//! My cloud: what's already in the person's own debrid accounts (Settings →
//! Integrations → Debrid accounts), listed and played without any scraping.
//! Several providers can be connected on one profile at once; each is asked
//! on its own, so one failing or rate-limited never hides the others' items.
//!
//! Hardening, and why:
//! - API keys are small secrets: each sits in the OS keychain as
//!   `debrid.{provider}.{profile}`, which the WebView's secret commands
//!   can't touch (see keychain.rs). The page can add or remove a key, never
//!   read one; SQLite keeps only the account's name and premium date.
//! - Every request is made here, to fixed https API hosts with redirects off
//!   (see net.rs); answers are capped, time-limited and checked field by field.
//! - The page gets names, sizes, states and `orbit-debrid://{provider}/{item}/{file}`
//!   addresses. A playable link (which is signed, and for some providers may
//!   carry account details) is made only when the player or the downloader
//!   asks for one (`resolve`, `resolve_download`), goes straight to mpv or the
//!   download job, and is never kept, logged or sent back to the page.
//! - Requests keep under each provider's rate limit, and a 429 pauses that
//!   account's requests for as long as the provider asks (see `net::Gate`).
//!
//! Providers: Real-Debrid and TorBox. Another (AllDebrid, Premiumize) is a
//! module like realdebrid.rs, a `Provider` variant, and an arm in each `match`
//! on it below: its user check, list, files, link and delete calls.

mod net;
mod realdebrid;
mod torbox;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::{Method, Url};
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State as Injected};
use zeroize::Zeroize;

use crate::db::Db;
use crate::episode_files;
use crate::keychain;
use crate::library::now_ms;
use crate::profiles::ActiveProfile;
use net::{Body, Fail};
/// Also reads Jellyfin's dates (jellyfin/items.rs).
pub(crate) use net::iso_ms;

/// How the page asks the player (or the downloader) for a file in the cloud.
pub const SCHEME: &str = "orbit-debrid://";
/// Keychain names under this prefix are Orbit's own (see keychain.rs).
pub(crate) const KEY_PREFIX: &str = "debrid.";
/// More items or files than any account holds; stops a runaway answer.
const MAX_ITEMS: usize = 5000;
const MAX_FILES: usize = 5000;
/// A file list is reused this long (Real-Debrid asks one request per item).
const FILES_TTL: Duration = Duration::from_secs(60);
/// TorBox's files (they come with its list) are reused up to the longest a list may be kept.
const KEPT_FILES_MAX: Duration = Duration::from_secs(600);
/// The list is reused this long unless the page asks otherwise.
const LIST_TTL: Duration = Duration::from_secs(60);
/// Even a Refresh reuses a list this fresh.
const LIST_FLOOR: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    RealDebrid,
    TorBox,
}

impl Provider {
    pub const ALL: [Self; 2] = [Self::RealDebrid, Self::TorBox];

    pub fn key(self) -> &'static str {
        match self {
            Self::RealDebrid => "realdebrid",
            Self::TorBox => "torbox",
        }
    }

    pub fn parse(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.key() == key)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::RealDebrid => "Real-Debrid",
            Self::TorBox => "TorBox",
        }
    }

    /// Time between requests: just under the published limit (Real-Debrid
    /// 250 a minute, TorBox 300), leaving room for addons using the same account.
    fn every(self) -> Duration {
        match self {
            Self::RealDebrid => Duration::from_millis(300),
            Self::TorBox => Duration::from_millis(250),
        }
    }

    fn valid_item(self, id: &str) -> bool {
        match self {
            Self::RealDebrid => realdebrid::is_id(id),
            Self::TorBox => torbox::parse_id(id).is_some(),
        }
    }
}

/// Who the key belongs to, from the provider.
pub struct Account {
    pub user_name: String,
    /// Milliseconds since 1970; None on a free account.
    pub premium_until: Option<i64>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Ready,
    Downloading,
    Queued,
    Error,
}

/// One torrent or download in an account, as the page sees it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub provider: &'static str,
    pub id: String,
    pub name: String,
    pub size: u64,
    pub state: State,
    /// 0–100.
    pub progress: f64,
    /// When it was added, ms since 1970.
    pub added: Option<i64>,
    pub deletable: bool,
}

/// A file inside an item, as the provider lists it. Never sent to the page
/// as is: `link` (Real-Debrid's hoster link) stays here.
pub struct Entry {
    pub id: u64,
    pub path: String,
    pub size: u64,
    /// The provider can make a link for it on its own (not packed into an archive).
    pub playable: bool,
    pub link: Option<String>,
}

pub struct Content {
    pub name: String,
    pub ready: bool,
    pub entries: Vec<Entry>,
}

/// An API key, wiped from memory when dropped.
struct Key(String);

