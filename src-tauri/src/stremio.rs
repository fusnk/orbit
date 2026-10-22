//! A Stremio account (Settings → Integrations): sign in, and bring its addons
//! into Orbit. Stremio's API takes JSON posts to api.strem.io; the session key
//! it returns is a secret, kept per profile in the OS keychain and only ever
//! sent in request bodies, never in a URL. The page never sees it, nor the
//! addons' transport URLs (which often hold debrid keys).
//!
//! Signing in through the browser: Orbit listens once on 127.0.0.1 at a path
//! with a random code, opens stremio.com's login with that address as the
//! callback, and accepts only a request to that exact path (for five minutes).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::keychain;
use crate::profiles::ActiveProfile;

const API: &str = "https://api.strem.io/api/";
const TIMEOUT: Duration = Duration::from_secs(20);
const LIMIT: usize = 8 * 1024 * 1024;
const LOGIN_WINDOW: Duration = Duration::from_secs(300);
/// Sent to the page when a browser sign-in finishes: `{ profile, email }` or `{ profile, error }`.
const SIGNED_IN_EVENT: &str = "stremio://signed-in";
/// What `call` answers when Stremio has ended the session (src/library/stremio-sync.ts knows it too).
const SESSION_ENDED: &str = "err.stremio.session-ended";

fn key_entry(profile: &str) -> String {
    format!("stremio-auth.{profile}")
}

/// The Stremio session of the active profile, if signed in.
fn auth_key(active: &ActiveProfile) -> Result<Option<String>, String> {
    keychain::get(&key_entry(&active.id()?))
}

/// `profile`'s Stremio session, if signed in.
fn auth_key_for(profile: &str) -> Result<Option<String>, String> {
    keychain::get(&key_entry(profile))
}

/// Forgets a deleted profile's Stremio session.
pub(crate) fn forget(profile: &str) -> Result<(), String> {
    keychain::delete(&key_entry(profile))
}

/// A Stremio session key: base64 or base64url text (letters, digits, `-_+/=`).
/// Nothing that could mean something in a header, JSON or a URL gets through.
fn valid_key(key: &str) -> bool {
    (16..=128).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_+/=".contains(&b))
}

#[derive(Deserialize)]
struct Reply {
    result: Option<Value>,
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    message: Option<String>,
}

/// Posts `body` to Stremio's API method `method`; the `result`, or Stremio's own error message.
async fn call(method: &str, body: Value) -> Result<Value, String> {
    // No redirects: a 307/308 would re-send the body (the session key, or the
    // email and password) to wherever it points, and Stremio's API never redirects.
    // One client for the session, so connections (and TLS sessions) are reused.
    static CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| reqwest::Client::builder().timeout(TIMEOUT).redirect(reqwest::redirect::Policy::none()).build().ok());
    let client = CLIENT.as_ref().ok_or("err.stremio.unreachable")?;
    let mut response = client.post(format!("{API}{method}")).json(&body).send().await.map_err(|_| "err.stremio.unreachable".to_string())?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "err.stremio.unreachable".to_string())? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("err.stremio.invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let reply: Reply = serde_json::from_slice(&bytes).map_err(|_| if unavailable(status) { "err.stremio.unreachable" } else { "err.stremio.invalid" })?;
    match (reply.result, reply.error) {
        (_, Some(e)) => Err(match e.message.as_deref() {
            Some("Wrong passphrase") => "err.stremio.wrong-login".into(),
            Some("Session does not exist") => SESSION_ENDED.into(),
            // Stremio's other messages are English and technical: logged, not shown.
            Some(m) => {
                eprintln!("stremio: {method} refused: {}", m.chars().take(200).collect::<String>());
                "err.stremio.refused".into()
            }
            None => "err.stremio.refused".into(),
        }),
        (Some(result), None) => Ok(result),
        (None, None) => Err("err.stremio.invalid".into()),
    }
}

