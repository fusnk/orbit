//! RPDB (RatingPosterDB, https://ratingposterdb.com) posters for people who
//! have a key: posters with the title's ratings drawn on, served to the page
//! through the `rpdb-art` protocol. The page asks for `{style}_{imdb id}`;
//! Rust fetches it, keeps it on disk for a while and answers with the image.
//!
//! Why through Rust: RPDB takes the key only in the address's path
//! (`https://api.ratingposterdb.com/{key}/imdb/{style}/{id}.jpg`), and secrets
//! never sit in an address the page can see. So the page never sees that
//! address; the key stays in the keychain and in this module. The address is
//! built here only, sent only to api.ratingposterdb.com over https with
//! redirects off (RPDB answers directly, so no redirect is needed), and
//! never logged, kept or put in an error: errors here are a fixed kind.
//!
//! What comes back is untrusted: at most `IMAGE_LIMIT` bytes, and only a
//! JPEG, PNG or WebP whose bytes agree with its content type.

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};

use reqwest::header::{CONTENT_TYPE, RETRY_AFTER};
use reqwest::{Client, Url, redirect};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::keychain;
use crate::skip::check_imdb_id;

pub const SCHEME: &str = "rpdb-art";
pub(crate) const KEY_ENTRY: &str = "rpdb-key";
pub(crate) const HOST: &str = "api.ratingposterdb.com";
/// RPDB's posters are around 100–300 KB; anything far bigger isn't one.
const IMAGE_LIMIT: usize = 3 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);
/// RPDB's own CDN keeps posters for weeks; a week here keeps ratings fresh enough.
const CACHE_FOR: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// The poster cache stays under this; the oldest go first.
const CACHE_CAP: u64 = 200 * 1024 * 1024;
/// A title RPDB doesn't have isn't asked about again for this long (the card shows its own poster).
const MISS_FOR: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_MISSES: usize = 5000;
/// After a 429 without Retry-After, no requests for this long.
const RATE_PAUSE: Duration = Duration::from_secs(60);
/// After a refused key (revoked, or a style its tier doesn't include), no requests for this long.
const DENIED_PAUSE: Duration = Duration::from_secs(10 * 60);

/// RPDB's poster styles. Free (tier 0) keys get `poster-default` only; RPDB refuses the rest for them.
pub const STYLES: [&str; 5] = ["poster-default", "poster-certs", "poster-mc", "poster-rt", "textless-default"];

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .referer(false)
        .redirect(redirect::Policy::none())
        .https_only(true)
        .build()
        .ok()
});

/// A few posters at a time, so a long grid doesn't open dozens of connections.
static SLOTS: LazyLock<tokio::sync::Semaphore> = LazyLock::new(|| tokio::sync::Semaphore::new(4));
/// `{style}_{imdb id}` → when RPDB last said it has no such poster.
static MISSES: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);
/// No requests until then (after a 429 or a refused key).
static PAUSED_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// The key as last read from or written to the keychain (outer `None`: not read yet), like tmdb.rs's token.
static KEY: Mutex<Option<Option<String>>> = Mutex::new(None);

/// Why a poster couldn't be had. Holds no address, key or body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Fail {
    NoKey,
    BadRequest,
    /// 401/403: a wrong key, or a style the key's tier doesn't include.
    Denied,
    /// 404: RPDB has no poster for the title.
    Missing,
    RateLimited(Option<u64>),
    Paused,
    TooLarge,
    NotImage,
    Status(u16),
    Timeout,
    Network,
}

impl Fail {
    /// A fixed text for the page; never anything from the request or answer.
    fn reason(self) -> &'static str {
        match self {
            Self::NoKey => "no RPDB key",
            Self::BadRequest => "bad request",
            Self::Denied => "RPDB refused the key",
            Self::Missing => "no RPDB poster",
            Self::RateLimited(_) | Self::Paused => "RPDB is busy",
            Self::TooLarge => "too large",
            Self::NotImage => "not an image",
            Self::Status(_) => "RPDB failed",
            Self::Timeout => "RPDB took too long",
            Self::Network => "RPDB unreachable",
        }
    }
}

/// An RPDB address. It holds the key, so it can't be printed: it only goes to reqwest.
pub(crate) struct KeyedUrl(Url);

