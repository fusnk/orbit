//! Profiles ("Who's watching?"). Library, watch history and addon preferences
//! belong to a profile; the active one is held here, in Rust, and every
//! per-profile command reads it from here rather than taking an id from the
//! WebView. That's what makes a PIN meaningful: until a PIN-locked profile is
//! selected with its PIN, nothing can read its library or history.
//!
//! PINs are kept in the OS keychain (never in SQLite) as salted, slow hashes
//! (PBKDF2-HMAC-SHA256), and are only ever compared here; the WebView can set
//! or clear one but never read it. Anything running as the same OS user can
//! read the keychain entry, so the PIN itself isn't there to read: a hash
//! only slows guessing it offline (a 4-digit PIN has 10,000 values), while
//! the lockout below is what stops guessing in Orbit. PINs saved before
//! hashing are hashed at startup, or on their next right entry.
//!
//! A profile can have a content limit (Kids, Teens, …). The page does the
//! filtering; what's decided here is who may change a limit. Tightening one
//! needs only the usual right to edit the profile. Loosening or removing one
//! needs a parent: a profile without a limit that has a PIN, either by being
//! the active profile or by its PIN being typed. A limited profile's own PIN
//! can't be the key, because the child knows it (it's how they sign in).
//! While limited profiles exist, adding a profile needs a parent too,
//! otherwise a child could make themselves a new profile without a limit.

use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::keychain;
use crate::library::now_ms;

/// Wrong PINs allowed before a pause, and how long the first pause lasts;
/// each wrong PIN after that doubles it, up to `MAX_LOCKOUT`. A 4-digit PIN
/// has 10,000 values; this keeps guessing (by hand or by restarting Orbit
/// between tries) from being practical.
const MAX_ATTEMPTS: i64 = 5;
const LOCKOUT: Duration = Duration::from_secs(30);
const MAX_LOCKOUT: Duration = Duration::from_secs(60 * 60);
const MAX_NAME_CHARS: usize = 24;
/// The error the page answers by asking for a parent's PIN.
const PARENT_PIN_NEEDED: &str = "parent-pin-needed";
/// Changing a PIN-locked profile needs that profile to be the active one (see `can_manage`).
const SWITCH_FIRST: &str = "err.profile.switch-first";

#[derive(Default)]
pub struct ActiveProfile {
    id: Mutex<Option<String>>,
}

impl ActiveProfile {
    /// The selected profile, or an error before one is chosen.
    pub fn id(&self) -> Result<String, String> {
        self.id.lock().map_err(|_| "profiles unavailable".to_string())?.clone().ok_or_else(|| "no profile selected".into())
    }

    /// The selected profile, refusing a change made for `expected` once another
    /// is active: a save the page queued before a profile switch can land just
    /// after it, and mustn't be filed under the profile switched to.
    pub fn id_for(&self, expected: Option<&str>) -> Result<String, String> {
        let id = self.id()?;
        match expected {
            Some(expected) if expected != id => Err("the profile changed".into()),
            _ => Ok(id),
        }
    }

    fn set(&self, id: Option<String>) -> Result<(), String> {
        *self.id.lock().map_err(|_| "profiles unavailable")? = id;
        Ok(())
    }
}

/// Makes `id` the active profile, for other modules' tests.
#[cfg(test)]
pub(crate) fn select_for_test(active: &ActiveProfile, id: &str) {
    active.set(Some(id.into())).unwrap();

}

/// The pause after `failures` wrong PINs in a row (none before `MAX_ATTEMPTS`).
fn lockout_after(failures: i64) -> Duration {
    if failures < MAX_ATTEMPTS {
        return Duration::ZERO;
    }
    let doublings = u32::try_from(failures - MAX_ATTEMPTS).unwrap_or(0).min(16);
    (LOCKOUT * 2u32.pow(doublings)).min(MAX_LOCKOUT)
}

/// How a PIN is stored: `pbkdf2-sha256${iterations}${salt hex}${hash hex}`.
const PIN_HASH: &str = "pbkdf2-sha256";
/// OWASP's figure for PBKDF2-HMAC-SHA256: a fraction of a second per PIN typed,
/// and every one of the 10,000 PINs costs that much again to try offline.
const PIN_ITERATIONS: u32 = 600_000;
const PIN_SALT_BYTES: usize = 16;
const PIN_HASH_BYTES: usize = 32;
/// Keychain writes of PINs, one at a time: the startup upgrade reads, hashes and writes
/// back, and must not put an old PIN back over one set meanwhile.
static PIN_WRITES: Mutex<()> = Mutex::new(());

/// Runs `work` (a PIN hash: slow on purpose) where it can't stall the async
/// runtime. PIN checks are reached from async commands (picking a profile,
/// a parent's okay, unlocking Live TV groups) through plain functions, so
/// they can't await `spawn_blocking`; on a runtime worker this hands the
/// worker's other tasks to another thread for the duration instead. Off the
/// runtime (the startup upgrade's thread, tests) it just runs.
fn off_worker<T>(work: impl FnOnce() -> T) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => tokio::task::block_in_place(work),
        _ => work(),
    }
}

/// `pin` as it's stored: a fresh salt, and the PBKDF2 hash.
fn hash_pin(pin: &str) -> Result<String, String> {
    let mut salt = [0u8; PIN_SALT_BYTES];
    getrandom::fill(&mut salt).map_err(|_| "couldn't make a PIN salt")?;
    let mut hash = [0u8; PIN_HASH_BYTES];
    let iterations = std::num::NonZeroU32::new(PIN_ITERATIONS).ok_or("no iterations")?;
    off_worker(|| aws_lc_rs::pbkdf2::derive(aws_lc_rs::pbkdf2::PBKDF2_HMAC_SHA256, iterations, &salt, pin.as_bytes(), &mut hash));
    let hex = crate::connect::auth::hex;
    Ok(format!("{PIN_HASH}${PIN_ITERATIONS}${}${}", hex(&salt), hex(&hash)))
}

/// A stored hash's iterations, salt and hash; None for anything else.
fn parse_hash(stored: &str) -> Option<(std::num::NonZeroU32, Vec<u8>, Vec<u8>)> {
    let mut parts = stored.strip_prefix(PIN_HASH)?.strip_prefix('$')?.split('$');
    let iterations: u32 = parts.next()?.parse().ok()?;
    // Never more work than Orbit asks for (a damaged entry mustn't hang a PIN check), nor too little to mean anything.
    let iterations = std::num::NonZeroU32::new(iterations).filter(|n| (1000..=PIN_ITERATIONS * 10).contains(&n.get()))?;
    let unhex = crate::connect::auth::unhex;
    let (salt, hash) = (unhex(parts.next()?)?, unhex(parts.next()?)?);
    (parts.next().is_none() && salt.len() == PIN_SALT_BYTES && hash.len() == PIN_HASH_BYTES).then_some((iterations, salt, hash))
}

fn is_hashed(stored: &str) -> bool {
    parse_hash(stored).is_some()
}