/// Whether an HTTP status means Stremio couldn't answer just now (down, overloaded, or a proxy's
/// error page in front of it). Such a page isn't a reply about the account: read as one it's
/// "invalid", and Settings would show a signed-in account as signed out (and sync stop) through
/// an outage. A reply Stremio did send with it (`error`) still counts as one.
fn unavailable(status: u16) -> bool {
    status == 429 || (500..=599).contains(&status)
}

/// The account's email, which also checks the session is still good.
async fn email_for(key: &str) -> Result<String, String> {
    let user = call("getUser", json!({ "type": "GetUser", "authKey": key })).await?;
    Ok(user.get("email").and_then(Value::as_str).unwrap_or("your Stremio account").chars().take(200).collect())
}

fn save_key_for(profile: &str, key: &str) -> Result<(), String> {
    keychain::set(&key_entry(profile), key)
}

#[derive(Serialize)]
pub struct Account {
    email: String,
}

/// The signed-in account (None if signed out); clears a session Stremio has ended.
///
/// These account commands read the profile once, before waiting on Stremio:
/// a profile switch meanwhile must not delete or save another profile's session.
#[tauri::command]
pub async fn stremio_account(active: State<'_, ActiveProfile>) -> Result<Option<Account>, String> {
    let profile = active.id()?;
    let Some(key) = auth_key_for(&profile)? else { return Ok(None) };
    match email_for(&key).await {
        Ok(email) => Ok(Some(Account { email })),
        Err(e) if e == SESSION_ENDED => {
            keychain::delete(&key_entry(&profile))?;
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

/// Whether the active profile has a Stremio session saved, read from the
/// keychain only: first-run setup asks at every launch, and that mustn't
/// contact Stremio (`stremio_account` does, for the email).
#[tauri::command]
pub fn stremio_signed_in(active: State<'_, ActiveProfile>) -> Result<bool, String> {
    Ok(auth_key(&active)?.is_some())
}

/// Signs in with an email and password. The password goes to Stremio only and isn't kept.
#[tauri::command]
pub async fn stremio_login(db: State<'_, crate::db::Db>, active: State<'_, ActiveProfile>, email: String, password: String) -> Result<Account, String> {
    let email = email.trim().to_string();
    if email.is_empty() || email.len() > 200 || password.is_empty() || password.len() > 500 {
        return Err("err.stremio.login".into());
    }
    let profile = active.id()?;
    let result = call("login", json!({ "type": "Login", "email": email, "password": password, "facebook": false })).await?;
    let key = result.get("authKey").and_then(Value::as_str).filter(|k| valid_key(k)).ok_or("err.stremio.no-session")?;
    crate::profiles::save_for_profile(&db, &profile, || save_key_for(&profile, key))?;
    Ok(Account { email: result.pointer("/user/email").and_then(Value::as_str).unwrap_or(&email).chars().take(200).collect() })
}

/// The `key` from a callback request line, if it's for `path` exactly.
fn callback_key(request: &str, path: &str) -> Option<String> {
    let target = request.lines().next()?.strip_prefix("GET ")?.split(' ').next()?;
    // Parsed as a URL so the key is percent-decoded (Stremio sends a base64 key's `=` as `%3D`).
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != path {
        return None;
    }
    let key = url.query_pairs().find_map(|(name, value)| (name == "key" || name == "authKey").then(|| value.into_owned()))?;
    valid_key(&key).then_some(key)
}

fn random_code() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Orbit</title><body style=\"font:16px system-ui;background:#0b0d12;color:#eee;display:grid;place-items:center;height:90vh\"><p>You’re signed in to Orbit. You can close this tab.</p>";

/// Waits on `listener` for the callback to `path`; the session key, or None if the listener fails.
async fn callback(listener: tokio::net::TcpListener, path: &str) -> Option<String> {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else { return None };
        let mut buf = vec![0u8; 8192];
        // A connection that sends nothing (a browser's spare one) or fails is dropped; the wait goes on.
        let Ok(Ok(n)) = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buf)).await else { continue };
        let request = String::from_utf8_lossy(&buf[..n]).into_owned();
        match callback_key(&request, path) {
            Some(key) => {
                let body = DONE_PAGE;
                let _ = socket
                    .write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes())
                    .await;
                return Some(key);
            }
            // Anything else (favicon, a stray request) is turned away; keep waiting.
            None => {
                let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            }
        }
    }
}