impl fmt::Debug for KeyedUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("KeyedUrl(<redacted>)")
    }
}

/// RPDB keys are `t{tier}-` and then letters, digits and dashes (`t0-free-rpdb`, `t2-…`).
fn check_key(key: &str) -> Result<(), Fail> {
    let rest = key.strip_prefix('t').and_then(|r| r.split_once('-'));
    let ok = key.len() <= 128
        && rest.is_some_and(|(tier, body)| (1..=2).contains(&tier.len()) && tier.bytes().all(|b| b.is_ascii_digit()) && !body.is_empty() && body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
    if ok { Ok(()) } else { Err(Fail::BadRequest) }
}

fn keyed(key: &str, rest: &str) -> Result<KeyedUrl, Fail> {
    check_key(key)?;
    Url::parse(&format!("https://{HOST}/{key}/{rest}")).map(KeyedUrl).map_err(|_| Fail::BadRequest)
}

/// The poster's address. No `fallback=true`: a title RPDB lacks should 404,
/// so the card keeps its own poster and Orbit's ratings instead.
pub(crate) fn poster_url(key: &str, style: &str, imdb_id: &str) -> Result<KeyedUrl, Fail> {
    if !STYLES.contains(&style) || check_imdb_id(imdb_id).is_err() {
        return Err(Fail::BadRequest);
    }
    keyed(key, &format!("imdb/{style}/{imdb_id}.jpg"))
}

/// `{style}_{imdb id}`, as the page asks the protocol for a poster; anything else is refused.
fn parse(path: &str) -> Option<(&'static str, &str)> {
    let (style, id) = path.trim_start_matches('/').split_once('_')?;
    let style = STYLES.iter().find(|s| **s == style)?;
    check_imdb_id(id).ok()?;
    Some((style, id))
}

/// The image type, when the content type is a JPEG, PNG or WebP and the bytes agree.
fn image_type(content_type: Option<&str>, body: &[u8]) -> Option<&'static str> {
    let declared = content_type?.split(';').next()?.trim().to_ascii_lowercase();
    let sniffed = sniff(body)?;
    (declared == sniffed || (declared == "image/jpg" && sniffed == "image/jpeg")).then_some(sniffed)
}