impl Drop for Key {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Real-Debrid tokens are 52 letters and digits, TorBox keys UUIDs. Anything
/// else (which could break out of a header) is refused before it's sent.
fn valid_key(key: &str) -> bool {
    (16..=128).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn key_entry(provider: Provider, profile: &str) -> String {
    format!("{KEY_PREFIX}{}.{profile}", provider.key())
}

/// A profile's account with one provider.
type Slot = (String, Provider);
/// A kept copy and when it was fetched.
type Kept<T> = (Instant, Arc<T>);

/// Each account's rate-limit place, and short-lived copies of its lists.
#[derive(Default)]
pub struct Debrid {
    gates: Mutex<HashMap<Slot, net::Gate>>,
    lists: Mutex<HashMap<Slot, Kept<Vec<Item>>>>,
    /// Each item's files, by account and item id.
    contents: Mutex<HashMap<(String, Provider, String), Kept<Content>>>,
    /// The sections of each account's last list its plan left out (see `torbox::refused`).
    refused: Mutex<HashMap<Slot, Vec<&'static str>>>,
}

impl Debrid {
    fn note_refused(&self, slot: &Slot, kinds: &[torbox::Kind]) {
        if let Ok(mut refused) = self.refused.lock() {
            refused.insert(slot.clone(), kinds.iter().map(|k| k.section()).collect());
        }
    }

    /// A "restricted" problem for each section an account's plan leaves out,
    /// after the list's other problems, so the page says why those items are missing.
    fn add_refused(&self, listing: &mut Listing, profile: &str, providers: &[Provider]) {
        let Ok(refused) = self.refused.lock() else { return };
        for provider in providers {
            for section in refused.get(&(profile.to_string(), *provider)).into_iter().flatten() {
                listing.problems.push(Problem { provider: provider.key(), kind: "restricted", retry_in: None, section: Some(section) });
            }
        }
    }

    fn forget(&self, profile: &str, provider: Provider) {
        if let Ok(mut lists) = self.lists.lock() {
            lists.remove(&(profile.to_string(), provider));
        }
        if let Ok(mut refused) = self.refused.lock() {
            refused.remove(&(profile.to_string(), provider));
        }
        if let Ok(mut contents) = self.contents.lock() {
            contents.retain(|(p, pr, _), _| !(p == profile && *pr == provider));
        }
    }

    fn forget_item(&self, profile: &str, provider: Provider, item: &str) {
        if let Ok(mut lists) = self.lists.lock()
            && let Some((at, items)) = lists.get(&(profile.to_string(), provider)).cloned()
        {
            let kept: Vec<Item> = items.iter().filter(|i| i.id != item).cloned().collect();
            lists.insert((profile.to_string(), provider), (at, Arc::new(kept)));
        }
        if let Ok(mut contents) = self.contents.lock() {
            contents.remove(&(profile.to_string(), provider, item.to_string()));
        }
    }
}

/// One account, opened for a request: its key and its place in the rate limit.
pub struct Api<'a> {
    debrid: &'a Debrid,
    profile: &'a str,
    provider: Provider,
    key: Key,
}

impl Api<'_> {
    pub fn key(&self) -> &str {
        &self.key.0
    }

    /// Waits for this account's turn, sends, and reads JSON. A 429 pauses
    /// the account's requests (see `net::Gate`).
    pub async fn call(&self, method: Method, url: Url, body: Body<'_>, limit: usize) -> Result<Value, Fail> {
        let slot = (self.profile.to_string(), self.provider);
        let wait = {
            let mut gates = self.debrid.gates.lock().map_err(|_| Fail::Network)?;
            let now = Instant::now();
            gates.entry(slot.clone()).or_insert_with(|| net::Gate::new(now)).reserve(now, self.provider.every())?
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        match net::send(method, url, Some(self.key()), body, limit).await {
            Ok(body) => net::json(&body),
            Err(Fail::RateLimited(after)) => {
                let now = Instant::now();
                let pause = self.debrid.gates.lock().map_or(after, |mut gates| gates.entry(slot).or_insert_with(|| net::Gate::new(now)).back_off(now, Some(after)));
                Err(Fail::RateLimited(pause))
            }
            Err(e) => Err(e),
        }
    }
}

fn open<'a>(debrid: &'a Debrid, profile: &'a str, provider: Provider) -> Result<Api<'a>, Fail> {
    match keychain::get(&key_entry(provider, profile)) {
        Ok(Some(key)) => Ok(Api { debrid, profile, provider, key: Key(key) }),
        _ => Err(Fail::NoKey),
    }
}

/// What a failure means, in words for the person. Never holds a key or an address.
fn describe(provider: Provider, fail: &Fail) -> String {
    let name = provider.name();
    match fail {
        Fail::Denied => crate::user_error::coded("debrid.signed-out", &[("provider", name)]),
        Fail::RateLimited(wait) => crate::user_error::coded("debrid.busy", &[("provider", name), ("seconds", &wait.as_secs().max(1).to_string())]),
        Fail::Gone => crate::user_error::coded("debrid.gone", &[("provider", name)]),
        Fail::Timeout => crate::user_error::coded("debrid.timeout", &[("provider", name)]),
        Fail::Network => crate::user_error::coded("debrid.unreachable", &[("provider", name)]),
        Fail::Status(status) => crate::user_error::coded("debrid.status", &[("provider", name), ("status", &status.to_string())]),
        Fail::TooLarge | Fail::Invalid => crate::user_error::coded("debrid.invalid", &[("provider", name)]),
        Fail::NoKey => crate::user_error::coded("debrid.key-unreadable", &[("provider", name)]),
    }
}

/// A provider that couldn't be asked, for the page to word (and to say when to try again).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    provider: &'static str,
    /// "denied", "rate-limited", "unreachable" or "failed".
    kind: &'static str,
    /// Seconds, when rate-limited.
    retry_in: Option<u64>,
    /// With "restricted": the part of the cloud the account's plan leaves out ("usenet", "web").
    #[serde(skip_serializing_if = "Option::is_none")]
    section: Option<&'static str>,
}