/// The browser sign-in started last. One started before it that fails (most often by timing
/// out) says nothing: the person has moved on to the newer one, which is still waiting.
static LOGIN_ATTEMPT: AtomicU64 = AtomicU64::new(0);

/// Starts a browser sign-in; the page hears `stremio://signed-in` when it finishes.
#[tauri::command]
pub async fn stremio_browser_login(app: AppHandle) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let path = format!("/orbit/{}", random_code()?);
    let mut login = Url::parse("https://www.stremio.com/login").map_err(|e| e.to_string())?;
    login.query_pairs_mut().append_pair("appName", "Orbit").append_pair("appCallback", &format!("http://127.0.0.1:{port}{path}"));
    // The profile that started this: signing in takes up to minutes, and the session belongs to it even if another profile is chosen meanwhile.
    let profile = app.state::<ActiveProfile>().id()?;
    crate::browser::open_in_browser(&login)?;
    let attempt = LOGIN_ATTEMPT.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let waited = tokio::time::timeout(LOGIN_WINDOW, callback(listener, &path)).await;
        let outcome = match waited {
            Ok(Some(key)) => match email_for(&key).await {
                // Unless the profile was deleted meanwhile (see `profiles::save_for_profile`).
                Ok(email) => crate::profiles::save_for_profile(&app.state::<crate::db::Db>(), &profile, || save_key_for(&profile, &key)).map(|()| email),
                Err(e) => Err(e),
            },
            _ => Err("err.stremio.login-timeout".into()),
        };
        if outcome.is_err() && LOGIN_ATTEMPT.load(Ordering::SeqCst) != attempt {
            return;
        }
        // The page ignores it unless it's for the profile now shown.
        let _ = app.emit(SIGNED_IN_EVENT, match outcome {
            Ok(email) => json!({ "profile": profile, "email": email }),
            Err(error) => json!({ "profile": profile, "error": error }),
        });
    });
    Ok(())
}

/// Signs out here and ends the session on Stremio's side too.
#[tauri::command]
pub async fn stremio_logout(active: State<'_, ActiveProfile>) -> Result<(), String> {
    let profile = active.id()?;
    if let Some(key) = auth_key_for(&profile)? {
        let _ = call("logout", json!({ "type": "Logout", "authKey": key })).await;
    }
    keychain::delete(&key_entry(&profile))
}

/// The account's addons, as offered for import (their URLs stay here).
#[derive(Default)]
pub struct Offered(Mutex<Option<OfferedList>>);

/// One listing: whose it is, and each addon's URL with the manifest id Stremio stored for it.
struct OfferedList {
    profile: String,
    addons: Vec<(Url, Option<String>)>,
}

/// The URL of offered addon `index`, for `profile` installing it with `manifest`. Only the profile
/// that listed them: the URLs can hold that person's debrid keys, and the list outlives a switch
/// of profile. And only for the same addon: an index from an older listing (the account's
/// addons changed since) must not install another addon's URL under this one's manifest.
fn offered_url(offered: &Option<OfferedList>, profile: &str, index: usize, manifest: &Value) -> Result<Url, crate::addons::AddonError> {
    let list = offered.as_ref().filter(|list| list.profile == profile).ok_or(crate::addons::AddonError::NotFound)?;
    let (url, id) = list.addons.get(index).ok_or(crate::addons::AddonError::NotFound)?;
    match (id.as_deref(), manifest.get("id").and_then(Value::as_str)) {
        (Some(offered), Some(given)) if offered == given => Ok(url.clone()),
        _ => Err(crate::addons::AddonError::NotFound),
    }
}

