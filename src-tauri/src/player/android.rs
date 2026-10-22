//! Video on Android: a Media3 player screen (gen/android NativePlayer.kt)
//! instead of mpv. `player_open` resolves the address exactly as on a PC
//! (logins, tokens and debrid links never reach the page), then hands it to
//! the player through this plugin, which only Rust can call. The player's
//! state is read back twice a second and sent to the page as the same events
//! mpv's would be, so resuming, watched marks and what plays next work as they
//! do on a PC.
//!
//! Plugin calls run on Android's main thread and wait for the answer, so
//! these must only be called from async commands or other threads.

use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Wry};

use super::{PlayerEvent, Status, Tagged, mirror_to_remote};

static PLAYER: OnceLock<PluginHandle<Wry>> = OnceLock::new();
/// Bumped by every open and stop, so the poll for a file left behind ends.
static SESSION: AtomicU64 = AtomicU64::new(0);
const POLL: Duration = Duration::from_millis(500);
/// Held while opening or closing the player screen, so a close can't land between an open's last
/// check and the screen appearing (it would then play over a page that has left its player).
static OPENING: Mutex<()> = Mutex::new(());

/// Registers the Kotlin player. Its IPC handler refuses every command, so the
/// page can't open an address of its own choosing or read the one playing.
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("native-player")
        .invoke_handler(|invoke| {
            invoke.resolver.reject("not allowed");
            true
        })
        .setup(|_app, api| {
            let _ = PLAYER.set(api.register_android_plugin("io.github.fusnk.orbit", "NativePlayerPlugin")?);
            Ok(())
        })
        .build()
}

fn player() -> Result<&'static PluginHandle<Wry>, String> {
    PLAYER.get().ok_or_else(|| "video playback isn't available".into())
}

/// The player's state (`PlayerSession.snapshot` in NativePlayer.kt).
#[derive(Deserialize)]
struct Snapshot {
    loaded: bool,
    ready: bool,
    position: f64,
    duration: Option<f64>,
    buffered: f64,
    paused: bool,
    buffering: bool,
    ended: bool,
    height: Option<i64>,
    speed: f64,
    error: Option<String>,
    closed: bool,
    #[serde(default)]
    keys: Vec<String>,
}

impl Snapshot {
    fn status(&self) -> Status {
        Status {
            time_pos: Some(self.position).filter(|p| p.is_finite() && *p >= 0.0),
            duration: self.duration.filter(|d| d.is_finite() && *d > 0.0),
            paused: self.paused,
            buffering: self.buffering,
            cache_time: Some(self.buffered).filter(|b| b.is_finite() && *b >= 0.0),
            height: self.height,
            speed: Some(self.speed).filter(|s| s.is_finite() && *s > 0.0),
            eof: self.ended,
            ..Status::default()
        }
    }
}

/// A subtitle that goes with a file from the start, as contents.
pub struct Subtitle(Value);

impl Subtitle {
    pub fn new(bytes: Vec<u8>, name: &str, lang: Option<&str>) -> Self {
        Self(json!({ "data": STANDARD.encode(&bytes), "mime": super::subtitle_mime(&bytes), "label": super::clean_label(name), "lang": lang.map(super::clean_label) }))
    }
}

/// What the player screen is asked to play.
pub struct File<'a> {
    /// Already resolved and checked.
    pub url: &'a str,
    /// "Name: value".
    pub headers: &'a [String],
    /// Seconds in.
    pub start: Option<f64>,
    /// A downloaded file: the only file the player may open.
    pub local: bool,
    pub subtitles: &'a [Subtitle],
    /// Switch the TV to the video's frame rate while it plays.
    pub match_rate: bool,
}

/// Plays `file`, reporting to the page as its load `load`. Nothing happens
/// unless `wanted` still says yes once the player is ours.
pub fn open(app: &AppHandle, file: &File, load: u64, wanted: impl Fn() -> bool) -> Result<(), String> {
    let _opening = OPENING.lock().unwrap_or_else(|e| e.into_inner());
    if !wanted() {
        return Ok(());
    }
    let session = SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    let start = file.start.filter(|s| s.is_finite() && *s > 0.0);
    let subtitles: Vec<&Value> = file.subtitles.iter().map(|s| &s.0).collect();
    let payload = json!({ "url": file.url, "headers": file.headers, "start": start, "local": file.local, "subtitles": subtitles, "matchRate": file.match_rate });
    player()?
        .run_mobile_plugin::<Value>("open", payload)
        .map_err(|_| "the player couldn't start")?;
    let app = app.clone();
    std::thread::Builder::new().name("android-player".into()).spawn(move || poll(&app, session, load)).map_err(|e| e.to_string())?;
    Ok(())
}

/// What plays, for Android's Now Playing and Assistant: the title and its episode line (None once it closes).
pub fn now_playing(shown: Option<(&str, Option<&str>)>) -> Result<(), String> {
    let (title, detail) = shown.unzip();
    player()?.run_mobile_plugin::<Value>("nowPlaying", json!({ "title": title, "detail": detail.flatten() })).map(drop).map_err(|_| "no player".into())
}

/// Orbit's Continue Watching on the TV's home screen, checked by watch_next.rs. Waits for Android's provider.
pub fn watch_next(items: &[crate::watch_next::Item]) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("watchNext", json!({ "items": items })).map(drop).map_err(|_| "unavailable".into())
}