fn problem(provider: Provider, fail: &Fail) -> Problem {
    let (kind, retry_in) = match fail {
        Fail::Denied | Fail::NoKey => ("denied", None),
        Fail::RateLimited(wait) => ("rate-limited", Some(wait.as_secs().max(1))),
        Fail::Timeout | Fail::Network => ("unreachable", None),
        _ => ("failed", None),
    };
    Problem { provider: provider.key(), kind, retry_in, section: None }
}

// ── Accounts ──

/// A connected account as Settings shows it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    provider: &'static str,
    name: &'static str,
    user_name: String,
    premium_until: Option<i64>,
}

fn accounts_of(db: &Db, profile: &str) -> Result<Vec<(Provider, AccountStatus)>, String> {
    let conn = db.lock()?;
    let mut stmt = conn.prepare("SELECT provider, user_name, premium_until FROM debrid_accounts WHERE profile_id = ?1 ORDER BY connected_at").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([profile], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<i64>>(2)?))).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (key, user_name, premium_until) = row.map_err(|e| e.to_string())?;
        if let Some(provider) = Provider::parse(&key) {
            out.push((provider, AccountStatus { provider: provider.key(), name: provider.name(), user_name, premium_until }));
        }
    }
    Ok(out)
}

fn save_account(db: &Db, profile: &str, provider: Provider, account: &Account) -> Result<(), String> {
    db.lock()?
        .execute(
            "INSERT INTO debrid_accounts (profile_id, provider, user_name, premium_until, connected_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(profile_id, provider) DO UPDATE SET user_name = excluded.user_name, premium_until = excluded.premium_until",
            params![profile, provider.key(), account.user_name, account.premium_until, now_ms()],
        )
        .map(drop)
        .map_err(|e| e.to_string())
}

/// Today's name and premium date for an account still connected. Never adds one: an account
/// removed while it was being asked about must stay removed (its key is gone from the keychain).
fn refresh_account(db: &Db, profile: &str, provider: Provider, account: &Account) -> Result<(), String> {
    db.lock()?
        .execute(
            "UPDATE debrid_accounts SET user_name = ?3, premium_until = ?4 WHERE profile_id = ?1 AND provider = ?2",
            params![profile, provider.key(), account.user_name, account.premium_until],
        )
        .map(drop)
        .map_err(|e| e.to_string())
}

async fn user(api: &Api<'_>) -> Result<Account, Fail> {
    match api.provider {
        Provider::RealDebrid => realdebrid::user(api, now_ms()).await,
        Provider::TorBox => torbox::user(api).await,
    }
}

#[tauri::command]
pub async fn debrid_accounts(db: Injected<'_, Db>, active: Injected<'_, ActiveProfile>) -> Result<Vec<AccountStatus>, String> {
    Ok(accounts_of(&db, &active.id()?)?.into_iter().map(|(_, a)| a).collect())
}

/// Checks `key` with the provider and, if it's accepted, keeps it in the
/// keychain for the active profile (replacing one it had for that provider).
#[tauri::command]
pub async fn debrid_connect(db: Injected<'_, Db>, active: Injected<'_, ActiveProfile>, state: Injected<'_, Debrid>, provider: String, mut key: String) -> Result<AccountStatus, String> {
    let trimmed = Key(key.trim().to_string());
    key.zeroize();
    let provider = Provider::parse(&provider).ok_or("unknown provider")?;
    if !valid_key(&trimmed.0) {
        return Err(crate::user_error::coded("debrid.key-format", &[("provider", provider.name())]));
    }
    let profile = active.id()?;
    let api = Api { debrid: &state, profile: &profile, provider, key: trimmed };
    let account = user(&api).await.map_err(|e| match e {
        Fail::Denied => crate::user_error::coded("debrid.rejected", &[("provider", provider.name())]),
        e => describe(provider, &e),
    })?;
    keychain::set(&key_entry(provider, &profile), api.key())?;
    save_account(&db, &profile, provider, &account)?;
    state.forget(&profile, provider);
    Ok(AccountStatus { provider: provider.key(), name: provider.name(), user_name: account.user_name, premium_until: account.premium_until })
}

#[derive(Serialize)]
pub struct Checked {
    accounts: Vec<AccountStatus>,
    problems: Vec<Problem>,
}