#[derive(Serialize)]
pub struct OfferedAddon {
    index: usize,
    host: String,
    /// Stremio's own addons (Cinemeta, the local add-on and so on).
    official: bool,
    /// Stremio's stored copy, validated by the page like any manifest.
    manifest: Value,
}

/// The signed-in account's addons, in its order.
#[tauri::command]
pub async fn stremio_addons(active: State<'_, ActiveProfile>, offered: State<'_, Offered>) -> Result<Vec<OfferedAddon>, String> {
    let profile = active.id()?;
    let key = auth_key(&active)?.ok_or("err.stremio.sign-in-first")?;
    let result = call("addonCollectionGet", json!({ "type": "AddonCollectionGet", "authKey": key, "update": true })).await?;
    let addons = result.get("addons").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut urls = Vec::new();
    let mut list = Vec::new();
    for addon in addons.into_iter().take(200) {
        let Some(url) = addon.get("transportUrl").and_then(Value::as_str).and_then(|u| crate::addons::net::parse_transport_url(u).ok()) else { continue };
        let manifest = addon.get("manifest").cloned().unwrap_or(Value::Null);
        let id = manifest.get("id").and_then(Value::as_str).map(str::to_owned);
        list.push(OfferedAddon {
            index: urls.len(),
            host: url.host_str().unwrap_or_default().to_string(),
            official: addon.pointer("/flags/official").and_then(Value::as_bool).unwrap_or(false),
            manifest,
        });
        urls.push((url, id));
    }
    *offered.0.lock().map_err(|_| "busy")? = Some(OfferedList { profile, addons: urls });
    Ok(list)
}

/// Installs offered addon `index` with its (page-validated) manifest. One already
/// installed keeps the manifest Orbit has: Stremio's stored copy can be older.
#[tauri::command]
pub async fn stremio_install_addon(
    db: State<'_, crate::db::Db>,
    active: State<'_, ActiveProfile>,
    offered: State<'_, Offered>,
    index: usize,
    manifest: Value,
) -> Result<crate::addons::InstalledAddon, crate::addons::AddonError> {
    let profile = active.id().map_err(|message| crate::addons::AddonError::Storage { message })?;
    let url = {
        let offered = offered.0.lock().map_err(|_| crate::addons::AddonError::NotFound)?;
        offered_url(&offered, &profile, index, &manifest)?
    };
    crate::addons::install_as(&db, &active, url, manifest, None, crate::addons::Existing::Keep)
}

// ── Watch sync ──────────────────────────────────────────────────────────
// Continue Watching and watched marks, both ways, through the account's
// library ("libraryItem" in Stremio's datastore). The page decides what
// changed (src/library/stremio-sync.ts); here, pushes read each item first
// and change only its watch fields, so the rest of a person's Stremio
// library (what's in it, notifications, anything newer Stremio adds) is
// left exactly as it was.

const LIBRARY: &str = "libraryItem";
/// A generous library; anything past this isn't synced.
const MAX_ITEMS: usize = 10_000;
const MAX_PUSH: usize = 50;
/// Stremio's watched-episodes field: "{video id}:{length}:{base64}".
const MAX_WATCHED_FIELD: usize = 64 * 1024;

/// "2026-10-03T09:41:07Z" for a time in milliseconds.
fn rfc3339(ms: i64) -> String {
    let secs = ms.div_euclid(1000).rem_euclid(86_400);
    format!("{}T{:02}:{:02}:{:02}Z", crate::backup::chrono_date(ms), secs / 3600, secs / 60 % 60, secs % 60)
}

/// Movies and series the account has watched or is watching, as Stremio
/// stores them (the page validates them like any outside data).
#[tauri::command]
pub async fn stremio_library_pull(active: State<'_, ActiveProfile>) -> Result<Vec<Value>, String> {
    let key = auth_key(&active)?.ok_or("err.stremio.sign-in-first")?;
    let result = call("datastoreGet", json!({ "authKey": key, "collection": LIBRARY, "ids": [], "all": true })).await?;
    let items = result.as_array().cloned().unwrap_or_default();
    Ok(items
        .into_iter()
        .filter(|item| matches!(item.get("type").and_then(Value::as_str), Some("movie" | "series")))
        .filter(|item| item.pointer("/state/lastWatched").is_some_and(Value::is_string))
        .take(MAX_ITEMS)
        .collect())
}

