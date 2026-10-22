//! Trailers: the YouTube videos a title's metadata names, found with yt-dlp
//! (shipped beside Orbit; see scripts/setup-ytdlp.mjs) and played by mpv, or
//! behind a title page or banner.
//!
//! The page asks for `orbit-trailer://{youtube id}`; only an 11-character
//! YouTube id ever reaches yt-dlp, never a URL or option from outside. yt-dlp
//! runs from a copy in the app's data folder, so it can update itself: YouTube
//! changes often, and an old yt-dlp soon stops finding videos.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;

/// What the player is asked to open for a trailer.
pub const SCHEME: &str = "orbit-trailer://";
const EXE: &str = "yt-dlp.exe";
/// yt-dlp's addresses last about six hours; reuse them for a while.
const CACHE_FOR: Duration = Duration::from_secs(30 * 60);
const RUN_TIMEOUT: Duration = Duration::from_secs(30);
const UPDATE_EVERY: Duration = Duration::from_secs(7 * 86_400);
/// After a failure, an update is tried at most this often.
const RETRY_UPDATE_AFTER: Duration = Duration::from_secs(3600);
/// For playing: the best picture up to 1080p, with the best sound. Plain files
/// (`https`) come first: YouTube's best format is often HLS, whose segments have
/// no file extension, and current FFmpeg refuses those ("loading failed"). H.264
/// before other codecs, which older PCs and TVs can't always decode in hardware.
const PLAY_FORMAT: &str = "bv*[height<=1080][protocol=https][vcodec^=avc1]+ba[protocol=https]/bv*[height<=1080][protocol=https]+ba[protocol=https]/b[protocol=https]/bv*[height<=1080]+ba/b";
/// For a page background: a picture the WebView can play, with its sound as a
/// separate file (fetched only if the person turns the sound on), or one file with both.
/// Plain files only where possible: the WebView doesn't play HLS either.
const PREVIEW_FORMAT: &str = "bv*[height<=720][ext=mp4][protocol=https][vcodec^=avc1]+ba[ext=m4a][protocol=https]/bv*[height<=720][ext=mp4][protocol=https]+ba[ext=m4a][protocol=https]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]";
/// Lookups at once: a page of banners asks for many trailers, and each is a whole Python process.
const MAX_RUNS: usize = 2;
/// yt-dlp prints one or two addresses; anything longer is cut off.
const MAX_OUTPUT: u64 = 64 * 1024;

/// A trailer's addresses: the picture (or picture and sound), and separate sound if any.
#[derive(Clone)]
pub struct Found {
    pub video: String,
    pub audio: Option<String>,
}

/// A trailer: its YouTube id, and whether it's for a page background.
type Key = (String, bool);

pub struct Trailers {
    found: Mutex<HashMap<Key, (Instant, Found)>>,
    updated: Mutex<Option<Instant>>,
    runs: tokio::sync::Semaphore,
    /// The slot for a trailer the person asked to play, apart from the page backgrounds' `runs`.
    play: tokio::sync::Semaphore,
    /// One lookup per trailer (id, preview) at a time.
    lookups: Mutex<HashMap<Key, Arc<tokio::sync::Mutex<()>>>>,
    /// Held while Orbit's copy of yt-dlp is made and while yt-dlp updates
    /// itself: the update replaces the file, and a copy made meanwhile (it
    /// looked missing) would put the old bundled one back over the new.
    tool: tokio::sync::Mutex<()>,
    /// yt-dlp processes running now, so quitting Orbit ends them (on Windows a
    /// child outlives its parent). Dropping one kills it (`kill_on_drop`).
    children: Mutex<HashMap<u64, tokio::process::Child>>,
    next_child: AtomicU64,
}

impl Default for Trailers {
    fn default() -> Self {
        Self {
            found: Mutex::default(),
            updated: Mutex::default(),
            runs: tokio::sync::Semaphore::new(MAX_RUNS),
            play: tokio::sync::Semaphore::new(1),
            lookups: Mutex::default(),
            tool: tokio::sync::Mutex::default(),
            children: Mutex::default(),
            next_child: AtomicU64::new(0),
        }
    }
}

impl Trailers {
    /// Ends every yt-dlp still running; called as Orbit quits.
    pub fn shutdown(&self) {
        if let Ok(mut children) = self.children.lock() {
            for (_, mut child) in children.drain() {
                let _ = child.start_kill();
            }
        }
    }