/// Asks each connected provider who the key belongs to again, so Settings
/// shows today's premium date (and a key revoked since).
#[tauri::command]
pub async fn debrid_check(db: Injected<'_, Db>, active: Injected<'_, ActiveProfile>, state: Injected<'_, Debrid>) -> Result<Checked, String> {
    let profile = active.id()?;
    let mut problems = Vec::new();
    for (provider, _) in accounts_of(&db, &profile)? {
        let checked = match open(&state, &profile, provider) {
            Ok(api) => user(&api).await,
            Err(e) => Err(e),
        };
        match checked {
            Ok(account) => refresh_account(&db, &profile, provider, &account)?,
            Err(e) => problems.push(problem(provider, &e)),
        }
    }
    Ok(Checked { accounts: accounts_of(&db, &profile)?.into_iter().map(|(_, a)| a).collect(), problems })
}

/// Forgets the provider's key and account for the active profile. Nothing
/// is sent to the provider: the person can make a new key there to revoke this one.
#[tauri::command]
pub async fn debrid_disconnect(db: Injected<'_, Db>, active: Injected<'_, ActiveProfile>, state: Injected<'_, Debrid>, provider: String) -> Result<(), String> {
    let provider = Provider::parse(&provider).ok_or("unknown provider")?;
    let profile = active.id()?;
    keychain::delete(&key_entry(provider, &profile))?;
    db.lock()?.execute("DELETE FROM debrid_accounts WHERE profile_id = ?1 AND provider = ?2", params![profile, provider.key()]).map_err(|e| e.to_string())?;
    state.forget(&profile, provider);
    Ok(())
}

/// Forgets a deleted profile's keys (its rows go with the profile's, see profiles.rs).
pub(crate) fn forget(profile: &str) -> Result<(), String> {
    // Each key is tried even if one before it couldn't be removed.
    crate::profiles::all_done(Provider::ALL.map(|provider| ("debrid key", keychain::delete(&key_entry(provider, profile)))))
}

// ── Lists and files ──

type Listed = Result<Arc<Vec<Item>>, (Fail, Option<Arc<Vec<Item>>>)>;

/// The provider's items: a recent copy if there is one (younger than
/// `max_age`, or than `LIST_FLOOR` on a Refresh), else asked afresh. If
/// asking fails, the last copy (if any) comes back with the failure.
async fn items_of(debrid: &Debrid, profile: &str, provider: Provider, max_age: Duration, refresh: bool) -> Listed {
    let slot = (profile.to_string(), provider);
    let cached = debrid.lists.lock().ok().and_then(|l| l.get(&slot).cloned());
    if let Some((at, items)) = &cached
        && reuse(at.elapsed(), max_age, refresh)
    {
        return Ok(items.clone());
    }
    let stale = || cached.as_ref().map(|(_, items)| items.clone());
    let api = open(debrid, profile, provider).map_err(|e| (e, stale()))?;
    let fetched = match provider {
        Provider::RealDebrid => realdebrid::list(&api).await,
        Provider::TorBox => torbox::list(&api, refresh).await.map(|listed| {
            debrid.note_refused(&slot, &listed.refused);
            let now = Instant::now();
            let (items, contents): (Vec<Item>, Vec<Content>) = listed.items.into_iter().unzip();
            if let Ok(mut kept) = debrid.contents.lock() {
                kept.retain(|(p, pr, _), _| !(p == profile && *pr == provider));
                for (item, content) in items.iter().zip(contents) {
                    kept.insert((profile.to_string(), provider, item.id.clone()), (now, Arc::new(content)));
                }
            }
            items
        }),
    };
    let items = Arc::new(fetched.map_err(|e| (e, stale()))?);
    if let Ok(mut lists) = debrid.lists.lock() {
        lists.insert(slot, (Instant::now(), items.clone()));
    }
    Ok(items)
}

/// Whether a kept list this old is used as is.
fn reuse(age: Duration, max_age: Duration, refresh: bool) -> bool {
    age < LIST_FLOOR || (!refresh && age < max_age)
}

/// Newest first; items with no date last.
fn newest_first(items: &mut [Item]) {
    items.sort_by(|a, b| b.added.unwrap_or(i64::MIN).cmp(&a.added.unwrap_or(i64::MIN)));
}

#[derive(Serialize)]
pub struct Listing {
    items: Vec<Item>,
    problems: Vec<Problem>,
}

/// Every connected account's items together, newest first. Each provider is
/// asked on its own: one that fails (or is rate-limited) adds a problem, and
/// still shows its last list if Orbit has one, without holding up the rest.
/// `max_age` (seconds, 10–600) is how old a kept list may be; `refresh`
/// asks afresh (see `LIST_FLOOR`).
#[tauri::command]
pub async fn debrid_items(app: AppHandle, db: Injected<'_, Db>, active: Injected<'_, ActiveProfile>, max_age: Option<u64>, refresh: Option<bool>) -> Result<Listing, String> {
    let profile = active.id()?;
    let max_age = max_age.map_or(LIST_TTL, |s| Duration::from_secs(s.clamp(10, 600)));
    let refresh = refresh.unwrap_or(false);
    let mut asks = tokio::task::JoinSet::new();
    for (provider, _) in accounts_of(&db, &profile)? {
        let (app, profile) = (app.clone(), profile.clone());
        asks.spawn(async move {
            let debrid = app.state::<Debrid>();
            (provider, items_of(&debrid, &profile, provider, max_age, refresh).await)
        });
    }
    let mut results = Vec::new();
    while let Some(done) = asks.join_next().await {
        results.extend(done.ok());
    }
    let providers: Vec<Provider> = results.iter().map(|(provider, _)| *provider).collect();
    let mut listing = merge(results);
    app.state::<Debrid>().add_refused(&mut listing, &profile, &providers);
    Ok(listing)
}

