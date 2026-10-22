//! Plex as a source (Settings → Integrations → Plex): a Plex Media Server
//! the person's Plex account can use, one per profile.
//!
//! Signing in is Plex's PIN flow: Orbit asks plex.tv for a PIN, opens Plex's
//! sign-in page in the person's browser, and waits (bounded, cancellable)
//! until the PIN carries an account token. Orbit never sees the Plex
//! password. The account's servers come from plex.tv; once the person picks
//! one, Orbit keeps the server's own token, the account token (to find the
//! server again if its addresses change) and the server's addresses, sealed
//! by the vault and bound to the profile's row. Every request is made here;
//! the page sees titles, names and `plex-art` image keys, and plays
//! `orbit-plex://…`, which `player_open` resolves here (see playback.rs) —
//! so the tokens and the server's address never reach it.

mod art;
mod client;
mod items;
mod playback;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::{Method, Url};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use zeroize::Zeroize;

use crate::db::Db;
use crate::library::now_ms;
use crate::media_server::{self, NetError, Playable, Reply, random_hex, server_hash};
use crate::profiles::ActiveProfile;
use crate::vault;

pub use art::{SCHEME as ART_SCHEME, serve as serve_art};
use client::{Who, error_text};
use items::{Item, Meta, is_rating_key};
pub use playback::SCHEME;

/// Titles in a Home row.
const ROW_LIMIT: &str = "60";
/// How long the IMDb/TMDB index of a server's libraries is reused.
const INDEX_TTL: Duration = Duration::from_secs(10 * 60);
const INDEX_PAGE: usize = 1000;
/// More titles than any home library has; stops a runaway server.
const INDEX_MAX: usize = 100_000;
const REPORT_TIMEOUT: Duration = Duration::from_secs(10);
/// Between checks of the PIN while the person signs in.
const PIN_EVERY: Duration = Duration::from_secs(2);
/// An unreachable server's other addresses are looked for at most this often.
const REDISCOVER_EVERY: Duration = Duration::from_secs(30);
/// A failed first check of a server's addresses is reused this long.
const RECHECK_EVERY: Duration = Duration::from_secs(10);

/// The sealed part of a connection.
#[derive(Serialize, Deserialize)]
struct Secret {
    /// The server's addresses, the one that answered last first.
    connections: Vec<String>,
    server_token: String,
    account_token: String,
    client_id: String,
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.server_token.zeroize();
        self.account_token.zeroize();
    }
}

/// A profile's connection, opened for one request.
pub(crate) struct Session<'a> {
    plex: &'a Plex,
    profile: String,
    base: Mutex<Url>,
    connections: Vec<Url>,
    token: String,
    account: String,
    client_id: String,
    server_id: String,
    /// A short hash of the server's id, used in Orbit's ids for its items.
    server: String,
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        self.token.zeroize();
        self.account.zeroize();
    }
}

impl Session<'_> {
    fn base(&self) -> Url {
        self.base.lock().map_or_else(|b| b.into_inner().clone(), |b| b.clone())
    }

    /// Sends a request to the server; if it can't be reached, its other
    /// addresses (and then plex.tv's latest list of them) are tried once.
    async fn send(&self, method: Method, path: &str, query: &[(&str, &str)], limit: usize, timeout: Duration) -> Result<Reply, String> {
        let base = self.checked().await?;
        let headers = client::headers(&self.client_id, Some(&self.token));
        let url = media_server::endpoint(&base, path, query)?;
        match client::send_raw(method.clone(), url, &headers, limit, timeout).await {
            Ok(reply) => Ok(reply),
            Err(err) if err.unreachable() => {
                let Some(moved) = self.rediscover().await else { return Err(error_text(&err, Who::Server)) };
                let url = media_server::endpoint(&moved, path, query)?;
                client::send_raw(method, url, &headers, limit, timeout).await.map_err(|e| error_text(&e, Who::Server))
            }
            Err(err) => Err(error_text(&err, Who::Server)),
        }
    }

    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let reply = self.send(Method::GET, path, query, media_server::JSON_LIMIT, media_server::JSON_TIMEOUT).await?;
        client::parse_json(&reply.body, Who::Server)
    }

    /// Items by rating key (Plex takes several, comma-separated).
    async fn metadata(&self, keys: &[&str]) -> Result<Vec<Meta>, String> {
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let value = self.get(&format!("/library/metadata/{}", keys.join(",")), &[("includeGuids", "1")]).await?;
        Ok(items::metadata_of(&value, items::MAX_ITEMS))
    }

    /// Another of the server's addresses that answers as it, remembered for
    /// the profile until Orbit restarts or the server changes.
    async fn rediscover(&self) -> Option<Url> {
        {
            let mut last = self.plex.rediscovered.lock().ok()?;
            if last.get(&self.profile).is_some_and(|at| at.elapsed() < REDISCOVER_EVERY) {
                return None;
            }
            last.insert(self.profile.clone(), Instant::now());
        }
        self.locate(Some(&self.base())).await
    }

    /// The server's address once it has answered `/identity` as this server
    /// during this run. A stored address isn't trusted on its own (it may now
    /// belong to another machine), so the token goes nowhere before that.
    async fn checked(&self) -> Result<Url, String> {
        let url = check_once(self.plex, &self.profile, &self.server_id, || self.locate(None)).await.ok_or_else(|| error_text(&NetError::Connect, Who::Server))?;
        if let Ok(mut base) = self.base.lock() {
            *base = url.clone();
        }
        Ok(url)
    }

    /// The first of the server's addresses (but `skip`) that answers as it,
    /// or else of plex.tv's latest list of them; remembered as checked.
    async fn locate(&self, skip: Option<&Url>) -> Option<Url> {
        let epoch = self.plex.epoch();
        let others: Vec<Url> = self.connections.iter().filter(|u| Some(*u) != skip).cloned().collect();
        let mut found = client::reachable(&others, &self.server_id, &self.client_id).await;
        if found.is_none() {
            // Its addresses may have changed (a new public IP, another port): plex.tv knows the latest.
            let fresh = client::resources(&self.account, &self.client_id).await.ok()?;
            let server = fresh.iter().find(|r| r.id == self.server_id)?;
            found = client::reachable(&server.connections, &self.server_id, &self.client_id).await;
        }
        let url = found?;
        if let Ok(mut base) = self.base.lock() {
            *base = url.clone();
        }
        self.plex.remember(epoch, &self.profile, &self.server_id, &url);
        Some(url)
    }
}