/// What a body's first bytes say it is (only the three raster types RPDB uses).
fn sniff(body: &[u8]) -> Option<&'static str> {
    if body.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if body.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if body.len() >= 12 && &body[..4] == b"RIFF" && &body[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn kind_of(err: &reqwest::Error) -> Fail {
    if err.is_timeout() { Fail::Timeout } else { Fail::Network }
}

/// GETs `url` and reads at most `limit` bytes, which must be an image.
async fn download(client: &Client, url: &KeyedUrl, limit: usize) -> Result<(Vec<u8>, &'static str), Fail> {
    let mut response = client.get(url.0.clone()).timeout(TIMEOUT).header("Accept", "image/webp,image/png,image/jpeg").send().await.map_err(|e| kind_of(&e))?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err(Fail::Denied),
        404 => return Err(Fail::Missing),
        429 => return Err(Fail::RateLimited(response.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse().ok()))),
        status => return Err(Fail::Status(status)),
    }
    let content_type = response.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_owned);
    // Refused before reading the body: a 200 that isn't an image (an error page) is never downloaded.
    if !content_type.as_deref().is_some_and(|t| t.trim_start().to_ascii_lowercase().starts_with("image/")) {
        return Err(Fail::NotImage);
    }
    if response.content_length().is_some_and(|len| len > limit as u64) {
        return Err(Fail::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| kind_of(&e))? {
        if body.len() + chunk.len() > limit {
            return Err(Fail::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    let kind = image_type(content_type.as_deref(), &body).ok_or(Fail::NotImage)?;
    Ok((body, kind))
}

/// The saved key, if any.
fn key() -> Result<Option<String>, Fail> {
    let mut slot = KEY.lock().map_err(|_| Fail::NoKey)?;
    if let Some(key) = slot.as_ref() {
        return Ok(key.clone());
    }
    let key = keychain::get(KEY_ENTRY).map_err(|_| Fail::NoKey)?;
    *slot = Some(key.clone());
    Ok(key)
}

fn store_key(key: Option<&str>) -> Result<(), String> {
    let mut slot = KEY.lock().map_err(|_| "RPDB key unavailable".to_string())?;
    *slot = None;
    match key {
        Some(key) => keychain::set(KEY_ENTRY, key)?,
        None => keychain::delete(KEY_ENTRY)?,
    }
    *slot = Some(key.map(String::from));
    // A new key starts fresh: what the old one couldn't get, this one may.
    if let Ok(mut misses) = MISSES.lock() {
        misses.clear();
    }
    if let Ok(mut paused) = PAUSED_UNTIL.lock() {
        *paused = None;
    }
    Ok(())
}

fn paused() -> bool {
    PAUSED_UNTIL.lock().ok().and_then(|p| *p).is_some_and(|until| until > Instant::now())
}

fn pause(for_: Duration) {
    if let Ok(mut paused) = PAUSED_UNTIL.lock() {
        *paused = Some(Instant::now() + for_);
    }
}

fn missed_lately(name: &str) -> bool {
    MISSES.lock().ok().and_then(|m| m.get(name).copied()).is_some_and(|at| at.elapsed() < MISS_FOR)
}

fn note_miss(name: String) {
    if let Ok(mut misses) = MISSES.lock() {
        if misses.len() >= MAX_MISSES {
            misses.retain(|_, at| at.elapsed() < MISS_FOR);
            if misses.len() >= MAX_MISSES {
                misses.clear();
            }
        }
        misses.insert(name, Instant::now());
    }
}

/// Posters kept on disk, under the app's cache folder.
pub struct Posters {
    dir: PathBuf,
}

impl Posters {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }
}

/// A cached poster, while it's fresh and still an image.
fn read_cached(dir: &Path, name: &str, now: SystemTime) -> Option<(Vec<u8>, &'static str)> {
    let path = dir.join(name);
    let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok()?;
    if now.duration_since(modified).map_or(true, |age| age > CACHE_FOR) {
        return None;
    }
    let body = std::fs::read(&path).ok()?;
    let kind = sniff(&body)?;
    Some((body, kind))
}

fn write_cached(dir: &Path, name: &str, body: &[u8]) {
    if std::fs::create_dir_all(dir).is_ok() && std::fs::write(dir.join(name), body).is_ok() {
        prune(dir, CACHE_CAP);
    }
}

/// Removes the oldest posters until the folder is under `cap` bytes.
fn prune(dir: &Path, cap: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok().filter(std::fs::Metadata::is_file)?;
            Some((meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), meta.len(), e.path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= cap {
        return;
    }
    files.sort_by_key(|f| f.0);
    for (_, len, path) in files {
        if total <= cap {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

async fn fetch(dir: PathBuf, path: &str) -> Result<(Vec<u8>, String, bool), Fail> {
    let (style, imdb_id) = parse(path).ok_or(Fail::BadRequest)?;
    // Without a key nothing is served, cached or not: removing the key turns RPDB off at once.
    let key = key()?.ok_or(Fail::NoKey)?;
    let name = format!("{style}_{imdb_id}");
    let cached = {
        let (dir, name) = (dir.clone(), name.clone());
        tauri::async_runtime::spawn_blocking(move || read_cached(&dir, &name, SystemTime::now())).await.ok().flatten()
    };
    if let Some((body, kind)) = cached {
        return Ok((body, kind.to_string(), true));
    }
    if missed_lately(&name) {
        return Err(Fail::Missing);
    }
    let _slot = SLOTS.acquire().await.map_err(|_| Fail::Network)?;
    if paused() {
        return Err(Fail::Paused);
    }
    let url = poster_url(&key, style, imdb_id)?;
    let client = CLIENT.as_ref().ok_or(Fail::Network)?;
    match download(client, &url, IMAGE_LIMIT).await {
        Ok((body, kind)) => {
            let (dir, name, copy, used) = (dir, name, body.clone(), key.clone());
            tauri::async_runtime::spawn_blocking(move || {
                // Not if the key was cleared (and its posters removed) during the download.
                if matches!(crate::rpdb::key(), Ok(Some(k)) if k == used) {
                    write_cached(&dir, &name, &copy);
                }
            });
            Ok((body, kind.to_string(), true))
        }
        Err(fail) => {
            match fail {
                Fail::Missing => note_miss(name),
                Fail::RateLimited(after) => pause(after.map_or(RATE_PAUSE, |s| Duration::from_secs(s.clamp(1, 600)))),
                Fail::Denied => pause(DENIED_PAUSE),
                _ => {}
            }
            Err(fail)
        }
    }
}

/// Answers one request from the page, off the protocol handler's thread. A
/// failure is a plain 404 (the page then shows the title's own poster).
pub fn serve(app: AppHandle, path: String, responder: UriSchemeResponder) {
    tauri::async_runtime::spawn(async move {
        let dir = app.state::<Posters>().dir.clone();
        let found = fetch(dir, &path).await.map_err(|fail| fail.reason().to_string());
        crate::media_server::respond_image(responder, found);
    });
}

/// Saves the key once RPDB says it's valid. Errors are codes the page translates; none repeats the key.
#[tauri::command]
pub async fn rpdb_set_key(key: String) -> Result<(), String> {
    let key = key.trim();
    let url = keyed(key, "isValid").map_err(|_| "rpdb.key-format".to_string())?;
    let client = CLIENT.as_ref().ok_or("rpdb.unreachable")?;
    let response = client.get(url.0.clone()).timeout(TIMEOUT).send().await.map_err(|_| "rpdb.unreachable".to_string())?;
    match response.status().as_u16() {
        200 => store_key(Some(key)),
        401 | 403 => Err("rpdb.refused".into()),
        429 => Err("rpdb.busy".into()),
        _ => Err("rpdb.unreachable".into()),
    }
}

#[tauri::command]
pub async fn rpdb_key_saved() -> Result<bool, String> {
    key().map(|k| k.is_some()).map_err(|fail| fail.reason().to_string())
}

/// Removes the key and the posters fetched with it.
#[tauri::command]
pub async fn rpdb_clear_key(posters: tauri::State<'_, Posters>) -> Result<(), String> {
    store_key(None)?;
    let dir = posters.dir.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(dir)).await.ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    const KEY: &str = "t1-SECRETkey-12345";
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F'];

    #[test]
    fn the_key_never_leaves_the_url() {
        let url = poster_url(KEY, "poster-default", "tt0111161").unwrap();
        assert_eq!(url.0.as_str(), format!("https://api.ratingposterdb.com/{KEY}/imdb/poster-default/tt0111161.jpg"));
        assert_eq!(url.0.host_str(), Some(HOST));
        assert_eq!(url.0.query(), None);
        // Nothing printable carries it: the address, every failure, and what the page is told.
        assert!(!format!("{url:?}").contains("SECRET"));
        let fails = [Fail::NoKey, Fail::BadRequest, Fail::Denied, Fail::Missing, Fail::RateLimited(Some(3)), Fail::Paused, Fail::TooLarge, Fail::NotImage, Fail::Status(500), Fail::Timeout, Fail::Network];
        for fail in fails {
            assert!(!format!("{fail:?} {}", fail.reason()).contains("SECRET"));
        }
        // A bad key, style or id is refused without echoing anything.
        for (key, style, id) in [("SECRET", "poster-default", "tt1"), (KEY, "poster-x", "tt1"), (KEY, "poster-default", "SECRET"), (KEY, "poster-default", "tt1/../x")] {
            assert_eq!(poster_url(key, style, id).unwrap_err(), Fail::BadRequest);
        }
    }

    #[test]
    fn keys_have_rpdbs_shape() {
        for good in ["t0-free-rpdb", "t1-abc123", "t12-A-b-C"] {
            assert!(check_key(good).is_ok(), "{good}");
        }
        for bad in ["", "t-abc", "x1-abc", "t1-", "t1-a/b", "t1-a?b=c", "t1-a b", "t123-abc", "t1-a.b", &format!("t1-{}", "a".repeat(200))] {
            assert!(check_key(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_protocol_takes_only_a_style_and_an_imdb_id() {
        assert_eq!(parse("/poster-default_tt0111161"), Some(("poster-default", "tt0111161")));
        assert_eq!(parse("poster-rt_tt1"), Some(("poster-rt", "tt1")));
        for bad in ["/poster-default_tmdb:278", "/poster-default_278", "/poster-default_tt", "/poster-default_tt12345678901", "/poster-default_tt1/../../x", "/poster-default_tt1.jpg", "/poster-evil_tt1", "/tt0111161", "/poster-default_tt1_x", ""] {
            assert!(parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn only_real_images_are_accepted() {
        assert_eq!(image_type(Some("image/jpeg"), JPEG), Some("image/jpeg"));
        assert_eq!(image_type(Some("image/jpg; charset=binary"), JPEG), Some("image/jpeg"));
        assert_eq!(image_type(Some("image/png"), b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_type(Some("image/webp"), b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        // Wrong or missing types, SVG (scriptable), and bytes that don't match the type.
        assert_eq!(image_type(Some("text/html"), JPEG), None);
        assert_eq!(image_type(None, JPEG), None);
        assert_eq!(image_type(Some("image/svg+xml"), b"<svg onload=x>"), None);
        assert_eq!(image_type(Some("image/png"), JPEG), None);
        assert_eq!(image_type(Some("image/jpeg"), b"<html>"), None);
    }

    /// A one-shot local server answering with `head` then `body`.
    fn serve_once(head: String, body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Some(Ok(mut stream)) = listener.incoming().next() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        format!("http://127.0.0.1:{port}/x.jpg")
    }

    fn get(head: &str, body: Vec<u8>, limit: usize) -> Result<(Vec<u8>, &'static str), Fail> {
        let url = KeyedUrl(Url::parse(&serve_once(head.to_string(), body)).unwrap());
        // The same checks, over plain http to the local server (the real client is https only).
        let client = Client::builder().redirect(redirect::Policy::none()).build().unwrap();
        tauri::async_runtime::block_on(download(&client, &url, limit))
    }

    #[test]
    fn downloads_are_capped_and_must_be_images() {
        let ok = |len: usize| format!("HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n");
        assert_eq!(get(&ok(JPEG.len()), JPEG.to_vec(), 1024).unwrap().1, "image/jpeg");
        // Declared too large: refused before reading.
        assert_eq!(get(&ok(5000), vec![0xFF; 5000], 1024).unwrap_err(), Fail::TooLarge);
        // Undeclared, and larger than the cap once read.
        let mut big = JPEG.to_vec();
        big.resize(5000, 0);
        assert_eq!(get("HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nConnection: close\r\n\r\n", big, 1024).unwrap_err(), Fail::TooLarge);
        // A 200 that isn't an image, or claims to be one but isn't.
        assert_eq!(get("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 6\r\nConnection: close\r\n\r\n", b"<html>".to_vec(), 1024).unwrap_err(), Fail::NotImage);
        assert_eq!(get(&ok(6), b"<html>".to_vec(), 1024).unwrap_err(), Fail::NotImage);
        // RPDB's answers for a missing title, a refused key, and a redirect (never followed).
        assert_eq!(get("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", vec![], 1024).unwrap_err(), Fail::Missing);
        assert_eq!(get("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", vec![], 1024).unwrap_err(), Fail::Denied);
        assert_eq!(get("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", vec![], 1024).unwrap_err(), Fail::Status(302));
        assert_eq!(get("HTTP/1.1 429 Too Many\r\nRetry-After: 7\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", vec![], 1024).unwrap_err(), Fail::RateLimited(Some(7)));
    }

    #[test]
    fn the_cache_expires_and_stays_under_its_cap() {
        let dir = std::env::temp_dir().join(format!("orbit-rpdb-test-{}", crate::library::now_ms()));
        write_cached(&dir, "poster-default_tt1", JPEG);
        assert_eq!(read_cached(&dir, "poster-default_tt1", SystemTime::now()).map(|c| c.1), Some("image/jpeg"));
        assert!(read_cached(&dir, "poster-default_tt1", SystemTime::now() + CACHE_FOR + Duration::from_secs(1)).is_none());
        // Not an image on disk (tampered with): not served.
        std::fs::write(dir.join("poster-default_tt2"), b"<html>").unwrap();
        assert!(read_cached(&dir, "poster-default_tt2", SystemTime::now()).is_none());
        std::fs::write(dir.join("poster-default_tt3"), vec![0u8; 100]).unwrap();
        prune(&dir, 20);
        let left: u64 = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.metadata().unwrap().len()).sum();
        assert!(left <= 20);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
