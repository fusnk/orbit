//! Profile pictures people upload (the profile editor's "Upload…"). Each is a
//! small square image the page has already cropped, kept as a file in Orbit's
//! data folder and named `upload-{random}`; a profile stores just that name.
//! Only PNG, JPEG and WebP are accepted (by their first bytes), and pictures no
//! profile uses any more are removed whenever a new one is saved, and when a
//! profile is deleted.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::{Client, ClientBuilder, Url, redirect};
use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

use crate::db::Db;

/// The page sends 256 px squares, a few dozen KB; this leaves room and no more.
const MAX_BYTES: usize = 2 * 1024 * 1024;
const PREFIX: &str = "upload-";
/// Where TMDB's pictures live (see tmdb.rs `image`).
const TMDB_IMAGES: &str = "https://image.tmdb.org/t/p/";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("avatars"))
}

/// `upload-` and 16 lower-case hex digits: safe as a file name.
pub fn is_upload_name(name: &str) -> bool {
    name.strip_prefix(PREFIX).is_some_and(|rest| rest.len() == 16 && rest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// Pictures that no profile uses.
fn unused(conn: &Connection, names: impl Iterator<Item = String>) -> Vec<String> {
    let used: Vec<String> = conn
        .prepare("SELECT avatar FROM profiles WHERE avatar IS NOT NULL")
        .and_then(|mut stmt| stmt.query_map([], |r| r.get(0))?.collect())
        .unwrap_or_default();
    names.filter(|n| is_upload_name(n) && !used.contains(n)).collect()
}

/// Removes the pictures in `dir` that no profile uses.
fn sweep(dir: &Path, conn: &Connection) {
    let existing = std::fs::read_dir(dir).map(|d| d.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect::<Vec<_>>()).unwrap_or_default();
    for name in unused(conn, existing.into_iter()) {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

/// Removes pictures no profile uses any more: a deleted profile's own, which
/// would otherwise stay on disk until someone next uploads one (or for good).
pub(crate) fn remove_unused(app: &AppHandle, db: &Db) -> Result<(), String> {
    sweep(&dir(app)?, &*db.lock()?);
    Ok(())
}

/// Saves the image sent as the raw request body and returns its name, for the profile to use.
#[tauri::command]
pub async fn avatar_save(app: AppHandle, db: State<'_, Db>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected the image's bytes".into()) };
    store(&app, &db, bytes)
}

/// A TMDB image URL as the page gets them from tmdb.rs (`image`): the CDN host
/// and a plain file path, nothing else, so this can't be turned into a fetch
/// of an arbitrary address.
fn is_tmdb_image_url(url: &str) -> bool {
    url.strip_prefix(TMDB_IMAGES).is_some_and(|rest| {
        let mut parts = rest.splitn(2, '/');
        let (size, file) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let plain = |s: &str| !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
        plain(size) && plain(file)
    })
}

/// Saves a character's picture from TMDB or AniList (see anilist.rs
/// `valid_character_image`) as if it were uploaded (the profile keeps working
/// offline, and the picture leaves with the profile like any upload), and
/// returns its name.
#[tauri::command]
pub async fn avatar_save_url(app: AppHandle, db: State<'_, Db>, url: String) -> Result<String, String> {
    if !is_tmdb_image_url(&url) && !crate::anilist::valid_character_image(&url) {
        return Err("invalid picture address".into());
    }
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| picture_client().https_only(true).build().ok());
    let client = CLIENT.as_ref().ok_or("err.picture.fetch")?;
    let bytes = download(client, url).await?;
    store(&app, &db, &bytes)
}

/// Redirects off: the address was checked to be TMDB's or AniList's image
/// host, and a redirect would fetch from wherever it pointed instead.
fn picture_client() -> ClientBuilder {
    Client::builder().user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION"))).redirect(redirect::Policy::none()).referer(false).timeout(FETCH_TIMEOUT)
}

/// The picture's bytes, at most `MAX_BYTES`.
async fn download(client: &Client, url: Url) -> Result<Vec<u8>, String> {
    let fetch = || "err.picture.fetch".to_string();
    let mut response = client.get(url).send().await.map_err(|_| fetch())?;
    if !response.status().is_success() {
        return Err(fetch());
    }
    let too_large = || "err.picture.too-large".to_string();
    if response.content_length().is_some_and(|n| n > MAX_BYTES as u64) {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| fetch())? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Checks and saves a picture's bytes, and returns its name.
fn store(app: &AppHandle, db: &Db, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_BYTES {
        return Err("err.picture.too-large".into());
    }
    if !crate::wallpaper::is_image(bytes) {
        return Err("err.picture.format".into());
    }
    let dir = dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Unsaved uploads from earlier, and pictures profiles moved away from.
    sweep(&dir, &*db.lock()?);
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let name = format!("{PREFIX}{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>());
    std::fs::write(dir.join(&name), bytes).map_err(|_| "err.picture.save")?;
    Ok(name)
}

/// An uploaded picture's bytes (empty if it's gone).
#[tauri::command]
pub async fn avatar_get(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    if !is_upload_name(&name) {
        return Err("invalid picture".into());
    }
    match std::fs::read(dir(&app)?.join(&name)) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(tauri::ipc::Response::new(Vec::new())),
        Err(_) => Err("err.picture.read".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sweep_keeps_only_pictures_a_profile_uses() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let conn = db.lock().unwrap();
        conn.execute("UPDATE profiles SET avatar = 'upload-00000000000000aa' WHERE id = 'main'", []).unwrap();
        let dir = std::env::temp_dir().join(format!("orbit-avatars-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["upload-00000000000000aa", "upload-00000000000000bb", "notes.txt"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        sweep(&dir, &conn);
        let mut left: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        left.sort();
        // A deleted profile's picture goes; the one in use and anything not a picture's name stay.
        assert_eq!(left, ["notes.txt", "upload-00000000000000aa"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_are_safe() {
        assert!(is_upload_name("upload-0123456789abcdef"));
        assert!(!is_upload_name("upload-0123456789ABCDEF"));
        assert!(!is_upload_name("upload-../../etc/passwd"));
        assert!(!is_upload_name("planet"));
        assert!(!is_upload_name("upload-0123"));
    }

    /// A one-shot local server answering with `answer`; the flag says whether it was asked.
    fn serve_once(answer: &'static str) -> (String, std::sync::Arc<std::sync::atomic::AtomicBool>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let asked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = asked.clone();
        std::thread::spawn(move || {
            if let Some(Ok(mut stream)) = listener.incoming().next() {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                let _ = stream.read(&mut [0u8; 2048]);
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        (format!("http://127.0.0.1:{port}/a.png"), asked)
    }

    #[test]
    fn picture_fetches_never_follow_a_redirect() {
        let (elsewhere, asked) = serve_once("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let redirect: &'static str = Box::leak(format!("HTTP/1.1 302 Found\r\nLocation: {elsewhere}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_boxed_str());
        let (url, _) = serve_once(redirect);
        // The real client is also https only; this one isn't, to reach the local server.
        let client = picture_client().build().unwrap();
        let got = tauri::async_runtime::block_on(download(&client, Url::parse(&url).unwrap()));
        assert_eq!(got, Err("err.picture.fetch".to_string()));
        assert!(!asked.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn picture_fetches_are_capped() {
        let (url, _) = serve_once("HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n");
        let client = picture_client().build().unwrap();
        assert_eq!(tauri::async_runtime::block_on(download(&client, Url::parse(&url).unwrap())), Err("err.picture.too-large".to_string()));
    }

    #[test]
    fn only_tmdb_pictures_are_fetched() {
        assert!(is_tmdb_image_url("https://image.tmdb.org/t/p/w185/abcDEF123.jpg"));
        assert!(!is_tmdb_image_url("https://image.tmdb.org/t/p/w185"));
        assert!(!is_tmdb_image_url("https://image.tmdb.org/t/p/w185/../x.jpg"));
        assert!(!is_tmdb_image_url("https://image.tmdb.org/t/p/w185/a.jpg?x=1"));
        assert!(!is_tmdb_image_url("https://image.tmdb.org.evil.com/t/p/w185/a.jpg"));
        assert!(!is_tmdb_image_url("http://image.tmdb.org/t/p/w185/a.jpg"));
    }
}