/// The profile's checked address for `server_id` (see `Session::checked`):
/// the one remembered this run, or else what `locate` finds. Requests that
/// arrive together wait for one `locate`, and a failed one is reused for
/// `RECHECK_EVERY`, so a burst (Home rows, artwork) costs one round of
/// `/identity` probes, not one per request.
async fn check_once<F: std::future::Future<Output = Option<Url>>>(plex: &Plex, profile: &str, server_id: &str, locate: impl FnOnce() -> F) -> Option<Url> {
    let remembered = || plex.moved.lock().ok().and_then(|m| m.get(profile).filter(|(id, _)| id == server_id).map(|(_, url)| url.clone()));
    if let Some(url) = remembered() {
        return Some(url);
    }
    let epoch = plex.epoch();
    let gate = plex.checks.lock().ok()?.entry(profile.to_string()).or_default().clone();
    let mut failed = gate.lock().await;
    if let Some(url) = remembered() {
        return Some(url);
    }
    if failed.is_some_and(|at| at.elapsed() < RECHECK_EVERY) {
        return None;
    }
    let found = locate().await;
    match &found {
        Some(url) => {
            plex.remember(epoch, profile, server_id, url);
            *failed = None;
        }
        None => *failed = Some(Instant::now()),
    }
    found
}

fn aad(profile: &str) -> Vec<u8> {
    format!("plex-server:{profile}").into_bytes()
}

const UNREADABLE: &str = "err.plex.unreadable";

/// The profile's connection, or None if it has none.
pub(crate) fn session<'a>(db: &Db, plex: &'a Plex, profile: &str) -> Result<Option<Session<'a>>, String> {
    let row: Option<(String, Vec<u8>)> = db
        .lock()?
        .query_row("SELECT server_id, secret FROM plex_servers WHERE profile_id = ?1", [profile], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((server_id, sealed)) = row else { return Ok(None) };
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let mut plain = vault::open(&cipher, &aad(profile), &sealed).map_err(|_| UNREADABLE)?;
    let secret: Result<Secret, _> = serde_json::from_slice(&plain);
    plain.zeroize();
    let mut secret = secret.map_err(|_| UNREADABLE)?;
    let connections: Vec<Url> = secret.connections.iter().filter_map(|c| media_server::parse_server(c).ok()).collect();
    let moved = plex.moved.lock().ok().and_then(|m| m.get(profile).filter(|(id, _)| *id == server_id).map(|(_, url)| url.clone()));
    let base = moved.or_else(|| connections.first().cloned()).ok_or(UNREADABLE)?;
    Ok(Some(Session {
        plex,
        profile: profile.to_string(),
        base: Mutex::new(base),
        connections,
        token: std::mem::take(&mut secret.server_token),
        account: std::mem::take(&mut secret.account_token),
        client_id: secret.client_id.clone(),
        server: server_hash(&server_id),
        server_id,
    }))
}

pub(crate) fn require<'a>(db: &Db, plex: &'a Plex, profile: &str) -> Result<Session<'a>, String> {
    session(db, plex, profile)?.ok_or_else(|| "err.plex.not-connected".into())
}

/// IMDb/TMDB keys → rating keys for one profile's server. One title can be
/// several items, one per library it's in (a "Movies" and a "4K Movies"
/// library, say), and each has its own versions.
struct Index {
    at: Instant,
    server: String,
    keys: HashMap<String, Vec<String>>,
}

/// Items kept for one title: more copies than this are a library set up oddly.
const COPIES_MAX: usize = 4;

/// Files `meta` under each of its IMDb/TMDB keys, next to other copies of the title.
fn add_copies(keys: &mut HashMap<String, Vec<String>>, meta: &items::Meta) {
    for key in items::lookup_keys(meta) {
        let copies = keys.entry(key).or_default();
        if copies.len() < COPIES_MAX && !copies.contains(&meta.rating_key) {
            copies.push(meta.rating_key.clone());
        }
    }
}

/// A sign-in under way: the PIN, then the account and its servers.
struct Linking {
    generation: u64,
    client_id: String,
    pin: client::Pin,
    account: Option<(String, String)>,
    servers: Vec<client::Resource>,
}

impl Drop for Linking {
    fn drop(&mut self) {
        if let Some((token, _)) = self.account.as_mut() {
            token.zeroize();
        }
    }
}