#[cfg(test)]
thread_local! {
    /// How many slow (hashed) PIN checks this thread has run.
    static HASH_CHECKS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// Whether `pin` opens `stored`: its hash, compared in constant time; or a PIN saved
/// before hashing (plain). Anything that starts like a hash but doesn't read as one opens nothing.
fn pin_matches(pin: &str, stored: &str) -> bool {
    match parse_hash(stored) {
        Some((iterations, salt, hash)) => {
            #[cfg(test)]
            HASH_CHECKS.with(|n| n.set(n.get() + 1));
            off_worker(|| aws_lc_rs::pbkdf2::verify(aws_lc_rs::pbkdf2::PBKDF2_HMAC_SHA256, iterations, &salt, pin.as_bytes(), &hash).is_ok())
        }
        None => !stored.starts_with(PIN_HASH) && same(pin, stored),
    }
}

/// Saves `pin` (hashed) as `id`'s PIN.
fn store_pin(id: &str, pin: &str) -> Result<(), String> {
    let hashed = hash_pin(pin)?;
    let _writing = PIN_WRITES.lock().map_err(|_| "profiles unavailable")?;
    keychain::set(&pin_entry(id), &hashed)
}

/// A plain PIN just typed right: stored hashed from now on. A failure only leaves it as it was.
fn upgrade_pin(id: &str, pin: &str, stored: &str) {
    if is_hashed(stored) {
        return;
    }
    let Ok(hashed) = hash_pin(pin) else { return };
    let Ok(_writing) = PIN_WRITES.lock() else { return };
    // Still the PIN that was typed (not changed meanwhile).
    if keychain::get(&pin_entry(id)).ok().flatten().as_deref() == Some(stored)
        && let Err(e) = keychain::set(&pin_entry(id), &hashed)
    {
        crate::diagnostics::warn(&format!("profiles: couldn't store a PIN hashed: {e}"));
    }
}

/// Hashes every PIN saved before PINs were hashed (once, at startup, off the main thread).
/// Nobody is locked out: a PIN is only replaced by its own hash, and one that can't be is
/// left as it was (and hashed on its next right entry instead).
pub(crate) fn upgrade_plain_pins(db: &Db) {
    let Ok(profiles) = db.lock().and_then(|conn| list(&conn)) else { return };
    for profile in profiles {
        let Ok(_writing) = PIN_WRITES.lock() else { return };
        let entry = pin_entry(&profile.id);
        let Ok(Some(stored)) = keychain::get(&entry) else { continue };
        if is_hashed(&stored) || check_pin(&stored).is_err() {
            continue;
        }
        if let Err(e) = hash_pin(&stored).and_then(|hashed| keychain::set(&entry, &hashed)) {
            crate::diagnostics::warn(&format!("profiles: couldn't store a PIN hashed: {e}"));
        }
    }
}

/// A new database starts with a new "Me" profile (id `main`), but the keychain
/// outlives the database: uninstalling with "Delete the application data", or
/// deleting Orbit's data folder, leaves the old "Me"'s PIN behind. It would
/// lock the new profile behind a PIN the person may not remember, with no way
/// to reset it, so it goes with the old data. Other profiles' ids are random
/// and can't be reused. Called only when Orbit has just created its database.
pub(crate) fn forget_previous_main_pin() {
    if let Err(e) = keychain::delete(&pin_entry("main")) {
        crate::diagnostics::warn(&format!("profiles: couldn't remove a PIN left from an earlier install: {e}"));
    }
}

/// Checks `pin` against `stored` PINs (any one of them opens it: e.g. every
/// parent's for a parent's okay, as the page can't know which parent is
/// typing), as one `attempt` for their `owners`. Each check is slow on
/// purpose, so it stops at the first PIN that opens; a wrong PIN is tried
/// against them all. Which one matched isn't a secret worth hiding by timing:
/// whoever typed it knows the PIN. A plain PIN it opens is stored hashed after.
fn check_any(db: &Db, stored: &[(String, String)], pin: &str) -> Result<(), String> {
    let owners: Vec<&str> = stored.iter().map(|(id, _)| id.as_str()).collect();
    let mut hit = None;
    attempt(db, &owners, now_ms(), || {
        hit = stored.iter().position(|(_, expected)| pin_matches(pin, expected));
        hit
    })?;
    if let Some((id, expected)) = hit.and_then(|i| stored.get(i)) {
        upgrade_pin(id, pin, expected);
    }
    Ok(())
}

/// PIN attempts, one at a time (see `attempt`).
static ATTEMPTS: Mutex<()> = Mutex::new(());

/// A PIN that didn’t match (with no pause yet).
const WRONG_PIN: &str = "err.pin.wrong";

fn locked_error(ms: i64) -> String {
    crate::user_error::coded("pin.locked", &[("seconds", &(ms / 1000 + 1).to_string())])
}

/// One PIN attempt against the PINs of `owners` (one profile, or every
/// parent's when any parent's PIN will do), at `now` (ms). Each profile has
/// one counter, kept in the database, whatever the PIN is asked for
/// (choosing the profile, a parent's okay, Live TV's locked groups), so
/// neither another way in nor a restart gives more tries. Refused while any
/// of them is locked; a wrong PIN counts against them all. The right one
/// (`matches` gives its index in `owners`) clears only its owner's count:
/// knowing your own PIN mustn't reset the count on someone else's.
fn attempt(db: &Db, owners: &[&str], now: i64, matches: impl FnOnce() -> Option<usize>) -> Result<(), String> {
    // One attempt at a time, so two at once can't both get past the pause before either counts. The
    // database itself is held only to read and write the counters, not while a PIN is hashed (slow on
    // purpose), which would stall everything else Orbit reads or saves meanwhile.
    let _one = ATTEMPTS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let sql = |e: rusqlite::Error| e.to_string();
    let conn = db.lock()?;
    let mut locked_until = 0;
    // No pause is longer than `MAX_LOCKOUT`: one ending later was saved while the
    // clock ran ahead, and putting the clock right must not stretch it to that.
    let longest = now.saturating_add(i64::try_from(MAX_LOCKOUT.as_millis()).unwrap_or(i64::MAX));
    for owner in owners {
        conn.execute("UPDATE pin_failures SET locked_until = ?2 WHERE profile_id = ?1 AND locked_until > ?2", params![owner, longest]).map_err(sql)?;
        let until: Option<i64> = conn.query_row("SELECT locked_until FROM pin_failures WHERE profile_id = ?1", [owner], |r| r.get(0)).optional().map_err(sql)?;
        locked_until = locked_until.max(until.unwrap_or(0));
    }
    if now < locked_until {
        return Err(locked_error(locked_until - now));
    }
    drop(conn);
    let matched = matches();
    let conn = db.lock()?;
    if let Some(owner) = matched.and_then(|i| owners.get(i)) {
        conn.execute("DELETE FROM pin_failures WHERE profile_id = ?1", [owner]).map_err(sql)?;
        return Ok(());
    }
    let mut pause = Duration::ZERO;
    for owner in owners {
        let failures: i64 = conn.query_row("SELECT failures FROM pin_failures WHERE profile_id = ?1", [owner], |r| r.get(0)).optional().map_err(sql)?.unwrap_or(0) + 1;
        let lock = lockout_after(failures);
        let until = if lock.is_zero() { 0 } else { now + i64::try_from(lock.as_millis()).unwrap_or(i64::MAX / 2) };
        conn.execute(
            "INSERT INTO pin_failures (profile_id, failures, locked_until) VALUES (?1, ?2, ?3)
             ON CONFLICT(profile_id) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until",
            params![owner, failures, until],
        )
        .map_err(sql)?;
        pause = pause.max(lock);
    }
    if pause.is_zero() { Err(WRONG_PIN.into()) } else { Err(locked_error(i64::try_from(pause.as_millis()).unwrap_or(i64::MAX) - 1)) }
}

/// How much a profile may see; the page maps certifications to these
/// (catalog/ratings.ts). Stored as text, kebab-case.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Level {
    Off,
    Kids,
    OlderKids,
    Teens,
    NoAdult,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Off => "off",
            Level::Kids => "kids",
            Level::OlderKids => "older-kids",
            Level::Teens => "teens",
            Level::NoAdult => "no-adult",
        }
    }

    /// The table's CHECK allows only the five names; anything else would be a
    /// damaged file, and is read as the strictest level rather than as none.
    fn parse(text: &str) -> Level {
        match text {
            "off" => Level::Off,
            "older-kids" => Level::OlderKids,
            "teens" => Level::Teens,
            "no-adult" => Level::NoAdult,
            _ => Level::Kids,
        }
    }

    /// Higher is stricter.
    fn strictness(self) -> u8 {
        match self {
            Level::Off => 0,
            Level::NoAdult => 1,
            Level::Teens => 2,
            Level::OlderKids => 3,
            Level::Kids => 4,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentLimit {
    level: Level,
    /// Titles without a rating Orbit could find are shown.
    allow_unrated: bool,
    /// Live TV (IPTV channels carry no ratings) is shown.
    allow_live_tv: bool,
}

impl ContentLimit {
    /// Whether `next` would let the profile see anything this limit hides.
    fn loosened_by(&self, next: &ContentLimit) -> bool {
        if self.level == Level::Off {
            return false;
        }
        next.level.strictness() < self.level.strictness() || (next.allow_unrated && !self.allow_unrated) || (next.allow_live_tv && !self.allow_live_tv)
    }
}

/// Whether a parent has okayed a change (see the module comment).
#[derive(Debug, PartialEq, Eq)]
enum Guardian {
    /// No profile without a limit has a PIN, so there's no one to ask: limits
    /// are only as strong as a parent's PIN, and the page says so.
    NoneSet,
    Verified,
    Unverified,
}

/// Checks for a parent: the active profile being one, or `pin` being one's
/// PIN. `guardians` are the (id, PIN) of profiles without a limit that have a
/// PIN. A wrong PIN counts toward a lockout, as when choosing a profile.
fn check_guardian(db: &Db, active: &ActiveProfile, guardians: &[(String, String)], pin: Option<&str>) -> Result<Guardian, String> {
    if guardians.is_empty() {
        return Ok(Guardian::NoneSet);
    }
    if active.id().is_ok_and(|id| guardians.iter().any(|(g, _)| *g == id)) {
        return Ok(Guardian::Verified);
    }
    let Some(pin) = pin else { return Ok(Guardian::Unverified) };
    check_any(db, guardians, pin)?;
    Ok(Guardian::Verified)
}

/// Profiles without a limit that have a PIN, with their PINs. Reads the
/// keychain, so it's called without the database locked; a keychain that
/// can't be read is an error (failing closed) rather than "no parents".
fn guardians(profiles: &[Profile]) -> Result<Vec<(String, String)>, String> {
    let mut found = Vec::new();
    for profile in profiles.iter().filter(|p| p.content_limit.level == Level::Off) {
        if let Some(pin) = keychain::get(&pin_entry(&profile.id))? {
            found.push((profile.id.clone(), pin));
        }
    }
    Ok(found)
}

/// Who may change a limit: a parent always (even on a child's PIN-locked
/// profile, so a child's PIN can't lock the parent out); otherwise whoever may
/// edit the profile, but only to tighten it while a parent exists.
fn may_set_limit(manageable: bool, loosening: bool, guardian: &Guardian) -> Result<(), String> {
    match guardian {
        Guardian::Verified => Ok(()),
        Guardian::NoneSet if manageable => Ok(()),
        Guardian::Unverified if manageable && !loosening => Ok(()),
        Guardian::NoneSet => Err(SWITCH_FIRST.into()),
        Guardian::Unverified => Err(PARENT_PIN_NEEDED.into()),
    }
}

/// Deleting a limited profile takes its limit away, and once no limited
/// profile is left, adding one needs no parent: so it needs a parent, as
/// loosening the limit would (otherwise a child could delete their own
/// profile and add one without a limit).
/// `manageable`: see `can_manage`. As for a limit, a parent may delete a
/// limited profile even when the child gave it a PIN.
fn may_delete(manageable: bool, limit: &ContentLimit, guardian: &Guardian) -> Result<(), String> {
    match limit.level {
        Level::Off if manageable => Ok(()),
        Level::Off => Err(SWITCH_FIRST.into()),
        _ => may_set_limit(manageable, true, guardian),
    }
}

/// While any profile has a limit, adding one needs a parent (if there is one).
fn may_create(any_limited: bool, guardian: &Guardian) -> Result<(), String> {
    if any_limited && *guardian == Guardian::Unverified { Err(PARENT_PIN_NEEDED.into()) } else { Ok(()) }
}

/// Restoring a backup replaces the settings every profile shares (a parent's
/// choices among them) with whatever the file holds, so on a limited profile
/// it needs a parent (if there is one), as loosening the limit would.
fn may_restore(limited: bool, guardian: &Guardian) -> Result<(), String> {
    if limited && *guardian == Guardian::Unverified { Err(PARENT_PIN_NEEDED.into()) } else { Ok(()) }
}

/// Whether the active profile may restore a backup (see `may_restore`): a
/// profile without a limit always may; a limited one needs a parent, by
/// `guardian_pin`. Called without the database locked (it reads the keychain).
pub(crate) fn check_restore(db: &Db, active: &ActiveProfile, guardian_pin: Option<&str>) -> Result<(), String> {
    let profiles = list(&*db.lock()?)?;
    let id = active.id()?;
    // A profile that can't be found counts as limited: failing closed.
    let limited = profiles.iter().find(|p| p.id == id).is_none_or(|p| p.content_limit.level != Level::Off);
    if !limited {
        return Ok(());
    }
    may_restore(limited, &check_guardian(db, active, &guardians(&profiles)?, guardian_pin)?)
}

/// Whether the active profile may change a setting that a content limit
/// relies on (Discord's "hide on limited profiles"): the same rule as
/// restoring a backup, so a limited profile needs a parent's `guardian_pin`.
#[tauri::command]
pub async fn profile_check_parent(db: State<'_, Db>, active: State<'_, ActiveProfile>, guardian_pin: Option<String>) -> Result<(), String> {
    check_restore(&db, &active, guardian_pin.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    id: String,
    name: String,
    color: String,
    /// A bundled avatar's name, or None for the coloured initial.
    avatar: Option<String>,
    /// The profile whose addon list this one uses, or None for its own.
    addons_from: Option<String>,
    has_pin: bool,
    content_limit: ContentLimit,
}

fn pin_entry(id: &str) -> String {
    format!("profile-pin.{id}")
}

fn has_pin(id: &str) -> Result<bool, String> {
    keychain::get(&pin_entry(id)).map(|p| p.is_some())
}

fn check_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(crate::user_error::coded("profile.name-length", &[("max", &MAX_NAME_CHARS.to_string())]));
    }
    Ok(name.to_string())
}

/// Two profiles with the same name (ignoring case and the spaces `check_name`
/// trims) can't be told apart in the picker. `name` is already checked;
/// `except` is the profile being edited, which may keep its own name.
fn check_unique_name(profiles: &[Profile], name: &str, except: Option<&str>) -> Result<(), String> {
    let name = name.trim().to_lowercase();
    let taken = profiles.iter().any(|p| Some(p.id.as_str()) != except && p.name.trim().to_lowercase() == name);
    if taken { Err("err.profile.name-taken".into()) } else { Ok(()) }
}

fn check_color(color: &str) -> Result<(), String> {
    let ok = color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if ok { Ok(()) } else { Err("invalid colour".into()) }
}

/// Avatars are bundled with the app and named like "planet", or uploaded and
/// named like "upload-0123456789abcdef" (see avatars.rs); only the name is stored.
fn check_avatar(avatar: Option<&str>) -> Result<(), String> {
    match avatar {
        Some(a) if crate::avatars::is_upload_name(a) => Ok(()),
        Some(a) if a.starts_with("upload-") || a.is_empty() || a.len() > 24 || !a.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') => Err("invalid avatar".into()),
        _ => Ok(()),
    }
}

fn check_pin(pin: &str) -> Result<(), String> {
    if pin.len() == 4 && pin.bytes().all(|b| b.is_ascii_digit()) { Ok(()) } else { Err("err.pin.format".into()) }
}

/// Compares without stopping at the first difference, so timing reveals nothing.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn exists(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row("SELECT 1 FROM profiles WHERE id = ?1", [id], |_| Ok(()))
        .optional()
        .map(|r| r.is_some())
        .map_err(|e| e.to_string())
}