    /// Runs `cmd` to the end (or until this future is dropped, which kills it):
    /// its exit status and up to `MAX_OUTPUT` bytes of what it printed.
    async fn output(&self, cmd: &mut tokio::process::Command) -> std::io::Result<(ExitStatus, Vec<u8>)> {
        let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
        let stdout = child.stdout.take();
        let id = self.next_child.fetch_add(1, Ordering::Relaxed);
        self.children.lock().map_err(|_| std::io::Error::other("busy"))?.insert(id, child);
        // Takes the child back out (killing it) however this future ends.
        let tracked = Tracked { children: &self.children, id };
        let mut out = Vec::new();
        if let Some(stdout) = stdout {
            stdout.take(MAX_OUTPUT).read_to_end(&mut out).await?;
        }
        let child = tracked.children.lock().ok().and_then(|mut c| c.remove(&id));
        let mut child = child.ok_or_else(|| std::io::Error::other("stopped"))?;
        Ok((child.wait().await?, out))
    }
}

/// A child in `Trailers::children`, removed (and so killed) when this is dropped.
struct Tracked<'a> {
    children: &'a Mutex<HashMap<u64, tokio::process::Child>>,
    id: u64,
}

impl Drop for Tracked<'_> {
    fn drop(&mut self) {
        let child = self.children.lock().ok().and_then(|mut c| c.remove(&self.id));
        drop(child);
    }
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Only YouTube's own https video servers are played.
fn video_url(line: &str) -> Option<String> {
    let url = reqwest::Url::parse(line.trim()).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https" && (host.ends_with(".googlevideo.com") || host.ends_with(".youtube.com"))).then(|| url.into())
}

/// Orbit's own copy of yt-dlp, made from the bundled one the first time.
async fn exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tools");
    let path = dir.join(EXE);
    if path.exists() {
        return Ok(path);
    }
    // Missing, or mid-update: once any update is over, look again before copying.
    let trailers = app.state::<Trailers>();
    let _tool = trailers.tool.lock().await;
    if !path.exists() {
        let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join(EXE);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::copy(&bundled, &path).map_err(|_| "err.trailer.missing")?;
    }
    Ok(path)
}

fn command(path: &PathBuf) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(path);
    // `--ignore-config`: settings files elsewhere on the computer can't change what runs.
    cmd.arg("--ignore-config").stdin(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        // No console window flashing up.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Updates yt-dlp in the background if it's been a week (or `soon`, after a failure, an hour).
fn maybe_update(app: &AppHandle, path: PathBuf, soon: bool) {
    let app = app.clone();
    let trailers = app.state::<Trailers>();
    let Ok(mut updated) = trailers.updated.lock() else { return };
    let stamp = path.with_extension("updated");
    let last = updated.or_else(|| {
        let modified = std::fs::metadata(&stamp).and_then(|m| m.modified()).ok()?;
        Instant::now().checked_sub(SystemTime::now().duration_since(modified).ok()?)
    });
    let due = if soon { RETRY_UPDATE_AFTER } else { UPDATE_EVERY };
    if last.is_some_and(|t| t.elapsed() < due) {
        return;
    }
    *updated = Some(Instant::now());
    drop(updated);
    tauri::async_runtime::spawn(async move {
        let trailers = app.state::<Trailers>();
        let _tool = trailers.tool.lock().await;
        // yt-dlp checks the new version against its release's checksums before replacing itself.
        let result = tokio::time::timeout(Duration::from_secs(120), trailers.output(command(&path).arg("-U"))).await;
        if matches!(result, Ok(Ok((status, _))) if status.success()) {
            let _ = std::fs::write(&stamp, b"");
        }
    });
}

/// The addresses of YouTube video `id`, for playing or (`preview`) a page background.
pub async fn find(app: &AppHandle, id: &str, preview: bool) -> Result<Found, String> {
    if !valid_id(id) {
        return Err("invalid trailer".into());
    }
    let key = (id.to_string(), preview);
    if let Some(found) = cached(&app.state::<Trailers>(), &key)? {
        return Ok(found);
    }
    let path = exe(app).await?;
    maybe_update(app, path.clone(), false);
    let trailers = app.state::<Trailers>();
    let turn = trailers.lookups.lock().map_err(|_| "busy")?.entry(key.clone()).or_default().clone();
    // The time limit covers waiting for a turn and a slot too: a lookup that can't get one in time gives up.
    let result = tokio::time::timeout(RUN_TIMEOUT, async {
        // One lookup per trailer at a time: one asked for meanwhile takes the first one's answer.
        let _turn = turn.lock().await;
        if let Some(found) = cached(&trailers, &key)? {
            return Ok(found);
        }
        // Playing has a slot of its own, so a page of banners can't hold it up.
        let _run = if preview { &trailers.runs } else { &trailers.play }.acquire().await.map_err(|_| "busy")?;
        let mut cmd = command(&path);
        cmd.args(["--no-playlist", "--no-warnings", "-f", if preview { PREVIEW_FORMAT } else { PLAY_FORMAT }, "-g", "--"]).arg(format!("https://www.youtube.com/watch?v={id}"));
        let out = match trailers.output(&mut cmd).await {
            Ok((status, out)) if status.success() => out,
            Ok(_) => {
                // Usually YouTube changed something; a newer yt-dlp will likely fix it.
                maybe_update(app, path.clone(), true);
                return Err("err.trailer.youtube-retry".to_string());
            }
            Err(_) => return Err("err.trailer.start".into()),
        };
        let mut urls = String::from_utf8_lossy(&out).lines().filter_map(video_url).collect::<Vec<_>>().into_iter();
        let found = Found { video: urls.next().ok_or("err.trailer.youtube")?, audio: urls.next() };
        let mut cache = trailers.found.lock().map_err(|_| "busy")?;
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_FOR);
        cache.insert(key.clone(), (Instant::now(), found.clone()));
        Ok(found)
    })
    .await
    .unwrap_or_else(|_| Err("err.trailer.timeout".into()));
    // The last one for this trailer forgets its turn.
    if let Ok(mut lookups) = trailers.lookups.lock()
        && Arc::strong_count(&turn) == 2
    {
        lookups.remove(&key);
    }
    result
}