/// What Orbit knows about one title's watching, to write into Stremio.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchPatch {
    id: String,
    r#type: String,
    name: String,
    poster: Option<String>,
    /// The movie, or the episode in progress or up next.
    video_id: Option<String>,
    /// Milliseconds; 1 means "at the start of the next episode", as in Stremio.
    time_offset: u64,
    duration: u64,
    /// Movies: watched, or unwatched only when the person marked it so in Orbit; left out
    /// (Stremio's mark kept) for one Orbit merely hasn't seen finished, which may have been
    /// finished on another device. Series leave it out (their episodes are in `watched_field`).
    watched: Option<bool>,
    watched_field: Option<String>,
    /// Stremio's field that `watched_field` was merged with (None: it had none).
    #[serde(default)]
    watched_base: Option<String>,
    last_watched: i64,
}

fn check_patch(p: &WatchPatch) -> Result<(), String> {
    crate::library::check_id(&p.id)?;
    if let Some(v) = &p.video_id {
        crate::library::check_id(v)?;
    }
    let field_ok = p.watched_field.as_ref().is_none_or(|f| f.len() <= MAX_WATCHED_FIELD && f.bytes().all(|b| b.is_ascii_graphic()));
    if !matches!(p.r#type.as_str(), "movie" | "series") || p.name.len() > 500 || !field_ok || p.last_watched <= 0 {
        return Err("invalid watch state".into());
    }
    Ok(())
}

/// A new library entry for a title the account hasn't got: like Stremio's own
/// for titles played without adding them (`temp`, not shown in the library).
fn new_item(p: &WatchPatch, now: &str) -> Value {
    let poster = p.poster.as_deref().filter(|u| u.starts_with("https://") && u.len() <= 2048);
    json!({
        "_id": p.id, "name": p.name, "type": p.r#type, "poster": poster, "posterShape": "poster",
        "removed": true, "temp": true, "_ctime": now, "_mtime": now,
        "state": { "lastWatched": now, "timeWatched": 0, "timeOffset": 0, "overallTimeWatched": 0, "timesWatched": 0,
                   "flaggedWatched": 0, "duration": 0, "video_id": null, "watched": null, "noNotif": false },
        "behaviorHints": { "defaultVideoId": null, "featuredVideoId": null, "hasScheduledVideos": false },
    })
}

/// `item` with Orbit's watch state written into it; other fields kept.
fn apply_patch(mut item: Value, p: &WatchPatch, now: &str) -> Value {
    if !item.get("state").is_some_and(Value::is_object) {
        item["state"] = json!({});
    }
    let state = &mut item["state"];
    state["lastWatched"] = json!(rfc3339(p.last_watched));
    state["timeOffset"] = json!(p.time_offset);
    if p.duration > 0 {
        state["duration"] = json!(p.duration);
    }
    if p.video_id.is_some() {
        state["video_id"] = json!(p.video_id);
    }
    match p.watched {
        Some(true) if state.get("timesWatched").and_then(Value::as_u64).unwrap_or(0) == 0 => {
            state["timesWatched"] = json!(1);
            state["flaggedWatched"] = json!(1);
        }
        Some(false) => {
            state["timesWatched"] = json!(0);
            state["flaggedWatched"] = json!(0);
        }
        _ => {}
    }
    // Only over the field the page merged with: one changed since (marks made
    // on another device in between) is kept, and the page's marks go next time.
    if let Some(field) = &p.watched_field
        && state.get("watched").and_then(Value::as_str) == p.watched_base.as_deref()
    {
        state["watched"] = json!(field);
    }
    item["_mtime"] = json!(now);
    item
}