/// Runs `save` (storing a secret for `id`) only while profile `id` exists,
/// with the database held meanwhile. A sign-in that finishes after its
/// profile was deleted would otherwise leave that profile's secret in the
/// keychain for good: `profile_delete` removes the rows with the database
/// held and clears the keychain after, so a save either lands first (and is
/// cleared) or finds the profile gone.
pub(crate) fn save_for_profile(db: &Db, id: &str, save: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let conn = db.lock()?;
    if !exists(&conn, id)? {
        return Err("no such profile".into());
    }
    save()
}

/// Profiles without `has_pin` filled in (see `with_pins`).
fn list(conn: &Connection) -> Result<Vec<Profile>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, color, avatar, addons_from, content_limit, limit_unrated, limit_live_tv FROM profiles ORDER BY position, created_at")
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |row| {
        let content_limit = ContentLimit { level: Level::parse(&row.get::<_, String>(5)?), allow_unrated: row.get(6)?, allow_live_tv: row.get(7)? };
        Ok(Profile { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, avatar: row.get(3)?, addons_from: row.get(4)?, has_pin: false, content_limit })
    })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())
}

/// Fills in `has_pin` from the keychain. Called without the database locked:
/// the keychain can be slow or wait on an unlock prompt, and every other
/// command would wait behind it. A keychain that can't be read counts as a
/// PIN (failing closed), so "Who's watching?" still shows and choosing a
/// profile reports the keychain error instead of startup stalling on it.
fn with_pins(profiles: Vec<Profile>) -> Vec<Profile> {
    profiles.into_iter().map(|p| Profile { has_pin: has_pin(&p.id).unwrap_or(true), ..p }).collect()
}

/// Changing or deleting a profile needs that profile to be the active one,
/// unless it has no PIN (then anyone at the computer could pick it anyway).
fn can_manage(active: &ActiveProfile, id: &str) -> Result<(), String> {
    if active.id().ok().as_deref() == Some(id) || !has_pin(id)? {
        Ok(())
    } else {
        Err(SWITCH_FIRST.into())
    }
}

/// The PINs that open the active profile's locked Live TV groups: any
/// parent's (see `guardians`, which includes the profile's own when it has no
/// limit). A limited profile's own PIN counts only while there's no parent:
/// a child knows their own PIN (and can set it), so it must not open groups a
/// parent locked. Empty when none is set.
fn group_pins(db: &Db, active: &ActiveProfile) -> Result<Vec<(String, String)>, String> {
    let id = active.id()?;
    let profiles = list(&*db.lock()?)?;
    let mut pins = guardians(&profiles)?;
    // A parent's own PIN first: the likeliest one typed, so the check stops there.
    pins.sort_by_key(|(owner, _)| *owner != id);
    if pins.is_empty()
        && let Some(own) = keychain::get(&pin_entry(&id))?
    {
        pins.push((id, own));
    }
    Ok(pins)
}

/// Whether `profile` may watch Live TV: it has no content limit, or its limit
/// allows Live TV. Checked in Rust (iptv/mod.rs) as well as by the page, so no
/// way of starting a channel can leave it out; a profile that can't be found
/// may not (failing closed).
pub(crate) fn live_tv_allowed(conn: &Connection, profile: &str) -> Result<bool, String> {
    let row: Option<(String, bool)> = conn
        .query_row("SELECT content_limit, limit_live_tv FROM profiles WHERE id = ?1", [profile], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row.is_some_and(|(level, live)| Level::parse(&level) == Level::Off || live))
}

/// Whether any PIN could open a locked Live TV group (so locking one means something).
pub(crate) fn has_group_pin(db: &Db, active: &ActiveProfile) -> Result<bool, String> {
    group_pins(db, active).map(|pins| !pins.is_empty())
}

