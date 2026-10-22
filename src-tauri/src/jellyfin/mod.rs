//! Jellyfin as a source (Settings → Integrations → Jellyfin): the person's
//! own media server, one per profile.
//!
//! Signing in sends the password once (`/Users/AuthenticateByName`) and keeps
//! only what the server gives back: the access token and user id, sealed by
//! the vault with the server's address and this connection's device id (bound
//! to the profile's row). The password is never stored. Every request to the
//! server is made here; the page sees titles, names and `jellyfin-art` image
//! keys, and plays `orbit-jellyfin://…`, which `player_open` resolves here
//! (see playback.rs) — so the token and the server's address never reach it.

mod art;
mod client;
mod items;
mod playback;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::{Method, Url};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;
use zeroize::Zeroize;

use crate::db::Db;
use crate::library::now_ms;
use crate::media_server::{random_hex, server_hash};
use crate::profiles::ActiveProfile;
use crate::vault;

pub use art::{SCHEME as ART_SCHEME, serve as serve_art};
pub use playback::{Playable, SCHEME};
use items::{Item, RawItem, is_item_id};

/// Fields asked for with every list the page shows.
const LIST_FIELDS: &str = "ProviderIds,Overview,Genres";
const LIST_IMAGES: &str = "Primary,Backdrop,Logo";
/// Titles in a Home row.
const ROW_LIMIT: &str = "60";
/// How long the provider-id index of a library is reused.
const INDEX_TTL: Duration = Duration::from_secs(10 * 60);
const INDEX_PAGE: usize = 1000;
/// More titles than any home library has; stops a runaway server.
const INDEX_MAX: usize = 100_000;
const REPORT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the server gets to say who it is before a request is refused.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a failed identity check is reused before the server is asked again.
const RECHECK_EVERY: Duration = Duration::from_secs(30);

/// The sealed part of a connection.
#[derive(Serialize, Deserialize)]
struct Secret {
    url: String,
    token: String,
    user_id: String,
    device_id: String,
}

/// A profile's connection, opened for one request.
pub(crate) struct Session {
    profile: String,
    server_id: String,
    base: Url,
    token: String,
    user_id: String,
    device_id: String,
    /// A short hash of the server's id, used in Orbit's ids for its items.
    server: String,
}

impl Session {
    /// The `Authorization` header with the token, once the server's address
    /// has answered as this server during this run (see `check_once`). A
    /// stored address isn't trusted on its own: it may now belong to another
    /// machine, so the token goes nowhere before that.
    async fn auth(&self) -> Result<String, String> {
        check_once(&self.profile, &self.server_id, &self.base, || is_server(&self.base, &self.server_id)).await.map_err(refused_text)?;
        Ok(client::authorization(&self.device_id, Some(&self.token)))
    }

    fn url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url, String> {
        client::endpoint(&self.base, path, query)
    }

    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        client::get_json(self.url(path, query)?, &self.auth().await?).await
    }

    /// Items by id, with `fields`.
    async fn items_by_id(&self, ids: &[&str], fields: &str) -> Result<Vec<RawItem>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids = ids.join(",");
        let value = self.get("/Items", &[("userId", &self.user_id), ("ids", &ids), ("fields", fields), ("enableImageTypes", LIST_IMAGES), ("imageTypeLimit", "1")]).await?;
        Ok(items::items_of(&value, items::MAX_ITEMS))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}

fn aad(profile: &str) -> Vec<u8> {
    format!("jellyfin-server:{profile}").into_bytes()
}

/// The profile's connection, or None if it has none.
pub(crate) fn session(db: &Db, profile: &str) -> Result<Option<Session>, String> {
    let row: Option<(String, Vec<u8>)> = db
        .lock()?
        .query_row("SELECT server_id, secret FROM jellyfin_servers WHERE profile_id = ?1", [profile], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((server_id, sealed)) = row else { return Ok(None) };
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let mut plain = vault::open(&cipher, &aad(profile), &sealed).map_err(|_| "err.jellyfin.unreadable")?;
    let secret: Result<Secret, _> = serde_json::from_slice(&plain);
    plain.zeroize();
    let mut secret = secret.map_err(|_| "err.jellyfin.unreadable")?;
    let base = client::parse_server(&secret.url)?;
    let session = Session {
        profile: profile.to_string(),
        server: server_hash(&server_id),
        server_id,
        base,
        token: std::mem::take(&mut secret.token),
        user_id: secret.user_id.clone(),
        device_id: secret.device_id.clone(),
    };
    Ok(Some(session))
}

/// Why the token wasn't sent: the address didn't answer as a Jellyfin
/// server, or answered as another one (reinstalled, which gives it a new
/// id, or the address now someone else's), which only connecting again fixes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Refused {
    Unreachable,
    Other,
}