/// The patches fit to send, and how many weren't. A bad one is left out
/// rather than failing the batch: the page would only send it again, and
/// hold up every other title's progress with it.
fn sendable(patches: &[WatchPatch]) -> (Vec<&WatchPatch>, usize) {
    let ok: Vec<&WatchPatch> = patches.iter().filter(|p| check_patch(p).is_ok()).collect();
    let skipped = patches.len() - ok.len();
    (ok, skipped)
}

/// Stremio's watched-episodes field for some series (None: it has none), for
/// the page to add its marks to before a push, so none made elsewhere are lost.
#[tauri::command]
pub async fn stremio_library_watched(active: State<'_, ActiveProfile>, ids: Vec<String>) -> Result<HashMap<String, Option<String>>, String> {
    if ids.len() > MAX_PUSH {
        return Err("too many changes".into());
    }
    for id in &ids {
        crate::library::check_id(id)?;
    }
    let key = auth_key(&active)?.ok_or("err.stremio.sign-in-first")?;
    let current = call("datastoreGet", json!({ "authKey": key, "collection": LIBRARY, "ids": ids, "all": false })).await?;
    Ok(watched_fields(&current, &ids))
}

/// Each asked-for id's watched field in a `datastoreGet` answer; a field too big or odd to send back counts as none.
fn watched_fields(current: &Value, ids: &[String]) -> HashMap<String, Option<String>> {
    let items = current.as_array().map(Vec::as_slice).unwrap_or_default();
    ids.iter()
        .map(|id| {
            let field = items
                .iter()
                .find(|item| item.get("_id").and_then(Value::as_str) == Some(id.as_str()))
                .and_then(|item| item.pointer("/state/watched"))
                .and_then(Value::as_str)
                .filter(|f| f.len() <= MAX_WATCHED_FIELD)
                .map(str::to_owned);
            (id.clone(), field)
        })
        .collect()
}