/// The providers' lists together: a failed one adds a problem and its last list, if any.
fn merge(results: Vec<(Provider, Listed)>) -> Listing {
    let (mut items, mut problems) = (Vec::new(), Vec::new());
    for (provider, listed) in results {
        match listed {
            Ok(list) => items.extend(list.iter().cloned()),
            Err((fail, stale)) => {
                problems.push(problem(provider, &fail));
                items.extend(stale.iter().flat_map(|list| list.iter().cloned()));
            }
        }
    }
    newest_first(&mut items);
    problems.sort_by_key(|p| p.provider);
    Listing { items, problems }
}

/// An item's name, state and files: kept briefly, else asked afresh (Real-Debrid)
/// or taken from the account's list (TorBox lists files with the items).
async fn content_of(debrid: &Debrid, profile: &str, provider: Provider, item: &str) -> Result<Arc<Content>, Fail> {
    let slot = (profile.to_string(), provider, item.to_string());
    let cached = debrid.contents.lock().ok().and_then(|c| c.get(&slot).cloned());
    match provider {
        Provider::RealDebrid => {
            if let Some((_, content)) = cached.filter(|(at, _)| at.elapsed() < FILES_TTL) {
                return Ok(content);
            }
            let api = open(debrid, profile, provider)?;
            let content = Arc::new(realdebrid::files(&api, item).await?);
            if let Ok(mut contents) = debrid.contents.lock() {
                contents.insert(slot, (Instant::now(), content.clone()));
            }
            Ok(content)
        }
        Provider::TorBox => {
            // The list brings every item's files: they're as fresh as the list
            // the page showed, so they're used while it could still be showing it.
            if let Some((_, content)) = cached.filter(|(at, _)| at.elapsed() < KEPT_FILES_MAX) {
                return Ok(content);
            }
            if let Err((fail, _)) = items_of(debrid, profile, provider, FILES_TTL, false).await {
                return Err(fail);
            }
            debrid.contents.lock().ok().and_then(|c| c.get(&slot).map(|(_, content)| content.clone())).ok_or(Fail::Gone)
        }
    }
}

/// A file as the page sees it (the shape of a torrent's files, see torrent.rs),
/// with the address that plays it when it can be played.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct File {
    index: u64,
    name: String,
    size: u64,
    video: bool,
    extra: bool,
    season: Option<u32>,
    episode: Option<u32>,
    last_episode: Option<u32>,
    address: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct Files {
    name: String,
    ready: bool,
    files: Vec<File>,
}

fn describe_files(provider: Provider, item: &str, content: &Content) -> Files {
    let files = content
        .entries
        .iter()
        .take(MAX_FILES)
        .map(|e| {
            let numbered = episode_files::parse(&e.path, &content.name);
            let video = episode_files::is_video(&e.path);
            File {
                index: e.id,
                name: episode_files::shown(&e.path),
                size: e.size,
                video,
                extra: episode_files::is_extra(&e.path),
                season: numbered.and_then(|n| n.season),
                episode: numbered.map(|n| n.first),
                last_episode: numbered.filter(|n| n.last != n.first).map(|n| n.last),
                address: (content.ready && video && e.playable).then(|| address(provider, item, e.id)),
            }
        })
        .collect();
    Files { name: content.name.clone(), ready: content.ready, files }
}

#[tauri::command]
pub async fn debrid_files(active: Injected<'_, ActiveProfile>, state: Injected<'_, Debrid>, provider: String, item: String) -> Result<Files, String> {
    let provider = Provider::parse(&provider).filter(|p| p.valid_item(&item)).ok_or("invalid item")?;
    let profile = active.id()?;
    let content = content_of(&state, &profile, provider, &item).await.map_err(|e| describe(provider, &e))?;
    Ok(describe_files(provider, &item, &content))
}

/// Deletes an item from the account (the page asks the person first).
#[tauri::command]
pub async fn debrid_delete(active: Injected<'_, ActiveProfile>, state: Injected<'_, Debrid>, provider: String, item: String) -> Result<(), String> {
    let provider = Provider::parse(&provider).filter(|p| p.valid_item(&item)).ok_or("invalid item")?;
    let profile = active.id()?;
    let api = open(&state, &profile, provider).map_err(|e| describe(provider, &e))?;
    let deleted = match provider {
        Provider::RealDebrid => realdebrid::delete(&api, &item).await,
        Provider::TorBox => torbox::delete(&api, &item).await,
    };
    match deleted {
        // Already gone counts as deleted.
        Ok(()) | Err(Fail::Gone) => {
            state.forget_item(&profile, provider, &item);
            Ok(())
        }
        Err(e) => Err(describe(provider, &e)),
    }
}