/// Checks `pin` against the PINs that open locked Live TV groups, with the
/// same lockout as choosing a profile. With no PIN set anywhere there's
/// nothing to check against, and the lock is only as strong as that (as with
/// content limits): it opens.
pub(crate) fn check_group_pin(db: &Db, active: &ActiveProfile, pin: &str) -> Result<(), String> {
    let pins = group_pins(db, active)?;
    if pins.is_empty() {
        return Ok(());
    }
    check_any(db, &pins, pin)
}

/// Settings kept per profile, as `{prefix}.{profile id}` (see the page's
/// player/profile-store.ts, home/rows.ts and `profileSetting` in library/profiles.ts).
pub(crate) const PROFILE_SETTINGS: [&str; 35] = [
    "home.layout",
    "player.track-memory",
    "player.transcript-whole",
    "player.failed-sources",
    "search.recent",
    "letterboxd.profile",
    "stremio.sync",
    // Titles still to send to Stremio, kept across restarts (see the page's library/stremio-sync.ts).
    "stremio.pending",
    "anilist.sync",
    "library.queue",
    "downloads.keep-next",
    "discover.recent-genres",
    "history.cleared",
    // Discover: its sections' order, and the profile's taste (liked, not interested, added Letterboxd lists).
    "explore.layout",
    "explore.taste",
    // Discover's grid filters (rating, year, genres, sort, hide watched…).
    "explore.filters",
    // Settings → Playback → Autoplay limits (lowest/highest quality, largest file).
    "playback.autoplay-limits",
    // The source each title last played from (fingerprints only), and "When resuming".
    "player.last-source",
    "playback.resume-source",
    // My Library → Calendar: episodes, films or both, and which film releases.
    "calendar.filter",
    // New episode alerts: the choices (Settings → Library & Metadata), and which episodes were already announced.
    "alerts.prefs",
    "alerts.seen",
    // Episode reminders: which shows, how many days before, and which episodes were reminded.
    "alerts.reminders",
    // Settings → Library & Metadata → Spoilers: what to hide about unwatched episodes.
    "library.spoilers",
    // Quick settings → Pause watch history: playback records nothing while it's on.
    "history.paused",
    // Where intros were skipped by hand in each series (see the page's player/learned-skips.ts).
    "player.learned-skips",
    // The command palette's recent picks.
    "palette.recent",
    // Settings → Playback → Rewind cache (see player/rewind_cache.rs).
    "playback.rewind-cache",
    // My Library's genre, status and rated filters.
    "library.filters",
    // The player's volume boost preset (Sound view: Off, 125%, 150%, 200%).
    "player.volume-boost-level",
    // Settings → Audio → Output device (see player/outputs.rs).
    "player.audio-device",
    // Settings → Video → Smooth motion, and whether the copy-link warning was shown.
    "video.smooth-motion",
    "player.copy-link-warned",
    // Whether Shorts' trailers play with sound (see the page's rooms/shorts/sound.ts).
    "shorts.sound",
    // Live TV's last group and channel (see the page's live/surf.ts).
    "live.last",
];

/// Whether settings key `key` is `profile`'s own copy of a per-profile setting.
pub(crate) fn profile_setting(key: &str) -> Option<(&'static str, &str)> {
    PROFILE_SETTINGS.iter().find_map(|prefix| key.strip_prefix(prefix)?.strip_prefix('.').map(|id| (*prefix, id)))
}

/// Removes everything a profile owns: library, history, lists, collections, ratings and notes, favourite episodes, its own addons,
/// its addon preferences, Live TV sources and favourites, its Jellyfin
/// and Plex servers, its debrid accounts, and its settings.
/// (Downloads go separately, as they have files; see `downloads::remove_profile`. So do the
/// big Live TV tables, a chunk at a time: VOD indexes before, guides after; see `profile_delete`.)
fn delete_rows(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for table in ["iptv_channels", "iptv_vod_locators"] {
        tx.execute(&format!("DELETE FROM {table} WHERE source_id IN (SELECT id FROM iptv_sources WHERE profile_id = ?1)"), [id])?;
    }
    tx.execute("DELETE FROM iptv_favourites WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM iptv_groups WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM iptv_sources WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM jellyfin_servers WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM plex_servers WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM debrid_accounts WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM pin_failures WHERE profile_id = ?1", [id])?;
    for prefix in PROFILE_SETTINGS {
        tx.execute("DELETE FROM settings WHERE key = ?1", [format!("{prefix}.{id}")])?;
    }
    tx.execute("DELETE FROM library WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM watch_titles WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM watch_progress WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE profile_id = ?1)", [id])?;
    tx.execute("DELETE FROM lists WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE profile_id = ?1)", [id])?;
    tx.execute("DELETE FROM collections WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM user_ratings WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM favourite_episodes WHERE profile_id = ?1", [id])?;
    tx.execute("DELETE FROM addon_prefs WHERE profile_id = ?1 OR addon_key IN (SELECT key FROM addons WHERE owner = ?1)", [id])?;
    tx.execute("DELETE FROM addons WHERE owner = ?1", [id])?;
    // Profiles that used its addons go back to their own lists.
    tx.execute("UPDATE profiles SET addons_from = NULL WHERE addons_from = ?1", [id])?;
    tx.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
    tx.commit()
}

#[tauri::command]
pub async fn profile_list(db: State<'_, Db>) -> Result<Vec<Profile>, String> {
    let profiles = list(&*db.lock()?)?;
    Ok(with_pins(profiles))
}

#[tauri::command]
pub async fn profile_active(active: State<'_, ActiveProfile>) -> Result<Option<String>, String> {
    Ok(active.id().ok())
}

/// Makes `id` the active profile, checking its PIN if it has one.
#[tauri::command]
pub async fn profile_select(db: State<'_, Db>, active: State<'_, ActiveProfile>, remote: State<'_, crate::remote::Remote>, id: String, pin: Option<String>) -> Result<(), String> {
    if !exists(&*db.lock()?, &id)? {
        return Err("no such profile".into());
    }
    if let Some(expected) = keychain::get(&pin_entry(&id))? {
        check_any(&db, &[(id.clone(), expected)], pin.as_deref().unwrap_or_default())?;
    }
    // Live TV's locked groups ask again on the next profile.
    crate::iptv::lock_groups();
    // A paired phone's search results were the last profile's (and its content limit's).
    remote.clear_search();
    remote.clear_picker();
    active.set(Some(id))
}