fn refused_text(refused: Refused) -> String {
    match refused {
        Refused::Unreachable => "err.jellyfin.unreachable".into(),
        Refused::Other => "err.jellyfin.other-server".into(),
    }
}

/// Servers that answered as themselves this run: profile → (server id,
/// address); and per profile, one check at a time and when (and why) the last failed.
#[derive(Default)]
struct Checks {
    ok: HashMap<String, (String, String)>,
    gates: HashMap<String, Gate>,
}

/// One check at a time for a profile, and when and why the last one failed.
type Gate = Arc<tokio::sync::Mutex<Option<(Instant, Refused)>>>;

static CHECKS: LazyLock<Mutex<Checks>> = LazyLock::new(Mutex::default);

/// Whether the profile's server at `base` has answered as `server_id` this
/// run, asking it (`identify`) if not. Requests that arrive together wait for
/// one check, and a failed one is reused for `RECHECK_EVERY`, so a burst
/// (Home rows, artwork) costs one `/System/Info/Public`, not one per request.
async fn check_once<F: std::future::Future<Output = Result<(), Refused>>>(profile: &str, server_id: &str, base: &Url, identify: impl FnOnce() -> F) -> Result<(), Refused> {
    let key = (server_id.to_string(), base.to_string());
    let checked = || CHECKS.lock().is_ok_and(|c| c.ok.get(profile) == Some(&key));
    if checked() {
        return Ok(());
    }
    let Some(gate) = CHECKS.lock().ok().map(|mut c| c.gates.entry(profile.to_string()).or_default().clone()) else { return Err(Refused::Unreachable) };
    let mut failed = gate.lock().await;
    if checked() {
        return Ok(());
    }
    if let Some((at, why)) = *failed
        && at.elapsed() < RECHECK_EVERY
    {
        return Err(why);
    }
    let answer = identify().await;
    match answer {
        Ok(()) => {
            if let Ok(mut c) = CHECKS.lock() {
                c.ok.insert(profile.to_string(), key);
            }
            *failed = None;
        }
        Err(why) => *failed = Some((Instant::now(), why)),
    }
    answer
}

/// Remembers a server that has just answered as itself (when connecting).
fn mark_checked(profile: &str, server_id: &str, base: &Url) {
    if let Ok(mut c) = CHECKS.lock() {
        c.ok.insert(profile.to_string(), (server_id.to_string(), base.to_string()));
        c.gates.remove(profile);
    }
}

/// Whether `base` answers `/System/Info/Public` as the server `server_id`:
/// asked without the token and following no redirect, so the answer is from
/// `base` itself (and a public address can't hand the check to the LAN).
async fn is_server(base: &Url, server_id: &str) -> Result<(), Refused> {
    let url = client::endpoint(base, "/System/Info/Public", &[]).map_err(|_| Refused::Unreachable)?;
    let reply = client::probe(url, 256 * 1024, PROBE_TIMEOUT).await.map_err(|_| Refused::Unreachable)?;
    let info = serde_json::from_slice::<Value>(&reply.body).ok().and_then(|v| check_public_info(&v).ok()).ok_or(Refused::Unreachable)?;
    if info.id == server_id { Ok(()) } else { Err(Refused::Other) }
}

fn require(db: &Db, profile: &str) -> Result<Session, String> {
    session(db, profile)?.ok_or_else(|| "err.jellyfin.not-connected".into())
}

/// Provider ids → item ids for one profile's server. One title can be
/// several items, one per library it's in (a "Movies" and a "Movies 4K"
/// library, say), and each has its own versions.
struct Index {
    at: Instant,
    server: String,
    keys: HashMap<String, Vec<String>>,
}

/// Items kept for one title: more copies than this are a library set up oddly.
const COPIES_MAX: usize = 4;

/// Each profile's library index, built when a title is first looked up.
#[derive(Default)]
pub struct Jellyfin {
    index: Mutex<HashMap<String, Arc<Index>>>,
}

impl Jellyfin {
    fn forget(&self, profile: &str) {
        if let Ok(mut index) = self.index.lock() {
            index.remove(profile);
        }
    }
}