// ── Playing and downloading ──

pub fn address(provider: Provider, item: &str, file: u64) -> String {
    format!("{SCHEME}{}/{item}/{file}", provider.key())
}

/// The provider, item and file an address names; None for anything else.
pub fn parse_address(address: &str) -> Option<(Provider, String, u64)> {
    let mut parts = address.strip_prefix(SCHEME)?.split('/');
    let (provider, item, file) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || !(1..=12).contains(&file.len()) || !file.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let provider = Provider::parse(provider).filter(|p| p.valid_item(item))?;
    Some((provider, item.to_string(), file.parse().ok()?))
}

/// A fresh download link for the file an address names.
async fn link_for(debrid: &Debrid, profile: &str, provider: Provider, item: &str, file: u64) -> Result<Url, Fail> {
    match provider {
        Provider::RealDebrid => {
            let content = content_of(debrid, profile, provider, item).await?;
            let link = content.entries.iter().find(|e| e.id == file).and_then(|e| e.link.clone()).filter(|_| content.ready).ok_or(Fail::Gone)?;
            realdebrid::unrestrict(&open(debrid, profile, provider)?, &link).await
        }
        Provider::TorBox => torbox::request_link(&open(debrid, profile, provider)?, item, file).await,
    }
}

/// The link mpv plays for `orbit-debrid://…`, made now and handed straight to the player.
pub async fn resolve(app: &AppHandle, profile: &str, address: &str) -> Result<String, String> {
    let (provider, item, file) = parse_address(address).ok_or("invalid cloud address")?;
    link_for(&app.state::<Debrid>(), profile, provider, &item, file).await.map(String::from).map_err(|e| describe(provider, &e))
}

/// Why a download's link couldn't be made.
pub enum Unavailable {
    /// The file (or the account's key) is gone.
    Gone,
    /// Try again later.
    Failed,
}