/// Writes Orbit's watch state for some titles into the account's library;
/// returns how many were left out as invalid (not worth sending again).
#[tauri::command]
pub async fn stremio_library_push(active: State<'_, ActiveProfile>, patches: Vec<WatchPatch>) -> Result<usize, String> {
    if patches.len() > MAX_PUSH {
        return Err("too many changes".into());
    }
    // Asked first, so a signed-out profile hears so even when nothing is fit to send.
    let key = auth_key(&active)?.ok_or("err.stremio.sign-in-first")?;
    let (patches, skipped) = sendable(&patches);
    if patches.is_empty() {
        return Ok(skipped);
    }
    let ids: Vec<&str> = patches.iter().map(|p| p.id.as_str()).collect();
    let current = call("datastoreGet", json!({ "authKey": key, "collection": LIBRARY, "ids": ids, "all": false })).await?;
    let current = current.as_array().cloned().unwrap_or_default();
    let now = rfc3339(crate::library::now_ms());
    let changes: Vec<Value> = patches
        .iter()
        .map(|p| {
            let existing = current.iter().find(|item| item.get("_id").and_then(Value::as_str) == Some(p.id.as_str())).cloned();
            apply_patch(existing.unwrap_or_else(|| new_item(p, &now)), p, &now)
        })
        .collect();
    call("datastorePut", json!({ "authKey": key, "collection": LIBRARY, "changes": changes })).await?;
    Ok(skipped)
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = callback_key(&text, "/synthetic");
    let _ = valid_key(&text);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(watched: Option<bool>) -> WatchPatch {
        WatchPatch {
            id: "tt1".into(),
            r#type: "movie".into(),
            name: "Film".into(),
            poster: Some("javascript:alert(1)".into()),
            video_id: Some("tt1".into()),
            time_offset: 600_000,
            duration: 6_000_000,
            watched,
            watched_field: None,
            watched_base: None,
            last_watched: 1_759_484_467_000,
        }
    }

    #[test]
    fn an_offered_addon_installs_only_for_its_profile_and_its_own_manifest() {
        let url = |s: &str| Url::parse(s).unwrap();
        let list = OfferedList {
            profile: "main".into(),
            addons: vec![(url("https://a.example/SECRET-A/manifest.json"), Some("org.a".into())), (url("https://b.example/manifest.json"), Some("org.b".into()))],
        };
        let offered = Some(list);
        let pick = |profile: &str, index: usize, id: &str| offered_url(&offered, profile, index, &json!({ "id": id })).map(|u| u.to_string());
        assert_eq!(pick("main", 0, "org.a").unwrap(), "https://a.example/SECRET-A/manifest.json");
        // Another profile never gets this one's URLs (they can hold its debrid keys), even by index.
        assert!(pick("kid", 0, "org.a").is_err());
        // An index from an older listing, or a manifest of another addon, doesn't install the wrong URL.
        assert!(pick("main", 0, "org.b").is_err());
        assert!(pick("main", 2, "org.a").is_err());
        assert!(offered_url(&None, "main", 0, &json!({ "id": "org.a" })).is_err());
    }

    #[test]
    fn writes_only_watch_fields() {
        let item = json!({ "_id": "tt1", "type": "movie", "removed": false, "temp": false, "behaviorHints": { "x": 1 },
                           "state": { "timesWatched": 3, "noNotif": true, "overallTimeWatched": 5 } });
        let out = apply_patch(item, &patch(Some(true)), "2026-10-03T00:00:00Z");
        assert_eq!(out["removed"], false);
        assert_eq!(out["behaviorHints"]["x"], 1);
        assert_eq!(out["state"]["noNotif"], true);
        assert_eq!(out["state"]["timesWatched"], 3);
        assert_eq!(out["state"]["timeOffset"], 600_000);
        assert_eq!(out["state"]["lastWatched"], "2025-10-03T09:41:07Z");
        assert_eq!(out["_mtime"], "2026-10-03T00:00:00Z");
        // Not finished in Orbit (watched left out): Stremio's own mark stays.
        let out = apply_patch(out, &patch(None), "2026-10-03T00:00:00Z");
        assert_eq!(out["state"]["timesWatched"], 3);
        let out = apply_patch(out, &patch(Some(false)), "2026-10-03T00:00:00Z");
        assert_eq!((out["state"]["timesWatched"].as_u64(), out["state"]["flaggedWatched"].as_u64()), (Some(0), Some(0)));
    }

    #[test]
    fn writes_the_watched_field_only_over_the_one_it_was_merged_with() {
        let item = |field: Option<&str>| json!({ "_id": "tt1", "state": { "watched": field } });
        let merged = WatchPatch { watched_field: Some("tt1:1:2:eJyTBQAABAAE".into()), watched_base: Some("tt1:1:1:eJxjBAAAAgAC".into()), ..patch(None) };
        let out = apply_patch(item(Some("tt1:1:1:eJxjBAAAAgAC")), &merged, "now");
        assert_eq!(out["state"]["watched"], "tt1:1:2:eJyTBQAABAAE");
        // Another device marked more since it was read: Stremio's stays.
        let out = apply_patch(item(Some("tt1:1:3:other")), &merged, "now");
        assert_eq!(out["state"]["watched"], "tt1:1:3:other");
        // Nothing in Stremio when read, nor now.
        let fresh = WatchPatch { watched_base: None, ..merged };
        assert_eq!(apply_patch(item(None), &fresh, "now")["state"]["watched"], "tt1:1:2:eJyTBQAABAAE");
        assert_eq!(apply_patch(item(Some("x:1:a")), &fresh, "now")["state"]["watched"], "x:1:a");
    }

    #[test]
    fn reads_watched_fields_for_the_ids_asked() {
        let answer = json!([{ "_id": "tt1", "state": { "watched": "tt1:1:1:a" } }, { "_id": "tt2", "state": { "watched": null } }, { "_id": "tt9", "state": { "watched": "x" } }]);
        let ids = vec!["tt1".to_string(), "tt2".into(), "tt3".into()];
        let fields = watched_fields(&answer, &ids);
        assert_eq!(fields.len(), 3);
        assert_eq!(fields["tt1"].as_deref(), Some("tt1:1:1:a"));
        assert_eq!((fields["tt2"].as_deref(), fields["tt3"].as_deref()), (None, None));
    }

    #[test]
    fn new_items_are_hidden_from_the_library_and_drop_unsafe_posters() {
        let item = new_item(&patch(None), "2026-10-03T00:00:00Z");
        assert_eq!((item["removed"].as_bool(), item["temp"].as_bool()), (Some(true), Some(true)));
        assert!(item["poster"].is_null());
        assert!(check_patch(&WatchPatch { r#type: "other".into(), ..patch(None) }).is_err());
        assert!(check_patch(&WatchPatch { watched_field: Some("a b".into()), ..patch(None) }).is_err());
    }

    #[test]
    fn one_bad_patch_does_not_hold_up_the_rest() {
        let patches = vec![
            WatchPatch { id: "tt2".into(), name: "名".repeat(200), ..patch(None) },
            patch(Some(true)),
            WatchPatch { id: "tt3".into(), watched_field: Some("tt3:1:2 é:1:eJw=".into()), ..patch(None) },
            WatchPatch { id: "tt4".into(), ..patch(None) },
        ];
        let (ok, skipped) = sendable(&patches);
        assert_eq!(ok.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["tt1", "tt4"]);
        assert_eq!(skipped, 2);
        let (ok, skipped) = sendable(&patches[..1]);
        assert!(ok.is_empty());
        assert_eq!(skipped, 1);
    }

    #[test]
    fn an_outage_is_unreachable_not_an_answer() {
        for status in [429, 500, 502, 503, 504] {
            assert!(unavailable(status), "{status}");
        }
        for status in [200, 400, 401, 404] {
            assert!(!unavailable(status), "{status}");
        }
    }

    #[test]
    fn accepts_only_its_own_callback() {
        let key = "a".repeat(40);
        let path = "/orbit/abc123";
        assert_eq!(callback_key(&format!("GET /orbit/abc123?key={key} HTTP/1.1\r\nHost: x"), path).as_deref(), Some(key.as_str()));
        assert_eq!(callback_key(&format!("GET /orbit/abc123?authKey={key} HTTP/1.1"), path).as_deref(), Some(key.as_str()));
        assert!(callback_key(&format!("GET /orbit/wrong?key={key} HTTP/1.1"), path).is_none());
        assert!(callback_key(&format!("POST /orbit/abc123?key={key} HTTP/1.1"), path).is_none());
        assert!(callback_key("GET /orbit/abc123?key=short HTTP/1.1", path).is_none());
        assert!(callback_key("GET /orbit/abc123?key=<script>aaaaaaaaaaaaaaaaaaa HTTP/1.1", path).is_none());
        assert!(callback_key("GET /favicon.ico HTTP/1.1", path).is_none());
        // Real keys are base64(url): `-`, `_` and an `=` sent as `%3D`.
        assert_eq!(callback_key("GET /orbit/abc123?key=Ab-1Cd_2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv%3D HTTP/1.1", path).as_deref(), Some("Ab-1Cd_2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv="));
        assert!(callback_key("GET /orbit/abc123?key=aaaaaaaaaaaaaaaaaaaa%22%0D%0A HTTP/1.1", path).is_none());
    }

    #[test]
    fn a_silent_connection_does_not_end_the_sign_in() {
        use std::io::Write;
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let key = "b".repeat(40);
            let request = format!("GET /orbit/abc123?key={key} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
            std::thread::spawn(move || {
                // A browser's spare connection (or any local program) that never sends a request, then the real callback.
                let _idle = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                std::thread::sleep(Duration::from_millis(200));
                let mut real = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                real.write_all(request.as_bytes()).unwrap();
                std::thread::sleep(Duration::from_secs(10));
            });
            assert_eq!(callback(listener, "/orbit/abc123").await.as_deref(), Some(key.as_str()));
        });
    }
}