/// Files `item` under each of its provider ids, next to other copies of the title.
fn add_copies(keys: &mut HashMap<String, Vec<String>>, item: &RawItem) {
    for key in items::lookup_keys(item) {
        let copies = keys.entry(key).or_default();
        if copies.len() < COPIES_MAX && !copies.contains(&item.id) {
            copies.push(item.id.clone());
        }
    }
}

/// The item ids of the profile's movies and shows by IMDb and TMDB id.
async fn index(state: &Jellyfin, profile: &str, session: &Session) -> Result<Arc<Index>, String> {
    if let Some(index) = state.index.lock().map_err(|_| "busy")?.get(profile).filter(|i| i.server == session.server && i.at.elapsed() < INDEX_TTL) {
        return Ok(index.clone());
    }
    let mut keys = HashMap::new();
    let mut start = 0usize;
    loop {
        let (start_s, limit_s) = (start.to_string(), INDEX_PAGE.to_string());
        let page = session
            .get(
                "/Items",
                &[
                    ("userId", &session.user_id),
                    ("recursive", "true"),
                    ("includeItemTypes", "Movie,Series"),
                    ("fields", "ProviderIds"),
                    ("enableImages", "false"),
                    ("enableUserData", "false"),
                    ("startIndex", &start_s),
                    ("limit", &limit_s),
                ],
            )
            .await?;
        let list = page.get("Items").and_then(Value::as_array).map(|l| items::parse_items(l, INDEX_PAGE)).unwrap_or_default();
        let count = page.get("Items").and_then(Value::as_array).map_or(0, Vec::len);
        for item in &list {
            add_copies(&mut keys, item);
        }
        start += count;
        let total = page.get("TotalRecordCount").and_then(Value::as_u64).map_or(usize::MAX, |t| usize::try_from(t).unwrap_or(usize::MAX));
        if count < INDEX_PAGE || start >= total || start >= INDEX_MAX {
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
    /// Plain http: the sign-in and video travel unencrypted.
    insecure: bool,
}

fn status_of(db: &Db, profile: &str) -> Result<Option<Status>, String> {
    db.lock()?
        .query_row("SELECT server_name, user_name, host, insecure FROM jellyfin_servers WHERE profile_id = ?1", [profile], |r| {
            Ok(Status { server_name: r.get(0)?, user_name: r.get(1)?, host: r.get(2)?, insecure: r.get(3)? })
        })
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn jellyfin_status(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Option<Status>, String> {
    status_of(&db, &active.id()?)
}

/// The server's name, id and version, asked before signing in.
struct PublicInfo {
    name: String,
    id: String,
}

fn check_public_info(value: &Value) -> Result<PublicInfo, String> {
    let not_jellyfin = || "err.jellyfin.not-jellyfin".to_string();
    let id = value.get("Id").and_then(Value::as_str).filter(|id| is_item_id(id)).ok_or_else(not_jellyfin)?;
    let version = value.get("Version").and_then(Value::as_str).ok_or_else(not_jellyfin)?;
    let mut parts = version.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let (major, minor) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
    // The `/UserViews`, `/UserItems` and `/Items/Latest` routes Orbit uses arrived in 10.9.
    if major < 10 || (major == 10 && minor < 9) {
        return Err(crate::user_error::coded("jellyfin.version", &[("version", &items::clean(version, 20))]));
    }
    let name = value.get("ServerName").and_then(Value::as_str).map(|n| items::clean(n, 80)).filter(|n| !n.is_empty()).unwrap_or_else(|| "Jellyfin".into());
    Ok(PublicInfo { name, id: id.to_ascii_lowercase() })
}

/// What signing in gives back: the token and the user.
fn check_login(value: &Value) -> Result<(String, String, String), String> {
    let bad = || "err.jellyfin.invalid".to_string();
    let token = value.get("AccessToken").and_then(Value::as_str).filter(|t| (16..=128).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_alphanumeric())).ok_or_else(bad)?;
    let user = value.get("User").ok_or_else(bad)?;
    let user_id = user.get("Id").and_then(Value::as_str).filter(|id| is_item_id(id)).ok_or_else(bad)?;
    let name = user.get("Name").and_then(Value::as_str).map(|n| items::clean(n, 80)).filter(|n| !n.is_empty()).ok_or_else(bad)?;
    Ok((token.to_string(), user_id.to_ascii_lowercase(), name))
}

/// Ends a session on the server (best effort: the token is gone from Orbit either way).
async fn logout(session: &Session) {
    if let (Ok(url), Ok(auth)) = (session.url("/Sessions/Logout", &[]), session.auth().await) {
        let _ = client::send(Method::POST, url, Some(&auth), None, 64 * 1024, REPORT_TIMEOUT).await;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    status: Status,
    /// The profile had no server before (so Home gets a row for it).
    first: bool,
}

/// Signs in to a server and keeps the session for the active profile,
/// replacing (and signing out) any it had.
#[tauri::command]
pub async fn jellyfin_connect(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Jellyfin>, server: String, username: String, mut password: String) -> Result<Connected, String> {
    let result = connect(&db, &active, &state, &server, &username, &password).await;
    password.zeroize();
    result
}

async fn connect(db: &Db, active: &ActiveProfile, state: &Jellyfin, server: &str, username: &str, password: &str) -> Result<Connected, String> {
    let profile = active.id()?;
    let username = username.trim();
    if username.is_empty() || username.len() > 256 || password.len() > 1024 {
        return Err("err.jellyfin.login".into());
    }
    let mut found = None;
    let mut last = String::new();
    for base in client::server_candidates(server)? {
        let url = client::endpoint(&base, "/System/Info/Public", &[])?;
        // Following no redirect, as the check before each later use of the token does.
        match client::probe(url, 256 * 1024, client::JSON_TIMEOUT).await {
            Ok(reply) => {
                let value: Value = serde_json::from_slice(&reply.body).map_err(|_| "err.jellyfin.not-jellyfin")?;
                found = Some((base, check_public_info(&value)?));
                break;
            }
            Err(e) => last = e,
        }
    }
    let (base, info) = found.ok_or(last)?;
    let device_id = random_hex(16)?;
    let url = client::endpoint(&base, "/Users/AuthenticateByName", &[])?;
    let body = json!({ "Username": username, "Pw": password });
    let reply = client::send(Method::POST, url, Some(&client::authorization(&device_id, None)), Some(&body), 1024 * 1024, client::JSON_TIMEOUT).await?;
    let value: Value = serde_json::from_slice(&reply.body).map_err(|_| "err.jellyfin.invalid")?;
    let (token, user_id, user_name) = check_login(&value)?;

    let previous = session(db, &profile).ok().flatten();
    let secret = Secret { url: base.to_string(), token, user_id, device_id };
    let mut plain = serde_json::to_vec(&secret).map_err(|e| e.to_string())?;
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let sealed = vault::seal(&cipher, &aad(&profile), &plain).map_err(|_| "err.keychain.failed");
    plain.zeroize();
    let sealed = sealed?;
    let (host, insecure) = client::display_host(&base);
    db.lock()?
        .execute(
            "INSERT INTO jellyfin_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(profile_id) DO UPDATE SET server_id = excluded.server_id, server_name = excluded.server_name, host = excluded.host,
                insecure = excluded.insecure, user_name = excluded.user_name, secret = excluded.secret, connected_at = excluded.connected_at",
            params![profile, info.id, info.name, host, insecure, user_name, sealed, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    state.forget(&profile);
    mark_checked(&profile, &info.id, &base);
    if let Some(previous) = &previous {
        logout(previous).await;
    }
    Ok(Connected { status: Status { server_name: info.name, user_name, host, insecure }, first: previous.is_none() })
}

/// Forgets the active profile's server and signs Orbit out of it.
#[tauri::command]
pub async fn jellyfin_disconnect(db: State<'_, Db>, active: State<'_, ActiveProfile>, state: State<'_, Jellyfin>) -> Result<(), String> {
    let profile = active.id()?;
    // Unreadable (e.g. a new keychain): still removed, just not signed out.
    let previous = session(&db, &profile).ok().flatten();
    db.lock()?.execute("DELETE FROM jellyfin_servers WHERE profile_id = ?1", [&profile]).map_err(|e| e.to_string())?;
    state.forget(&profile);
    if let Some(previous) = previous {
        logout(&previous).await;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Library {
    id: String,
    name: String,
    /// "movies", "tvshows" or "mixed" (movies and shows together).
    kind: String,
}

/// A view as a library with movies or shows in it: a Movies or Shows
/// library, or a "Mixed movies and shows" one, which Jellyfin gives no
/// collection type at all. Music, playlists, Live TV and the like aren't.
fn library_of(view: RawItem) -> Option<Library> {
    let kind = match view.collection_type.as_deref() {
        Some(kind @ ("movies" | "tvshows")) => kind.to_string(),
        None if view.kind.as_deref() == Some("CollectionFolder") => "mixed".to_string(),
        _ => return None,
    };
    Some(Library { name: view.name.map(|n| items::clean(&n, 80)).filter(|n| !n.is_empty())?, id: view.id, kind })
}

/// The person's libraries with movies or shows.
#[tauri::command]
pub async fn jellyfin_libraries(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<Library>, String> {
    let session = require(&db, &active.id()?)?;
    let value = session.get("/UserViews", &[("userId", &session.user_id)]).await?;
    Ok(items::items_of(&value, 100).into_iter().filter_map(library_of).collect())
}

/// Movies and shows for `raws`, an episode standing for its series (fetched
/// once for all), without repeats.
async fn to_items(session: &Session, raws: Vec<RawItem>) -> Result<Vec<Item>, String> {
    let wanted: Vec<String> = raws.iter().filter(|r| r.kind() == Some("episode")).filter_map(|r| r.series_id.clone()).filter(|id| is_item_id(id)).collect::<HashSet<_>>().into_iter().collect();
    let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let series: HashMap<String, RawItem> = session.items_by_id(&refs, LIST_FIELDS).await?.into_iter().map(|s| (s.id.clone(), s)).collect();
    let mut seen = HashSet::new();
    Ok(raws
        .iter()
        .filter_map(|raw| match raw.kind() {
            Some("episode") => series.get(raw.series_id.as_deref()?).and_then(|s| items::to_item(&session.server, s)),
            _ => items::to_item(&session.server, raw),
        })
        .filter(|item| seen.insert(item.title_id.clone()))
        .collect())
}

/// A Home row: "resume" (Continue watching), "latest" (Recently added), or
/// "library" (`library`'s titles).
#[tauri::command]
pub async fn jellyfin_items(db: State<'_, Db>, active: State<'_, ActiveProfile>, feed: String, library: Option<String>) -> Result<Vec<Item>, String> {
    let session = require(&db, &active.id()?)?;
    let user = session.user_id.clone();
    let common = [("userId", user.as_str()), ("fields", LIST_FIELDS), ("enableImageTypes", LIST_IMAGES), ("imageTypeLimit", "1"), ("limit", ROW_LIMIT)];
    let value = match feed.as_str() {
        "resume" => session.get("/UserItems/Resume", &[&common[..], &[("mediaTypes", "Video")]].concat()).await?,
        "latest" => session.get("/Items/Latest", &[&common[..], &[("includeItemTypes", "Movie,Series,Episode")]].concat()).await?,
        "library" => {
            let library = library.filter(|l| is_item_id(l)).ok_or("invalid library")?;
            let query = [&common[..], &[("parentId", library.as_str()), ("recursive", "true"), ("includeItemTypes", "Movie,Series"), ("sortBy", "SortName"), ("sortOrder", "Ascending")]].concat();
            session.get("/Items", &query).await?
        }
        _ => return Err("invalid feed".into()),
    };
    to_items(&session, items::items_of(&value, items::MAX_ITEMS)).await
}

#[derive(Serialize)]
pub struct Meta {
    item: Item,
    episodes: Vec<items::EpisodeInfo>,
}

/// Details for a `jellyfin:…` title (one with no IMDb id), with its episodes
/// if it's a show. None if it's not on the connected server.
#[tauri::command]
pub async fn jellyfin_meta(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<Option<Meta>, String> {
    let Some(session) = session(&db, &active.id()?)? else { return Ok(None) };
    let Some(item_id) = items::parse_local_id(&session.server, &id) else { return Ok(None) };
    let Some(raw) = session.items_by_id(&[item_id], LIST_FIELDS).await?.into_iter().next() else { return Ok(None) };
    let Some(item) = items::to_item(&session.server, &raw) else { return Ok(None) };
    let episodes = if item.kind == "series" {
        let value = session.get(&format!("/Shows/{}/Episodes", raw.id), &[("userId", &session.user_id), ("isMissing", "false"), ("fields", "Overview,PremiereDate"), ("enableImageTypes", "Primary"), ("imageTypeLimit", "1")]).await?;
        items::items_of(&value, items::MAX_EPISODES).iter().filter_map(|e| items::to_episode(&session.server, e)).collect()
    } else {
        Vec::new()
    };
    Ok(Some(Meta { item, episodes }))
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
    /// When it was last played there (ms), if the server says.
    resume_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    server_name: String,
    versions: Vec<Found>,
}

/// Episode `number` of `season` among the episodes Jellyfin listed for that
/// season, and whether to look in the whole list instead: episodes with no
/// season number (files without SxxEyy, often a one-season show) are in no
/// season Jellyfin can be asked for by number. They're taken as season 1,
/// and only when the show has no season 1 of its own.
fn in_season(listed: Vec<RawItem>, season: i64, number: i64) -> (Option<String>, bool) {
    let ask_all = listed.is_empty() && season == 1;
    (listed.into_iter().find(|e| e.covers(season, number)).map(|e| e.id), ask_all)
}

/// Episode `number` among a show's episodes that have no season number.
fn unnumbered(all: Vec<RawItem>, number: i64) -> Option<String> {
    all.into_iter().find(|e| e.parent_index_number.is_none() && e.covers(1, number)).map(|e| e.id)
}

/// The movie or episode's versions on the connected server, if it has it:
/// found by Jellyfin id, or by IMDb/TMDB id through the library index.
// Tauri passes each command argument by name; the extra ones are injected state.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn jellyfin_find(
    db: State<'_, Db>,
    active: State<'_, ActiveProfile>,
    state: State<'_, Jellyfin>,
    title_id: String,
    kind: String,
    season: Option<i64>,
    episode: Option<i64>,
    episode_id: Option<String>,
) -> Result<Option<Sources>, String> {
    let profile = active.id()?;
    let Some(session) = session(&db, &profile)? else { return Ok(None) };
    let server_name = status_of(&db, &profile)?.map(|s| s.server_name).unwrap_or_default();
    let found: Vec<String> = match items::parse_local_id(&session.server, &title_id) {
        Some(id) => vec![id.to_string()],
        None => match items::key_for(&title_id, &kind) {
            Some(key) => index(&state, &profile, &session).await?.keys.get(&key).cloned().unwrap_or_default(),
            None => Vec::new(),
        },
    };
    let mut targets = Vec::new();
    if kind == "series" {
        match (episode_id.as_deref().and_then(|e| items::parse_local_id(&session.server, e)), season, episode) {
            (Some(id), _, _) => targets.push(id.to_string()),
            (None, Some(season), Some(number)) => {
                let season_s = season.to_string();
                for item in &found {
                    let path = format!("/Shows/{item}/Episodes");
                    let query = [("userId", session.user_id.as_str()), ("isMissing", "false"), ("enableImages", "false")];
                    let value = session.get(&path, &[&query[..], &[("season", season_s.as_str())]].concat()).await?;
                    let (mut episode, ask_all) = in_season(items::items_of(&value, items::MAX_EPISODES), season, number);
                    if ask_all {
                        episode = unnumbered(items::items_of(&session.get(&path, &query).await?, items::MAX_EPISODES), number);
                    }
                    targets.extend(episode);
                }
            }
            _ => {}
        }
    } else {
        targets = found;
    }
    if targets.is_empty() {
        return Ok(Some(Sources { server_name, versions: Vec::new() }));
    }
    let refs: Vec<&str> = targets.iter().map(String::as_str).collect();
    let mut versions = Vec::new();
    for raw in session.items_by_id(&refs, "MediaSources").await? {
        let (resume, resume_at) = (raw.resume(), raw.resumed_at());
        versions.extend(items::versions(&raw).into_iter().map(|v| Found { address: playback::address(&raw.id, &v.media_source), label: v.label, name: v.name, size: v.size, resume, resume_at }));
    }
    Ok(Some(Sources { server_name, versions }))
}

/// The direct-play address of `orbit-jellyfin://…` for the player (see playback.rs).
pub async fn resolve(db: &Db, profile: &str, address: &str) -> Result<Playable, String> {
    let (item, media_source) = playback::parse_address(address)?;
    let session = require(db, profile)?;
    let raw = session.items_by_id(&[&item], "MediaSources").await?.into_iter().next().ok_or("err.jellyfin.video-gone")?;
    playback::playable(&session.base, &session.auth().await?, &raw, media_source.as_deref())
}

/// Tells the server playback started, moved on, or stopped, so its resume
/// points and watched marks follow what's played in Orbit.
#[tauri::command]
pub async fn jellyfin_report(db: State<'_, Db>, active: State<'_, ActiveProfile>, event: String, address: String, position: f64, paused: bool) -> Result<(), String> {
    let path = playback::report_path(&event).ok_or("invalid event")?;
    let (item, media_source) = playback::parse_address(&address)?;
    let session = require(&db, &active.id()?)?;
    let body = playback::report_body(&item, media_source.as_deref(), position, paused);
    client::send(Method::POST, session.url(path, &[])?, Some(&session.auth().await?), Some(&body), 64 * 1024, REPORT_TIMEOUT).await.map(|_| ())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(data) {
        let rows = items::items_of(&value, 256);
        assert!(rows.len() <= 256);
        for row in rows {
            let _ = row.kind();
            let _ = row.imdb();
            let _ = row.tmdb();
            assert!(row.resume().is_none_or(|n| n.is_finite() && n >= 0.0));
        }
    }
    let _ = playback::parse_address(&String::from_utf8_lossy(data));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_waits_for_the_server_to_say_who_it_is() {
        let id = "f27caa37e5142225cceded48f6553502";
        let info = r#"{"Id":"F27CAA37E5142225CCEDED48F6553502","Version":"10.10.7","ServerName":"Den"}"#;
        let is = |url: Url, id: &str| tauri::async_runtime::block_on(is_server(&url, id));
        assert_eq!(is(crate::media_server::test_server(false, info), id), Ok(()));
        // Another Jellyfin server at that address (reinstalled, or the address now someone else's).
        assert_eq!(is(crate::media_server::test_server(false, info), "00000000000000000000000000000000"), Err(Refused::Other));
        // The answer must come from the address itself.
        assert_eq!(is(crate::media_server::test_server(true, info), id), Err(Refused::Unreachable));
        assert_eq!(is(crate::media_server::test_server(false, r#"{"not":"jellyfin"}"#), id), Err(Refused::Unreachable));
    }

    #[test]
    fn another_server_at_the_address_says_to_connect_again() {
        assert_eq!(refused_text(Refused::Other), "err.jellyfin.other-server");
        assert_eq!(refused_text(Refused::Unreachable), "err.jellyfin.unreachable");
        // The reason is kept with a failed check, for the requests that reuse it.
        tauri::async_runtime::block_on(async {
            let home = Url::parse("http://192.168.1.7:8096/").unwrap();
            assert_eq!(check_once("jf-other", "srv", &home, || async { Err(Refused::Other) }).await, Err(Refused::Other));
            assert_eq!(check_once("jf-other", "srv", &home, || async { Ok(()) }).await, Err(Refused::Other));
        });
    }

    #[test]
    fn one_identity_check_per_profile_and_address() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = AtomicUsize::new(0);
        let answer = |ok: bool| {
            calls.fetch_add(1, Ordering::SeqCst);
            async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                if ok { Ok(()) } else { Err(Refused::Unreachable) }
            }
        };
        async fn check_once<F: std::future::Future<Output = Result<(), Refused>>>(profile: &str, server_id: &str, base: &Url, identify: impl FnOnce() -> F) -> bool {
            super::check_once(profile, server_id, base, identify).await.is_ok()
        }
        let home = Url::parse("http://192.168.1.5:8096/").unwrap();
        let moved = Url::parse("http://192.168.1.9:8096/").unwrap();
        tauri::async_runtime::block_on(async {
            // A burst of first requests: one check, and all get its answer.
            let (a, b) = tokio::join!(check_once("jf-test", "srv", &home, || answer(true)), check_once("jf-test", "srv", &home, || answer(true)));
            assert!(a && b);
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert!(check_once("jf-test", "srv", &home, || answer(false)).await);
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            // Another address (or server) is checked again; a failure is reused for a while.
            assert!(!check_once("jf-test", "srv", &moved, || answer(false)).await);
            assert!(!check_once("jf-test", "srv", &moved, || answer(true)).await);
            assert_eq!(calls.load(Ordering::SeqCst), 2);
            // Connecting checks it, and clears the failure.
            mark_checked("jf-test", "srv", &moved);
            assert!(check_once("jf-test", "srv", &moved, || answer(false)).await);
            assert_eq!(calls.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn server_info_and_login_are_checked() {
        let info = check_public_info(&json!({ "Id": "F27CAA37E5142225CCEDED48F6553502", "Version": "10.10.7", "ServerName": "Den\u{0}" })).unwrap();
        assert_eq!((info.id.as_str(), info.name.as_str()), ("f27caa37e5142225cceded48f6553502", "Den"));
        assert_eq!(check_public_info(&json!({ "Id": "f27caa37e5142225cceded48f6553502", "Version": "10.8.13" })).err().unwrap(), "err.jellyfin.version|version=10.8.13");
        assert!(check_public_info(&json!({ "Version": "10.10.0" })).is_err());
        assert!(check_public_info(&json!("<html>")).is_err());

        let (token, user, name) = check_login(&json!({ "AccessToken": "0123456789abcdef0123456789abcdef", "User": { "Id": "f27caa37e5142225cceded48f6553502", "Name": "sam" } })).unwrap();
        assert_eq!((token.len(), user.len(), name.as_str()), (32, 32, "sam"));
        // A token that could break out of the header is refused.
        assert!(check_login(&json!({ "AccessToken": "abc\", Token=\"x0123456789", "User": { "Id": "f27caa37e5142225cceded48f6553502", "Name": "sam" } })).is_err());
        assert!(check_login(&json!({ "AccessToken": "0123456789abcdef0123456789abcdef", "User": { "Id": "x", "Name": "sam" } })).is_err());
    }

    #[test]
    fn libraries_include_mixed_movies_and_shows() {
        let views = items::items_of(
            &json!({ "Items": [
                { "Id": "a".repeat(32), "Name": "Films", "Type": "CollectionFolder", "CollectionType": "movies" },
                { "Id": "b".repeat(32), "Name": "TV", "Type": "CollectionFolder", "CollectionType": "tvshows" },
                // "Mixed movies and shows": a library with no collection type.
                { "Id": "c".repeat(32), "Name": "Everything", "Type": "CollectionFolder" },
                { "Id": "d".repeat(32), "Name": "Music", "Type": "CollectionFolder", "CollectionType": "music" },
                { "Id": "e".repeat(32), "Name": "Playlists", "Type": "ManualPlaylistsFolder", "CollectionType": "playlists" },
                { "Id": "f".repeat(32), "Name": "Folder", "Type": "Folder" }
            ] }),
            100,
        );
        let found: Vec<(String, String)> = views.into_iter().filter_map(library_of).map(|l| (l.name, l.kind)).collect();
        assert_eq!(found, [("Films".into(), "movies".into()), ("TV".into(), "tvshows".into()), ("Everything".into(), "mixed".into())]);
    }

    #[test]
    fn episodes_without_a_season_number_are_found_as_season_one() {
        let eps = |v: Value| items::items_of(&v, 100);
        let numbered = eps(json!([{ "Id": "a".repeat(32), "Type": "Episode", "ParentIndexNumber": 1, "IndexNumber": 3 }]));
        assert_eq!(in_season(numbered, 1, 3), (Some("a".repeat(32)), false));
        // Season 1 asked for, none listed: the whole list is looked at, only its unnumbered episodes.
        assert_eq!(in_season(Vec::new(), 1, 3), (None, true));
        assert_eq!(in_season(Vec::new(), 2, 3), (None, false));
        let all = eps(json!([
            { "Id": "b".repeat(32), "Type": "Episode", "ParentIndexNumber": 0, "IndexNumber": 3 },
            { "Id": "c".repeat(32), "Type": "Episode", "IndexNumber": 3 }
        ]));
        assert_eq!(unnumbered(all, 3), Some("c".repeat(32)));
    }

    #[test]
    fn a_title_in_two_libraries_keeps_both_copies() {
        let list = items::items_of(
            &json!({ "Items": [
                { "Id": "a".repeat(32), "Type": "Movie", "Name": "Dune", "ProviderIds": { "Imdb": "tt1160419", "Tmdb": "438631" } },
                { "Id": "b".repeat(32), "Type": "Movie", "Name": "Dune", "ProviderIds": { "Imdb": "tt1160419" } },
                { "Id": "a".repeat(32), "Type": "Movie", "Name": "Dune", "ProviderIds": { "Imdb": "tt1160419" } }
            ] }),
            10,
        );
        let mut keys = HashMap::new();
        for item in &list {
            add_copies(&mut keys, item);
        }
        assert_eq!(keys["imdb:tt1160419"], ["a".repeat(32), "b".repeat(32)]);
        assert_eq!(keys["tmdb:movie:438631"], ["a".repeat(32)]);
    }

    #[test]
    fn server_hash_is_short_and_stable() {
        let a = server_hash("f27caa37e5142225cceded48f6553502");
        assert_eq!(a.len(), 8);
        assert_eq!(a, server_hash("F27CAA37E5142225CCEDED48F6553502"));
        assert_ne!(a, server_hash("a27caa37e5142225cceded48f6553502"));
    }

    #[test]
    fn rows_are_per_profile_and_sealed() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO jellyfin_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES ('main', 'x', 'Den', '10.0.0.2:8096', 1, 'sam', x'00', 1)",
            [],
        )
        .unwrap();
        // One server per profile.
        assert!(conn.execute("INSERT INTO jellyfin_servers (profile_id, server_id, server_name, host, insecure, user_name, secret, connected_at) VALUES ('main', 'y', 'B', 'h', 0, 'u', x'00', 1)", []).is_err());
        let aad_main = aad("main");
        assert_ne!(aad_main, aad("kid"));
    }
}