/// Adds a profile (without a limit). While any profile has a limit, this
/// needs a parent: being one, or `guardian_pin`.
#[tauri::command]
pub async fn profile_create(
    db: State<'_, Db>,
    active: State<'_, ActiveProfile>,
    name: String,
    color: String,
    avatar: Option<String>,
    guardian_pin: Option<String>,
) -> Result<Profile, String> {
    let name = check_name(&name)?;
    check_color(&color)?;
    check_avatar(avatar.as_deref())?;
    let profiles = list(&*db.lock()?)?;
    check_unique_name(&profiles, &name, None)?;
    let any_limited = profiles.iter().any(|p| p.content_limit.level != Level::Off);
    if any_limited {
        may_create(any_limited, &check_guardian(&db, &active, &guardians(&profiles)?, guardian_pin.as_deref())?)?;
    }
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|_| "couldn't create a profile id")?;
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let conn = db.lock()?;
    conn.execute(
        "INSERT INTO profiles (id, name, color, avatar, position, created_at)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position) + 1, 0) FROM profiles), ?5)",
        params![id, name, color, avatar, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    let content_limit = ContentLimit { level: Level::Off, allow_unrated: true, allow_live_tv: true };
    Ok(Profile { id, name, color, avatar, addons_from: None, has_pin: false, content_limit })
}

/// Sets a profile's content limit. Loosening or removing one needs a parent
/// (see `may_set_limit`): being one, or `guardian_pin`.
#[tauri::command]
pub async fn profile_set_limit(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, limit: ContentLimit, guardian_pin: Option<String>) -> Result<(), String> {
    let profiles = list(&*db.lock()?)?;
    let current = profiles.iter().find(|p| p.id == id).ok_or("no such profile")?.content_limit;
    let guardian = check_guardian(&db, &active, &guardians(&profiles)?, guardian_pin.as_deref())?;
    may_set_limit(can_manage(&active, &id).is_ok(), current.loosened_by(&limit), &guardian)?;
    db.lock()?
        .execute(
            "UPDATE profiles SET content_limit = ?1, limit_unrated = ?2, limit_live_tv = ?3 WHERE id = ?4",
            params![limit.level.as_str(), limit.allow_unrated, limit.allow_live_tv, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn profile_update(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, name: String, color: String, avatar: Option<String>) -> Result<(), String> {
    let name = check_name(&name)?;
    check_color(&color)?;
    check_avatar(avatar.as_deref())?;
    can_manage(&active, &id)?;
    let conn = db.lock()?;
    check_unique_name(&list(&conn)?, &name, Some(&id))?;
    let changed = conn
        .execute("UPDATE profiles SET name = ?1, color = ?2, avatar = ?3 WHERE id = ?4", params![name, color, avatar, id])
        .map_err(|e| e.to_string())?;
    if changed == 0 { Err("no such profile".into()) } else { Ok(()) }
}

fn addons_from(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT addons_from FROM profiles WHERE id = ?1", [id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no such profile".into())
}

/// Checks a link from `id` to `from`'s addons. Links are one level deep: a
/// profile others follow can't follow anyone, and can't be followed through.
fn check_link(conn: &Connection, id: &str, from: &str) -> Result<(), String> {
    if id == from {
        return Err("a profile can't follow itself".into());
    }
    if addons_from(conn, from)?.is_some() {
        return Err("err.profile.follows-other".into());
    }
    let followers: i64 = conn.query_row("SELECT COUNT(*) FROM profiles WHERE addons_from = ?1", [id], |row| row.get(0)).map_err(|e| e.to_string())?;
    if followers > 0 {
        return Err("err.profile.has-followers".into());
    }
    Ok(())
}

/// Makes `id` use `from`'s addon list (read-only, live), or with `None` its own
/// list again. Linking gives `id` the use of `from`'s private addons, and
/// unlinking undoes a restriction, so both need `from`'s say-so: its PIN (by
/// being the active profile) when it has one. That's what lets a parent lock
/// a kid's profile to their list.
#[tauri::command]
pub async fn profile_set_addons_from(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, from: Option<String>) -> Result<(), String> {
    can_manage(&active, &id)?;
    let conn = db.lock()?;
    if let Some(current) = addons_from(&conn, &id)? {
        can_manage(&active, &current)?;
    }
    if let Some(from) = &from {
        check_link(&conn, &id, from)?;
        can_manage(&active, from)?;
    }
    conn.execute("UPDATE profiles SET addons_from = ?1 WHERE id = ?2", params![from, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Sets or (with `None`) removes the active profile's PIN.
#[tauri::command]
pub async fn profile_set_pin(active: State<'_, ActiveProfile>, pin: Option<String>) -> Result<(), String> {
    let id = active.id()?;
    match pin {
        Some(pin) => {
            check_pin(&pin)?;
            store_pin(&id, &pin)
        }
        None => keychain::delete(&pin_entry(&id)),
    }
}

/// Deletes a profile and everything it owns. The last profile can't be
/// deleted, and a limited one needs a parent (see `may_delete`): being one, or `guardian_pin`.
#[tauri::command]
pub async fn profile_delete(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, guardian_pin: Option<String>) -> Result<(), String> {
    let profiles = list(&*db.lock()?)?;
    let limit = profiles.iter().find(|p| p.id == id).ok_or("no such profile")?.content_limit;
    if limit.level == Level::Off {
        can_manage(&active, &id)?;
    } else {
        may_delete(can_manage(&active, &id).is_ok(), &limit, &check_guardian(&db, &active, &guardians(&profiles)?, guardian_pin.as_deref())?)?;
    }
    // Checked again below, with the delete; asked here too so the last profile's Live TV isn't touched.
    if profiles.len() <= 1 {
        return Err("err.profile.last".into());
    }
    // Live TV's VOD indexes and guides can be hundreds of thousands of rows: cleared a chunk
    // at a time around the delete (see `iptv::drop_vod_indexes`), not inside its transaction.
    let (sweeper, owner) = (app.clone(), id.clone());
    let sources = tauri::async_runtime::spawn_blocking(move || crate::iptv::drop_vod_indexes(&sweeper.state::<Db>(), &owner, None))
        .await
        .map_err(|e| e.to_string())??;
    {
        let mut conn = db.lock()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if count <= 1 {
            return Err("err.profile.last".into());
        }
        delete_rows(&mut conn, &id).map_err(|e| e.to_string())?;
    }
    crate::iptv::drop_guides_later(&app, sources);
    // Every step runs even if one before it failed, so one keychain error
    // doesn't leave the rest of the profile's secrets and downloads behind.
    let active_cleared = if active.id().ok().as_deref() == Some(id.as_str()) { active.set(None) } else { Ok(()) };
    let downloads = crate::downloads::remove_profile(&app, &id).await;
    all_done([
        ("active profile", active_cleared),
        ("PIN", keychain::delete(&pin_entry(&id))),
        ("Stremio sign-in", crate::stremio::forget(&id)),
        ("AniList sign-in", crate::anilist::forget(&id)),
        ("debrid keys", crate::debrid::forget(&id)),
        ("translation keys", crate::player::subtrans::forget(&id)),
        ("downloads", downloads),
        ("picture", crate::avatars::remove_unused(&app, &db)),
    ])
}

/// Ok if every step of a cleanup went through; otherwise a coded error. The
/// steps that failed are logged by name (never their own error, which could
/// carry a secret); the person is told only what to do.
pub(crate) fn all_done<'a>(steps: impl IntoIterator<Item = (&'a str, Result<(), String>)>) -> Result<(), String> {
    let failed: Vec<&str> = steps.into_iter().filter(|(_, result)| result.is_err()).map(|(name, _)| name).collect();
    if failed.is_empty() {
        return Ok(());
    }
    eprintln!("profile cleanup: couldn't remove {}", failed.join(", "));
    Err("err.profile.cleanup".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn cleanup_fails_without_naming_the_steps() {
        assert!(all_done([("PIN", Ok(())), ("downloads", Ok(()))]).is_ok());
        let err = all_done([("PIN", Err("keychain operation failed".into())), ("Stremio sign-in", Ok(())), ("downloads", Err("x".into()))]).unwrap_err();
        assert_eq!(err, "err.profile.cleanup");
    }

    #[test]
    fn validates_names_colours_and_pins() {
        assert_eq!(check_name("  Sam ").unwrap(), "Sam");
        assert!(check_name("").is_err() && check_name("a\nb").is_err() && check_name(&"x".repeat(25)).is_err());
        // Shown to the person (an empty name in the editor), so in their language: a code the page has words for.
        assert_eq!(check_name("  ").unwrap_err(), "err.profile.name-length|max=24");
        assert!(check_color("#e5484d").is_ok() && check_color("red").is_err() && check_color("#e5484").is_err());
        assert!(check_avatar(None).is_ok() && check_avatar(Some("planet")).is_ok());
        assert!(check_avatar(Some("../x")).is_err() && check_avatar(Some("")).is_err() && check_avatar(Some("Planet")).is_err());
        assert!(check_avatar(Some("upload-0123456789abcdef")).is_ok() && check_avatar(Some("upload-xyz")).is_err());
        assert!(check_pin("0123").is_ok() && check_pin("123").is_err() && check_pin("12a4").is_err() && check_pin("12345").is_err());
        assert!(same("1234", "1234") && !same("1234", "1235") && !same("1234", "123"));
    }

    #[test]
    fn pins_are_kept_as_salted_slow_hashes_and_old_plain_ones_still_open() {
        let stored = hash_pin("0420").unwrap();
        // Not the PIN, and not the same twice (a fresh salt each time).
        assert!(stored.starts_with("pbkdf2-sha256$") && !stored.contains("0420"), "{stored}");
        assert_ne!(stored, hash_pin("0420").unwrap());
        assert!(is_hashed(&stored));
        assert!(pin_matches("0420", &stored));
        assert!(!pin_matches("0421", &stored) && !pin_matches("", &stored));
        // A PIN saved before hashing (plain in the keychain) still opens, and is marked for upgrading.
        assert!(pin_matches("1234", "1234") && !pin_matches("1235", "1234"));
        assert!(!is_hashed("1234"));
        // A damaged hash opens nothing, not even as a plain PIN.
        for damaged in ["pbkdf2-sha256$", "pbkdf2-sha256$0$00$00", "pbkdf2-sha256$600000$zz$00", "pbkdf2-sha256$600000$00"] {
            assert!(!pin_matches(damaged, damaged) && !pin_matches("1234", damaged), "{damaged}");
        }
    }

    #[test]
    fn pauses_start_at_the_fifth_wrong_pin_and_double_up_to_an_hour() {
        for failures in [-1, 0, MAX_ATTEMPTS - 1] {
            assert_eq!(lockout_after(failures), Duration::ZERO, "{failures}");
        }
        let secs: Vec<u64> = (MAX_ATTEMPTS..MAX_ATTEMPTS + 9).map(|n| lockout_after(n).as_secs()).collect();
        assert_eq!(secs, [30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
        assert_eq!(lockout_after(MAX_ATTEMPTS + i64::from(u32::MAX)), MAX_LOCKOUT);
    }

    #[test]
    fn a_stored_hash_must_ask_for_a_sensible_amount_of_work() {
        let (salt, hash) = ("00".repeat(PIN_SALT_BYTES), "11".repeat(PIN_HASH_BYTES));
        let stored = |iterations: u64| format!("pbkdf2-sha256${iterations}${salt}${hash}");
        assert!(parse_hash(&stored(1000)).is_some() && parse_hash(&stored(u64::from(PIN_ITERATIONS) * 10)).is_some());
        // Too little to mean anything, or so much that a damaged entry would hang the PIN check.
        for odd in [0, 999, u64::from(PIN_ITERATIONS) * 10 + 1, u64::from(u32::MAX) + 1] {
            assert!(parse_hash(&stored(odd)).is_none(), "{odd}");
        }
        // Salt and hash of the wrong length, or a part too many, read as damaged.
        assert!(parse_hash(&format!("pbkdf2-sha256$600000${}${hash}", "00".repeat(PIN_SALT_BYTES - 1))).is_none());
        assert!(parse_hash(&format!("pbkdf2-sha256$600000${salt}${}", "11".repeat(PIN_HASH_BYTES + 1))).is_none());
        assert!(parse_hash(&format!("{}$extra", stored(600_000))).is_none());
        assert!(parse_hash(&stored(600_000).replace("pbkdf2-sha256", "pbkdf2-sha1")).is_none());
    }

    #[test]
    fn a_secret_is_saved_only_for_a_profile_that_still_exists() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let mut saved = 0;
        let mut save = || {
            saved += 1;
            Ok(())
        };
        save_for_profile(&db, "main", &mut save).unwrap();
        // Deleted while a browser sign-in was still open.
        assert!(save_for_profile(&db, "gone", &mut save).is_err());
        assert_eq!(saved, 1);
    }

    #[test]
    fn names_are_one_per_profile() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, color, position, created_at) VALUES ('sam', 'Sam', '#46c28e', 5, 5)", []).unwrap();
        let profiles = list(&conn).unwrap();
        for taken in ["Sam", "sam", "SAM"] {
            assert_eq!(check_unique_name(&profiles, taken, None).unwrap_err(), "err.profile.name-taken", "{taken}");
        }
        assert!(check_unique_name(&profiles, "Sammy", None).is_ok());
        // A profile keeps its own name (or changes its case) when edited.
        assert!(check_unique_name(&profiles, "sam", Some("sam")).is_ok());
    }

    #[test]
    fn migration_moves_existing_data_into_the_first_profile() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Data as it looked at v5, then upgrade.
        conn.pragma_update(None, "user_version", 0).unwrap();
        let v5 = &crate::db::MIGRATIONS[..5];
        for sql in v5 {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 5).unwrap();
        conn.execute("INSERT INTO library (id, added_at, title) VALUES ('tt1', 1, '{}')", []).unwrap();
        conn.execute("INSERT INTO watch_progress VALUES ('tt1', 'tt1', NULL, NULL, 5.0, 10.0, 0, 1)", []).unwrap();
        conn.execute(
            "INSERT INTO addons (key, position, enabled, installed_at, display_host, manifest, transport_url, builtin) VALUES ('k', 3, 0, 1, 'h', '{}', x'00', 0)",
            [],
        )
        .unwrap();
        crate::db::migrate(&mut conn).unwrap();

        let owner: (String, i64) = conn.query_row("SELECT owner, shared FROM addons", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(owner, ("main".into(), 1));
        let prefs: (i64, i64) = conn.query_row("SELECT enabled, position FROM addon_prefs WHERE profile_id = 'main'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(prefs, (0, 3));
        let lib: String = conn.query_row("SELECT profile_id FROM library", [], |r| r.get(0)).unwrap();
        assert_eq!(lib, "main");
        let watch: String = conn.query_row("SELECT profile_id FROM watch_progress", [], |r| r.get(0)).unwrap();
        assert_eq!(watch, "main");
        let profiles: i64 = conn.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0)).unwrap();
        assert_eq!(profiles, 1);
    }

    #[test]
    fn deleting_a_profile_removes_what_it_owns() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, color, position, created_at) VALUES ('p2', 'Kid', '#46c28e', 1, 2)", []).unwrap();
        conn.execute("INSERT INTO library VALUES ('p2', 'tt1', 1, '{}')", []).unwrap();
        conn.execute("INSERT INTO library VALUES ('main', 'tt1', 1, '{}')", []).unwrap();
        conn.execute("INSERT INTO addons (key, installed_at, display_host, manifest, transport_url, builtin, owner, shared) VALUES ('a', 1, 'h', '{}', x'00', 0, 'p2', 1)", []).unwrap();
        conn.execute("INSERT INTO addon_prefs (profile_id, addon_key, position) VALUES ('main', 'a', 0)", []).unwrap();
        for p in ["p2", "main"] {
            conn.execute(
                "INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES (?1 || '-src', ?1, 'TV', 'm3u', 'h', 0, x'00', 1, 1)",
                [p],
            )
            .unwrap();
            conn.execute("INSERT INTO iptv_channels (source_id, key, position, name) VALUES (?1 || '-src', 'c', 0, 'One')", [p]).unwrap();
            conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title) VALUES (?1 || '-src', 'c', 0, 1, 'News')", [p]).unwrap();
            conn.execute("INSERT INTO iptv_favourites VALUES (?1, ?1 || '-src', 'c', 0)", [p]).unwrap();
            conn.execute("INSERT INTO iptv_groups VALUES (?1, 'News', 0, 1, 0)", [p]).unwrap();
            conn.execute("INSERT INTO jellyfin_servers VALUES (?1, 's', 'Den', 'h', 1, 'u', x'00', 1)", [p]).unwrap();
            conn.execute("INSERT INTO plex_servers VALUES (?1, 's', 'Den', 'h', 1, 'u', x'00', 1)", [p]).unwrap();
            conn.execute("INSERT INTO debrid_accounts VALUES (?1, 'torbox', 'u', NULL, 1)", [p]).unwrap();
            conn.execute("INSERT INTO collections VALUES (?1 || '-col', ?1, 0, 'Saga', NULL, '{}', '[]', 1)", [p]).unwrap();
            conn.execute("INSERT INTO collection_items VALUES (?1 || '-col', 'tt1', 0, '{}')", [p]).unwrap();
            conn.execute("INSERT INTO user_ratings VALUES (?1, 'tt1', 7, 1, 'Note', 1)", [p]).unwrap();
            conn.execute("INSERT INTO favourite_episodes VALUES (?1, 'tt1', 1, 2, 'tt1:1:2', 'Pilot', NULL, '{}', 1)", [p]).unwrap();
            conn.execute("INSERT INTO settings VALUES ('player.track-memory.' || ?1, '[]')", [p]).unwrap();
            conn.execute("INSERT INTO settings VALUES ('home.layout.' || ?1, '{}')", [p]).unwrap();
            conn.execute("INSERT INTO settings VALUES ('stremio.sync.' || ?1, 'false')", [p]).unwrap();
            conn.execute("INSERT INTO settings VALUES ('library.queue.' || ?1, '[]')", [p]).unwrap();
            conn.execute("INSERT INTO settings VALUES ('downloads.keep-next.' || ?1, '{}')", [p]).unwrap();
            conn.execute("INSERT INTO settings VALUES ('discover.recent-genres.' || ?1, '[]')", [p]).unwrap();
        }
        conn.execute("INSERT INTO settings VALUES ('live.last.p2', '{\"group\":\"all\"}'), ('live.last.main', '{\"group\":\"all\"}')", []).unwrap();
        delete_rows(&mut conn, "p2").unwrap();
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!((count("SELECT COUNT(*) FROM library"), count("SELECT COUNT(*) FROM addons"), count("SELECT COUNT(*) FROM addon_prefs")), (1, 0, 0));
        // Live TV and settings: only the other profile's are left.
        for table in ["iptv_sources", "iptv_channels", "iptv_favourites", "iptv_groups", "jellyfin_servers", "plex_servers", "debrid_accounts", "collections", "collection_items", "user_ratings", "favourite_episodes"] {
            assert_eq!(count(&format!("SELECT COUNT(*) FROM {table}")), 1, "{table}");
        }
        assert_eq!(count("SELECT COUNT(*) FROM iptv_sources WHERE profile_id = 'main'"), 1);
        // Guides are cleared afterwards, a chunk at a time (`iptv::drop_guides_later`), not in the transaction.
        assert_eq!(count("SELECT COUNT(*) FROM iptv_programmes"), 2);
        assert_eq!(count("SELECT COUNT(*) FROM settings WHERE key LIKE '%.p2'"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM settings WHERE key LIKE '%.main'"), 7);
    }

    #[test]
    fn recognises_per_profile_settings() {
        assert_eq!(profile_setting("home.layout.0123456789abcdef"), Some(("home.layout", "0123456789abcdef")));
        assert_eq!(profile_setting("player.track-memory.main"), Some(("player.track-memory", "main")));
        assert_eq!(profile_setting("search.recent.main"), Some(("search.recent", "main")));
        assert_eq!(profile_setting("letterboxd.profile.main"), Some(("letterboxd.profile", "main")));
        assert_eq!(profile_setting("stremio.sync.main"), Some(("stremio.sync", "main")));
        assert_eq!(profile_setting("library.queue.main"), Some(("library.queue", "main")));
        assert_eq!(profile_setting("downloads.keep-next.main"), Some(("downloads.keep-next", "main")));
        assert_eq!(profile_setting("library.queue"), None);
        assert_eq!(profile_setting("downloads.keep-next"), None);
        assert_eq!(profile_setting("discover.recent-genres.main"), Some(("discover.recent-genres", "main")));
        assert_eq!(profile_setting("discover.recent-genres"), None);
        // The player's smooth motion and copy-link warning are per profile too (go with the profile, stay out of others' backups).
        assert_eq!(profile_setting("video.smooth-motion.main"), Some(("video.smooth-motion", "main")));
        assert_eq!(profile_setting("player.copy-link-warned.main"), Some(("player.copy-link-warned", "main")));
        assert_eq!(profile_setting("explore.layout.main"), Some(("explore.layout", "main")));
        assert_eq!(profile_setting("explore.taste.main"), Some(("explore.taste", "main")));
        assert_eq!(profile_setting("explore.taste"), None);
        assert_eq!(profile_setting("playback.autoplay-limits.main"), Some(("playback.autoplay-limits", "main")));
        assert_eq!(profile_setting("playback.autoplay-limits"), None);
        assert_eq!(profile_setting("library.sort"), None);
        assert_eq!(profile_setting("home.layout"), None);
        assert_eq!(profile_setting("search.recent"), None);
        assert_eq!(profile_setting("palette.recent.main"), Some(("palette.recent", "main")));
        assert_eq!(profile_setting("palette.recent"), None);
        // Shorts' sound switch (rooms/shorts/sound.ts) is saved per profile too.
        assert_eq!(profile_setting("shorts.sound.main"), Some(("shorts.sound", "main")));
        assert_eq!(profile_setting("home.layoutx.main"), None);
        assert_eq!(profile_setting("theme"), None);
        // Live TV's last group and channel: one per profile, out of other profiles' reach.
        assert_eq!(profile_setting("live.last.main"), Some(("live.last", "main")));
        assert_eq!(profile_setting("live.last"), None);
    }

    const fn limit(level: Level, allow_unrated: bool, allow_live_tv: bool) -> ContentLimit {
        ContentLimit { level, allow_unrated, allow_live_tv }
    }

    #[test]
    fn knows_which_changes_loosen_a_limit() {
        let kids = limit(Level::Kids, false, false);
        // Less strict levels, or turning an allowance on, loosen it.
        for next in [limit(Level::Off, false, false), limit(Level::OlderKids, false, false), limit(Level::NoAdult, false, false), limit(Level::Kids, true, false), limit(Level::Kids, false, true)] {
            assert!(kids.loosened_by(&next), "{next:?}");
        }
        assert!(!kids.loosened_by(&kids));
        let teens = limit(Level::Teens, true, true);
        // Stricter levels and turning allowances off tighten it.
        for next in [limit(Level::Kids, true, true), limit(Level::OlderKids, false, false), limit(Level::Teens, false, true), limit(Level::Teens, true, false)] {
            assert!(!teens.loosened_by(&next), "{next:?}");
        }
        assert!(teens.loosened_by(&limit(Level::NoAdult, true, true)));
        // No limit: there is nothing to loosen.
        assert!(!limit(Level::Off, true, true).loosened_by(&limit(Level::Off, true, true)));
        assert!(!limit(Level::Off, false, false).loosened_by(&kids));
    }

    #[test]
    fn live_tv_follows_the_profiles_limit() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        assert!(live_tv_allowed(&conn, "main").unwrap());
        conn.execute("UPDATE profiles SET content_limit = 'teens', limit_live_tv = 1 WHERE id = 'main'", []).unwrap();
        assert!(live_tv_allowed(&conn, "main").unwrap());
        conn.execute("UPDATE profiles SET limit_live_tv = 0 WHERE id = 'main'", []).unwrap();
        assert!(!live_tv_allowed(&conn, "main").unwrap());
        // No limit: the switch (left off by an earlier limit) doesn't matter.
        conn.execute("UPDATE profiles SET content_limit = 'off' WHERE id = 'main'", []).unwrap();
        assert!(live_tv_allowed(&conn, "main").unwrap());
        assert!(!live_tv_allowed(&conn, "gone").unwrap());
    }

    #[test]
    fn levels_round_trip_and_damage_reads_as_strictest() {
        for level in [Level::Off, Level::Kids, Level::OlderKids, Level::Teens, Level::NoAdult] {
            assert_eq!(Level::parse(level.as_str()), level);
            assert_eq!(serde_json::to_value(level).unwrap(), serde_json::Value::String(level.as_str().into()));
        }
        assert_eq!(Level::parse("garbage"), Level::Kids);
        let parsed: ContentLimit = serde_json::from_str(r#"{"level":"older-kids","allowUnrated":false,"allowLiveTv":true}"#).unwrap();
        assert_eq!(parsed, limit(Level::OlderKids, false, true));
        assert!(serde_json::from_str::<ContentLimit>(r#"{"level":"none","allowUnrated":false,"allowLiveTv":true}"#).is_err());
    }

    #[test]
    fn only_a_parent_can_loosen_a_limit() {
        use Guardian::*;
        // A parent can do anything, even to a profile they couldn't otherwise edit.
        assert!(may_set_limit(false, true, &Verified).is_ok());
        // The child (who can edit their own profile) can tighten but not loosen.
        assert!(may_set_limit(true, false, &Unverified).is_ok());
        assert_eq!(may_set_limit(true, true, &Unverified).unwrap_err(), PARENT_PIN_NEEDED);
        assert_eq!(may_set_limit(false, false, &Unverified).unwrap_err(), PARENT_PIN_NEEDED);
        // No parent has a PIN: the usual editing rule is all there is.
        assert!(may_set_limit(true, true, &NoneSet).is_ok());
        assert_eq!(may_set_limit(false, false, &NoneSet).unwrap_err(), SWITCH_FIRST);
        // Adding a profile while a child has a limit needs a parent too.
        assert_eq!(may_create(true, &Unverified).unwrap_err(), PARENT_PIN_NEEDED);
        assert!(may_create(true, &Verified).is_ok() && may_create(true, &NoneSet).is_ok() && may_create(false, &Unverified).is_ok());
    }

    #[test]
    fn a_child_cannot_delete_their_limited_profile_without_a_parent() {
        use Guardian::*;
        let kids = limit(Level::Kids, false, false);
        let off = limit(Level::Off, true, true);
        // Deleting a limited profile removes its limit (and then adding a
        // profile no longer needs a parent), so it's loosening it.
        assert_eq!(may_delete(true, &kids, &Unverified).unwrap_err(), PARENT_PIN_NEEDED);
        assert!(may_delete(true, &kids, &Verified).is_ok());
        assert!(may_delete(true, &kids, &NoneSet).is_ok());
        assert!(may_delete(true, &off, &Unverified).is_ok());
    }

    #[test]
    fn a_childs_pin_doesnt_lock_a_parent_out_of_deleting_their_profile() {
        use Guardian::*;
        let kids = limit(Level::Kids, false, false);
        let off = limit(Level::Off, true, true);
        // The child set a PIN, so the profile can't be managed from another one…
        assert!(may_delete(false, &kids, &Verified).is_ok());
        assert_eq!(may_delete(false, &kids, &Unverified).unwrap_err(), PARENT_PIN_NEEDED);
        assert!(may_delete(false, &kids, &NoneSet).is_err());
        // …but another adult's PIN-locked profile still needs that adult.
        assert!(may_delete(false, &off, &Verified).is_err());
    }

    #[test]
    fn a_limited_profile_needs_a_parent_to_restore_a_backup() {
        use Guardian::*;
        assert_eq!(may_restore(true, &Unverified).unwrap_err(), PARENT_PIN_NEEDED);
        assert!(may_restore(true, &Verified).is_ok());
        // No parent has a PIN: there's no one to ask.
        assert!(may_restore(true, &NoneSet).is_ok());
        // Other profiles restore as before.
        assert!(may_restore(false, &Unverified).is_ok());

        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let active = ActiveProfile::default();
        active.set(Some("main".into())).unwrap();
        assert!(check_restore(&db, &active, None).is_ok());
        // Limited, with no profile left without a limit (so no parent's PIN to read): nothing to ask for.
        db.lock().unwrap().execute("UPDATE profiles SET content_limit = 'kids' WHERE id = 'main'", []).unwrap();
        assert!(check_restore(&db, &active, None).is_ok());
        // Without an active profile there's nothing to restore into.
        assert!(check_restore(&db, &ActiveProfile::default(), None).is_err());
    }

    #[test]
    fn a_pin_check_stops_at_the_first_pin_that_opens_and_tries_each_only_when_wrong() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let pins = vec![("main".to_string(), hash_pin("1111").unwrap()), ("p2".to_string(), hash_pin("2222").unwrap()), ("p3".to_string(), hash_pin("3333").unwrap())];
        HASH_CHECKS.with(|n| n.set(0));
        assert!(check_any(&db, &pins, "1111").is_ok());
        assert_eq!(HASH_CHECKS.with(Cell::get), 1, "one slow check, not one per stored PIN");
        HASH_CHECKS.with(|n| n.set(0));
        assert!(check_any(&db, &pins, "2222").is_ok());
        assert_eq!(HASH_CHECKS.with(Cell::get), 2);
        // A wrong PIN has to be tried against every PIN that could have opened it.
        HASH_CHECKS.with(|n| n.set(0));
        assert_eq!(check_any(&db, &pins, "9999").unwrap_err(), WRONG_PIN);
        assert_eq!(HASH_CHECKS.with(Cell::get), 3);
    }

    #[test]
    fn the_database_is_free_while_a_pin_is_hashed() {
        // Hashing takes a moment on purpose: the rest of Orbit must not wait on the database meanwhile.
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        assert!(attempt(&db, &["main"], 1_000_000, || db.is_free().then_some(0)).is_ok());
    }

    #[test]
    fn a_pin_check_on_the_runtime_lets_other_tasks_run_meanwhile() {
        // One worker: a PIN check that held it would keep every other task waiting until it ended.
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(1).build().unwrap();
        let stored = hash_pin("1234").unwrap();
        let other_ran = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let seen = other_ran.clone();
        let (started_tx, started_rx) = std::sync::mpsc::channel::<()>();
        let check = runtime.spawn(async move {
            started_tx.send(()).unwrap();
            assert!(pin_matches("1234", &stored));
            seen.load(std::sync::atomic::Ordering::SeqCst)
        });
        // The check holds the only worker before the other task is spawned.
        started_rx.recv().unwrap();
        let flag = other_ran.clone();
        runtime.spawn(async move { flag.store(true, std::sync::atomic::Ordering::SeqCst) });
        assert!(runtime.block_on(check).unwrap(), "the other task waited for the PIN check");
    }

    /// Roughly how long one PIN check takes here (`cargo test --release -- --ignored --nocapture pin_check_cost`).
    #[test]
    #[ignore = "a measurement, not a check"]
    fn pin_check_cost() {
        let stored = hash_pin("1234").unwrap();
        let runs = 5;
        let started = std::time::Instant::now();
        for _ in 0..runs {
            assert!(pin_matches("1234", &stored));
        }
        println!("one PIN check ({PIN_ITERATIONS} iterations): {:?}", started.elapsed() / runs);
    }

    #[test]
    fn a_parent_is_the_active_parent_or_a_parents_pin() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let parents = vec![("main".to_string(), "1234".to_string()), ("p2".to_string(), "9999".to_string())];
        let active = ActiveProfile::default();
        assert_eq!(check_guardian(&db, &active, &[], None).unwrap(), Guardian::NoneSet);
        assert_eq!(check_guardian(&db, &active, &parents, None).unwrap(), Guardian::Unverified);
        assert_eq!(check_guardian(&db, &active, &parents, Some("9999")).unwrap(), Guardian::Verified);
        assert_eq!(check_guardian(&db, &active, &parents, Some("0000")).unwrap_err(), WRONG_PIN);
        // The child's own PIN isn't a parent's.
        active.set(Some("kid".into())).unwrap();
        assert_eq!(check_guardian(&db, &active, &parents, Some("4321")).unwrap_err(), WRONG_PIN);
        active.set(Some("main".into())).unwrap();
        assert_eq!(check_guardian(&db, &active, &parents, None).unwrap(), Guardian::Verified);
        // Guessing is paused after a few wrong PINs, even when the right one follows.
        let fresh = ActiveProfile::default();
        for _ in 0..MAX_ATTEMPTS {
            assert!(check_guardian(&db, &fresh, &parents, Some("0000")).is_err());
        }
        assert!(check_guardian(&db, &fresh, &parents, Some("1234")).unwrap_err().starts_with("err.pin.locked|seconds="));
    }

    #[test]
    fn one_parents_right_pin_leaves_the_others_count_alone() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let t = 1_000_000;
        for _ in 0..MAX_ATTEMPTS - 1 {
            assert_eq!(attempt(&db, &["p2"], t, || None).unwrap_err(), WRONG_PIN);
        }
        // "main" types their own PIN where either parent's will do: p2's count stays.
        assert!(attempt(&db, &["main", "p2"], t, || Some(0)).is_ok());
        assert!(attempt(&db, &["p2"], t, || None).unwrap_err().starts_with("err.pin.locked|seconds="));
    }

    #[test]
    fn one_lockout_per_profile_that_survives_a_restart_and_grows() {
        let path = std::env::temp_dir().join(format!("orbit-pin-test-{}.db", now_ms()));
        let wrong = || None;
        let right = || Some(0);
        let t = 1_000_000;
        {
            let db = Db::open(&path).unwrap();
            for _ in 0..MAX_ATTEMPTS - 1 {
                assert_eq!(attempt(&db, &["main"], t, wrong).unwrap_err(), WRONG_PIN);
            }
            // Another way of asking for the same PIN (a parent's okay for both parents) shares the counter.
            assert_eq!(attempt(&db, &["main", "p2"], t, wrong).unwrap_err(), "err.pin.locked|seconds=30");
        }
        // Restarting Orbit doesn't end the pause, nor does the right PIN during it.
        let db = Db::open(&path).unwrap();
        assert!(attempt(&db, &["main"], t + 10_000, right).unwrap_err().starts_with("err.pin.locked|seconds=2"));
        // The other parent's PIN was only tried once.
        assert!(attempt(&db, &["p2"], t + 10_000, right).is_ok());
        // After the pause, each further wrong PIN doubles it.
        let after = t + 30_000;
        assert_eq!(attempt(&db, &["main"], after, wrong).unwrap_err(), "err.pin.locked|seconds=60");
        assert!(attempt(&db, &["main"], after + 59_000, right).is_err());
        assert!(attempt(&db, &["main"], after + 60_000, right).is_ok());
        // The right PIN starts the count again.
        assert_eq!(attempt(&db, &["main"], after + 60_000, wrong).unwrap_err(), WRONG_PIN);
        assert_eq!(lockout_after(MAX_ATTEMPTS + 40), MAX_LOCKOUT);
        drop(db);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn a_clock_set_back_doesnt_stretch_a_pin_pause() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let t = 1_000_000_000;
        // Five wrong PINs while the clock read a day ahead: a 30 s pause, saved as ending tomorrow.
        let ahead = t + 86_400_000;
        for _ in 0..MAX_ATTEMPTS {
            assert!(attempt(&db, &["main"], ahead, || None).is_err());
        }
        // The clock is put right: the pause left is never more than the longest one Orbit gives.
        let error = attempt(&db, &["main"], t, || Some(0)).unwrap_err();
        let seconds: i64 = error.rsplit('=').next().unwrap().parse().unwrap();
        assert!(seconds <= MAX_LOCKOUT.as_secs() as i64 + 1, "{error}");
        // And it ends: an hour on, the right PIN is taken.
        assert!(attempt(&db, &["main"], t + MAX_LOCKOUT.as_millis() as i64, || Some(0)).is_ok());
    }

    #[test]
    fn limits_live_in_the_profiles_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Profiles made before limits existed (v15) come out of the upgrade without one.
        for sql in &crate::db::MIGRATIONS[..15] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 15).unwrap();
        conn.execute("INSERT INTO profiles (id, name, color, position, created_at) VALUES ('kid', 'Kid', '#46c28e', 1, 2)", []).unwrap();
        crate::db::migrate(&mut conn).unwrap();
        assert!(list(&conn).unwrap().iter().all(|p| p.content_limit == limit(Level::Off, true, true)));
        conn.execute("UPDATE profiles SET content_limit = 'teens', limit_unrated = 0 WHERE id = 'main'", []).unwrap();
        assert_eq!(list(&conn).unwrap()[0].content_limit, limit(Level::Teens, false, true));
        // The table refuses levels Orbit doesn't know.
        assert!(conn.execute("UPDATE profiles SET content_limit = 'everything' WHERE id = 'main'", []).is_err());
        conn.execute("INSERT INTO title_ratings VALUES ('tt1', '{\"US\":\"PG\"}', 0, 1)", []).unwrap();
    }

    #[test]
    fn links_are_one_level_and_cleared_with_their_source() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        for (id, at) in [("a", 1), ("b", 2)] {
            conn.execute("INSERT INTO profiles (id, name, color, position, created_at) VALUES (?1, ?1, '#46c28e', ?2, ?2)", params![id, at]).unwrap();
        }
        assert!(check_link(&conn, "a", "a").is_err());
        assert!(check_link(&conn, "a", "missing").is_err());
        assert!(check_link(&conn, "a", "main").is_ok());
        conn.execute("UPDATE profiles SET addons_from = 'main' WHERE id = 'a'", []).unwrap();
        // No chains: nobody can follow a follower, and a followed profile can't follow.
        assert!(check_link(&conn, "b", "a").is_err());
        assert!(check_link(&conn, "main", "b").is_err());
        assert!(check_link(&conn, "b", "main").is_ok());

        delete_rows(&mut conn, "main").unwrap();
        assert_eq!(addons_from(&conn, "a").unwrap(), None);
    }
}
