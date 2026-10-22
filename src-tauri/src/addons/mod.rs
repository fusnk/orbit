//! Installed addons and their network traffic.
//!
//! Transport URLs often embed credentials (e.g. `https://host/<api-key>/manifest.json`),
//! so they're sealed with `vault` in SQLite and never sent back to the WebView:
//! the UI refers to addons by a random local key and Rust resolves the URL.

pub(crate) mod bundle;
pub(crate) mod net;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Url;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db::Db;
use crate::profiles::ActiveProfile;
use crate::vault::{self, VaultError};

const MANIFEST_LIMIT: usize = 256 * 1024;
const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Addons Orbit installs itself, as Stremio does: Cinemeta (metadata and
/// catalogs, see the design handoff) and OpenSubtitles v3 (subtitles only; no
/// video, no account). Both can be switched off but not removed. Decided here
/// by exact URL, not by the UI, so a compromised WebView can't mark arbitrary
/// addons as unremovable.
pub const BUILTIN_URLS: [&str; 2] = ["https://v3-cinemeta.strem.io/manifest.json", "https://opensubtitles-v3.strem.io/manifest.json"];

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum AddonError {
    /// `reason` is a code (`not-url`, `credentials`, `query`, `manifest-path`, `resource-path`, `token`):
    /// the page says it in the person's language, so no English text of Rust's reaches the screen.
    InvalidUrl { reason: &'static str },
    Blocked { reason: &'static str },
    Timeout,
    Http { status: u16 },
    /// A 429 from an API Orbit signs in to (TMDB), with its Retry-After in
    /// seconds; addons' 429s stay `Http`, which the page reads as "busy".
    RateLimited { retry_after_secs: Option<u64> },
    TooLarge { limit_bytes: usize },
    InvalidResponse { issues: Vec<String> },
    Network { message: String },
    NotFound,
    /// The sealed URL can't be opened (data key lost or row corrupt).
    ReinstallNeeded,
    /// Built-in addons can be disabled but not removed.
    BuiltIn,
    /// Only the profile that installed an addon can share it.
    NotOwner,
    /// The active profile uses another profile's addons, which only that profile can change.
    Linked { owner: String },
    Storage { message: String },
}

impl From<rusqlite::Error> for AddonError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Storage { message: err.to_string() }
    }
}

impl From<VaultError> for AddonError {
    fn from(err: VaultError) -> Self {
        match err {
            VaultError::Unavailable => Self::Storage { message: "OS keychain is unavailable".into() },
            VaultError::Undecryptable => Self::ReinstallNeeded,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAddon {
    key: String,
    manifest: Value,
    display_host: String,
    enabled: bool,
    installed_at: i64,
    url_readable: bool,
    built_in: bool,
    /// Installed by the active profile (so it can share or delete it).
    owned: bool,
    /// Shared with the other profiles.
    shared: bool,
    /// The name of the profile that shared it, when it isn't the active one's.
    shared_by: Option<String>,
}

/// Binds a sealed URL to its row and its owner (`None` for a built-in), see
/// `vault`. With the key alone, a row's `owner` could be changed in the
/// database (e.g. one profile's private, credential-bearing addon handed to
/// another) and the URL would still open; with the owner in, it doesn't.
/// Keys are hex, so the parts can't run into each other.
pub(crate) fn aad(key: &str, owner: Option<&str>) -> Vec<u8> {
    format!("addon-url:v2:{key}:{}", owner.unwrap_or_default()).into_bytes()
}

/// What URLs sealed before the owner was bound used. Still read, so addons
/// installed then keep working; anything sealed now uses `aad`.
fn legacy_aad(key: &str) -> Vec<u8> {
    format!("addon-url:{key}").into_bytes()
}

/// Re-seals URLs still sealed the legacy way (`legacy_aad`) under `aad`, binding
/// them to their owner, so moving such a row to another profile no longer opens
/// it. Each row changes only if its re-seal succeeded and it still holds the
/// ciphertext that was read (compare-and-set), all in one transaction: a failure
/// leaves the old, still readable URL. Already-bound and unreadable rows are left
/// alone, so running it again changes nothing. Returns how many rows changed.
fn reseal_legacy(conn: &mut Connection, cipher: &aes_gcm::Aes256Gcm) -> Result<usize, AddonError> {
    let tx = conn.transaction()?;
    let rows: Vec<(String, Option<String>, Vec<u8>)> = tx
        .prepare("SELECT key, owner, transport_url FROM addons")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut changed = 0;
    for (key, owner, sealed) in rows {
        if vault::open(cipher, &aad(&key, owner.as_deref()), &sealed).is_ok() {
            continue;
        }
        let Ok(plain) = vault::open(cipher, &legacy_aad(&key), &sealed) else { continue };
        let resealed = vault::seal(cipher, &aad(&key, owner.as_deref()), &plain)?;
        changed += tx.execute("UPDATE addons SET transport_url = ?1 WHERE key = ?2 AND transport_url = ?3", params![resealed, key, sealed])?;
    }
    tx.commit()?;
    Ok(changed)
}

/// Whether this run has re-sealed the legacy URLs (see `reseal_legacy`); tried again until it succeeds.
static RESEALED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, Connection>, AddonError> {
    db.lock().map_err(|message| AddonError::Storage { message })
}

fn random_key() -> Result<String, AddonError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| VaultError::Unavailable)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn display_host(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

fn open_url(cipher: &aes_gcm::Aes256Gcm, key: &str, owner: Option<&str>, sealed: &[u8]) -> Result<Url, AddonError> {
    let plain = vault::open(cipher, &aad(key, owner), sealed).or_else(|_| vault::open(cipher, &legacy_aad(key), sealed))?;
    let text = String::from_utf8(plain).map_err(|_| AddonError::ReinstallNeeded)?;
    Url::parse(&text).map_err(|_| AddonError::ReinstallNeeded)
}

/// `from_link`: the address came from a website's install link the person
/// hasn't confirmed yet. Any web page can produce one, so it may not make Orbit
/// send anything to this machine or the LAN (a router's admin page, a local
/// service) without a click: such an address is refused here as
/// `Blocked { reason: "local" }`, before any request, and the page asks first.
#[tauri::command]
pub async fn addon_fetch_manifest(url: String, from_link: Option<bool>) -> Result<String, AddonError> {
    let url = net::parse_transport_url(&url)?;
    if from_link == Some(true) {
        if net::leads_into_lan(&url).await {
            return Err(AddonError::Blocked { reason: "local" });
        }
    } else {
        // An address the person gave (typed, or a link they confirmed) may be on the LAN (see `net::GuardedDns`).
        net::trust_host(&url);
    }
    net::fetch_text(url, MANIFEST_LIMIT, MANIFEST_TIMEOUT).await
}

fn active_id(active: &ActiveProfile) -> Result<String, AddonError> {
    active.id().map_err(|message| AddonError::Storage { message })
}

/// Whose addon list `profile` uses: its own, or (id, name) of the profile it follows.
fn linked_to(conn: &Connection, profile: &str) -> rusqlite::Result<Option<(String, String)>> {
    conn.prepare_cached("SELECT s.id, s.name FROM profiles p JOIN profiles s ON s.id = p.addons_from WHERE p.id = ?1")?
        .query_row([profile], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()
}

/// The profile whose list the active profile sees (for reading and fetching).
fn reading_profile(conn: &Connection, active: &ActiveProfile) -> Result<String, AddonError> {
    let profile = active_id(active)?;
    Ok(linked_to(conn, &profile)?.map_or(profile, |(id, _)| id))
}

/// The active profile, when it manages its own list; a linked profile can't change addons.
fn editing_profile(conn: &Connection, active: &ActiveProfile) -> Result<String, AddonError> {
    let profile = active_id(active)?;
    match linked_to(conn, &profile)? {
        Some((_, owner)) => Err(AddonError::Linked { owner }),
        None => Ok(profile),
    }
}

/// One addon as a profile sees it.
struct Visible {
    key: String,
    manifest: String,
    display_host: String,
    installed_at: i64,
    sealed: Vec<u8>,
    built_in: bool,
    owner: Option<String>,
    shared: bool,
    owner_name: Option<String>,
    enabled: bool,
}

/// The addons `profile` can see, in its order: built-ins (everyone), its own,
/// and those other profiles share, minus any it removed from its list.
fn visible(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<Visible>> {
    listed(conn, profile, false)
}

/// With `hidden`, instead the shared addons `profile` removed from its list.
fn listed(conn: &Connection, profile: &str, hidden: bool) -> rusqlite::Result<Vec<Visible>> {
    let mut stmt = conn.prepare_cached(&format!("{VISIBLE_SQL} ORDER BY a.builtin DESC, COALESCE(p.position, 1000000), a.installed_at"))?;
    stmt.query_map(params![profile, hidden], visible_row)?.collect()
}

/// What `listed` selects and from where; `?1` is the profile, `?2` whether hidden.
const VISIBLE_SQL: &str = "SELECT a.key, a.manifest, a.display_host, a.installed_at, a.transport_url, a.builtin, a.owner, a.shared,
                o.name, COALESCE(p.enabled, 1)
         FROM addons a
         LEFT JOIN addon_prefs p ON p.addon_key = a.key AND p.profile_id = ?1
         LEFT JOIN profiles o ON o.id = a.owner
         WHERE (a.owner IS NULL OR a.owner = ?1 OR a.shared = 1) AND COALESCE(p.hidden, 0) = ?2";

fn visible_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Visible> {
    Ok(Visible {
        key: row.get(0)?,
        manifest: row.get(1)?,
        display_host: row.get(2)?,
        installed_at: row.get(3)?,
        sealed: row.get(4)?,
        built_in: row.get(5)?,
        owner: row.get(6)?,
        shared: row.get(7)?,
        owner_name: row.get(8)?,
        enabled: row.get(9)?,
    })
}

/// One addon `profile` can see. Asks for that addon alone: every addon
/// request comes through here, and reading every manifest each time held the
/// database for no reason.
fn find_visible(conn: &Connection, profile: &str, key: &str) -> Result<Visible, AddonError> {
    let mut stmt = conn.prepare_cached(&format!("{VISIBLE_SQL} AND a.key = ?3"))?;
    stmt.query_row(params![profile, false, key], visible_row).optional()?.ok_or(AddonError::NotFound)
}

/// One addon `profile` can see and has enabled: what addon requests may use.
/// A disabled addon is off for this profile, so it isn't asked for anything.
fn find_enabled(conn: &Connection, profile: &str, key: &str) -> Result<Visible, AddonError> {
    let addon = find_visible(conn, profile, key)?;
    if addon.enabled { Ok(addon) } else { Err(AddonError::NotFound) }
}

/// Makes sure `profile` has a preferences row for `key` (new ones go last).
fn ensure_pref(conn: &Connection, profile: &str, key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO addon_prefs (profile_id, addon_key, enabled, position, hidden)
         VALUES (?1, ?2, 1, (SELECT COALESCE(MAX(position) + 1, 0) FROM addon_prefs WHERE profile_id = ?1), 0)
         ON CONFLICT(profile_id, addon_key) DO NOTHING",
        params![profile, key],
    )?;
    Ok(())
}

fn to_installed(a: Visible, profile: &str, cipher: Option<&aes_gcm::Aes256Gcm>) -> InstalledAddon {
    let url_readable = cipher.is_some_and(|c| open_url(c, &a.key, a.owner.as_deref(), &a.sealed).is_ok());
    let owned = a.owner.as_deref() == Some(profile);
    InstalledAddon {
        manifest: serde_json::from_str(&a.manifest).unwrap_or(Value::Null),
        shared_by: if owned || a.built_in { None } else { a.owner_name },
        key: a.key,
        display_host: a.display_host,
        enabled: a.enabled,
        installed_at: a.installed_at,
        url_readable,
        built_in: a.built_in,
        owned,
        shared: a.shared,
    }
}

/// Stores an addon for the active profile. `manifest` has already been fetched
/// and schema-validated by the UI. Installing a URL this profile can already
/// see updates it in place (and puts it back on the list if it was removed).
/// `replace`: the key of this profile's own copy of the same addon (same
/// manifest id) whose settings the new URL replaces, once the person agreed.
#[tauri::command]
pub async fn addon_install(db: State<'_, Db>, active: State<'_, ActiveProfile>, url: String, manifest: Value, replace: Option<String>) -> Result<InstalledAddon, AddonError> {
    install(&db, &active, net::parse_transport_url(&url)?, manifest, replace)
}

/// What installing an addon that's already here does with the manifest it was given.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Existing {
    /// The person installed it again (or Orbit just fetched it): the given manifest is the newer one.
    Refresh,
    /// An import from another app's stored copy, which can be older than the one Orbit has: kept as it is.
    Keep,
}

/// Stores the addon at `url` (already checked as a transport URL) for the active profile.
pub(crate) fn install(db: &Db, active: &ActiveProfile, url: Url, manifest: Value, replace: Option<String>) -> Result<InstalledAddon, AddonError> {
    install_as(db, active, url, manifest, replace, Existing::Refresh)
}

/// As `install`, with `existing` deciding what an addon already installed at `url` keeps.
pub(crate) fn install_as(db: &Db, active: &ActiveProfile, url: Url, manifest: Value, replace: Option<String>, existing: Existing) -> Result<InstalledAddon, AddonError> {
    let manifest_json = manifest.to_string();
    if manifest_json.len() > MANIFEST_LIMIT {
        return Err(AddonError::TooLarge { limit_bytes: MANIFEST_LIMIT });
    }
    let cipher = vault::cipher()?;
    let host = display_host(&url);
    let built_in = BUILTIN_URLS.contains(&url.as_str());
    let conn = lock(db)?;
    // Built-ins are everyone's, so first-run setup works on a linked profile too.
    let profile = if built_in { reading_profile(&conn, active)? } else { editing_profile(&conn, active)? };
    let key = store(&conn, &cipher, &profile, &url, &manifest_json, &host, replace, existing)?;
    let addon = find_visible(&conn, &profile, &key)?;
    Ok(to_installed(addon, &profile, Some(&cipher)))
}

/// Writes the addon at `url` into `profile`'s list (a new row, a replaced URL, or the row it already
/// has) and returns its key; shown again if the profile had removed it.
#[allow(clippy::too_many_arguments)]
fn store(conn: &Connection, cipher: &aes_gcm::Aes256Gcm, profile: &str, url: &Url, manifest_json: &str, host: &str, replace: Option<String>, on_existing: Existing) -> Result<String, AddonError> {
    let built_in = BUILTIN_URLS.contains(&url.as_str());
    // Duplicates are found by decrypting: sealed values use random nonces, so
    // equal URLs never produce equal ciphertexts to compare directly. Another
    // profile's private copy doesn't count; this profile gets its own.
    let mut existing = None;
    {
        let mut stmt = conn.prepare("SELECT key, transport_url, owner FROM addons WHERE owner IS NULL OR owner = ?1 OR shared = 1")?;
        let mut rows = stmt.query([profile])?;
        while let Some(row) = rows.next()? {
            let key: String = row.get(0)?;
            let sealed: Vec<u8> = row.get(1)?;
            let owner: Option<String> = row.get(2)?;
            if open_url(cipher, &key, owner.as_deref(), &sealed).is_ok_and(|stored| &stored == url) {
                existing = Some(key);
                break;
            }
        }
    }

    // A built-in URL is never sealed into someone's own row (built-ins are decided by exact URL).
    let replace = replace.filter(|_| !built_in);
    let key = match (existing, replace) {
        (Some(key), _) => {
            if on_existing == Existing::Refresh {
                store_manifest(conn, &key, manifest_json, Some(host))?;
            }
            key
        }
        (None, Some(key)) => {
            replace_url(conn, cipher, profile, &key, url, manifest_json, host)?;
            key
        }
        (None, None) => {
            let key = random_key()?;
            // Built-ins belong to everyone; anything else to the profile that installed it.
            let owner = if built_in { None } else { Some(profile) };
            let sealed = vault::seal(cipher, &aad(&key, owner), url.as_str().as_bytes())?;
            let installed_at = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
            conn.execute(
                "INSERT INTO addons (key, installed_at, display_host, manifest, transport_url, builtin, owner, shared)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                params![key, installed_at, host, manifest_json, sealed, built_in, owner],
            )?;
            key
        }
    };
    ensure_pref(conn, profile, &key)?;
    conn.execute("UPDATE addon_prefs SET hidden = 0 WHERE profile_id = ?1 AND addon_key = ?2", params![profile, key])?;
    Ok(key)
}

/// Re-running an addon's setup gives a new URL (its settings live in it): this
/// seals that URL into `profile`'s own copy at `key`, so it keeps its row, place
/// and enabled state instead of a second copy being added at the end. Only for
/// the same addon (manifest id) at the same host, never a built-in or another profile's addon.
/// A fresh nonce and the row's AAD, as for any seal (see `vault`).
fn replace_url(conn: &Connection, cipher: &aes_gcm::Aes256Gcm, profile: &str, key: &str, url: &Url, manifest_json: &str, host: &str) -> Result<(), AddonError> {
    let addon = find_visible(conn, profile, key)?;
    if addon.built_in {
        return Err(AddonError::BuiltIn);
    }
    if addon.owner.as_deref() != Some(profile) {
        return Err(AddonError::NotOwner);
    }
    let id = |json: &str| serde_json::from_str::<Value>(json).ok().and_then(|m| m.get("id").and_then(Value::as_str).map(str::to_owned));
    // Any site can claim any manifest id, so only the addon's own host (and port)
    // may replace its settings; another host is a different addon.
    let installed = id(&addon.manifest);
    if installed.is_none() || installed != id(manifest_json) || addon.display_host != host {
        return Err(AddonError::NotFound);
    }
    // Checked above: the row is `profile`'s own.
    let sealed = vault::seal(cipher, &aad(key, Some(profile)), url.as_str().as_bytes())?;
    conn.execute("UPDATE addons SET transport_url = ?1, manifest = ?2, display_host = ?3 WHERE key = ?4", params![sealed, manifest_json, host, key])?;
    Ok(())
}

/// Replaces an installed addon's stored manifest (and its shown host, when given).
/// Position, enabled state and every other per-profile preference live in
/// `addon_prefs` and the transport URL (with any user configuration) stays sealed
/// as it was, so both are untouched.
fn store_manifest(conn: &Connection, key: &str, manifest_json: &str, host: Option<&str>) -> rusqlite::Result<()> {
    match host {
        Some(host) => conn.execute("UPDATE addons SET manifest = ?1, display_host = ?2 WHERE key = ?3", params![manifest_json, host, key])?,
        None => conn.execute("UPDATE addons SET manifest = ?1 WHERE key = ?2", params![manifest_json, key])?,
    };
    Ok(())
}

/// The active profile's addons in its order. A lost data key or corrupt row
/// still lists the addon (with `url_readable: false`) so it can be removed.
#[tauri::command]
pub async fn addon_list(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<InstalledAddon>, AddonError> {
    let cipher = vault::cipher().ok();
    let mut conn = lock(&db)?;
    // The first list of a run (at startup) binds any legacy URLs to their owners; a failure keeps them as they were.
    if let Some(cipher) = &cipher
        && !RESEALED.load(std::sync::atomic::Ordering::Relaxed)
    {
        match reseal_legacy(&mut conn, cipher) {
            Ok(_) => RESEALED.store(true, std::sync::atomic::Ordering::Relaxed),
            Err(err) => eprintln!("Could not re-seal older addon URLs: {err:?}"),
        }
    }
    let profile = reading_profile(&conn, &active)?;
    Ok(visible(&conn, &profile)?.into_iter().map(|a| to_installed(a, &profile, cipher.as_ref())).collect())
}

/// Turns an addon on or off for the active profile only.
#[tauri::command]
pub async fn addon_set_enabled(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String, enabled: bool) -> Result<(), AddonError> {
    let conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    find_visible(&conn, &profile, &key)?;
    ensure_pref(&conn, &profile, &key)?;
    conn.execute("UPDATE addon_prefs SET enabled = ?1 WHERE profile_id = ?2 AND addon_key = ?3", params![enabled, profile, key])?;
    Ok(())
}

/// Moves an addon to `index` in the active profile's order (clamped to the list bounds).
#[tauri::command]
pub async fn addon_move(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String, index: usize) -> Result<(), AddonError> {
    let mut conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    let tx = conn.transaction()?;
    let mut rows: Vec<(String, bool)> = visible(&tx, &profile)?.into_iter().map(|a| (a.key, a.built_in)).collect();
    let from = rows.iter().position(|(k, _)| *k == key).ok_or(AddonError::NotFound)?;
    let moved = rows.remove(from);
    rows.insert(index.min(rows.len()), moved);
    // Built-ins always stay at the top of the list.
    rows.sort_by_key(|(_, built_in)| !built_in);
    for (position, (key, _)) in rows.iter().enumerate() {
        ensure_pref(&tx, &profile, key)?;
        tx.execute("UPDATE addon_prefs SET position = ?1 WHERE profile_id = ?2 AND addon_key = ?3", params![position as i64, profile, key])?;
    }
    tx.commit()?;
    Ok(())
}

/// Removes an addon. The owner removes it for everyone; another profile only
/// takes a shared addon off its own list. Built-ins can't be removed.
#[tauri::command]
pub async fn addon_remove(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String) -> Result<(), AddonError> {
    let mut conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    let addon = find_visible(&conn, &profile, &key)?;
    if addon.built_in {
        return Err(AddonError::BuiltIn);
    }
    if addon.owner.as_deref() == Some(profile.as_str()) {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM addon_prefs WHERE addon_key = ?1", [&key])?;
        tx.execute("DELETE FROM addons WHERE key = ?1", [&key])?;
        tx.commit()?;
    } else {
        ensure_pref(&conn, &profile, &key)?;
        conn.execute("UPDATE addon_prefs SET hidden = 1 WHERE profile_id = ?1 AND addon_key = ?2", params![profile, key])?;
    }
    Ok(())
}

/// Shares (or stops sharing) one of the active profile's own addons with the other profiles.
#[tauri::command]
pub async fn addon_set_shared(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String, shared: bool) -> Result<(), AddonError> {
    let conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    let changed = conn.execute("UPDATE addons SET shared = ?1 WHERE key = ?2 AND owner = ?3", params![shared, key, profile])?;
    if changed == 0 { Err(AddonError::NotOwner) } else { Ok(()) }
}

/// Shares (or stops sharing) all of the active profile's own addons at once.
#[tauri::command]
pub async fn addon_set_all_shared(db: State<'_, Db>, active: State<'_, ActiveProfile>, shared: bool) -> Result<(), AddonError> {
    let conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    conn.execute("UPDATE addons SET shared = ?1 WHERE owner = ?2", params![shared, profile])?;
    Ok(())
}

/// Shared addons the active profile removed from its list, so they can be put back.
#[tauri::command]
pub async fn addon_removed_list(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<InstalledAddon>, AddonError> {
    let cipher = vault::cipher().ok();
    let conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    Ok(listed(&conn, &profile, true)?.into_iter().map(|a| to_installed(a, &profile, cipher.as_ref())).collect())
}

/// Puts a shared addon the active profile removed back on its list (where it was).
#[tauri::command]
pub async fn addon_restore(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String) -> Result<(), AddonError> {
    let conn = lock(&db)?;
    let profile = editing_profile(&conn, &active)?;
    // Only an addon that's still shared: one its owner stopped sharing stays out of reach.
    if !listed(&conn, &profile, true)?.iter().any(|a| a.key == key) {
        return Err(AddonError::NotFound);
    }
    conn.execute("UPDATE addon_prefs SET hidden = 0 WHERE profile_id = ?1 AND addon_key = ?2", params![profile, key])?;
    Ok(())
}

/// Fetches `path` (`/{resource}/{type}/{id}[/{extra}].json`) from an addon the
/// active profile can see. Another profile's private addon (whose URL may hold
/// that person's credentials) is never reachable, unless that profile linked
/// this one to its list (see `profiles::profile_set_addons_from`).
#[tauri::command]
pub async fn addon_request(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String, path: String) -> Result<String, AddonError> {
    let transport = {
        let conn = lock(&db)?;
        let profile = reading_profile(&conn, &active)?;
        let addon = find_enabled(&conn, &profile, &key)?;
        open_url(&vault::cipher()?, &key, addon.owner.as_deref(), &addon.sealed)?
    };
    net::trust_host(&transport);
    let url = net::resource_url(&transport, &path)?;
    net::fetch_text(url, RESPONSE_LIMIT, REQUEST_TIMEOUT).await
}

// ── Manifest refresh ──
//
// A manifest is stored at install time; addons change theirs (new catalogs,
// a new version) without the URL changing. Refreshing runs in two steps
// because manifests are schema-validated in one place, the UI (see
// src/addons/schema.ts), as at install: Rust opens each sealed URL and
// fetches the manifest under the install-time limits, the UI validates it,
// and Rust stores the ones that changed. URLs never leave Rust.
//
// What's stored is Rust's own copy of what it fetched (kept in `Fetched`
// between the two steps), never a manifest the page sends: the page only
// names the addons whose manifest passed its schema. Otherwise a script on
// the page could store any manifest it liked for an installed addon (another
// name, logo, catalogs or behaviour hints), and it would stick. The page
// validates stored manifests again whenever it reads them (`fromStored`).

/// Manifests `addon_refresh_fetch` fetched, by (profile whose list it was,
/// addon key), until `addon_refresh_apply` stores or drops them. At most one
/// per addon, each under `MANIFEST_LIMIT`.
#[derive(Default)]
pub struct Fetched(std::sync::Mutex<Kept>);

/// Each manifest with the sealed URL it was fetched from (see `apply_update`).
type Kept = std::collections::HashMap<(String, String), (Value, Vec<u8>)>;

impl Fetched {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Kept>, AddonError> {
        self.0.lock().map_err(|_| AddonError::Storage { message: "addon refresh unavailable".into() })
    }
}

/// Manifest fields whose change matters: what the addon is called and looks
/// like, and what it can be asked for. A reworded description alone isn't
/// worth reporting as an update.
const TRACKED_FIELDS: [&str; 8] = ["version", "name", "logo", "types", "resources", "catalogs", "idPrefixes", "behaviorHints"];

fn manifest_changed(old: &Value, new: &Value) -> bool {
    TRACKED_FIELDS.iter().any(|field| old.get(field) != new.get(field))
}

/// One addon's freshly fetched manifest, or why it couldn't be fetched.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedManifest {
    key: String,
    /// The raw JSON, for the UI to validate like any addon response.
    body: Option<String>,
    error: Option<AddonError>,
    /// The sealed URL it was fetched from, as stored then. Stays in Rust.
    #[serde(skip)]
    sealed: Vec<u8>,
}

/// One addon to refresh: its key, its sealed URL as stored, and that URL opened (or why it can't be).
type Target = (String, Vec<u8>, Result<Url, AddonError>);

/// The addons `profile` uses, each with its transport URL opened (or why it can't be).
/// `enabled_only` leaves out the ones it turned off.
fn refresh_targets(conn: &Connection, profile: &str, cipher: &aes_gcm::Aes256Gcm, enabled_only: bool) -> rusqlite::Result<Vec<Target>> {
    Ok(visible(conn, profile)?
        .into_iter()
        .filter(|a| a.enabled || !enabled_only)
        .map(|a| {
            let url = open_url(cipher, &a.key, a.owner.as_deref(), &a.sealed);
            (a.key, a.sealed, url)
        })
        .collect())
}

/// Fetches every target's manifest at once, each under the install-time size
/// cap, timeout and redirect rules. Errors carry no URL (see `net::network`).
async fn fetch_manifests(targets: Vec<Target>) -> Vec<FetchedManifest> {
    let tasks: Vec<_> = targets
        .into_iter()
        .map(|(key, sealed, url)| {
            let task = tauri::async_runtime::spawn(async move {
                match url {
                    Ok(url) => {
                        net::trust_host(&url);
                        net::fetch_text(url, MANIFEST_LIMIT, MANIFEST_TIMEOUT).await
                    }
                    Err(err) => Err(err),
                }
            });
            (key, sealed, task)
        })
        .collect();
    let mut fetched = Vec::with_capacity(tasks.len());
    for (key, sealed, task) in tasks {
        let result = task.await.unwrap_or_else(|_| Err(AddonError::Network { message: "the request stopped".into() }));
        fetched.push(match result {
            Ok(body) => FetchedManifest { key, body: Some(body), error: None, sealed },
            Err(error) => FetchedManifest { key, body: None, error: Some(error), sealed },
        });
    }
    fetched
}

/// Fetches the current manifest of every addon the active profile uses
/// (built-ins included: they're stored the same way). Nothing is stored here.
/// `enabled_only`: the daily background refresh, which leaves out addons the
/// profile turned off (nothing asks them for anything, so there's no reason to
/// contact them); one turned back on is refreshed then, by its key.
#[tauri::command]
pub async fn addon_refresh_fetch(db: State<'_, Db>, active: State<'_, ActiveProfile>, fetched: State<'_, Fetched>, key: Option<String>, enabled_only: Option<bool>) -> Result<Vec<FetchedManifest>, AddonError> {
    let (profile, mut targets) = {
        let cipher = vault::cipher()?;
        let conn = lock(&db)?;
        // A linked profile refreshes the list it uses: a manifest is the
        // addon author's, not a choice of the list's owner, and fetching
        // through that list is already allowed (see `addon_request`).
        let profile = reading_profile(&conn, &active)?;
        let targets = refresh_targets(&conn, &profile, &cipher, enabled_only == Some(true))?;
        (profile, targets)
    };
    // One addon's "Refresh manifest" (the Addons page); none given is every one.
    if let Some(key) = key {
        targets.retain(|(k, _, _)| *k == key);
        if targets.is_empty() {
            return Err(AddonError::NotFound);
        }
    }
    let results = fetch_manifests(targets).await;
    remember(&mut *fetched.lock()?, &profile, &results);
    Ok(results)
}

/// Keeps Rust's copy of each manifest fetched for `profile`, for `addon_refresh_apply`.
fn remember(kept: &mut Kept, profile: &str, results: &[FetchedManifest]) {
    for result in results {
        let id = (profile.to_string(), result.key.clone());
        match result.body.as_deref().and_then(|body| serde_json::from_str::<Value>(body).ok()) {
            Some(manifest) => kept.insert(id, (manifest, result.sealed.clone())),
            None => kept.remove(&id),
        };
    }
}

/// An addon whose fetched manifest the page found valid.
#[derive(Deserialize)]
pub struct ManifestUpdate {
    key: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefreshOutcome {
    Updated,
    Unchanged,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    key: String,
    outcome: RefreshOutcome,
}

/// Stores `manifest` for `key` if any tracked field changed; whether it did.
/// A failure leaves the stored manifest as it was. `sealed`: the URL it was
/// fetched from, as stored then. A configured addon's manifest depends on its
/// settings (which catalogs it has), so one fetched before the person set the
/// addon up again (a new URL, with its own manifest) would undo that; it's dropped.
fn apply_update(conn: &Connection, profile: &str, key: &str, sealed: &[u8], manifest: &Value) -> Result<bool, AddonError> {
    let addon = find_visible(conn, profile, key)?;
    if addon.sealed != sealed {
        return Err(AddonError::InvalidResponse { issues: vec!["the addon was set up again since".into()] });
    }
    let json = manifest.to_string();
    if json.len() > MANIFEST_LIMIT {
        return Err(AddonError::TooLarge { limit_bytes: MANIFEST_LIMIT });
    }
    let old: Value = serde_json::from_str(&addon.manifest).unwrap_or(Value::Null);
    // A manifest with another id is another addon, which only an install may bring in.
    if !manifest.is_object() || old.get("id").is_some_and(|id| manifest.get("id") != Some(id)) {
        return Err(AddonError::InvalidResponse { issues: vec!["the addon's id changed".into()] });
    }
    if !manifest_changed(&old, manifest) {
        return Ok(false);
    }
    store_manifest(conn, key, &json, None)?;
    Ok(true)
}

/// Stores the refreshed manifests the UI validated, where they changed: Rust's
/// own fetched copy of each (see `Fetched`); an addon without one fails.
#[tauri::command]
pub async fn addon_refresh_apply(db: State<'_, Db>, active: State<'_, ActiveProfile>, fetched: State<'_, Fetched>, updates: Vec<ManifestUpdate>) -> Result<Vec<RefreshResult>, AddonError> {
    let mut kept = fetched.lock()?;
    let mut conn = lock(&db)?;
    let profile = reading_profile(&conn, &active)?;
    // One transaction for the lot: one disk sync instead of one per addon.
    let tx = conn.transaction()?;
    let results = apply_kept(&tx, &mut kept, &profile, updates);
    tx.commit()?;
    Ok(results)
}

fn apply_kept(conn: &Connection, kept: &mut Kept, profile: &str, updates: Vec<ManifestUpdate>) -> Vec<RefreshResult> {
    updates
        .into_iter()
        .map(|update| {
            let manifest = kept.remove(&(profile.to_string(), update.key.clone()));
            let outcome = match manifest.ok_or(AddonError::NotFound).and_then(|(manifest, sealed)| apply_update(conn, profile, &update.key, &sealed, &manifest)) {
                Ok(true) => RefreshOutcome::Updated,
                Ok(false) => RefreshOutcome::Unchanged,
                Err(_) => RefreshOutcome::Failed,
            };
            RefreshResult { key: update.key, outcome }
        })
        .collect()
}

const ART_LIMIT: usize = 4 * 1024 * 1024;
const ART_TIMEOUT: Duration = Duration::from_secs(10);

/// Fetches a piece of artwork so the UI can sample its colour for the ambient
/// glow. Image hosts often redirect without CORS headers, which stops the
/// WebView reading pixels itself; the bytes come back raw (not JSON) and the
/// UI reads them through a `blob:` URL it creates.
#[tauri::command]
pub async fn art_fetch(url: String) -> Result<tauri::ipc::Response, AddonError> {
    let url = Url::parse(&url).map_err(|_| AddonError::InvalidUrl { reason: "not-url" })?;
    net::check_artwork_url(&url)?;
    let (bytes, content_type) = net::fetch_bytes(url, ART_LIMIT, ART_TIMEOUT).await?;
    if !content_type.is_some_and(|t| t.starts_with("image/")) {
        return Err(AddonError::InvalidResponse { issues: vec!["not an image".into()] });
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    net::fuzz_input(data);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, color, position, created_at) VALUES ('kid', 'Kid', '#46c28e', 1, 1)", []).unwrap();
        let add = |key: &str, builtin: bool, owner: Option<&str>, shared: bool, at: i64| {
            conn.execute(
                "INSERT INTO addons (key, installed_at, display_host, manifest, transport_url, builtin, owner, shared) VALUES (?1, ?2, 'h', '{}', x'00', ?3, ?4, ?5)",
                params![key, at, builtin, owner, shared],
            )
            .unwrap();
        };
        add("cinemeta", true, None, false, 1);
        add("mine", false, Some("main"), false, 2);
        add("kids-shared", false, Some("kid"), true, 3);
        add("kids-private", false, Some("kid"), false, 4);
        conn
    }

    fn keys(conn: &Connection, profile: &str) -> Vec<String> {
        visible(conn, profile).unwrap().into_iter().map(|a| a.key).collect()
    }

    #[test]
    fn an_import_leaves_an_installed_addons_newer_manifest_alone() {
        use aes_gcm::aead::KeyInit;
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        let url = Url::parse("https://addon.example/cfg/manifest.json").unwrap();
        let manifest = |version: &str| format!(r#"{{"id":"org.example","version":"{version}"}}"#);
        let stored = |key: &str| conn.query_row("SELECT manifest FROM addons WHERE key = ?1", [key], |row| row.get::<_, String>(0)).unwrap();
        let key = store(&conn, &cipher, "main", &url, &manifest("2.0.0"), "addon.example", None, Existing::Refresh).unwrap();
        // Stremio's stored copy is older: importing it finds the same row and keeps Orbit's.
        assert_eq!(store(&conn, &cipher, "main", &url, &manifest("1.0.0"), "addon.example", None, Existing::Keep).unwrap(), key);
        assert_eq!(stored(&key), manifest("2.0.0"));
        // Installed again by the person (a freshly fetched manifest), it's updated as before.
        assert_eq!(store(&conn, &cipher, "main", &url, &manifest("3.0.0"), "addon.example", None, Existing::Refresh).unwrap(), key);
        assert_eq!(stored(&key), manifest("3.0.0"));
        // An addon not yet here is installed with the imported manifest.
        let other = Url::parse("https://other.example/manifest.json").unwrap();
        let new = store(&conn, &cipher, "main", &other, &manifest("1.0.0"), "other.example", None, Existing::Keep).unwrap();
        assert_ne!(new, key);
        assert_eq!(stored(&new), manifest("1.0.0"));
    }

    #[test]
    fn profiles_see_built_ins_their_own_and_shared_addons() {
        let conn = conn();
        assert_eq!(keys(&conn, "main"), ["cinemeta", "mine", "kids-shared"]);
        assert_eq!(keys(&conn, "kid"), ["cinemeta", "kids-shared", "kids-private"]);
        // Who shared it is reported to everyone else.
        let shared = visible(&conn, "main").unwrap().into_iter().find(|a| a.key == "kids-shared").unwrap();
        assert_eq!(shared.owner_name.as_deref(), Some("Kid"));
    }

    #[test]
    fn requests_only_reach_enabled_addons() {
        let conn = conn();
        assert!(find_enabled(&conn, "main", "mine").is_ok());
        ensure_pref(&conn, "main", "mine").unwrap();
        conn.execute("UPDATE addon_prefs SET enabled = 0 WHERE profile_id = 'main' AND addon_key = 'mine'", []).unwrap();
        assert!(matches!(find_enabled(&conn, "main", "mine"), Err(AddonError::NotFound)));
        // Still listed, so it can be enabled again.
        assert!(find_visible(&conn, "main", "mine").is_ok());
    }

    #[test]
    fn hiding_and_order_are_per_profile() {
        let conn = conn();
        ensure_pref(&conn, "main", "kids-shared").unwrap();
        conn.execute("UPDATE addon_prefs SET hidden = 1 WHERE profile_id = 'main' AND addon_key = 'kids-shared'", []).unwrap();
        assert_eq!(keys(&conn, "main"), ["cinemeta", "mine"]);
        assert_eq!(keys(&conn, "kid"), ["cinemeta", "kids-shared", "kids-private"]);
        // ...and can be found again to restore.
        let removed: Vec<String> = listed(&conn, "main", true).unwrap().into_iter().map(|a| a.key).collect();
        assert_eq!(removed, ["kids-shared"]);
        assert!(listed(&conn, "kid", true).unwrap().is_empty());

        ensure_pref(&conn, "kid", "kids-private").unwrap();
        ensure_pref(&conn, "kid", "kids-shared").unwrap();
        // Built-ins stay first; the rest follow this profile's positions.
        assert_eq!(keys(&conn, "kid"), ["cinemeta", "kids-private", "kids-shared"]);
        assert_eq!(keys(&conn, "main"), ["cinemeta", "mine"]);
    }

    fn manifest_of(conn: &Connection, key: &str) -> Value {
        let raw: String = conn.query_row("SELECT manifest FROM addons WHERE key = ?1", [key], |r| r.get(0)).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn detects_changes_to_tracked_fields_only() {
        let old = serde_json::json!({ "id": "a", "version": "1.0.0", "name": "A", "description": "x", "catalogs": [], "types": ["movie"] });
        assert!(!manifest_changed(&old, &old.clone()));
        assert!(!manifest_changed(&old, &serde_json::json!({ "id": "a", "version": "1.0.0", "name": "A", "description": "reworded", "catalogs": [], "types": ["movie"] })));
        for (field, value) in [
            ("version", serde_json::json!("1.1.0")),
            ("name", serde_json::json!("B")),
            ("logo", serde_json::json!("https://a.example/logo.png")),
            ("catalogs", serde_json::json!([{ "type": "movie", "id": "top" }])),
            ("types", serde_json::json!(["movie", "series"])),
            ("resources", serde_json::json!(["stream"])),
            ("idPrefixes", serde_json::json!(["tt"])),
            ("behaviorHints", serde_json::json!({ "configurable": true })),
        ] {
            let mut new = old.clone();
            new[field] = value;
            assert!(manifest_changed(&old, &new), "{field}");
        }
    }

    #[test]
    fn applying_a_refresh_keeps_prefs_and_failures_keep_the_old_manifest() {
        let conn = conn();
        let stored = serde_json::json!({ "id": "org.mine", "version": "1.0.0", "name": "Mine" });
        conn.execute("UPDATE addons SET manifest = ?1 WHERE key = 'mine'", [stored.to_string()]).unwrap();
        ensure_pref(&conn, "main", "kids-shared").unwrap();
        ensure_pref(&conn, "main", "mine").unwrap();
        conn.execute("UPDATE addon_prefs SET enabled = 0 WHERE profile_id = 'main' AND addon_key = 'mine'", []).unwrap();

        // Unchanged: nothing written.
        assert!(!apply_update(&conn, "main", "mine", &[0], &stored).unwrap());
        // Another addon's manifest, an unknown or unreachable key, or not a manifest: refused, old one kept.
        let other = serde_json::json!({ "id": "org.other", "version": "2.0.0", "name": "Other" });
        assert!(matches!(apply_update(&conn, "main", "mine", &[0], &other), Err(AddonError::InvalidResponse { .. })));
        assert!(matches!(apply_update(&conn, "main", "nope", &[0], &stored), Err(AddonError::NotFound)));
        assert!(matches!(apply_update(&conn, "main", "kids-private", &[0], &stored), Err(AddonError::NotFound)));
        assert!(matches!(apply_update(&conn, "main", "mine", &[0], &serde_json::json!("x")), Err(AddonError::InvalidResponse { .. })));
        assert_eq!(manifest_of(&conn, "mine"), stored);

        // Changed: stored, with this profile's order and enabled state as they were.
        let newer = serde_json::json!({ "id": "org.mine", "version": "1.1.0", "name": "Mine" });
        assert!(apply_update(&conn, "main", "mine", &[0], &newer).unwrap());
        assert_eq!(manifest_of(&conn, "mine"), newer);
        assert_eq!(keys(&conn, "main"), ["cinemeta", "kids-shared", "mine"]);
        assert!(!visible(&conn, "main").unwrap().into_iter().find(|a| a.key == "mine").unwrap().enabled);
    }

    #[test]
    fn a_refresh_stores_rusts_own_copy_never_the_pages() {
        let conn = conn();
        let stored = serde_json::json!({ "id": "org.mine", "version": "1.0.0", "name": "Mine" });
        conn.execute("UPDATE addons SET manifest = ?1 WHERE key = 'mine'", [stored.to_string()]).unwrap();
        let newer = serde_json::json!({ "id": "org.mine", "version": "1.1.0", "name": "Mine" });
        let mut kept = std::collections::HashMap::new();
        let fetched = |key: &str, body: Option<&str>| FetchedManifest { key: key.into(), body: body.map(str::to_owned), error: None, sealed: vec![0] };
        remember(&mut kept, "main", &[fetched("mine", Some(&newer.to_string())), fetched("cinemeta", Some("not json")), fetched("kids-shared", None)]);
        assert_eq!(kept.len(), 1);
        let update = |key: &str| ManifestUpdate { key: key.into() };
        let outcomes = |results: Vec<RefreshResult>| results.into_iter().map(|r| (r.key, r.outcome)).collect::<Vec<_>>();

        // Another profile can't apply what was fetched for this one, and nothing un-fetched is stored.
        assert_eq!(outcomes(apply_kept(&conn, &mut kept, "kid", vec![update("mine")])), [("mine".into(), RefreshOutcome::Failed)]);
        assert_eq!(outcomes(apply_kept(&conn, &mut kept, "main", vec![update("cinemeta")])), [("cinemeta".into(), RefreshOutcome::Failed)]);
        assert_eq!(manifest_of(&conn, "mine"), stored);
        // The fetched copy is stored once; applying again finds nothing kept.
        assert_eq!(outcomes(apply_kept(&conn, &mut kept, "main", vec![update("mine")])), [("mine".into(), RefreshOutcome::Updated)]);
        assert_eq!(manifest_of(&conn, "mine"), newer);
        assert_eq!(outcomes(apply_kept(&conn, &mut kept, "main", vec![update("mine")])), [("mine".into(), RefreshOutcome::Failed)]);
        // A later fetch that fails drops the earlier copy.
        remember(&mut kept, "main", &[fetched("mine", Some(&newer.to_string()))]);
        remember(&mut kept, "main", &[fetched("mine", None)]);
        assert!(kept.is_empty());
    }

    #[test]
    fn a_refresh_fetched_before_the_addon_was_set_up_again_is_not_stored() {
        let conn = conn();
        let stored = serde_json::json!({ "id": "org.mine", "version": "1.0.0", "name": "Mine" });
        conn.execute("UPDATE addons SET manifest = ?1 WHERE key = 'mine'", [stored.to_string()]).unwrap();
        let refreshed = serde_json::json!({ "id": "org.mine", "version": "1.1.0", "name": "Mine" });
        let mut kept = std::collections::HashMap::new();
        // Fetched from the URL sealed now (the fixture's x'00')...
        remember(&mut kept, "main", &[FetchedManifest { key: "mine".into(), body: Some(refreshed.to_string()), error: None, sealed: vec![0] }]);
        // ...then the person set it up again: new settings, a new URL, and the manifest that goes with them.
        let configured = serde_json::json!({ "id": "org.mine", "version": "1.0.0", "name": "Mine", "catalogs": [{ "type": "movie", "id": "new" }] });
        conn.execute("UPDATE addons SET transport_url = x'01', manifest = ?1 WHERE key = 'mine'", [configured.to_string()]).unwrap();
        // The old settings' manifest would undo the new one's catalogs.
        let outcomes = apply_kept(&conn, &mut kept, "main", vec![ManifestUpdate { key: "mine".into() }]);
        assert_eq!(outcomes[0].outcome, RefreshOutcome::Failed);
        assert_eq!(manifest_of(&conn, "mine"), configured);
    }

    #[test]
    fn background_refreshes_leave_out_disabled_addons() {
        use aes_gcm::KeyInit;
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7u8; 32]).unwrap();
        ensure_pref(&conn, "main", "mine").unwrap();
        conn.execute("UPDATE addon_prefs SET enabled = 0 WHERE addon_key = 'mine'", []).unwrap();
        let keys = |enabled_only| refresh_targets(&conn, "main", &cipher, enabled_only).unwrap().into_iter().map(|(k, _, _)| k).collect::<Vec<_>>();
        assert_eq!(keys(true), ["cinemeta", "kids-shared"]);
        // Asked for by the person (Check for updates, one addon's Refresh): every addon, as before.
        assert_eq!(keys(false), ["cinemeta", "mine", "kids-shared"]);
    }

    #[test]
    fn an_unconfirmed_install_link_never_reaches_the_lan() {
        // Port 1: were it fetched, it would fail as a network error instead.
        let url = "https://127.0.0.1:1/manifest.json".to_string();
        let err = tauri::async_runtime::block_on(addon_fetch_manifest(url.clone(), Some(true))).unwrap_err();
        assert!(matches!(err, AddonError::Blocked { reason: "local" }), "{err:?}");
        // Once the person confirmed (or typed it), it's fetched as before.
        let err = tauri::async_runtime::block_on(addon_fetch_manifest(url, None)).unwrap_err();
        assert!(!matches!(err, AddonError::Blocked { .. }), "{err:?}");
    }

    #[test]
    fn refresh_failures_are_per_addon_and_never_show_the_url() {
        use aes_gcm::KeyInit;
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7u8; 32]).unwrap();
        // Nothing listens on port 1, so the fetch fails at connect time.
        let sealed = vault::seal(&cipher, &aad("mine", Some("main")), b"http://127.0.0.1:1/secret-token/manifest.json").unwrap();
        conn.execute("UPDATE addons SET transport_url = ?1 WHERE key = 'mine'", [sealed]).unwrap();

        let targets = refresh_targets(&conn, "main", &cipher, false).unwrap();
        let fetched = tauri::async_runtime::block_on(fetch_manifests(targets));
        assert_eq!(fetched.iter().map(|f| f.key.as_str()).collect::<Vec<_>>(), ["cinemeta", "mine", "kids-shared"]);
        // Each addon fails on its own: the fixture's unreadable rows, and the unreachable one.
        assert!(fetched.iter().all(|f| f.body.is_none() && f.error.is_some()));
        assert!(matches!(fetched[0].error, Some(AddonError::ReinstallNeeded)));
        assert!(matches!(fetched[1].error, Some(AddonError::Network { .. })));
        let json = serde_json::to_string(&fetched).unwrap();
        assert!(!json.contains("secret-token") && !json.contains("127.0.0.1"), "{json}");
        // Fetching stores nothing.
        assert_eq!(manifest_of(&conn, "mine"), serde_json::json!({}));
    }

    #[test]
    fn reconfiguring_replaces_the_addon_in_place() {
        use aes_gcm::KeyInit;
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7u8; 32]).unwrap();
        conn.execute("UPDATE addons SET manifest = '{\"id\":\"org.mine\",\"name\":\"Mine\"}', display_host = 'mine.example'", []).unwrap();
        ensure_pref(&conn, "main", "mine").unwrap();
        conn.execute("UPDATE addon_prefs SET enabled = 0 WHERE addon_key = 'mine'", []).unwrap();
        let manifest = r#"{"id":"org.mine","name":"Mine","version":"2.0.0"}"#;

        // Another host claiming the same id can't take over the addon's settings.
        let spoof = Url::parse("https://evil.example/manifest.json").unwrap();
        assert!(matches!(replace_url(&conn, &cipher, "main", "mine", &spoof, manifest, "evil.example"), Err(AddonError::NotFound)));
        assert_eq!(find_visible(&conn, "main", "mine").unwrap().display_host, "mine.example");

        let url = Url::parse("https://mine.example/new-config/manifest.json").unwrap();
        replace_url(&conn, &cipher, "main", "mine", &url, manifest, "mine.example").unwrap();
        // The new settings are sealed into the same row, which keeps its place and enabled state.
        let addon = find_visible(&conn, "main", "mine").unwrap();
        assert_eq!(open_url(&cipher, "mine", Some("main"), &addon.sealed).unwrap(), url);
        // Bound to its owner: handed to another profile, it no longer opens.
        assert!(matches!(open_url(&cipher, "mine", Some("kid"), &addon.sealed), Err(AddonError::ReinstallNeeded)));
        assert_eq!((addon.display_host.as_str(), addon.enabled), ("mine.example", false));
        assert_eq!(manifest_of(&conn, "mine")["version"], "2.0.0");
        assert_eq!(keys(&conn, "main"), ["cinemeta", "mine", "kids-shared"]);

        // Only this profile's own addon, and only with the same manifest id.
        let other = r#"{"id":"org.other","name":"Other"}"#;
        assert!(matches!(replace_url(&conn, &cipher, "main", "mine", &url, other, "h"), Err(AddonError::NotFound)));
        assert!(matches!(replace_url(&conn, &cipher, "main", "kids-shared", &url, "{}", "h"), Err(AddonError::NotOwner)));
        assert!(matches!(replace_url(&conn, &cipher, "main", "cinemeta", &url, "{}", "h"), Err(AddonError::BuiltIn)));
        assert!(matches!(replace_url(&conn, &cipher, "main", "kids-private", &url, "{}", "h"), Err(AddonError::NotFound)));
    }

    #[test]
    fn old_rows_are_resealed_with_their_owner_once_and_never_lost() {
        use aes_gcm::KeyInit;
        let mut conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[3u8; 32]).unwrap();
        let url = "https://a.example/secret/manifest.json";
        let old = vault::seal(&cipher, &legacy_aad("mine"), url.as_bytes()).unwrap();
        conn.execute("UPDATE addons SET transport_url = ?1 WHERE key = 'mine'", [&old]).unwrap();
        let current = vault::seal(&cipher, &aad("kids-shared", Some("kid")), url.as_bytes()).unwrap();
        conn.execute("UPDATE addons SET transport_url = ?1 WHERE key = 'kids-shared'", [&current]).unwrap();
        let sealed = |conn: &Connection, key: &str| conn.query_row("SELECT transport_url FROM addons WHERE key = ?1", [key], |r| r.get::<_, Vec<u8>>(0)).unwrap();

        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 1);
        // Now bound to its owner: the legacy form no longer opens it, nor another owner.
        let resealed = sealed(&conn, "mine");
        assert_eq!(vault::open(&cipher, &aad("mine", Some("main")), &resealed).unwrap(), url.as_bytes());
        assert!(vault::open(&cipher, &legacy_aad("mine"), &resealed).is_err());
        assert!(open_url(&cipher, "mine", Some("kid"), &resealed).is_err());
        // Rows already bound, and rows that can't be opened (the fixture's x'00'), are left exactly as they were.
        assert_eq!(sealed(&conn, "kids-shared"), current);
        assert_eq!(sealed(&conn, "kids-private"), vec![0]);
        // Idempotent.
        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 0);
        assert_eq!(sealed(&conn, "mine"), resealed);
    }

    #[test]
    fn urls_are_bound_to_row_and_owner_and_old_rows_still_open() {
        use aes_gcm::KeyInit;
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[5u8; 32]).unwrap();
        let url = Url::parse("https://a.example/secret/manifest.json").unwrap();
        let sealed = vault::seal(&cipher, &aad("k1", Some("main")), url.as_str().as_bytes()).unwrap();
        assert_eq!(open_url(&cipher, "k1", Some("main"), &sealed).unwrap(), url);
        for (key, owner) in [("k1", Some("kid")), ("k1", None), ("k2", Some("main"))] {
            assert!(open_url(&cipher, key, owner, &sealed).is_err(), "{key} {owner:?}");
        }
        let built_in = vault::seal(&cipher, &aad("k3", None), url.as_str().as_bytes()).unwrap();
        assert!(open_url(&cipher, "k3", None, &built_in).is_ok());
        assert!(open_url(&cipher, "k3", Some("main"), &built_in).is_err());
        // Sealed before the owner was bound: still read, still tied to its row.
        let old = vault::seal(&cipher, &legacy_aad("k4"), url.as_str().as_bytes()).unwrap();
        assert_eq!(open_url(&cipher, "k4", Some("main"), &old).unwrap(), url);
        assert!(open_url(&cipher, "k5", Some("main"), &old).is_err());
    }

    #[test]
    fn the_shown_host_never_carries_the_path_or_credentials() {
        let host = |s: &str| display_host(&Url::parse(s).unwrap());
        assert_eq!(host("https://user:secret@addon.example/abc123token/manifest.json"), "addon.example");
        assert_eq!(host("https://addon.example:8443/cfg/manifest.json"), "addon.example:8443");
        // The scheme's default port isn't shown.
        assert_eq!(host("https://addon.example:443/manifest.json"), "addon.example");
        assert_eq!(host("http://127.0.0.1:7000/manifest.json"), "127.0.0.1:7000");
        // Each row's associated data is distinct per key and per owner.
        let all = [aad("aa", None), aad("aa", Some("main")), aad("aa", Some("kid")), aad("ab", Some("main")), legacy_aad("aa")];
        let distinct: std::collections::HashSet<_> = all.iter().collect();
        assert_eq!(distinct.len(), all.len());
    }

    #[test]
    fn links_resolve_only_to_existing_profiles() {
        let conn = conn();
        assert_eq!(linked_to(&conn, "kid").unwrap(), None);
        conn.execute("UPDATE profiles SET addons_from = 'main' WHERE id = 'kid'", []).unwrap();
        assert_eq!(linked_to(&conn, "kid").unwrap(), Some(("main".into(), "Me".into())));
        // A link to a profile that no longer exists is ignored.
        conn.execute("UPDATE profiles SET addons_from = 'gone' WHERE id = 'kid'", []).unwrap();
        assert_eq!(linked_to(&conn, "kid").unwrap(), None);
    }
}