/// The link a download job fetches, made each time it (re)starts: a link
/// that expires mid-way is simply made again when the download resumes.
pub async fn resolve_download(app: &AppHandle, profile: &str, address: &str) -> Result<String, Unavailable> {
    let (provider, item, file) = parse_address(address).ok_or(Unavailable::Gone)?;
    link_for(&app.state::<Debrid>(), profile, provider, &item, file).await.map(String::from).map_err(|e| match e {
        Fail::Gone | Fail::Denied | Fail::NoKey => Unavailable::Gone,
        _ => Unavailable::Failed,
    })
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let _ = parse_address(&String::from_utf8_lossy(data));
    if let Ok(value) = serde_json::from_slice(data) {
        let _ = realdebrid::parse_user(&value, 0);
        let items = realdebrid::parse_torrents(&value);
        assert!(items.len() <= MAX_ITEMS);
        assert!(
            items
                .iter()
                .all(|i| i.progress.is_finite() && (0.0..=100.0).contains(&i.progress))
        );
        if let Ok(info) = realdebrid::parse_info(&value) {
            assert!(info.entries.len() <= MAX_FILES);
        }
        let _ = realdebrid::parse_unrestricted(&value);
        for kind in [
            torbox::Kind::Torrent,
            torbox::Kind::Usenet,
            torbox::Kind::Web,
        ] {
            if let Ok(items) = torbox::parse_list(&value, kind) {
                assert!(items.len() <= MAX_ITEMS);
                for (item, content) in items {
                    assert!(item.progress.is_finite() && (0.0..=100.0).contains(&item.progress));
                    assert!(content.entries.len() <= MAX_FILES);
                }
            }
        }
        let _ = torbox::parse_user(&value);
        let _ = torbox::parse_link(&value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert_eq!(address(Provider::RealDebrid, "ABC123", 3), "orbit-debrid://realdebrid/ABC123/3");
        assert_eq!(parse_address("orbit-debrid://realdebrid/ABC123/3"), Some((Provider::RealDebrid, "ABC123".into(), 3)));
        assert_eq!(parse_address("orbit-debrid://torbox/t42/0"), Some((Provider::TorBox, "t42".into(), 0)));
        for bad in [
            "orbit-debrid://torbox/42/0",
            "orbit-debrid://realdebrid/ABC/3/4",
            "orbit-debrid://realdebrid/ABC",
            "orbit-debrid://realdebrid/../3",
            "orbit-debrid://realdebrid/ABC/3?token=x",
            "orbit-debrid://realdebrid/ABC/-1",
            "orbit-debrid://alldebrid/ABC/1",
            "orbit-plex://1/2",
            "https://real-debrid.com/d/ABC",
        ] {
            assert_eq!(parse_address(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_check_does_not_bring_back_an_account_removed_meanwhile() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let account = |name: &str| Account { user_name: name.into(), premium_until: Some(1) };
        save_account(&db, "main", Provider::TorBox, &account("sam")).unwrap();
        refresh_account(&db, "main", Provider::TorBox, &account("sam2")).unwrap();
        assert_eq!(accounts_of(&db, "main").unwrap()[0].1.user_name, "sam2");
        // Removed (Settings → Remove) while a check was asking TorBox: its answer adds nothing back.
        db.lock().unwrap().execute("DELETE FROM debrid_accounts", []).unwrap();
        refresh_account(&db, "main", Provider::TorBox, &account("sam")).unwrap();
        assert!(accounts_of(&db, "main").unwrap().is_empty());
    }

    #[test]
    fn keys_live_under_orbits_own_keychain_names() {
        for provider in Provider::ALL {
            let name = key_entry(provider, "0123456789abcdef");
            assert!(name.starts_with(KEY_PREFIX));
            assert!(crate::check_name(&name).is_ok(), "{name}");
            assert_eq!(Provider::parse(provider.key()), Some(provider));
        }
        assert_ne!(key_entry(Provider::TorBox, "main"), key_entry(Provider::TorBox, "kid"));
        assert!(valid_key("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOP"));
        assert!(valid_key("123e4567-e89b-12d3-a456-426614174000"));
        assert!(!valid_key("short") && !valid_key("abc\r\nX-Evil: 1abcdefghijk") && !valid_key("has space in it 12345"));
    }

    #[test]
    fn failures_never_carry_the_key_or_an_address() {
        let fails = [Fail::Denied, Fail::RateLimited(Duration::from_secs(12)), Fail::Gone, Fail::Status(500), Fail::Timeout, Fail::Network, Fail::TooLarge, Fail::Invalid, Fail::NoKey];
        for provider in Provider::ALL {
            for fail in &fails {
                let text = describe(provider, fail);
                assert!(!text.contains("http") && !text.contains("token") && text.contains(provider.name()), "{text}");
                let shown = serde_json::to_string(&problem(provider, fail)).unwrap();
                assert!(!shown.contains("http"), "{shown}");
            }
        }
        assert_eq!(problem(Provider::TorBox, &Fail::RateLimited(Duration::from_secs(30))), Problem { provider: "torbox", kind: "rate-limited", retry_in: Some(30), section: None });
        assert_eq!(problem(Provider::RealDebrid, &Fail::NoKey).kind, "denied");
        assert_eq!(problem(Provider::RealDebrid, &Fail::Timeout).kind, "unreachable");
    }

    fn content() -> Content {
        Content {
            name: "Show.S02.1080p".into(),
            ready: true,
            entries: vec![
                Entry { id: 1, path: "Show.S02.1080p/Show.S02E03.1080p.mkv".into(), size: 900, playable: true, link: Some("https://real-debrid.com/d/SECRETLINK".into()) },
                Entry { id: 2, path: "Show.S02.1080p/Sample/sample.mkv".into(), size: 9, playable: true, link: Some("https://real-debrid.com/d/OTHER".into()) },
                Entry { id: 3, path: "Show.S02.1080p/info.nfo".into(), size: 1, playable: false, link: None },
                Entry { id: 4, path: "Show.S02.1080p/Show.S02E04.mkv".into(), size: 800, playable: false, link: None },
            ],
        }
    }

    #[test]
    fn files_read_episodes_and_only_ready_videos_play() {
        let files = describe_files(Provider::RealDebrid, "ABC", &content());
        let first = &files.files[0];
        assert_eq!((first.season, first.episode, first.video, first.extra), (Some(2), Some(3), true, false));
        assert_eq!(first.address.as_deref(), Some("orbit-debrid://realdebrid/ABC/1"));
        assert!(files.files[1].extra);
        // Not a video, or not playable on its own: no address.
        assert_eq!(files.files[2].address, None);
        assert_eq!(files.files[3].address, None);
        // Not ready yet: nothing plays.
        let waiting = Content { ready: false, ..content() };
        assert!(describe_files(Provider::RealDebrid, "ABC", &waiting).files.iter().all(|f| f.address.is_none()));
    }

    #[test]
    fn the_page_never_sees_links() {
        let shown = serde_json::to_string(&describe_files(Provider::RealDebrid, "ABC", &content())).unwrap();
        assert!(!shown.contains("SECRETLINK") && !shown.contains("real-debrid.com"), "{shown}");
        let item = Item { provider: "torbox", id: "t1".into(), name: "N".into(), size: 1, state: State::Ready, progress: 100.0, added: None, deletable: true };
        let shown = serde_json::to_value(&item).unwrap();
        assert_eq!(shown["state"], "ready");
        assert_eq!(shown.as_object().unwrap().len(), 8);
    }

    #[test]
    fn lists_merge_newest_first() {
        let item = |provider: &'static str, id: &str, added: Option<i64>| Item { provider, id: id.into(), name: id.into(), size: 0, state: State::Ready, progress: 100.0, added, deletable: true };
        let mut items = vec![item("realdebrid", "A", Some(1)), item("torbox", "t1", None), item("torbox", "t2", Some(3)), item("realdebrid", "B", Some(2))];
        newest_first(&mut items);
        assert_eq!(items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["t2", "B", "A", "t1"]);
    }

    #[test]
    fn one_provider_failing_doesnt_hide_the_other() {
        let item = |provider: &'static str, id: &str| Item { provider, id: id.into(), name: id.into(), size: 0, state: State::Ready, progress: 100.0, added: None, deletable: true };
        let listing = merge(vec![
            (Provider::TorBox, Err((Fail::RateLimited(Duration::from_secs(40)), Some(Arc::new(vec![item("torbox", "t1")]))))),
            (Provider::RealDebrid, Ok(Arc::new(vec![item("realdebrid", "A")]))),
        ]);
        let ids: Vec<&str> = listing.items.iter().map(|i| i.id.as_str()).collect();
        assert!(ids.contains(&"A") && ids.contains(&"t1"));
        assert_eq!(listing.problems, [Problem { provider: "torbox", kind: "rate-limited", retry_in: Some(40), section: None }]);
        // Failing with nothing kept: just the problem.
        let listing = merge(vec![(Provider::RealDebrid, Err((Fail::Denied, None))), (Provider::TorBox, Ok(Arc::new(vec![item("torbox", "t2")])))]);
        assert_eq!(listing.items.len(), 1);
        assert_eq!(listing.problems[0].kind, "denied");
    }

    #[test]
    fn sections_a_plan_leaves_out_are_reported_on_their_own() {
        let debrid = Debrid::default();
        let slot = ("p".to_string(), Provider::TorBox);
        debrid.note_refused(&slot, &[torbox::Kind::Usenet]);
        let mut listing = Listing { items: Vec::new(), problems: vec![problem(Provider::RealDebrid, &Fail::Timeout)] };
        debrid.add_refused(&mut listing, "p", &[Provider::RealDebrid, Provider::TorBox]);
        assert_eq!(listing.problems[1], Problem { provider: "torbox", kind: "restricted", retry_in: None, section: Some("usenet") });
        let shown = serde_json::to_value(&listing.problems[0]).unwrap();
        assert!(shown.get("section").is_none());
        // Another profile's, or once the plan includes it again, or the account is gone: nothing.
        let mut other = Listing { items: Vec::new(), problems: Vec::new() };
        debrid.add_refused(&mut other, "q", &[Provider::TorBox]);
        assert!(other.problems.is_empty());
        debrid.note_refused(&slot, &[]);
        debrid.add_refused(&mut other, "p", &[Provider::TorBox]);
        assert!(other.problems.is_empty());
        debrid.note_refused(&slot, &[torbox::Kind::Web]);
        debrid.forget("p", Provider::TorBox);
        debrid.add_refused(&mut other, "p", &[Provider::TorBox]);
        assert!(other.problems.is_empty());
    }

    #[test]
    fn kept_lists_are_reused_briefly() {
        let s = Duration::from_secs;
        assert!(reuse(s(30), LIST_TTL, false));
        assert!(!reuse(s(90), LIST_TTL, false));
        assert!(reuse(s(240), s(300), false));
        // Refresh asks again, unless the list is only seconds old.
        assert!(!reuse(s(30), LIST_TTL, true));
        assert!(reuse(s(5), LIST_TTL, true));
    }

    #[test]
    fn deleted_items_leave_the_kept_list() {
        let debrid = Debrid::default();
        let kept = Arc::new(vec![Item { provider: "torbox", id: "t1".into(), name: "N".into(), size: 0, state: State::Ready, progress: 100.0, added: None, deletable: true }]);
        debrid.lists.lock().unwrap().insert(("p".into(), Provider::TorBox), (Instant::now(), kept));
        debrid.contents.lock().unwrap().insert(("p".into(), Provider::TorBox, "t1".into()), (Instant::now(), Arc::new(content())));
        debrid.forget_item("p", Provider::TorBox, "t1");
        assert!(debrid.lists.lock().unwrap().get(&("p".into(), Provider::TorBox)).unwrap().1.is_empty());
        assert!(debrid.contents.lock().unwrap().is_empty());
        debrid.forget("p", Provider::TorBox);
        assert!(debrid.lists.lock().unwrap().is_empty());
    }

    #[test]
    fn accounts_are_per_profile_and_provider() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO debrid_accounts VALUES ('main', 'realdebrid', 'sam', NULL, 1)", []).unwrap();
        conn.execute("INSERT INTO debrid_accounts VALUES ('main', 'torbox', 'sam@x', 5, 2)", []).unwrap();
        conn.execute("INSERT INTO debrid_accounts VALUES ('kid', 'torbox', 'kid@x', NULL, 3)", []).unwrap();
        assert!(conn.execute("INSERT INTO debrid_accounts VALUES ('main', 'torbox', 'again', NULL, 4)", []).is_err());
        // No column for a key: it's in the keychain.
        let columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('debrid_accounts')").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert!(columns.iter().all(|c| !c.contains("key") && !c.contains("token") && !c.contains("secret")), "{columns:?}");
    }
}