/// Closes the player screen, if it's open.
pub fn stop() -> Result<(), String> {
    let _opening = OPENING.lock().unwrap_or_else(|e| e.into_inner());
    SESSION.fetch_add(1, Ordering::SeqCst);
    match PLAYER.get() {
        Some(player) => player.run_mobile_plugin::<Value>("stop", json!({})).map(drop).map_err(|_| "the player couldn't stop".into()),
        None => Ok(()),
    }
}

/// Pauses or plays (the phone remote, the page's keys).
pub fn set_paused(paused: bool) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("setPaused", json!({ "paused": paused })).map(drop).map_err(|_| "no player".into())
}

/// Jumps to `seconds`, or by them when `relative`.
pub fn seek(seconds: f64, relative: bool) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("seek", json!({ "seconds": seconds, "relative": relative })).map(drop).map_err(|_| "no player".into())
}

/// Settings' audio and subtitle languages (comma-separated ISO codes, checked by the caller).
pub fn set_languages(audio: &str, subtitle: &str) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("setLanguages", json!({ "audio": audio, "subtitle": subtitle })).map(drop).map_err(|_| "no player".into())
}

/// Settings' subtitle look (already checked by the caller): mpv's size scale, "#rrggbb", "none"/"shadow"/"box",
/// outline thickness, position (100 = bottom) and bold. NativePlayer.kt maps them onto Media3's caption style.
pub fn set_subtitle_style(size: u32, color: &str, background: &str, outline: u32, position: u32, bold: bool) -> Result<(), String> {
    let style = json!({ "size": size, "color": color, "background": background, "outline": outline, "position": position, "bold": bold });
    player()?.run_mobile_plugin::<Value>("setSubtitleStyle", style).map(drop).map_err(|_| "no player".into())
}

/// What this device can decode and show (codecs, HDR kinds, highest resolution), for ranking sources.
pub fn capabilities() -> Result<Value, String> {
    player()?.run_mobile_plugin::<Value>("capabilities", json!({})).map_err(|_| "unavailable".into())
}

/// Android's speech prompt, saying `prompt`; the words heard, or None.
pub fn listen(prompt: &str) -> Result<Option<String>, String> {
    #[derive(Deserialize)]
    struct Heard {
        text: Option<String>,
    }
    let heard: Heard = player()?.run_mobile_plugin("listen", json!({ "prompt": prompt })).map_err(|_| "unavailable")?;
    Ok(heard.text)
}

/// Shows the Skip button with `label` (Skip intro, Skip recap…), or removes it (None).
pub fn skip_button(label: Option<&str>) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("skipButton", json!({ "label": label })).map(drop).map_err(|_| "no player".into())
}

/// Shows the Next up button with `label`, or removes it (None).
pub fn next_up(label: Option<&str>) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("nextUp", json!({ "label": label })).map(drop).map_err(|_| "no player".into())
}

/// Opens YouTube video `id` (an 11-character id, checked by the caller) in the YouTube app, or a browser.
pub fn open_youtube(id: &str) -> Result<(), String> {
    player()?.run_mobile_plugin::<Value>("openYoutube", json!({ "id": id })).map(drop).map_err(|_| "err.trailer.youtube".into())
}

/// Adds subtitle contents (already fetched and cleaned up, see `add_subtitle_bytes_as`) and shows them.
pub fn add_subtitle(bytes: &[u8], name: &str, lang: Option<&str>) -> Result<(), String> {
    let Subtitle(payload) = Subtitle::new(bytes.to_vec(), name, lang);
    player()?.run_mobile_plugin::<Value>("addSubtitle", payload).map(drop).map_err(|_| "err.subtitles.download".into())
}

fn poll(app: &AppHandle, session: u64, load: u64) {
    let emit = |event: PlayerEvent| {
        mirror_to_remote(app, &event);
        let _ = app.emit("player://event", Tagged { load, event });
    };
    let (mut loaded, mut ready, mut ended) = (false, false, false);
    let mut sent: Option<Status> = None;
    while SESSION.load(Ordering::SeqCst) == session {
        std::thread::sleep(POLL);
        let Ok(snapshot) = player().and_then(|p| p.run_mobile_plugin::<Snapshot>("status", json!({})).map_err(|_| String::new())) else { continue };
        // Stopped, or another file opened, while waiting for the answer.
        if SESSION.load(Ordering::SeqCst) != session {
            break;
        }
        if snapshot.loaded && !loaded {
            loaded = true;
            emit(PlayerEvent::Loaded);
        }
        if let Some(code) = &snapshot.error {
            // The page decides what's next (another source, or a message); a new open polls anew.
            emit(PlayerEvent::Error { message: code.clone() });
            break;
        }
        if snapshot.ready && !ready {
            ready = true;
            emit(PlayerEvent::Ready);
        }
        let status = snapshot.status();
        if sent.as_ref() != Some(&status) {
            emit(PlayerEvent::Status(status.clone()));
            sent = Some(status);
        }
        if snapshot.ended && !ended {
            ended = true;
            emit(PlayerEvent::Ended);
        }
        // Only the keys the page acts on this way (see NativePlayer.kt dispatchKeyEvent).
        for key in snapshot.keys.into_iter().filter(|k| k == "MediaTrackNext" || k == "MediaTrackPrevious" || k == "Skip") {
            emit(PlayerEvent::Key { key });
        }
        if snapshot.closed {
            emit(PlayerEvent::Closed);
            break;
        }
    }
}