/// Each profile's library index, sign-in under way, and server address that answered last.
#[derive(Default)]
pub struct Plex {
    index: Mutex<HashMap<String, Arc<Index>>>,
    linking: Mutex<HashMap<String, Linking>>,
    generation: AtomicU64,
    /// Each profile's server and the address that answered as it this run.
    moved: Mutex<HashMap<String, (String, Url)>>,
    rediscovered: Mutex<HashMap<String, Instant>>,
    /// One check of the stored addresses at a time per profile, and when the last one failed.
    checks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Option<Instant>>>>>,
    /// Bumped by `forget` (under `moved`'s lock): a check that began before it
    /// may have found the old server's address, which must not be remembered.
    forgets: AtomicU64,
}

impl Plex {
    fn forget(&self, profile: &str) {
        if let Ok(mut index) = self.index.lock() {
            index.remove(profile);
        }
        if let Ok(mut moved) = self.moved.lock() {
            moved.remove(profile);
            self.forgets.fetch_add(1, Ordering::SeqCst);
        }
        if let Ok(mut last) = self.rediscovered.lock() {
            last.remove(profile);
        }
        if let Ok(mut checks) = self.checks.lock() {
            checks.remove(profile);
        }
    }

    /// Taken before a check starts, for `remember`.
    fn epoch(&self) -> u64 {
        self.forgets.load(Ordering::SeqCst)
    }

    /// Remembers the address that answered as `server_id`, unless a profile
    /// was forgotten (disconnected, another server chosen) since `epoch`.
    fn remember(&self, epoch: u64, profile: &str, server_id: &str, url: &Url) {
        if let Ok(mut moved) = self.moved.lock()
            && self.forgets.load(Ordering::SeqCst) == epoch
        {
            moved.insert(profile.to_string(), (server_id.to_string(), url.clone()));
        }
    }

    fn linking(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Linking>>, String> {
        self.linking.lock().map_err(|_| "busy".to_string())
    }
}

/// The rating keys of the server's movies and shows by IMDb and TMDB id.
async fn index(state: &Plex, profile: &str, session: &Session<'_>) -> Result<Arc<Index>, String> {
    if let Some(index) = state.index.lock().map_err(|_| "busy")?.get(profile).filter(|i| i.server == session.server && i.at.elapsed() < INDEX_TTL) {
        return Ok(index.clone());
    }
    let mut keys = HashMap::new();
    let sections = session.get("/library/sections", &[]).await?;
    let mut total_seen = 0usize;
    for (section, _, _) in sections_of(&sections) {
        let mut start = 0usize;
        loop {
            let (start_s, size_s) = (start.to_string(), INDEX_PAGE.to_string());
            let page = session
                .get(
                    &format!("/library/sections/{section}/all"),
                    &[("includeGuids", "1"), ("X-Plex-Container-Start", &start_s), ("X-Plex-Container-Size", &size_s), ("excludeElements", "Media,Genre,Country,Director,Writer,Role,Collection,Label")],
                )
                .await?;
            let count = items::container(&page).and_then(|c| c.get("Metadata")).and_then(Value::as_array).map_or(0, Vec::len);
            for meta in items::metadata_of(&page, INDEX_PAGE) {
                add_copies(&mut keys, &meta);
            }
            start += count;
            total_seen += count;
            let total = items::container(&page).and_then(|c| c.get("totalSize")).and_then(Value::as_u64).map_or(usize::MAX, |t| usize::try_from(t).unwrap_or(usize::MAX));
            if count < INDEX_PAGE || start >= total || total_seen >= INDEX_MAX {
                break;
            }
        }
        if total_seen >= INDEX_MAX {
            break;
        }
    }
    let index = Arc::new(Index { at: Instant::now(), server: session.server.clone(), keys });
    state.index.lock().map_err(|_| "busy")?.insert(profile.to_string(), index.clone());
    Ok(index)
}

/// What the settings page shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    server_name: String,
    user_name: String,
    host: String,
    /// Plain http: the token and video travel unencrypted.
    insecure: bool,
}

fn status_of(db: &Db, profile: &str) -> Result<Option<Status>, String> {
    db.lock()?
        .query_row("SELECT server_name, user_name, host, insecure FROM plex_servers WHERE profile_id = ?1", [profile], |r| {
            Ok(Status { server_name: r.get(0)?, user_name: r.get(1)?, host: r.get(2)?, insecure: r.get(3)? })
        })
        .optional()
        .map_err(|e| e.to_string())
}