/// Trailer `key`'s addresses if they were found recently.
fn cached(trailers: &Trailers, key: &Key) -> Result<Option<Found>, String> {
    let found = trailers.found.lock().map_err(|_| "busy")?;
    Ok(found.get(key).filter(|(at, _)| at.elapsed() < CACHE_FOR).map(|(_, found)| found.clone()))
}

/// What a page plays behind its artwork: the picture, and its sound when that's a separate file.
#[derive(serde::Serialize)]
pub struct Preview {
    video: String,
    audio: Option<String>,
}

/// The addresses for playing trailer `id` behind a title page or banner (muted unless the person chooses sound).
#[tauri::command]
pub async fn trailer_preview(app: AppHandle, id: String) -> Result<Preview, String> {
    let found = find(&app, &id, true).await?;
    Ok(Preview { video: found.video, audio: found.audio })
}

/// Android has no yt-dlp: a trailer opens in the YouTube app instead. Only a checked id goes to it.
#[tauri::command]
pub async fn trailer_open_youtube(id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid trailer".into());
    }
    #[cfg(target_os = "android")]
    return crate::player::android::open_youtube(&id);
    #[cfg(not(target_os = "android"))]
    Err("unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_youtube_ids_and_servers() {
        assert!(valid_id("cdx31ak4KbQ"));
        assert!(valid_id("a-b_c123456"));
        assert!(!valid_id("cdx31ak4Kb"));
        assert!(!valid_id("--exec=calc"));
        assert!(!valid_id("https://x.y"));
        assert_eq!(video_url("https://rr1---sn-x.googlevideo.com/videoplayback?a=1").as_deref(), Some("https://rr1---sn-x.googlevideo.com/videoplayback?a=1"));
        assert_eq!(video_url("http://rr1---sn-x.googlevideo.com/v"), None);
        assert_eq!(video_url("https://evil.example/googlevideo.com"), None);
        assert_eq!(video_url("ERROR: nope"), None);
    }

    /// A lookup still running as Orbit quits is ended, not left behind.
    #[test]
    fn quitting_ends_running_lookups() {
        let trailers = std::sync::Arc::new(Trailers::default());
        tauri::async_runtime::block_on(async {
            let mut cmd = if cfg!(windows) { tokio::process::Command::new("ping") } else { tokio::process::Command::new("sleep") };
            if cfg!(windows) {
                cmd.args(["-n", "30", "127.0.0.1"]);
            } else {
                cmd.arg("30");
            }
            cmd.kill_on_drop(true);
            let t = trailers.clone();
            let run = tokio::spawn(async move { t.output(&mut cmd).await });
            while trailers.children.lock().unwrap().is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            trailers.shutdown();
            let result = tokio::time::timeout(Duration::from_secs(10), run).await.expect("the process outlived the shutdown").unwrap();
            assert!(result.is_err() || result.is_ok_and(|(status, _)| !status.success()));
            assert!(trailers.children.lock().unwrap().is_empty());
        });
    }
}