/// The status with the server's address in use this run. Orbit moves to
/// another of the server's addresses when the one it chose stops answering
/// (to plain http on the LAN when the https `plex.direct` one can't be
/// resolved, say), and "Not secure" must follow the address the token goes to.
fn current_status(db: &Db, plex: &Plex, profile: &str) -> Result<Option<Status>, String> {
    let Some(mut status) = status_of(db, profile)? else { return Ok(None) };
    let server_id: Option<String> = db.lock()?.query_row("SELECT server_id FROM plex_servers WHERE profile_id = ?1", [profile], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let moved = plex.moved.lock().ok().and_then(|m| m.get(profile).filter(|(id, _)| Some(id) == server_id.as_ref()).map(|(_, url)| url.clone()));
    if let Some(url) = moved {
        (status.host, status.insecure) = media_server::display_host(&url);
    }
    Ok(Some(status))
}

#[tauri::command]
pub async fn plex_status(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<Option<Status>, String> {
    current_status(&db, &state, &active.id()?)
}

/// Starts signing in: asks plex.tv for a PIN and opens Plex's sign-in page
/// in the person's browser. `plex_link_wait` then waits for it.
#[tauri::command]
pub async fn plex_link_start(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<(), String> {
    let profile = active.id()?;
    // Connecting again keeps the same identifier, so plex.tv lists Orbit once.
    let client_id = match session(&db, &state, &profile).ok().flatten() {
        Some(s) => s.client_id.clone(),
        None => random_hex(16)?,
    };
    let url = client::account_url("/api/v2/pins", &[("strong", "true")])?;
    let pin = client::parse_pin(&client::account_json(Method::POST, url, &client_id, None).await?)?;
    let page = client::auth_page(&client_id, &pin.code)?;
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.linking()?.insert(profile, Linking { generation, client_id, pin, account: None, servers: Vec::new() });
    crate::browser::open_in_browser(&page)
}

/// Opens Plex's sign-in page again (the browser tab was closed, say).
#[tauri::command]
pub async fn plex_link_open(active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<(), String> {
    let page = {
        let linking = state.linking()?;
        let link = linking.get(&active.id()?).ok_or("cancelled")?;
        client::auth_page(&link.client_id, &link.pin.code)?
    };
    crate::browser::open_in_browser(&page)
}

/// Stops waiting for a sign-in.
#[tauri::command]
pub async fn plex_link_cancel(active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<(), String> {
    state.linking()?.remove(&active.id()?);
    Ok(())
}

/// A server the person can pick.
#[derive(Serialize)]
pub struct ServerChoice {
    id: String,
    name: String,
    /// Their own, rather than shared with them.
    owned: bool,
}

/// Waits until the person has allowed Orbit on Plex's page (checking every
/// few seconds, until the PIN expires or the wait is cancelled), then lists
/// the account's servers.
#[tauri::command]
pub async fn plex_link_wait(active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<Vec<ServerChoice>, String> {
    let profile = active.id()?;
    let (generation, client_id, pin_id, code, deadline) = {
        let linking = state.linking()?;
        let link = linking.get(&profile).ok_or("cancelled")?;
        (link.generation, link.client_id.clone(), link.pin.id, link.pin.code.clone(), Instant::now() + Duration::from_secs(link.pin.expires_in))
    };
    let current = || state.linking().ok().is_some_and(|l| l.get(&profile).is_some_and(|link| link.generation == generation));
    let url = client::account_url(&format!("/api/v2/pins/{pin_id}"), &[("code", &code)])?;
    let mut token = loop {
        if !current() {
            return Err("cancelled".into());
        }
        // A failed check (a network blip) is tried again; only the PIN's expiry ends the wait.
        if let Ok(value) = client::account_json(Method::GET, url.clone(), &client_id, None).await
            && let Some(token) = client::pin_token(&value)?
        {
            break token;
        }
        if Instant::now() >= deadline {
            state.linking()?.remove(&profile);
            return Err("err.plex.pin-expired".into());
        }
        tokio::time::sleep(PIN_EVERY).await;
    };
    let result = async {
        let user = client::account_json(Method::GET, client::account_url("/api/v2/user", &[])?, &client_id, Some(&token)).await?;
        let servers = client::resources(&token, &client_id).await?;
        Ok::<_, String>((client::user_name(&user), servers))
    }
    .await;
    let (name, servers) = match result {
        Ok(found) => found,
        Err(e) => {
            token.zeroize();
            return Err(e);
        }
    };
    if servers.is_empty() {
        token.zeroize();
        state.linking()?.remove(&profile);
        return Err("err.plex.no-server".into());
    }
    let choices = servers.iter().map(|s| ServerChoice { id: s.id.clone(), name: s.name.clone(), owned: s.owned }).collect();
    let mut linking = state.linking()?;
    let Some(link) = linking.get_mut(&profile).filter(|l| l.generation == generation) else {
        token.zeroize();
        return Err("cancelled".into());
    };
    link.account = Some((token, name));
    link.servers = servers;
    Ok(choices)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    status: Status,
    /// The profile had no server before (so Home gets a row for it).
    first: bool,
}

/// Keeps the chosen server for the active profile, at the best of its
/// addresses that answers, replacing any it had.
#[tauri::command]
pub async fn plex_choose(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>, server: String) -> Result<Connected, String> {
    let profile = active.id()?;
    let (client_id, mut account_token, user_name, server_id, server_name, mut server_token, connections) = {
        let linking = state.linking()?;
        let link = linking.get(&profile).ok_or("cancelled")?;
        let (account_token, user_name) = link.account.as_ref().ok_or("cancelled")?;
        let found = link.servers.iter().find(|s| s.id == server).ok_or("err.plex.server-gone")?;
        (link.client_id.clone(), account_token.clone(), user_name.clone(), found.id.clone(), found.name.clone(), found.token.clone(), found.connections.clone())
    };
    let Some(chosen) = client::reachable(&connections, &server_id, &client_id).await else {
        account_token.zeroize();
        server_token.zeroize();
        return Err(crate::user_error::coded("plex.unreachable", &[("server", &server_name)]));
    };
    let mut ordered = vec![chosen.to_string()];
    ordered.extend(connections.iter().filter(|c| **c != chosen).map(ToString::to_string));
    let secret = Secret { connections: ordered, server_token, account_token, client_id };
    let mut plain = serde_json::to_vec(&secret).map_err(|e| e.to_string())?;
    drop(secret);
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let sealed = vault::seal(&cipher, &aad(&profile), &plain).map_err(|_| "err.keychain.failed");
    plain.zeroize();
    let sealed = sealed?;
    let (host, insecure) = media_server::display_host(&chosen);
    let first = status_of(&db, &profile)?.is_none();
    db.lock()?
        .execute(
            "INSERT INTO plex_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(profile_id) DO UPDATE SET server_id = excluded.server_id, server_name = excluded.server_name, host = excluded.host,
                insecure = excluded.insecure, user_name = excluded.user_name, secret = excluded.secret, connected_at = excluded.connected_at",
            params![profile, server_id, server_name, host, insecure, user_name, sealed, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    state.linking()?.remove(&profile);
    state.forget(&profile);
    // `chosen` just answered as the server: no need to ask again this run.
    if let Ok(mut moved) = state.moved.lock() {
        moved.insert(profile, (server_id, chosen));
    }
    Ok(Connected { status: Status { server_name, user_name, host, insecure }, first })
}

/// Forgets the active profile's server and tokens. Nothing is sent to Plex:
/// it has no sign-out for a single device token; the person can remove
/// Orbit under Authorized Devices on plex.tv to revoke it too.
#[tauri::command]
pub async fn plex_disconnect(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<(), String> {
    let profile = active.id()?;
    db.lock()?.execute("DELETE FROM plex_servers WHERE profile_id = ?1", [&profile]).map_err(|e| e.to_string())?;
    state.linking()?.remove(&profile);
    state.forget(&profile);
    Ok(())
}

/// The movie and show libraries ("sections") in a `/library/sections` answer: (key, title, kind).
fn sections_of(value: &Value) -> Vec<(String, String, &'static str)> {
    items::container(value)
        .and_then(|c| c.get("Directory"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(100)
        .filter_map(|d| {
            let key = d.get("key").and_then(Value::as_str).filter(|k| is_rating_key(k))?;
            let kind = match d.get("type").and_then(Value::as_str)? {
                "movie" => "movies",
                "show" => "tvshows",
                _ => return None,
            };
            let name = d.get("title").and_then(Value::as_str).map(|n| media_server::clean(n, 80)).filter(|n| !n.is_empty())?;
            Some((key.to_string(), name, kind))
        })
        .collect()
}

#[derive(Serialize)]
pub struct Library {
    id: String,
    name: String,
    /// "movies" or "tvshows".
    kind: &'static str,
}

/// The person's Movies and Shows libraries.
#[tauri::command]
pub async fn plex_libraries(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>) -> Result<Vec<Library>, String> {
    let session = require(&db, &state, &active.id()?)?;
    let value = session.get("/library/sections", &[]).await?;
    Ok(sections_of(&value).into_iter().map(|(id, name, kind)| Library { id, name, kind }).collect())
}

/// Movies and shows for `metas`, a season or episode standing for its show
/// (fetched once for all), without repeats.
async fn to_items(session: &Session<'_>, metas: Vec<Meta>) -> Result<Vec<Item>, String> {
    let wanted: Vec<String> = metas.iter().filter_map(Meta::show).map(str::to_string).collect::<HashSet<_>>().into_iter().collect();
    let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let shows: HashMap<String, Meta> = session.metadata(&refs).await?.into_iter().map(|s| (s.rating_key.clone(), s)).collect();
    let mut seen = HashSet::new();
    Ok(metas
        .iter()
        .filter_map(|meta| match meta.show() {
            Some(show) => shows.get(show).and_then(|s| items::to_item(&session.server, s)),
            None => items::to_item(&session.server, meta),
        })
        .filter(|item| seen.insert(item.title_id.clone()))
        .collect())
}

/// The pages of the libraries that answered: one failing (removed meanwhile, or
/// erroring) leaves the others' titles in the row. Only when every one failed
/// is the row an error, the first one's.
fn answered(pages: Vec<Result<Vec<Meta>, String>>) -> Result<Vec<Vec<Meta>>, String> {
    let mut first = None;
    let mut ok = Vec::new();
    for page in pages {
        match page {
            Ok(page) => ok.push(page),
            Err(e) => {
                first.get_or_insert(e);
            }
        }
    }
    match first {
        Some(e) if ok.is_empty() => Err(e),
        _ => Ok(ok),
    }
}

/// The `limit` most recently added of several libraries' pages, newest first.
fn newest(pages: Vec<Vec<Meta>>, limit: usize) -> Vec<Meta> {
    let mut all: Vec<Meta> = pages.into_iter().flatten().collect();
    // Stable: what has no date keeps its library's own order, after the rest.
    all.sort_by_key(|m| std::cmp::Reverse(m.added_at.unwrap_or(0)));
    all.truncate(limit);
    all
}

/// A Home row: "resume" (On Deck), "latest" (Recently added), or "library"
/// (`library`'s titles).
#[tauri::command]
pub async fn plex_items(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>, feed: String, library: Option<String>) -> Result<Vec<Item>, String> {
    let session = require(&db, &state, &active.id()?)?;
    let common = [("includeGuids", "1"), ("X-Plex-Container-Start", "0"), ("X-Plex-Container-Size", ROW_LIMIT)];
    let value = match feed.as_str() {
        "resume" => session.get("/library/onDeck", &common).await?,
        "latest" => {
            // Asked of each movie and show library: the server-wide list also holds music and
            // photos, which could fill the whole page and leave the row nearly empty.
            let sections = session.get("/library/sections", &[]).await?;
            let mut pages = Vec::new();
            for (section, _, _) in sections_of(&sections) {
                let page = session.get(&format!("/library/sections/{section}/recentlyAdded"), &common).await;
                pages.push(page.map(|page| items::metadata_of(&page, items::MAX_ITEMS)));
            }
            return to_items(&session, newest(answered(pages)?, items::MAX_ITEMS)).await;
        }
        "library" => {
            let library = library.filter(|l| is_rating_key(l)).ok_or("invalid library")?;
            session.get(&format!("/library/sections/{library}/all"), &[&common[..], &[("sort", "titleSort")]].concat()).await?
        }
        _ => return Err("invalid feed".into()),
    };
    to_items(&session, items::metadata_of(&value, items::MAX_ITEMS)).await
}

#[derive(Serialize)]
pub struct MetaDetails {
    item: Item,
    episodes: Vec<items::EpisodeInfo>,
}

/// Details for a `plex:…` title (one with no IMDb id), with its episodes if
/// it's a show. None if it's not on the connected server.
#[tauri::command]
pub async fn plex_meta(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Plex>, id: String) -> Result<Option<MetaDetails>, String> {
    let Some(session) = session(&db, &state, &active.id()?)? else { return Ok(None) };
    let Some(key) = items::parse_local_id(&session.server, &id) else { return Ok(None) };
    let Some(meta) = session.metadata(&[key]).await?.into_iter().next() else { return Ok(None) };
    let Some(item) = items::to_item(&session.server, &meta) else { return Ok(None) };
    let episodes = if item.kind == "series" {
        let value = session.get(&format!("/library/metadata/{key}/allLeaves"), &[]).await?;
        items::metadata_of(&value, items::MAX_EPISODES).iter().filter_map(|e| items::to_episode(&session.server, e)).collect()
    } else {
        Vec::new()
    };
    Ok(Some(MetaDetails { item, episodes }))
}

/// One version of a movie or episode on the server, for the source picker.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    address: String,
    label: String,
    name: Option<String>,
    size: Option<u64>,
    /// Where the server says the person stopped, in seconds.
    resume: Option<f64>,
    /// When it was last viewed there (ms), if the server says.
    resume_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    server_name: String,
    versions: Vec<Found>,
}

/// The movie or episode's versions on the connected server, if it has it:
/// found by rating key, or by IMDb/TMDB id through the library index.
// Tauri passes each command argument by name; the extra ones are injected state.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn plex_find(
    db: State<'_, Db>,
    active: State<'_, ActiveProfile>,
    state: State<'_, Plex>,
    title_id: String,
    kind: String,
    season: Option<i64>,
    episode: Option<i64>,
    episode_id: Option<String>,
) -> Result<Option<Sources>, String> {
    let profile = active.id()?;
    let Some(session) = session(&db, &state, &profile)? else { return Ok(None) };
    let server_name = status_of(&db, &profile)?.map(|s| s.server_name).unwrap_or_default();
    let none = |server_name: String| Ok(Some(Sources { server_name, versions: Vec::new() }));
    let found: Vec<String> = match items::parse_local_id(&session.server, &title_id) {
        Some(key) => vec![key.to_string()],
        None => match media_server::key_for(&title_id, &kind) {
            Some(key) => index(&state, &profile, &session).await?.keys.get(&key).cloned().unwrap_or_default(),
            None => Vec::new(),
        },
    };
    let mut targets = Vec::new();
    if kind == "series" {
        match (episode_id.as_deref().and_then(|e| items::parse_local_id(&session.server, e)), season, episode) {
            (Some(key), _, _) => targets.push(key.to_string()),
            (None, Some(season), Some(number)) => {
                for item in &found {
                    let value = session.get(&format!("/library/metadata/{item}/allLeaves"), &[]).await?;
                    targets.extend(items::metadata_of(&value, items::MAX_EPISODES).into_iter().find(|e| e.index == Some(number) && e.season.unwrap_or(season) == season).map(|e| e.rating_key));
                }
            }
            _ => {}
        }
    } else {
        targets = found;
    }
    if targets.is_empty() {
        return none(server_name);
    }
    let refs: Vec<&str> = targets.iter().map(String::as_str).collect();
    let mut versions = Vec::new();
    for meta in session.metadata(&refs).await? {
        let (resume, resume_at) = (meta.resume(), meta.resumed_at());
        versions.extend(items::versions(&meta).into_iter().map(|v| Found { address: playback::address(&meta.rating_key, &v.part), label: v.label, name: v.name, size: v.size, resume, resume_at }));
    }
    Ok(Some(Sources { server_name, versions }))
}

/// The direct-play address of `orbit-plex://…` for the player (see playback.rs).
pub async fn resolve(db: &Db, plex: &Plex, profile: &str, address: &str) -> Result<Playable, String> {
    let (item, part) = playback::parse_address(address)?;
    let session = require(db, plex, profile)?;
    let meta = session.metadata(&[&item]).await?.into_iter().next().ok_or("err.plex.video-gone")?;
    // mpv gets the token too: only for an address that answered as the server.
    playback::playable(&session.checked().await?, &session.client_id, &session.token, &meta, &part)
}

/// Tells the server playback started, moved on, paused, or stopped, so its
/// resume points, dashboard and watched marks follow what's played in Orbit.
// Tauri passes each command argument by name; the extra ones are injected state.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn plex_report(
    db: State<'_, Db>,
    active: State<'_, ActiveProfile>,
    state: State<'_, Plex>,
    event: String,
    address: String,
    position: f64,
    paused: bool,
    duration: Option<f64>,
) -> Result<(), String> {
    let plex_state = playback::state_for(&event, paused).ok_or("invalid event")?;
    let (item, _) = playback::parse_address(&address)?;
    let session = require(&db, &state, &active.id()?)?;
    let query = playback::timeline_query(&item, plex_state, position, duration);
    let query: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
    session.send(Method::GET, "/:/timeline", &query, 64 * 1024, REPORT_TIMEOUT).await?;
    if event == "stop" && playback::finished(position, duration) {
        session.send(Method::GET, "/:/scrobble", &[("key", &item), ("identifier", playback::IDENTIFIER)], 64 * 1024, REPORT_TIMEOUT).await?;
    }
    Ok(())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let _ = client::parse_json(data, client::Who::Account);
    if let Ok(value) = serde_json::from_slice(data) {
        let _ = items::parse_meta(&value);
        let _ = client::parse_pin(&value);
        let _ = client::parse_resources(&value);
        let _ = client::identity_of(&value);
    }
    let text = String::from_utf8_lossy(data);
    let _ = items::parse_art(&text);
    let _ = playback::parse_address(&text);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_title_in_two_libraries_keeps_both_copies() {
        let meta = |key: &str| items::parse_meta(&json!({ "ratingKey": key, "type": "movie", "title": "Dune", "Guid": [{ "id": "imdb://tt1160419" }] })).unwrap();
        let mut keys = HashMap::new();
        for m in [meta("101"), meta("202"), meta("101")] {
            add_copies(&mut keys, &m);
        }
        assert_eq!(keys["imdb:tt1160419"], ["101", "202"]);
    }

    #[test]
    fn libraries_are_movies_and_shows_only() {
        let value = json!({ "MediaContainer": { "Directory": [
            { "key": "1", "type": "movie", "title": "Films" },
            { "key": "2", "type": "show", "title": "TV\u{0}" },
            { "key": "3", "type": "artist", "title": "Music" },
            { "key": "../4", "type": "movie", "title": "Bad" },
            { "key": "5", "type": "movie" }
        ] } });
        assert_eq!(sections_of(&value), [("1".to_string(), "Films".to_string(), "movies"), ("2".to_string(), "TV".to_string(), "tvshows")]);
        assert!(sections_of(&json!([])).is_empty());
    }

    #[test]
    fn recently_added_is_the_newest_across_movie_and_show_libraries() {
        let page = |items: Value| items::metadata_of(&json!({ "MediaContainer": { "Metadata": items } }), 100);
        let films = page(json!([
            { "ratingKey": "1", "type": "movie", "title": "A", "addedAt": 300 },
            { "ratingKey": "2", "type": "movie", "title": "B", "addedAt": 100 }
        ]));
        let shows = page(json!([
            { "ratingKey": "3", "type": "season", "parentRatingKey": "9", "addedAt": 400 },
            { "ratingKey": "4", "type": "episode", "grandparentRatingKey": "9", "addedAt": 200 },
            { "ratingKey": "5", "type": "episode", "grandparentRatingKey": "9" }
        ]));
        let keys: Vec<String> = newest(vec![films, shows], 4).into_iter().map(|m| m.rating_key).collect();
        assert_eq!(keys, ["3", "1", "4", "2"]);
    }

    #[test]
    fn recently_added_keeps_the_libraries_that_answered() {
        let page = |key: &str| items::metadata_of(&json!({ "MediaContainer": { "Metadata": [{ "ratingKey": key, "type": "movie", "title": "A" }] } }), 100);
        // One library failing leaves the others' titles in the row.
        let kept = answered(vec![Err("err.plex.status|status=500".into()), Ok(page("1")), Ok(page("2"))]).unwrap();
        assert_eq!(kept.iter().flatten().map(|m| m.rating_key.as_str()).collect::<Vec<_>>(), ["1", "2"]);
        // Every one failing is the row's error (the first); no libraries at all is just an empty row.
        assert_eq!(answered(vec![Err("err.plex.timeout".into()), Err("err.plex.failed".into())]).unwrap_err(), "err.plex.timeout");
        assert!(answered(Vec::new()).unwrap().is_empty());
    }

    /// A stand-in for `Session::locate` that counts its calls.
    async fn located(calls: &std::sync::atomic::AtomicUsize, answer: Option<&str>) -> Option<Url> {
        calls.fetch_add(1, Ordering::SeqCst);
        // Lets the other requests of a burst reach the gate meanwhile.
        tokio::time::sleep(Duration::from_millis(20)).await;
        answer.map(|a| Url::parse(a).unwrap())
    }

    #[test]
    fn the_token_waits_for_one_identity_check_per_profile() {
        use std::sync::atomic::AtomicUsize;
        let plex = Plex::default();
        let calls = AtomicUsize::new(0);
        let home = Some("http://192.168.1.5:32400/");
        tauri::async_runtime::block_on(async {
            // A burst of first requests: one check, and all get its answer.
            let (a, b, c) = tokio::join!(
                check_once(&plex, "main", "srv", || located(&calls, home)),
                check_once(&plex, "main", "srv", || located(&calls, home)),
                check_once(&plex, "main", "srv", || located(&calls, home)),
            );
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert!([&a, &b, &c].iter().all(|u| u.as_ref().map(Url::as_str) == home));
            // Checked: later requests go straight through.
            assert!(check_once(&plex, "main", "srv", || located(&calls, None)).await.is_some());
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            // Another server (connected since) is checked again.
            assert!(check_once(&plex, "main", "other", || located(&calls, None)).await.is_none());
            assert_eq!(calls.load(Ordering::SeqCst), 2);
            // A failed check is reused for a while rather than repeated per request…
            assert!(check_once(&plex, "main", "other", || located(&calls, home)).await.is_none());
            assert_eq!(calls.load(Ordering::SeqCst), 2);
            // …and the rediscovery throttle doesn't stand in the way of a first check.
            plex.rediscovered.lock().unwrap().insert("kid".into(), Instant::now());
            assert!(check_once(&plex, "kid", "srv", || located(&calls, home)).await.is_some());
            assert_eq!(calls.load(Ordering::SeqCst), 3);
            // Forgetting the profile (disconnect, another server) forgets the check.
            plex.forget("main");
            assert!(check_once(&plex, "main", "srv", || located(&calls, home)).await.is_some());
            assert_eq!(calls.load(Ordering::SeqCst), 4);
        });
    }

    #[test]
    fn a_check_running_across_a_forget_leaves_the_new_server_alone() {
        let plex = Plex::default();
        let old = Url::parse("http://10.0.0.9:32400/").unwrap();
        let new = Url::parse("http://192.168.1.5:32400/").unwrap();
        tauri::async_runtime::block_on(async {
            let check = check_once(&plex, "main", "old", || async {
                tokio::time::sleep(Duration::from_millis(40)).await;
                Some(old.clone())
            });
            let choose = async {
                // Mid-check, another server is chosen: plex_choose forgets, then seeds it.
                tokio::time::sleep(Duration::from_millis(10)).await;
                plex.forget("main");
                plex.moved.lock().unwrap().insert("main".into(), ("new".into(), new.clone()));
            };
            let (found, ()) = tokio::join!(check, choose);
            // The old check still answers its own request…
            assert_eq!(found.as_ref(), Some(&old));
        });
        // …but the new server's address is what stays remembered.
        assert_eq!(plex.moved.lock().unwrap().get("main"), Some(&("new".to_string(), new)));
    }

    #[test]
    fn the_status_shows_the_address_in_use() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        db.lock()
            .unwrap()
            .execute("INSERT INTO plex_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES ('main', 'srv', 'Den', '192-168-1-5.abc.plex.direct:32400', 0, 'sam', x'00', 1)", [])
            .unwrap();
        let plex = Plex::default();
        let shown = |plex: &Plex| current_status(&db, plex, "main").unwrap().map(|s| (s.host, s.insecure));
        assert_eq!(shown(&plex), Some(("192-168-1-5.abc.plex.direct:32400".to_string(), false)));
        // The https address stopped answering and Orbit moved to plain http on the LAN: "Not secure" follows.
        plex.moved.lock().unwrap().insert("main".into(), ("srv".into(), Url::parse("http://192.168.1.5:32400/").unwrap()));
        assert_eq!(shown(&plex), Some(("192.168.1.5:32400".to_string(), true)));
        // An address remembered for another server isn't this one's.
        plex.moved.lock().unwrap().insert("main".into(), ("other".into(), Url::parse("http://10.0.0.9:32400/").unwrap()));
        assert_eq!(shown(&plex), Some(("192-168-1-5.abc.plex.direct:32400".to_string(), false)));
        assert!(current_status(&db, &plex, "kid").unwrap().is_none());
    }

    #[test]
    fn rows_are_per_profile_and_sealed() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO plex_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES ('main', 'x', 'Den', '10.0.0.2:32400', 1, 'sam', x'00', 1)", []).unwrap();
        // One server per profile.
        assert!(conn.execute("INSERT INTO plex_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES ('main', 'y', 'B', 'h', 0, 'u', x'00', 1)", []).is_err());
        assert_ne!(aad("main"), aad("kid"));
        // Not the same as Jellyfin's: a sealed row can't be moved between the two.
        assert_ne!(aad("main"), b"jellyfin-server:main".to_vec());
    }

    #[test]
    fn the_sealed_secret_round_trips_without_the_page_seeing_it() {
        let secret = Secret { connections: vec!["http://192.168.1.5:32400/".into()], server_token: "srvTOKEN1".into(), account_token: "accTOKEN1".into(), client_id: "abc".into() };
        let plain = serde_json::to_vec(&secret).unwrap();
        let back: Secret = serde_json::from_slice(&plain).unwrap();
        assert_eq!((back.server_token.as_str(), back.account_token.as_str(), back.connections.len()), ("srvTOKEN1", "accTOKEN1", 1));
        // What the page gets (status, items, sources) has no token or address fields at all.
        let status = serde_json::to_value(Status { server_name: "Den".into(), user_name: "sam".into(), host: "192.168.1.5:32400".into(), insecure: true }).unwrap();
        assert!(!status.to_string().contains("TOKEN"));
        let found = serde_json::to_value(Found { address: playback::address("101", "11"), label: String::new(), name: None, size: None, resume: None, resume_at: None }).unwrap();
        assert_eq!(found["address"], "orbit-plex://101/11");
    }
}
