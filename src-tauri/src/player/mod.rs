//! Video playback with libmpv. mpv is the source of truth for playback
//! state: the page only sends commands and renders what `player://event`
//! reports.
//!
//! One mpv instance is kept for the app's lifetime (created on first use on
//! Windows, during GTK setup on Linux). A dedicated thread drains its events.
//! Linux's render callback only sets an atomic; no mpv callback does blocking work.

#[cfg(target_os = "android")]
pub mod android;
mod caps;
pub mod dip;
mod mpv;
pub mod outputs;
mod paste;
mod placement;
mod proxy_headers;
mod rewind_cache;
mod sdh;
mod sub_colors;
pub mod subsync;
pub mod subtrans;
mod surface;
pub mod thumbs;
pub mod transcript;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use mpv::{Mpv, event, format};
pub use surface::Surface;

/// The bundled libmpv beside the app. On Linux `Mpv::load` ignores the path and uses the
/// system library found by pkg-config, but the name is still passed (subtitle sync, previews).
const LIBMPV: &str = if cfg!(windows) { "libmpv-2.dll" } else { "libmpv.so.2" };
/// The bundled subtitle fonts, under the resources folder.
const FONTS_DIR: &str = "fonts";
/// The WebView's background outside the player (matches tauri.conf.json).
pub const OPAQUE: Color = Color(0x0b, 0x0d, 0x12, 0xff);
const TRANSPARENT: Color = Color(0, 0, 0, 0);
/// Position updates arrive every frame; the page needs a few per second.
const TIME_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const MAX_URL_BYTES: usize = 8192;

/// Options every mpv that opens a stream URL must have (the player and the
/// seek-bar previews), or it doesn't start. Each closes a way for untrusted
/// stream URLs or local config to do more than play video.
pub(crate) const STREAM_HARDENING: &[(&str, &str)] = &[
    // Ignore the user's own mpv config and scripts: Orbit's behavior shouldn't depend on them.
    ("config", "no"),
    ("load-scripts", "no"),
    // Never hand a URL to youtube-dl/yt-dlp, which would run an external program.
    ("ytdl", "no"),
    // A remote playlist (HLS/DASH) may only reach network protocols, never
    // local files or devices, so a stream can't read files off this PC.
    ("demuxer-lavf-o", "protocol_whitelist=[http,https,tls,tcp,crypto,data,httpproxy]"),
    ("stream-lavf-o", "protocol_whitelist=[http,https,tls,tcp,crypto,data,httpproxy]"),
];

/// Options that must apply too, or playback doesn't start.
const REQUIRED_OPTIONS: &[(&str, &str)] = &[
    // The page draws every control and owns all input.
    ("osc", "no"),
    ("input-default-bindings", "no"),
    ("input-vo-keyboard", "no"),
    ("input-cursor", "no"),
    ("cursor-autohide", "no"),
    // Stay alive between files, and keep the last frame at the end instead
    // of tearing down the video window (which would leave a hole).
    ("idle", "yes"),
    ("keep-open", "yes"),
    ("force-window", "no"),
    ("terminal", "no"),
    ("hwdec", "auto-safe"),
];

/// Built-in overlays nothing can open anyway (mpv gets no input); off to save work.
/// Names vary between mpv versions, so failures here are ignored.
const OPTIONAL_OPTIONS: &[(&str, &str)] = &[("load-stats-overlay", "no"), ("load-osd-console", "no"), ("load-auto-profiles", "no")];

/// Observed properties, identified by their reply id.
const OBSERVED: &[(u64, &str, i32)] = &[
    (1, "time-pos", format::DOUBLE),
    (2, "duration", format::DOUBLE),
    (3, "pause", format::FLAG),
    (4, "paused-for-cache", format::FLAG),
    (5, "seeking", format::FLAG),
    (6, "eof-reached", format::FLAG),
    (7, "volume", format::DOUBLE),
    (16, "af", format::NODE),
    (8, "mute", format::FLAG),
    (9, "demuxer-cache-time", format::DOUBLE),
    (10, "height", format::INT64),
    (11, "speed", format::DOUBLE),
    (12, "track-list", format::NODE),
    (13, "chapter-list", format::NODE),
    // The decoded audio's format: "spdif-…" while it passes through undecoded.
    (14, "audio-params", format::NODE),
    (15, "sub-delay", format::DOUBLE),
    // The sound outputs (see outputs.rs): mpv refreshes the list on hotplug only while it's observed.
    (17, "audio-device-list", format::NODE),
    (18, "audio-device", format::STRING),
];
/// Chapters beyond this aren't useful for finding intros and credits.
const MAX_CHAPTERS: usize = 500;

#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Status {
    time_pos: Option<f64>,
    duration: Option<f64>,
    paused: bool,
    buffering: bool,
    /// Logical volume, up to the chosen boost preset.
    volume: Option<f64>,
    muted: bool,
    /// How far ahead the stream is buffered (seconds from the start).
    cache_time: Option<f64>,
    /// Video height in pixels, for the quality badge.
    height: Option<i64>,
    speed: Option<f64>,
    sub_delay: Option<f64>,
    /// The audio goes to the receiver undecoded (Settings → Audio passthrough):
    /// Orbit's volume and sound filters can't change it.
    passthrough: bool,
    /// At the end of the file (mpv's `eof-reached`): mpv paused itself on the last frame.
    eof: bool,
}

impl Status {
    /// What's left when mpv loads another file. Volume, mute and speed belong to the
    /// player, not the file: mpv keeps them across files and reports no change, so they're
    /// kept here too (resetting mute made a muted player look unmuted, and M then muted it
    /// again). Pause comes from mpv itself (`paused`): the mirrored value can lag, since
    /// mpv may report FILE_LOADED before the `pause=no` that `player_open` set, while a
    /// pause pressed during the load is still set in mpv and must be kept.
    fn for_new_file(&self, paused: bool) -> Status {
        Status { volume: self.volume, muted: self.muted, speed: self.speed, paused, ..Status::default() }
    }
}

/// An audio or subtitle track, as the track menus show it.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: i64,
    /// "audio" or "sub".
    kind: String,
    title: Option<String>,
    lang: Option<String>,
    codec: Option<String>,
    channels: Option<i64>,
    /// The main pick of its kind (for subtitles, not the second one).
    selected: bool,
    /// Shown as the second subtitle (`secondary-sid`), at the top.
    secondary: bool,
    external: bool,
    default: bool,
    forced: bool,
    /// Subtitles for the deaf and hard of hearing (they describe sounds too), as the file flags them.
    hearing_impaired: bool,
}

/// Picks the audio and subtitle tracks out of mpv's `track-list`.
fn tracks_from(list: &serde_json::Value) -> Vec<Track> {
    let text = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_owned);
    let flag = |v: &serde_json::Value, k: &str| v.get(k).and_then(serde_json::Value::as_bool).unwrap_or(false);
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let kind = text(t, "type")?;
            if kind != "audio" && kind != "sub" {
                return None;
            }
            Some(Track {
                id: t.get("id")?.as_i64()?,
                kind,
                title: text(t, "title"),
                lang: text(t, "lang"),
                codec: text(t, "codec"),
                channels: t.get("demux-channel-count").and_then(serde_json::Value::as_i64),
                // mpv marks both subtitle picks "selected"; main-selection 1 is the second one.
                selected: flag(t, "selected") && t.get("main-selection").and_then(serde_json::Value::as_i64) != Some(1),
                secondary: flag(t, "selected") && t.get("main-selection").and_then(serde_json::Value::as_i64) == Some(1),
                external: flag(t, "external"),
                default: flag(t, "default"),
                forced: flag(t, "forced"),
                hearing_impaired: flag(t, "hearing-impaired"),
            })
        })
        .collect()
}

/// A chapter of the file, from its own chapter markers.
#[derive(Serialize, Clone, PartialEq)]
struct Chapter {
    title: Option<String>,
    /// Start, in seconds.
    time: f64,
}

fn chapters_from(list: &serde_json::Value) -> Vec<Chapter> {
    list.as_array()
        .into_iter()
        .flatten()
        .take(MAX_CHAPTERS)
        .filter_map(|c| {
            let time = c.get("time")?.as_f64().filter(|t| t.is_finite() && *t >= 0.0)?;
            Some(Chapter { title: c.get("title").and_then(|t| t.as_str()).map(str::to_owned), time })
        })
        .collect()
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum PlayerEvent {
    Status(Status),
    Tracks { tracks: Vec<Track> },
    Chapters { chapters: Vec<Chapter> },
    /// The sound outputs, and the one mpv plays on now (see outputs.rs).
    Outputs { devices: Vec<outputs::Device>, active: String },
    /// A new file is open: events before this one belong to the previous file.
    Loaded,
    /// Playback (re)started: the first frame is up, or a seek finished.
    Ready,
    Ended,
    Error { message: String },
    /// Android: the person left the player screen (Back); the page closes its player too.
    #[cfg(target_os = "android")]
    Closed,
    /// Android: a remote key the player screen leaves to the page (MediaTrackNext/Previous: the next channel or episode).
    #[cfg(target_os = "android")]
    Key { key: String },
}

/// An event with the page's number for the load it belongs to, so the page
/// can drop anything left over from a file it has already moved on from.
#[derive(Serialize, Clone)]
struct Tagged {
    load: u64,
    #[serde(flatten)]
    event: PlayerEvent,
}

/// The file the page asked for last: mpv's playlist entry id for it, and the
/// page's number for that load. None once stopped.
type Current = Arc<Mutex<Option<(i64, u64)>>>;

/// The page's load number for an event about playlist entry `entry`, or None
/// if that entry isn't the one asked for last (a channel surfed past, say):
/// its late events must not reach the page as if they were the new file's.
fn load_for(current: Option<(i64, u64)>, entry: i64) -> Option<u64> {
    current.filter(|(wanted, _)| *wanted == entry).map(|(_, load)| load)
}

struct Engine {
    mpv: Arc<Mpv>,
    stop: Arc<AtomicBool>,
    events: JoinHandle<()>,
}

pub struct PlayerState {
    surface: Option<Arc<Surface>>,
    engine: Mutex<Option<Engine>>,
    /// Bumped by every open and stop. Opening can wait (a trailer's address
    /// is looked up first); an open overtaken meanwhile doesn't load, so
    /// closing the player or picking another source while it waits can't
    /// start the old file afterwards.
    opens: AtomicU64,
    /// Held while a file is handed to mpv, so the event thread can't tag the
    /// new file's first events before its entry id is known.
    current: Current,
    /// The chosen logical volume ceiling (100, 125, 150, or 200).
    boost: AtomicU32,
    /// The file playing was opened with headers: a sign-in (Jellyfin, Plex) or an addon's
    /// own (`proxyHeaders`). mpv sends a file's headers with every request it makes for
    /// that file, so subtitles from elsewhere are then fetched here instead (see `player_add_subtitle`).
    signed_in: AtomicBool,
    /// Sound settings, and the playing audio track's codec they depend on (see `apply_audio`).
    audio: Mutex<AudioPrefs>,
    /// What's playing, for subtitle sync to read (see subsync). None for live TV,
    /// trailers, Jellyfin and Plex (whose sign-ins aren't shared with it).
    media: Mutex<Option<subsync::Media>>,
    sync: subsync::Syncs,
    /// The AI subtitle translation running, if any (see subtrans): stopped like a sync.
    translate: subsync::Syncs,
    transcript: transcript::Cache,
    /// Settings → Audio & Subtitles → Remove hearing-impaired text, and whether song lyrics stay (see sdh.rs).
    strip_sdh: AtomicBool,
    keep_lyrics: AtomicBool,
    /// Player → Keep subtitles at the bottom: placement tags come out of the files Orbit adds (see placement.rs).
    keep_bottom: AtomicBool,
    /// Settings → Audio & Subtitles → Fix ALL-CAPS subtitles (see caps.rs).
    fix_caps: AtomicBool,
    /// Where the person put subtitles (`sub-pos`, from their style), and how far they're
    /// raised for now to clear the controls (see `player_lift_subtitles`).
    sub_position: AtomicU32,
    sub_lift: AtomicU32,
    /// A smooth skip's audio dip under way, restored on every open and stop (see dip.rs).
    dip: dip::Dip,
    /// Settings → Audio → Output device (see outputs.rs).
    outputs: Mutex<outputs::Outputs>,
    /// The window is hidden in the tray (see tray.rs): files open paused until it's back.
    hidden: AtomicBool,
}

impl PlayerState {
    /// GTK rendering must be initialized on the main thread. Linux initializes
    /// eagerly in setup so command workers never wait while holding this lock.
    #[cfg(target_os = "linux")]
    pub fn initialize_linux(&self, app: &AppHandle) -> Result<(), String> {
        self.mpv(app).map(|_| ())
    }

    pub fn new(surface: Option<Surface>) -> Self {
        Self {
            surface: surface.map(Arc::new),
            engine: Mutex::new(None),
            opens: AtomicU64::new(0),
            current: Arc::default(),
            boost: AtomicU32::new(100),
            signed_in: AtomicBool::new(false),
            audio: Mutex::default(),
            media: Mutex::new(None),
            sync: subsync::Syncs::default(),
            translate: subsync::Syncs::default(),
            transcript: transcript::Cache::default(),
            strip_sdh: AtomicBool::new(false),
            keep_lyrics: AtomicBool::new(true),
            keep_bottom: AtomicBool::new(true),
            sub_position: AtomicU32::new(SUB_POS_BOTTOM),
            sub_lift: AtomicU32::new(0),
            fix_caps: AtomicBool::new(false),
            dip: dip::Dip::default(),
            outputs: Mutex::default(),
            hidden: AtomicBool::new(false),
        }
    }

    /// Which open (or stop) the player is on now, for `same_file`.
    fn opens_now(&self) -> u64 {
        self.opens.load(Ordering::SeqCst)
    }

    /// Whether no other file was opened, and the player not stopped, since `opens_now` gave `opens`.
    fn same_file(&self, opens: u64) -> bool {
        self.opens_now() == opens
    }

    /// Stops the event thread, then destroys mpv. Called once on app exit.
    pub fn shutdown(&self) {
        let Some(engine) = self.engine.lock().ok().and_then(|mut e| e.take()) else {
            #[cfg(target_os = "linux")]
            if let Some(surface) = &self.surface {
                surface.shutdown();
            }
            return;
        };
        engine.stop.store(true, Ordering::SeqCst);
        engine.mpv.wakeup();
        // On Linux, release the render context before waiting for a client-API
        // thread: that thread can be waiting for render work on this GTK thread.
        #[cfg(target_os = "linux")]
        if let Some(surface) = &self.surface {
            surface.shutdown();
        }
        let _ = engine.events.join();
        // The event thread's reference is gone, so this drop terminates mpv.
        drop(engine.mpv);
    }

    /// The window hid to the tray: what plays pauses, and files opened while it stays there
    /// (a source still loading, the next episode Next Up starts) open paused.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn hide_to_tray(&self) {
        self.hidden.store(true, Ordering::SeqCst);
        #[cfg(not(target_os = "android"))]
        self.pause();
    }

    /// The window is back from the tray.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn window_shown(&self) {
        self.hidden.store(false, Ordering::SeqCst);
    }

    /// Whether a file opened now stays paused (see `hide_to_tray`).
    fn opens_paused(&self) -> bool {
        self.hidden.load(Ordering::SeqCst)
    }

    /// Pauses playback if the player has started.
    #[cfg(not(target_os = "android"))]
    fn pause(&self) {
        // Called from the window's close handler, on the UI thread: a synchronous property set waits
        // for mpv's core, which on Windows may itself wait on that thread (its video window is a child
        // of the main window), and on Linux renders there. So it's set off that thread everywhere.
        if let Some(engine) = self.engine.lock().ok().and_then(|e| e.as_ref().map(|e| e.mpv.clone())) {
            tauri::async_runtime::spawn_blocking(move || {
                let _ = engine.set_property("pause", "yes");
            });
        }
    }

    /// The player's mpv if it has started; never starts it.
    fn running(&self) -> Option<Arc<Mpv>> {
        self.engine.lock().ok().and_then(|e| e.as_ref().map(|e| e.mpv.clone()))
    }

    fn mpv(&self, app: &AppHandle) -> Result<Arc<Mpv>, String> {
        let mut engine = self.engine.lock().map_err(|_| "player unavailable")?;
        if let Some(engine) = engine.as_ref() {
            return Ok(engine.mpv.clone());
        }
        let surface = self.surface.clone().ok_or("video playback isn't available on this platform yet")?;
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        #[cfg(not(target_os = "linux"))]
        let mpv = Mpv::load(&resources.join(LIBMPV))?;
        #[cfg(target_os = "linux")]
        let mpv = Mpv::load(std::path::Path::new(env!("ORBIT_SYSTEM_LIBMPV")))?;
        #[cfg(not(target_os = "linux"))]
        mpv.set_option("wid", &surface.wid())?;
        #[cfg(target_os = "linux")]
        mpv.set_option("vo", "libmpv")?;
        // GTK renders on the UI thread: let mpv schedule frames without a
        // deliberate wait in render_context_render (see mpv/render.h).
        #[cfg(target_os = "linux")]
        mpv.set_option("video-timing-offset", "0")?;
        for (name, value) in STREAM_HARDENING.iter().chain(REQUIRED_OPTIONS) {
            mpv.set_option(name, value).map_err(|e| format!("mpv option {name}: {e}"))?;
        }
        for (name, value) in OPTIONAL_OPTIONS {
            let _ = mpv.set_option(name, value);
        }
        // The readability fonts Orbit ships (Settings → Subtitles → Font) live
        // in the resources' `fonts/` folder (see tauri.conf.json); libass loads
        // them from here by family name. Optional: an mpv without the option
        // just keeps the system fonts.
        if let Some(fonts) = resources.join(FONTS_DIR).to_str() {
            let _ = mpv.set_option("sub-fonts-dir", fonts);
        }
        mpv.initialize()?;
        for (id, name, fmt) in OBSERVED {
            mpv.observe(*id, name, *fmt)?;
        }
        let mpv = Arc::new(mpv);
        #[cfg(target_os = "linux")]
        surface.attach(mpv.clone())?;
        let stop = Arc::new(AtomicBool::new(false));
        let events = {
            let (mpv, stop, app, current, event_surface) = (mpv.clone(), stop.clone(), app.clone(), self.current.clone(), surface.clone());
            std::thread::Builder::new()
                .name("mpv-events".into())
                .spawn(move || event_loop(&mpv, &event_surface, &stop, &app, &current))
                .map_err(|e| {
                    #[cfg(target_os = "linux")]
                    surface.shutdown();
                    e.to_string()
                })?
        };
        *engine = Some(Engine { mpv: mpv.clone(), stop, events });
        Ok(mpv)
    }
}

/// Drains mpv's events on its own thread and forwards them to the page.
fn event_loop(mpv: &Mpv, surface: &Surface, stop: &AtomicBool, app: &AppHandle, current: &Current) {
    let mut status = Status::default();
    let mut sent = Status::default();
    let mut last_time_event = Instant::now() - TIME_EVENT_INTERVAL;
    // The playlist entry mpv is on: what follows a START_FILE is about that file.
    let mut entry = -1i64;
    // Only waits while `player_open` hands mpv a file (a quick, local call).
    let emit_for = |entry: i64, event: PlayerEvent| {
        if let Some(load) = load_for(current.lock().ok().and_then(|c| *c), entry) {
            mirror_to_remote(app, &event);
            // Windows' media flyout and Linux's MPRIS show mpv's play/pause (see media_controls.rs).
            if let PlayerEvent::Status(s) = &event {
                crate::media_controls::playback(app, s.paused);
                #[cfg(target_os = "linux")]
                crate::media_controls::progress(app, s.time_pos, s.duration, s.speed);
            }
            #[cfg(target_os = "linux")]
            if matches!(event, PlayerEvent::Ready) {
                crate::media_controls::restarted(app);
            }
            let _ = app.emit("player://event", Tagged { load, event });
        }
    };
    let (mut paused_for_cache, mut seeking) = (false, false);
    // The audio track's codec the sound settings were last applied for.
    let mut audio_codec: Option<String> = None;
    // The sound output mpv plays on (`audio-device`), for the page's device lists.
    let mut audio_device = String::from(outputs::AUTO);
    // Whether the screen is being kept awake (see idle_inhibit.rs).
    #[cfg(target_os = "linux")]
    let mut awake = false;

    loop {
        let ev = mpv.wait_event(-1.0);
        match ev.event_id {
            event::NONE => {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                continue;
            }
            event::SHUTDOWN => break,
            event::START_FILE => {
                // SAFETY: START_FILE events carry an mpv_event_start_file.
                entry = unsafe { &*(ev.data as *const mpv::EventStartFile) }.playlist_entry_id;
            }
            event::FILE_LOADED => {
                let paused = mpv.get_string("pause").map_or(status.paused, |p| p == "yes");
                status = status.for_new_file(paused);
                emit_for(entry, PlayerEvent::Loaded);
            }
            // mpv (re)created its video window, on top of the WebView: move it beneath.
            event::VIDEO_RECONFIG => {
                surface.push_video_behind();
            }
            event::PLAYBACK_RESTART => emit_for(entry, PlayerEvent::Ready),
            event::SET_PROPERTY_REPLY if ev.reply_userdata == outputs::REPLY && ev.error < 0 => {
                if let Ok(mut outputs) = app.state::<PlayerState>().outputs.lock() {
                    outputs.refused();
                }
            }
            event::END_FILE => {
                // SAFETY: END_FILE events carry an mpv_event_end_file.
                let end = unsafe { &*(ev.data as *const mpv::EventEndFile) };
                if end.reason == mpv::end_reason::ERROR {
                    emit_for(end.playlist_entry_id, PlayerEvent::Error { message: mpv.error_text(end.error) });
                }
            }
            event::PROPERTY_CHANGE => {
                // SAFETY: PROPERTY_CHANGE events carry an mpv_event_property.
                let prop = unsafe { &*(ev.data as *const mpv::EventProperty) };
                let double = || (prop.format == format::DOUBLE && !prop.data.is_null()).then(|| unsafe { *(prop.data as *const f64) });
                let flag = || prop.format == format::FLAG && !prop.data.is_null() && unsafe { *(prop.data as *const i32) } != 0;
                let int = || (prop.format == format::INT64 && !prop.data.is_null()).then(|| unsafe { *(prop.data as *const i64) });
                match ev.reply_userdata {
                    1 => status.time_pos = double(),
                    2 => status.duration = double(),
                    3 => status.paused = flag(),
                    4 => paused_for_cache = flag(),
                    5 => seeking = flag(),
                    6 => {
                        status.eof = flag();
                        if status.eof {
                            emit_for(entry, PlayerEvent::Ended);
                        }
                    }
                    // mpv's volume is the logical one divided by the boost stage's gain (af), which a
                    // command may have changed since this event was queued: converting the event's value
                    // could flash a wrong volume. The logical volume last applied is what's shown; the
                    // events (volume, af) only say when to send it.
                    7 | 16 => {
                        if let Ok(prefs) = app.state::<PlayerState>().audio.lock() {
                            status.volume = Some(prefs.volume);
                        }
                    }
                    8 => status.muted = flag(),
                    9 => status.cache_time = double(),
                    10 => status.height = int(),
                    11 => status.speed = double(),
                    15 => status.sub_delay = double(),
                    12 if prop.format == format::NODE && !prop.data.is_null() => {
                        // SAFETY: NODE-format property data is an mpv_node valid during this event.
                        let list = unsafe { mpv::node_to_json(&*(prop.data as *const mpv::Node), 0) };
                        let tracks = tracks_from(&list);
                        // Another audio track (or file): passthrough may now apply, or no longer.
                        let codec = tracks.iter().find(|t| t.kind == "audio" && t.selected).and_then(|t| t.codec.clone());
                        if codec != audio_codec {
                            audio_codec = codec;
                            if let Ok(mut prefs) = app.state::<PlayerState>().audio.lock() {
                                // The logical volume is kept through a passed-through track (where mpv's
                                // volume is the plain one), so a decoded track after it gets its boost back.
                                let next = AudioPrefs { codec: audio_codec.clone(), ..prefs.clone() };
                                let _ = update_audio(mpv, &mut prefs, next);
                            }
                        }
                        emit_for(entry, PlayerEvent::Tracks { tracks });
                    }
                    13 if prop.format == format::NODE && !prop.data.is_null() => {
                        // SAFETY: as above.
                        let list = unsafe { mpv::node_to_json(&*(prop.data as *const mpv::Node), 0) };
                        emit_for(entry, PlayerEvent::Chapters { chapters: chapters_from(&list) });
                    }
                    // An output was plugged in or removed: the chosen one may be back, or gone (then the default).
                    17 if prop.format == format::NODE && !prop.data.is_null() => {
                        // SAFETY: as above.
                        let devices = outputs::devices_from(&unsafe { mpv::node_to_json(&*(prop.data as *const mpv::Node), 0) });
                        if let Ok(mut outputs) = app.state::<PlayerState>().outputs.lock() {
                            outputs.listed(mpv, devices.clone());
                        }
                        emit_for(entry, PlayerEvent::Outputs { devices, active: audio_device.clone() });
                    }
                    18 => {
                        audio_device = (prop.format == format::STRING && !prop.data.is_null())
                            // SAFETY: STRING-format property data is a char* valid during this event.
                            .then(|| unsafe { *(prop.data as *const *const std::ffi::c_char) })
                            .filter(|text| !text.is_null())
                            // SAFETY: a NUL-terminated string owned by mpv for this event.
                            .map_or_else(|| outputs::AUTO.into(), |text| unsafe { std::ffi::CStr::from_ptr(text) }.to_string_lossy().into_owned());
                        let devices = app.state::<PlayerState>().outputs.lock().map(|o| o.devices()).unwrap_or_default();
                        emit_for(entry, PlayerEvent::Outputs { devices, active: audio_device.clone() });
                    }
                    14 => {
                        status.passthrough = prop.format == format::NODE
                            && !prop.data.is_null()
                            // SAFETY: as above.
                            && unsafe { mpv::node_to_json(&*(prop.data as *const mpv::Node), 0) }.get("format").and_then(|f| f.as_str()).is_some_and(|f| f.starts_with("spdif"));
                    }
                    _ => {}
                }
                status.buffering = paused_for_cache || seeking;
            }
            _ => {}
        }
        // A video playing keeps the screen awake; paused, at the end, stopped or sound only, it may sleep.
        #[cfg(target_os = "linux")]
        if (status.height.is_some() && !status.paused && !status.eof) != awake {
            awake = !awake;
            crate::idle_inhibit::set(awake);
        }
        if status != sent {
            // Only the ever-moving positions changed? Throttle; anything else goes out now.
            let only_time = Status { time_pos: sent.time_pos, cache_time: sent.cache_time, ..status.clone() } == sent;
            if !only_time || last_time_event.elapsed() >= TIME_EVENT_INTERVAL {
                emit_for(entry, PlayerEvent::Status(status.clone()));
                sent = status.clone();
                last_time_event = Instant::now();
            }
        }
    }
    // mpv is going away with Orbit. Closing the bus connection on exit releases the hold too.
    #[cfg(target_os = "linux")]
    if awake {
        crate::idle_inhibit::set(false);
    }
}

/// The phone remote shows the same playback state the page gets (see remote/).
fn mirror_to_remote(app: &AppHandle, event: &PlayerEvent) {
    match event {
        PlayerEvent::Status(s) => crate::remote::player_status(
            app,
            crate::remote::Playback { position: s.time_pos, duration: s.duration, paused: s.paused, buffering: s.buffering, volume: s.volume, muted: s.muted },
        ),
        PlayerEvent::Tracks { tracks } => crate::remote::player_tracks(
            app,
            tracks
                .iter()
                .map(|t| crate::remote::Track { id: t.id, audio: t.kind == "audio", title: t.title.as_deref().map(clean_label), lang: t.lang.as_deref().map(clean_label), selected: t.selected })
                .collect(),
        ),
        _ => {}
    }
}

/// Stream URLs come from addons, so only plain web addresses are played: no
/// local files, devices or mpv-specific protocols.
fn check_stream_url(url: &str) -> Result<(), String> {
    if url.len() > MAX_URL_BYTES {
        return Err("err.player.link".into());
    }
    // The URL parser skips tabs and newlines and trims spaces, but mpv gets the
    // text as it is: "ht<tab>tp://…" would pass as http yet open as a file path.
    if url.chars().any(char::is_control) || url.trim() != url {
        return Err("err.player.link".into());
    }
    // mpv reads the text, not the parsed URL: the parser takes "https:x\\..\\file"
    // as https, but without a literal "://" mpv opens it as a path on this PC.
    let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) || url.contains('\\') {
        return Err("err.player.link".into());
    }
    let parsed = tauri::Url::parse(url).map_err(|_| "err.player.link")?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("err.player.link".into()),
    }
}

/// Per-file options for a file on this PC: a download (with the subtitles
/// saved beside it) or a file dropped onto the window (`saved_subtitles` None).
/// Either may have come from anywhere (an addon, a torrent fetched elsewhere):
/// if it's really a playlist or an EDL behind a video name, it mustn't open
/// what it lists (other files on this PC, devices, `lavfi://`, addresses on
/// the LAN), so references aren't followed and playlist entries mpv deems
/// unsafe stay refused. A download's subtitles are listed exactly (mpv's own
/// search could pick up other files); a dropped file keeps that search, for
/// the subtitles the person keeps beside it.
fn local_file_options(saved_subtitles: Option<&[String]>) -> Vec<String> {
    let mut options = vec!["access-references=no".to_string(), "load-unsafe-playlists=no".to_string()];
    if let Some(subtitles) = saved_subtitles {
        options.push("sub-auto=no".to_string());
        options.extend(subtitles.iter().map(|s| format!("sub-files-append=%{}%{s}", s.len())));
    }
    options
}

// Tauri passes each command argument by name; the extra ones are injected state.
#[allow(clippy::too_many_arguments)]
// Android hands the resolved address to its own player before the mpv part (player/android.rs).
#[cfg_attr(target_os = "android", allow(unreachable_code, unused_variables, unused_mut, unused_assignments))]
#[tauri::command]
pub async fn player_open(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PlayerState>,
    db: State<'_, crate::db::Db>,
    active: State<'_, crate::profiles::ActiveProfile>,
    url: String,
    start: Option<f64>,
    volume: Option<f64>,
    muted: Option<bool>,
    subtitles: Option<bool>,
    live: Option<bool>,
    stream_headers: Option<std::collections::BTreeMap<String, String>>,
    load: u64,
) -> Result<(), String> {
    // Live TV channels arrive as `orbit-tv://source/channel`; the real address
    // holds the provider login, so it's looked up here and never seen by the page.
    // Videos from the person's own servers arrive as `orbit-jellyfin://{item}/{version}`
    // or `orbit-plex://{item}/{part}`, likewise.
    // Trailers arrive as `orbit-trailer://{youtube id}`, found with yt-dlp.
    // Downloads arrive as `orbit-download://{id}`: the page never handles file
    // paths, so a local file can only be one Orbit saved for this profile.
    // Files in the person's debrid cloud arrive as `orbit-debrid://{provider}/{item}/{file}`;
    // the signed link is made here, now, and goes only to mpv (see debrid/mod.rs).
    let run = state.opens.fetch_add(1, Ordering::SeqCst) + 1;
    // A subtitle sync for the file before is of no use any more.
    state.sync.cancel();
    state.translate.cancel();
    // A plain stream from an addon (not live TV, Jellyfin, Plex or a trailer), for subtitle sync.
    let mut web = false;
    let mut audio = None;
    let mut local = None;
    let mut dropped = false;
    // Jellyfin and Plex: the token goes as a header for this file only (see jellyfin/playback.rs, plex/playback.rs).
    // An addon's stream: the headers it asked for, likewise (see proxy_headers.rs).
    let mut headers = Vec::new();
    let mut subtitle_files = Vec::new();
    let mut vod_format = None;
    let (url, user_agent, referrer) = if url.starts_with(crate::iptv::SCHEME) && url.contains("/vod/") {
        let (source, key) = url.strip_prefix(crate::iptv::SCHEME).and_then(|r| r.split_once("/vod/")).ok_or("Invalid IPTV locator")?;
        let ext = key.rsplit_once('-').map(|(_, e)| e).ok_or("Invalid IPTV container")?;
        vod_format = Some(match ext { "mp4" | "mov" => "mov", "mkv" | "webm" => "matroska", "avi" => "avi", "ts" => "mpegts", _ => return Err("err.player.format".into()) });
        (crate::iptv::vod_proxy::address(&app, &active.id()?, source, key).await?, None, None)
    } else if url.starts_with(crate::iptv::SCHEME) {
        crate::iptv::resolve(&*db.lock()?, &active.id()?, &url)?
    } else if crate::media_server::is_address(&url) {
        let found = crate::media_server::resolve(&app, &active.id()?, &url).await?;
        headers = found.headers;
        subtitle_files = found.subtitles;
        (found.url, None, None)
    } else if url.starts_with(crate::debrid::SCHEME) {
        // Played like an addon's web stream (subtitle sync can read it); the page never sees the link.
        web = true;
        (crate::debrid::resolve(&app, &active.id()?, &url).await?, None, None)
    } else if let Some(id) = url.strip_prefix(crate::trailer::SCHEME) {
        let found = crate::trailer::find(&app, id, false).await?;
        audio = found.audio;
        (found.video, None, None)
    } else if let Some(id) = url.strip_prefix(crate::downloads::SCHEME) {
        let file = crate::downloads::resolve(&app, &active.id()?, id)?;
        let video = file.video.clone();
        local = Some(file);
        (video, None, None)
    } else if let Some(key) = url.strip_prefix(crate::local::SCHEME) {
        // A video dropped onto the window: Rust looked up and re-checked its path (see local.rs).
        dropped = true;
        (crate::local::resolve(&app.state::<crate::local::LocalFiles>(), key)?, None, None)
    } else {
        web = true;
        // An addon's own headers for its stream (see proxy_headers.rs). Set only here, so they go
        // with the address the addon gave and never with one Orbit resolved (Jellyfin, Plex, debrid…).
        if let Some(asked) = &stream_headers {
            headers = proxy_headers::header_lines(asked)?;
        }
        (url, None, None)
    };
    if local.is_none() && !dropped {
        check_stream_url(&url)?;
    }
    #[cfg(target_os = "android")]
    return {
        // The provider's user agent and referrer go as headers there.
        for (name, value) in [("User-Agent", &user_agent), ("Referer", &referrer)] {
            if let Some(v) = value.as_ref().filter(|v| !v.is_empty() && !v.chars().any(char::is_control)) {
                headers.push(format!("{name}: {v}"));
            }
        }
        headers.retain(|h| !h.chars().any(char::is_control));
        // A download's saved subtitles go with it, as contents (the player opens no other file).
        let subtitles: Vec<android::Subtitle> = local
            .iter()
            .flat_map(|file| &file.subtitles)
            .filter_map(|path| {
                let path = std::path::Path::new(path);
                let bytes = std::fs::read(path).ok().filter(|b| b.len() <= MAX_SUBTITLE_BYTES)?;
                let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                Some(android::Subtitle::new(cleaned_subtitle(&state, &bytes).ok()?, &name, None))
            })
            .collect();
        // Settings → Playback → Match the TV's refresh rate (playback.ts MATCH_RATE_KEY).
        let match_rate = db.setting("playback.match-refresh").and_then(|v| v.as_bool()).unwrap_or(false);
        // Checked again under the player's lock, so a close that came meanwhile can't be overtaken.
        let file = android::File { url: &url, headers: &headers, start, local: local.is_some(), subtitles: &subtitles, match_rate };
        android::open(&app, &file, load, || state.opens.load(Ordering::SeqCst) == run)
    };
    let media = match &local {
        Some(file) => Some(subsync::Media::File { path: file.video.clone().into(), subtitles: file.subtitles.clone() }),
        None if dropped => Some(subsync::Media::File { path: url.clone().into(), subtitles: Vec::new() }),
        None if web => Some(subsync::Media::Web(url.clone())),
        None => None,
    };
    if state.opens.load(Ordering::SeqCst) != run {
        return Ok(());
    }
    let mpv = state.mpv(&app)?;
    // A skip's dip from the file before doesn't carry into this one.
    state.dip.restore(&mpv);
    // Applied before loading, so a saved volume is in effect from the first sound.
    if let Some(v) = volume {
        let mut prefs = state.audio.lock().map_err(|_| "player unavailable")?;
        set_volume_with_audio(&mpv, &mut prefs, check_volume(v, max_volume(&state))?)?;
    }
    if let Some(m) = muted {
        mpv.set_property("mute", if m { "yes" } else { "no" })?;
    }
    // Per-file options; `%len%value` quotes values that may contain commas.
    let mut options = Vec::new();
    if let Some(format) = vod_format {
        // Pin the binary demuxer: a provider cannot disguise a remote playlist as a movie.
        options.push("demuxer=lavf".to_string());
        options.push(format!("demuxer-lavf-format={format}"));
    }
    // Subtitles hidden with the Subtitles key (V) show again in the next file.
    options.push("sub-visibility=yes".to_string());
    // Settings → Playback → Rewind cache: fixed presets only, not for a live channel (see rewind_cache.rs).
    let cache = active.id().ok().and_then(|id| db.setting(&rewind_cache::key(&id)));
    for (name, value) in rewind_cache::options(cache.as_ref(), live == Some(true)) {
        options.push(format!("{name}={value}"));
    }
    if let Some(s) = start.filter(|s| s.is_finite() && *s > 0.0) {
        options.push(format!("start={s:.3}"));
    }
    // Off for this file only: no subtitle track is picked automatically. Otherwise mpv picks by the
    // subtitle languages: it keeps a subtitle turned off ("sid=no") for every file after, which
    // the page's own picks (the title's remembered choice, the preferred languages) don't expect.
    let sid = if subtitles == Some(false) { "sid=no" } else { "sid=auto" };
    options.push(sid.to_string());
    // YouTube sends the best picture and sound separately.
    if let Some(a) = audio {
        options.push(format!("audio-files-append=%{}%{a}", a.len()));
    }
    if let Some(file) = &local {
        options.extend(local_file_options(Some(&file.subtitles)));
    } else if dropped {
        options.extend(local_file_options(None));
    }
    // `-append` adds each as one entry, so commas inside a value are kept.
    for header in headers.iter().filter(|h| !h.chars().any(char::is_control)) {
        options.push(format!("http-header-fields-append=%{}%{header}", header.len()));
    }
    for s in subtitle_files.iter().filter(|s| check_stream_url(s).is_ok()) {
        options.push(format!("sub-files-append=%{}%{s}", s.len()));
    }
    for (name, value) in [("user-agent", user_agent), ("referrer", referrer)] {
        if let Some(v) = value.filter(|v| !v.is_empty() && !v.chars().any(char::is_control)) {
            options.push(format!("{name}=%{}%{v}", v.len()));
        }
    }
    let mut current = state.current.lock().map_err(|_| "player unavailable")?;
    // Overtaken while waiting for the lock: the newer open plays, not this one.
    if state.opens.load(Ordering::SeqCst) != run {
        return Ok(());
    }
    // Only now: an open overtaken by closing the player would otherwise leave the page see-through after it.
    window.set_background_color(Some(TRANSPARENT)).map_err(|e| e.to_string())?;
    state.signed_in.store(!headers.is_empty(), Ordering::SeqCst);
    *state.media.lock().map_err(|_| "player unavailable")? = media;
    mpv.loadfile(&url, "replace", &options.join(","))?;
    // Unpaused only once the new file is asked for. Played to its end, the file before sits paused
    // there (`keep-open`), and unpausing a file at its end pauses it again: `pause` then carried into
    // this one, and the next episode opened paused at 0:00. The page's own pause for this file
    // (asked for while it was being found) comes after this, so it still holds. With the window
    // hidden in the tray it stays paused: unpausing would play it where nobody sees it.
    mpv.set_property("pause", if state.opens_paused() { "yes" } else { "no" })?;
    // `replace` puts the new file last in the playlist; its id marks its events.
    let last = mpv.get_string("playlist-count").and_then(|n| n.parse::<i64>().ok()).filter(|n| *n > 0);
    let id = last.and_then(|n| mpv.get_string(&format!("playlist/{}/id", n - 1))).and_then(|id| id.parse().ok());
    *current = id.map(|id| (id, load));
    Ok(())
}

#[tauri::command]
pub async fn player_set_paused(app: AppHandle, state: State<'_, PlayerState>, paused: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return {
        let _ = (app, state);
        android::set_paused(paused)
    };
    #[cfg(not(target_os = "android"))]
    state.mpv(&app)?.set_property("pause", if paused { "yes" } else { "no" })
}

/// Seeks to `seconds`, or by `seconds` (which may be negative) when `relative`.
#[tauri::command]
pub async fn player_seek(app: AppHandle, state: State<'_, PlayerState>, seconds: f64, relative: Option<bool>) -> Result<(), String> {
    let relative = relative.unwrap_or(false);
    if !seconds.is_finite() || (!relative && seconds < 0.0) {
        return Err("invalid position".into());
    }
    #[cfg(target_os = "android")]
    return {
        let _ = (app, state);
        android::seek(seconds, relative)
    };
    // Relative jumps (±10 s, "What did they say?") are exact: by default mpv lands on
    // the nearest keyframe, which on some streams is 20+ seconds away.
    #[cfg(not(target_os = "android"))]
    state.mpv(&app)?.command(&["seek", &format!("{seconds:.3}"), if relative { "relative+exact" } else { "absolute" }])
}

/// Legacy toggle ceiling; native mpv volume itself stays at or below 100.
const BOOSTED_MAX: f64 = 150.0;

fn max_volume(state: &PlayerState) -> f64 {
    f64::from(state.boost.load(Ordering::SeqCst))
}

fn check_volume(volume: f64, max: f64) -> Result<f64, String> {
    if volume.is_finite() && (0.0..=max).contains(&volume) { Ok(volume) } else { Err("invalid volume".into()) }
}

#[tauri::command]
pub async fn player_set_volume(app: AppHandle, state: State<'_, PlayerState>, volume: f64) -> Result<(), String> {
    let mpv = state.mpv(&app)?;
    let mut prefs = state.audio.lock().map_err(|_| "player unavailable")?;
    set_volume_with_audio(&mpv, &mut prefs, check_volume(volume, max_volume(&state))?)
}

/// Compatibility with the original 150% toggle.
#[tauri::command]
pub async fn player_set_volume_boost(app: AppHandle, state: State<'_, PlayerState>, on: bool) -> Result<(), String> {
    player_set_volume_boost_level(app, state, if on { BOOSTED_MAX as u16 } else { 100 }).await
}

fn check_boost_level(level: u16) -> Result<u16, String> {
    if [100, 125, 150, 200].contains(&level) { Ok(level) } else { Err("invalid volume boost level".into()) }
}

#[tauri::command]
pub async fn player_set_volume_boost_level(app: AppHandle, state: State<'_, PlayerState>, level: u16) -> Result<(), String> {
    let level = check_boost_level(level)?;
    let mpv = state.mpv(&app)?;
    let mut prefs = state.audio.lock().map_err(|_| "player unavailable")?;
    // mpv applies volume after af. Keep that stage attenuation-only: actual
    // amplification belongs before the limiter, so it cannot undo the ceiling.
    mpv.set_property("volume-max", "100")?;
    // The preset is a ceiling: the volume stays, brought down only to a lower one.
    let next = AudioPrefs { boost_level: level, volume: prefs.volume.min(f64::from(level)), ..prefs.clone() };
    update_audio(&mpv, &mut prefs, next)?;
    state.boost.store(u32::from(level), Ordering::SeqCst);
    Ok(())
}

/// Settings → Video → HDR output. On, mpv always tags its output with the
/// video's colours (`target-colorspace-hint=yes`), so with Windows HDR on an
/// HDR film reaches the display as HDR instead of tone-mapped to SDR. Off is
/// mpv's own default (`auto`), what Orbit has always used: it only sets the
/// output colours when it knows the display's. Off by default, because on an
/// SDR display (or with Windows HDR off) forcing it can wash colours out.
///
/// The video output (`vo`) is left as mpv chooses: changing it would recreate
/// the video window that Orbit keeps beneath the page (see surface.rs). The
/// hint needs `gpu-next`, mpv's default output in recent versions; with
/// another output mpv ignores it.
#[tauri::command]
pub async fn player_set_hdr(app: AppHandle, state: State<'_, PlayerState>, on: bool) -> Result<(), String> {
    let result = state.mpv(&app)?.set_property("target-colorspace-hint", hdr_hint(on));
    // An mpv without the option can't be in HDR mode, so "off" is already true.
    if on { result } else { Ok(()) }
}

/// The only two values Orbit ever sets for `target-colorspace-hint`.
const fn hdr_hint(on: bool) -> &'static str {
    if on { "yes" } else { "auto" }
}

/// How bright white subtitles are in an HDR picture with Settings → Picture &
/// Sound → Softer subtitles in HDR on, in nits. mpv's default (`sdr`) is 203,
/// the reference white for graphics in HDR (ITU-R BT.2408): in a dark scene on
/// a bright HDR TV that glares. 100 is SDR's own peak, as bright as subtitles
/// look in an SDR film, and still clear over bright scenes.
const HDR_SUBTITLE_NITS: &str = "100";
/// Text subtitles (and mpv's OSD, unused here) and picture-based ones (PGS, VobSub).
const HDR_SUBTITLE_OPTIONS: [&str; 2] = ["sub-hdr-peak", "image-subs-hdr-peak"];

/// Settings → Picture & Sound → Softer subtitles in HDR (on by default). Only
/// HDR output uses these options (with "Play HDR videos in HDR" on and an HDR
/// video; `gpu-next`, mpv's default output): an SDR video or a tone-mapped
/// HDR one is drawn as before. `blend-subtitles` isn't used: it would also tone
/// down subtitles, but draws them inside the picture, so they could no longer
/// sit in the black bars under a wide film.
#[tauri::command]
pub async fn player_set_hdr_subtitles(app: AppHandle, state: State<'_, PlayerState>, on: bool) -> Result<(), String> {
    let mpv = state.mpv(&app)?;
    for name in HDR_SUBTITLE_OPTIONS {
        // An mpv without the option (older than 0.39, e.g. a Linux distribution's) has nothing to soften.
        let Some(default) = mpv.get_string(&format!("option-info/{name}/default-value")) else { continue };
        mpv.set_property(name, if on { HDR_SUBTITLE_NITS } else { &default })?;
    }
    Ok(())
}

/// What Settings → Picture & Sound → Smooth motion sets. `display-resample`
/// times frames to the display's refresh (nudging the speed and resampling
/// the sound by a fraction of a percent), and `interpolation` blends
/// neighbouring frames where the frame rate and refresh still don't divide
/// evenly (24 fps on 60 Hz), so pans don't judder. `oversample` is mpv's own
/// `tscale` and the sharpest: it only blends at the moment a frame changes,
/// so films don't take on the "soap opera" look of TV motion smoothing.
const SMOOTH_MOTION: &[(&str, &str)] = &[("video-sync", "display-resample"), ("interpolation", "yes"), ("tscale", "oversample")];

/// Settings → Picture & Sound → Smooth motion, per profile and off by default:
/// rendering more frames costs GPU time, and on a weak GPU it can drop frames
/// instead. Off puts back mpv's own default for each option. mpv applies
/// both ways while a video plays.
#[tauri::command]
pub async fn player_set_smooth_motion(app: AppHandle, state: State<'_, PlayerState>, on: bool) -> Result<(), String> {
    let mpv = state.mpv(&app)?;
    for (name, value) in SMOOTH_MOTION {
        let value = if on { (*value).to_owned() } else { mpv.get_string(&format!("option-info/{name}/default-value")).ok_or("mpv option missing")? };
        mpv.set_property(name, &value)?;
    }
    Ok(())
}

/// Shows or hides subtitles (whatever track is chosen) and returns whether they now show.
#[tauri::command]
pub async fn player_toggle_subtitles(app: AppHandle, state: State<'_, PlayerState>) -> Result<bool, String> {
    let mpv = state.mpv(&app)?;
    mpv.command(&["cycle", "sub-visibility"])?;
    Ok(mpv.get_string("sub-visibility").as_deref() == Some("yes"))
}

/// Shows or hides subtitles without changing the track ("What did they say?" shows ones the
/// Subtitles key hid, then hides them again). Says whether they were showing before.
#[tauri::command]
pub async fn player_set_subtitles_visible(app: AppHandle, state: State<'_, PlayerState>, visible: bool) -> Result<bool, String> {
    let mpv = state.mpv(&app)?;
    let was = mpv.get_string("sub-visibility").as_deref() == Some("yes");
    mpv.set_property("sub-visibility", if visible { "yes" } else { "no" })?;
    Ok(was)
}

#[tauri::command]
pub async fn player_set_muted(app: AppHandle, state: State<'_, PlayerState>, muted: bool) -> Result<(), String> {
    state.mpv(&app)?.set_property("mute", if muted { "yes" } else { "no" })
}

#[cfg_attr(target_os = "android", allow(unreachable_code))]
#[tauri::command]
pub async fn player_stop(window: WebviewWindow, state: State<'_, PlayerState>) -> Result<(), String> {
    state.opens.fetch_add(1, Ordering::SeqCst);
    state.sync.cancel();
    state.translate.cancel();
    *state.media.lock().map_err(|_| "player unavailable")? = None;
    // Whatever was playing says nothing more to the page.
    *state.current.lock().map_err(|_| "player unavailable")? = None;
    #[cfg(target_os = "android")]
    return {
        let _ = window;
        android::stop()
    };
    // Nothing to stop if mpv was never started.
    let mpv = state.engine.lock().map_err(|_| "player unavailable")?.as_ref().map(|e| e.mpv.clone());
    if let Some(mpv) = mpv {
        state.dip.restore(&mpv);
        // Stopping also closes mpv's video window.
        mpv.command(&["stop"])?;
    }
    window.set_background_color(Some(OPAQUE)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn player_set_speed(app: AppHandle, state: State<'_, PlayerState>, speed: f64) -> Result<(), String> {
    if !speed.is_finite() || !(0.25..=4.0).contains(&speed) {
        return Err("invalid speed".into());
    }
    state.mpv(&app)?.set_property("speed", &format!("{speed:.2}"))
}

/// How subtitles look (Settings → Audio & Subtitles). mpv draws them, so
/// these become mpv properties; styled (ASS) subtitles keep their own look.
#[derive(serde::Deserialize)]
pub struct SubtitleStyle {
    /// mpv's scale: 55 is its default at 720p.
    size: u32,
    /// "#rrggbb".
    color: String,
    /// The text's opacity in percent (see sub_colors.rs); absent in styles saved before it could be set.
    #[serde(default = "sub_colors::opacity_default")]
    opacity: u32,
    /// "none", "shadow" or "box".
    background: String,
    /// The box's "#rrggbb" and opacity in percent.
    #[serde(rename = "backColor", default = "sub_colors::black")]
    back_color: String,
    #[serde(rename = "backOpacity", default = "sub_colors::back_opacity_default")]
    back_opacity: u32,
    /// Outline thickness, 0 for none.
    outline: u32,
    /// The outline's "#rrggbb".
    #[serde(rename = "outlineColor", default = "sub_colors::black")]
    outline_color: String,
    /// Vertical position: 100 is the bottom, lower is higher up.
    position: u32,
    bold: bool,
    /// Plain text subtitles Orbit adds lose their placement tags (see placement.rs).
    #[serde(rename = "keepBottom", default = "keep_bottom_default")]
    keep_bottom: bool,
    /// One of `sub_font`'s ids; absent in styles saved before fonts could be chosen.
    #[serde(default)]
    font: String,
}

const fn keep_bottom_default() -> bool {
    true
}

/// mpv's `sub-font` for a font id from the page: the family name of one of
/// the bundled subtitle fonts (see `FONTS_DIR`), or mpv's own default.
/// Only these names ever reach mpv, never a free-form one from the page.
fn sub_font(id: &str) -> Result<&'static str, String> {
    match id {
        "" | "default" => Ok("sans-serif"),
        "atkinson" => Ok("Atkinson Hyperlegible"),
        "lexend" => Ok("Lexend"),
        "opendyslexic" => Ok("OpenDyslexic"),
        "arimo" => Ok("Arimo"),
        _ => Err("invalid subtitle font".into()),
    }
}

fn check_hex(color: &str) -> Result<(), String> {
    let ok = color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if ok { Ok(()) } else { Err("invalid colour".into()) }
}

/// `sub-pos` for the bottom of the picture, and the highest subtitles go (half way up).
const SUB_POS_BOTTOM: u32 = 100;
const SUB_POS_HIGHEST: u32 = 50;
/// The most subtitles are raised for the controls, in percent of the window's height.
const MAX_LIFT: u32 = 30;

/// `sub-pos` with subtitles raised `lift` percent above the bottom for the
/// controls: the person's own position if that's higher already, never above
/// the highest they could pick themselves.
fn lifted_position(position: u32, lift: u32) -> u32 {
    position.min(SUB_POS_BOTTOM.saturating_sub(lift)).max(SUB_POS_HIGHEST)
}

/// While the player's controls cover the bottom of the picture, subtitles are
/// raised `lift` percent of the window's height so the bar doesn't hide them;
/// 0 puts them back where the person's style has them. The page measures the
/// controls; only the number reaches mpv, kept within `MAX_LIFT`.
#[tauri::command]
pub async fn player_lift_subtitles(app: AppHandle, state: State<'_, PlayerState>, lift: u32) -> Result<(), String> {
    if lift > MAX_LIFT {
        return Err("invalid subtitle lift".into());
    }
    state.sub_lift.store(lift, Ordering::SeqCst);
    // Android's player screen draws its own controls and subtitles.
    #[cfg(target_os = "android")]
    return {
        let _ = app;
        Ok(())
    };
    #[cfg(not(target_os = "android"))]
    state.mpv(&app)?.set_property("sub-pos", &lifted_position(state.sub_position.load(Ordering::SeqCst), lift).to_string())
}

#[tauri::command]
pub async fn player_set_subtitle_style(app: AppHandle, state: State<'_, PlayerState>, style: SubtitleStyle) -> Result<(), String> {
    check_hex(&style.color)?;
    let text_color = sub_colors::text(&style.color, style.opacity)?;
    let back_color = sub_colors::with_opacity(&style.back_color, style.back_opacity)?;
    let outline_color = sub_colors::with_opacity(&style.outline_color, 100)?;
    if !(20..=120).contains(&style.size) || style.outline > 6 || !(50..=100).contains(&style.position) {
        return Err("invalid subtitle style".into());
    }
    let (border_style, shadow) = match style.background.as_str() {
        "none" => ("outline-and-shadow", "0"),
        "shadow" => ("outline-and-shadow", "2"),
        "box" => ("background-box", "0"),
        _ => return Err("invalid subtitle background".into()),
    };
    let font = sub_font(&style.font)?;
    state.keep_bottom.store(style.keep_bottom, Ordering::SeqCst);
    state.sub_position.store(style.position, Ordering::SeqCst);
    #[cfg(target_os = "android")]
    return {
        let _ = (app, font, border_style, shadow, text_color, back_color, outline_color);
        android::set_subtitle_style(style.size, &style.color, &style.background, style.outline, style.position, style.bold)
    };
    #[cfg(not(target_os = "android"))]
    {
        let mpv = state.mpv(&app)?;
        mpv.set_property("sub-font", font)?;
        mpv.set_property("sub-font-size", &style.size.to_string())?;
        mpv.set_property("sub-color", &text_color)?;
        mpv.set_property("sub-bold", if style.bold { "yes" } else { "no" })?;
        // Still clear of the controls if they're showing (see `player_lift_subtitles`).
        mpv.set_property("sub-pos", &lifted_position(style.position, state.sub_lift.load(Ordering::SeqCst)).to_string())?;
        mpv.set_property("sub-border-size", &style.outline.to_string())?;
        mpv.set_property("sub-border-color", &outline_color)?;
        mpv.set_property("sub-shadow-offset", shadow)?;
        mpv.set_property("sub-shadow-color", "#99000000")?;
        mpv.set_property("sub-back-color", &back_color)?;
        mpv.set_property("sub-border-style", border_style)
    }
}

/// mpv's `sub-ass-override` for the subtitle showing, from a fixed list:
/// "strip" keeps plain text subtitles at `sub-pos` whatever placement tags
/// their lines carry (`{\an8}`; it drops their italics too), "scale" (mpv's
/// default) leaves tags as written. The page picks per track codec, so styled
/// ASS/SSA subtitles always get "scale".
fn ass_override(mode: &str) -> Result<&'static str, String> {
    match mode {
        "strip" => Ok("strip"),
        "scale" => Ok("scale"),
        _ => Err("invalid subtitle override".into()),
    }
}

#[tauri::command]
pub async fn player_set_subtitle_override(app: AppHandle, state: State<'_, PlayerState>, mode: String) -> Result<(), String> {
    let mode = ass_override(&mode)?;
    state.mpv(&app)?.set_property("sub-ass-override", mode)
}

/// "Even out volume" (Settings) lifts quiet dialogue and tames loud scenes
/// with mpv's dynamic normaliser. The player's Sound view picks one of night
/// mode or a preset (see `Sound`). The page only names it: the filter strings
/// are fixed here, never ones from the page.
#[tauri::command]
pub async fn player_set_audio(app: AppHandle, state: State<'_, PlayerState>, normalize: bool, sound: String) -> Result<(), String> {
    let sound = Sound::parse(&sound)?;
    let mpv = state.mpv(&app)?;
    let mut prefs = state.audio.lock().map_err(|_| "player unavailable")?;
    (prefs.normalize, prefs.sound) = (normalize, sound);
    apply_audio(&mpv, &prefs)
}

/// Night mode and the sound presets, one at a time.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Sound {
    #[default]
    Off,
    /// Mixes down to stereo, which keeps the centre (dialogue) channel, and
    /// compresses peaks so explosions don't wake anyone.
    Night,
    /// A fuller low end and a little air on top, for films at a good volume.
    Cinema,
    /// A gentle "smile" curve (low and high shelves) for concerts and musicals.
    Music,
    /// Lifts the speech band (around 2–3 kHz), trims rumble below it and evens
    /// out levels a little, so voices stand out over music and effects.
    Dialogue,
}

impl Sound {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "off" => Ok(Self::Off),
            "night" => Ok(Self::Night),
            "cinema" => Ok(Self::Cinema),
            "music" => Ok(Self::Music),
            "dialogue" => Ok(Self::Dialogue),
            _ => Err("unknown sound mode".into()),
        }
    }

    /// The `af` entry for this mode. Boosting presets end in a limiter so the
    /// added gain can't clip.
    const fn filter(self) -> Option<&'static str> {
        match self {
            Self::Off => None,
            Self::Night => Some("lavfi=[acompressor=threshold=0.05:ratio=6:attack=5:release=300:makeup=3]"),
            Self::Cinema => Some("lavfi=[bass=g=4:f=90:w=0.7,treble=g=1.5:f=9000,alimiter=limit=0.95]"),
            Self::Music => Some("lavfi=[bass=g=3:f=110:w=0.7,treble=g=2.5:f=8000,alimiter=limit=0.95]"),
            Self::Dialogue => Some("lavfi=[highpass=f=90,equalizer=f=2500:t=q:w=1.2:g=5,acompressor=threshold=0.1:ratio=3:attack=10:release=250:makeup=1.5,alimiter=limit=0.95]"),
        }
    }
}

/// The sound settings, and the codec of the audio track playing.
#[derive(Clone)]
struct AudioPrefs {
    /// The chosen ceiling (100, 125, 150 or 200).
    boost_level: u16,
    /// The volume the boost stage's gain is for: 100 (no gain) up to 100, else the ceiling (see `boost_for`).
    boost_volume: f64,
    /// The logical volume last applied (0 up to the ceiling), as the page sees it.
    volume: f64,
    normalize: bool,
    sound: Sound,
    /// Formats passed through to a receiver (a subset of `PASSTHROUGH_FORMATS`).
    passthrough: Vec<&'static str>,
    /// mpv's name for the playing audio track's codec ("eac3", "truehd", ...).
    codec: Option<String>,
}

impl Default for AudioPrefs {
    fn default() -> Self {
        Self { boost_level: 100, boost_volume: 100.0, volume: 100.0, normalize: false, sound: Sound::default(), passthrough: Vec::new(), codec: None }
    }
}

fn volume_scale(prefs: &AudioPrefs) -> f64 {
    if passes_through(&prefs.passthrough, prefs.codec.as_deref()) { 1.0 } else { prefs.boost_volume / 100.0 }
}

fn native_volume(volume: f64, prefs: &AudioPrefs) -> f64 {
    (volume / volume_scale(prefs)).min(100.0)
}

/// The boost stage for a logical `volume`: none up to 100, then the ceiling's
/// gain, fixed, with mpv's volume (after the limiter) bringing it down to the
/// step asked for. So a step above 100 changes only mpv's volume, and the
/// filters (the boost's limiter, the normaliser's and presets' state) aren't
/// rebuilt on every step; only crossing 100 or another ceiling rebuilds them.
fn boost_for(volume: f64, level: u16) -> f64 {
    if volume > 100.0 { f64::from(level).max(volume) } else { 100.0 }
}

fn set_logical_volume(mpv: &Mpv, prefs: &AudioPrefs, volume: f64) -> Result<(), String> {
    mpv.set_property("volume", &format!("{:.6}", native_volume(volume, prefs)))
}

/// Settings → Audio & Subtitles → Audio passthrough: the formats mpv may send
/// undecoded (`audio-spdif`) for a receiver or soundbar to decode. Fixed names,
/// never text from the page. ("dts" with "dts-hd" means "dts-hd" to mpv.)
const PASSTHROUGH_FORMATS: &[&str] = &["ac3", "eac3", "dts", "dts-hd", "truehd"];

/// The page's list, checked against the allowlist, in a fixed order, without repeats.
fn check_passthrough(formats: &[String]) -> Result<Vec<&'static str>, String> {
    if formats.len() > PASSTHROUGH_FORMATS.len() || formats.iter().any(|f| !PASSTHROUGH_FORMATS.contains(&f.as_str())) {
        return Err("invalid passthrough formats".into());
    }
    Ok(PASSTHROUGH_FORMATS.iter().copied().filter(|p| formats.iter().any(|f| f == p)).collect())
}

/// Whether a track in `codec` (mpv's codec name) goes through undecoded with these formats.
/// DTS-HD tracks are "dts" to mpv; with either DTS choice their core at least passes.
fn passes_through(formats: &[&str], codec: Option<&str>) -> bool {
    match codec {
        Some("dts") => formats.contains(&"dts") || formats.contains(&"dts-hd"),
        Some(c @ ("ac3" | "eac3" | "truehd")) => formats.contains(&c),
        _ => false,
    }
}

/// mpv's `audio-channels` and `af` for these settings. Passed-through audio
/// isn't decoded, so nothing can filter it: volume levelling, night mode and
/// the presets stand down while it plays (mpv would fail and disable the filters anyway),
/// and come back for a track that's decoded.
fn audio_options(prefs: &AudioPrefs) -> (&'static str, String) {
    if passes_through(&prefs.passthrough, prefs.codec.as_deref()) {
        return ("auto-safe", String::new());
    }
    let mut filters = Vec::new();
    if prefs.normalize {
        filters.push("lavfi=[dynaudnorm=f=250:g=15]".to_string());
    }
    filters.extend(prefs.sound.filter().map(str::to_string));
    if prefs.boost_volume > 100.0 {
        let gain = (prefs.boost_volume / 100.0).powi(3);
        filters.push(format!("lavfi=[volume={gain:.6},alimiter=limit=0.95:level=false]"));
    }
    (if prefs.sound == Sound::Night { "stereo" } else { "auto-safe" }, filters.join(","))
}

fn set_volume_with_audio(mpv: &Mpv, prefs: &mut AudioPrefs, volume: f64) -> Result<(), String> {
    let next = AudioPrefs { volume, ..prefs.clone() };
    update_audio(mpv, prefs, next)
}

/// Moves mpv from `prefs` to `next` (its boost stage worked out here), then keeps
/// `next`. Only the volume changes when the filters stay the same; otherwise
/// they're rebuilt in the order that can't clip. If mpv refuses, `prefs` is put back.
fn update_audio(mpv: &Mpv, prefs: &mut AudioPrefs, mut next: AudioPrefs) -> Result<(), String> {
    next.boost_volume = boost_for(next.volume, next.boost_level);
    let result = if audio_options(&next) == audio_options(prefs) { set_logical_volume(mpv, &next, next.volume) } else { reconfigure_audio(mpv, prefs, &next) };
    if let Err(error) = result {
        let _ = apply_audio(mpv, prefs);
        let _ = set_logical_volume(mpv, prefs, prefs.volume);
        return Err(error);
    }
    *prefs = next;
    Ok(())
}

/// Lower post-filter volume before raising filter gain; remove gain before
/// raising post-filter volume. Reversing either transition could briefly clip.
fn reconfigure_audio(mpv: &Mpv, previous: &AudioPrefs, next: &AudioPrefs) -> Result<(), String> {
    if volume_scale(next) > volume_scale(previous) {
        set_logical_volume(mpv, next, next.volume)?;
        apply_audio(mpv, next)
    } else {
        apply_audio(mpv, next)?;
        set_logical_volume(mpv, next, next.volume)
    }
}

fn apply_audio(mpv: &Mpv, prefs: &AudioPrefs) -> Result<(), String> {
    let (channels, filters) = audio_options(prefs);
    mpv.set_property("audio-channels", channels)?;
    mpv.set_property("af", &filters)
}

/// Sets the formats passed through (empty: off, mpv decodes everything).
/// Applies from the next file, or the next audio track change. On Windows mpv
/// opens the device in exclusive mode by itself for passthrough (WASAPI only
/// carries undecoded audio that way), so `audio-exclusive` isn't needed.
#[tauri::command]
pub async fn player_set_passthrough(app: AppHandle, state: State<'_, PlayerState>, formats: Vec<String>) -> Result<(), String> {
    let formats = check_passthrough(&formats)?;
    let mpv = state.mpv(&app)?;
    mpv.set_property("audio-spdif", &formats.join(","))?;
    let mut prefs = state.audio.lock().map_err(|_| "player unavailable")?;
    let next = AudioPrefs { passthrough: formats, ..prefs.clone() };
    update_audio(&mpv, &mut prefs, next)
}

/// Audio or subtitle timing, in seconds (positive = later), for releases
/// that are out of sync.
#[tauri::command]
pub async fn player_set_delay(app: AppHandle, state: State<'_, PlayerState>, kind: String, seconds: f64) -> Result<(), String> {
    let property = match kind.as_str() {
        "audio" => "audio-delay",
        "sub" => "sub-delay",
        _ => return Err("unknown delay".into()),
    };
    if !seconds.is_finite() || seconds.abs() > 30.0 {
        return Err("invalid delay".into());
    }
    state.mpv(&app)?.set_property(property, &format!("{seconds:.3}"))
}

/// The picture's shape: an aspect ratio override, and how it fits the window
/// ("fit" with bars, "fill" cropping the bars, or "stretch").
#[tauri::command]
pub async fn player_set_picture(app: AppHandle, state: State<'_, PlayerState>, aspect: String, fit: String) -> Result<(), String> {
    if !["no", "16:9", "4:3", "21:9", "2.39:1", "1.85:1"].contains(&aspect.as_str()) {
        return Err("invalid aspect ratio".into());
    }
    let (panscan, keepaspect) = match fit.as_str() {
        "fit" => ("0", "yes"),
        "fill" => ("1", "yes"),
        "stretch" => ("0", "no"),
        _ => return Err("invalid fit".into()),
    };
    let mpv = state.mpv(&app)?;
    mpv.set_property("video-aspect-override", &aspect)?;
    mpv.set_property("panscan", panscan)?;
    mpv.set_property("keepaspect", keepaspect)
}

/// Picture adjustments (Settings → Video, and the player's Playback &
/// picture panel): mpv's equalizer properties, each -100..100 (0 is the
/// picture as the file has it). Checked here, so only whole numbers in
/// mpv's range ever reach it.
fn check_equalizer(values: [i64; 4]) -> Result<[i64; 4], String> {
    if values.iter().all(|v| (-100..=100).contains(v)) { Ok(values) } else { Err("invalid picture adjustment".into()) }
}

#[tauri::command]
pub async fn player_set_equalizer(app: AppHandle, state: State<'_, PlayerState>, brightness: i64, contrast: i64, saturation: i64, gamma: i64) -> Result<(), String> {
    let [brightness, contrast, saturation, gamma] = check_equalizer([brightness, contrast, saturation, gamma])?;
    let mpv = state.mpv(&app)?;
    mpv.set_property("brightness", &brightness.to_string())?;
    mpv.set_property("contrast", &contrast.to_string())?;
    mpv.set_property("saturation", &saturation.to_string())?;
    mpv.set_property("gamma", &gamma.to_string())
}

/// Every option a picture quality preset may change. "Balanced" puts each
/// back to this mpv's own default (read from `option-info`), so it is exactly
/// what Orbit did before the presets existed.
const QUALITY_OPTIONS: &[&str] = &[
    "scale",
    "cscale",
    "dscale",
    "dither",
    "deband",
    "correct-downscaling",
    "linear-downscaling",
    "sigmoid-upscaling",
    "scale-antiring",
    "hdr-compute-peak",
    "allow-delayed-peak-detect",
    "hdr-peak-percentile",
    "hdr-contrast-recovery",
];

/// Settings → Video → Picture quality: the options each preset sets, from a
/// fixed list (the page only names a preset). "fast" is mpv's built-in
/// `fast` profile plus bilinear chroma and no debanding; "high" is its
/// `high-quality` profile plus debanding and sharper chroma and downscaling,
/// for a dedicated GPU. `None` means "balanced": mpv's defaults.
fn quality_options(preset: &str) -> Result<Option<&'static [(&'static str, &'static str)]>, String> {
    match preset {
        "balanced" => Ok(None),
        "fast" => Ok(Some(&[
            ("scale", "bilinear"),
            ("cscale", "bilinear"),
            ("dscale", "bilinear"),
            ("dither", "no"),
            ("deband", "no"),
            ("correct-downscaling", "no"),
            ("linear-downscaling", "no"),
            ("sigmoid-upscaling", "no"),
            ("hdr-compute-peak", "no"),
            ("allow-delayed-peak-detect", "yes"),
        ])),
        "high" => Ok(Some(&[
            ("scale", "ewa_lanczossharp"),
            ("cscale", "ewa_lanczossharp"),
            ("dscale", "mitchell"),
            ("scale-antiring", "0.6"),
            ("deband", "yes"),
            ("correct-downscaling", "yes"),
            ("linear-downscaling", "yes"),
            ("sigmoid-upscaling", "yes"),
            ("hdr-peak-percentile", "99.995"),
            ("hdr-contrast-recovery", "0.30"),
        ])),
        _ => Err("invalid picture quality".into()),
    }
}

/// Applies a picture quality preset. mpv's renderer takes these while a
/// video plays, so a change shows at once. Every option starts from mpv's
/// default, so switching presets never leaves one of another's behind.
#[tauri::command]
pub async fn player_set_quality(app: AppHandle, state: State<'_, PlayerState>, preset: String) -> Result<(), String> {
    let options = quality_options(&preset)?;
    let mpv = state.mpv(&app)?;
    for name in QUALITY_OPTIONS {
        if let Some(default) = mpv.get_string(&format!("option-info/{name}/default-value")) {
            mpv.set_property(name, &default)?;
        }
    }
    for (name, value) in options.unwrap_or_default() {
        mpv.set_property(name, value)?;
    }
    Ok(())
}

/// One frame on, or back (`.` and `,` while paused). mpv pauses on the frame it
/// lands on and reports the new position itself; the command names are fixed here.
#[tauri::command]
pub async fn player_frame_step(app: AppHandle, state: State<'_, PlayerState>, back: bool) -> Result<(), String> {
    state.mpv(&app)?.command(&[if back { "frame-back-step" } else { "frame-step" }])
}

/// Jumps to the next (1) or previous (-1) chapter.
#[tauri::command]
pub async fn player_chapter(app: AppHandle, state: State<'_, PlayerState>, step: i64) -> Result<(), String> {
    if step != 1 && step != -1 {
        return Err("invalid chapter step".into());
    }
    state.mpv(&app)?.command(&["add", "chapter", &step.to_string()])
}

/// Language lists for mpv's `alang`/`slang`: comma-separated codes like
/// "fr,fre,fra" or regional "pt-br" / "zh-hant" (or empty). Checked because
/// they come from the page; 256 bytes fits five languages with every variant.
fn check_languages(list: &str) -> Result<(), String> {
    let plain = |part: &str, len: std::ops::RangeInclusive<usize>, ok: fn(&u8) -> bool| len.contains(&part.len()) && part.bytes().all(|b| ok(&b));
    let code = |code: &str| match code.split_once('-') {
        Some((lang, region)) => plain(lang, 2..=3, u8::is_ascii_lowercase) && plain(region, 2..=4, |b| b.is_ascii_lowercase() || b.is_ascii_digit()),
        None => plain(code, 2..=3, u8::is_ascii_lowercase),
    };
    let ok = list.len() <= 256 && (list.is_empty() || list.split(',').all(code));
    if ok { Ok(()) } else { Err("invalid language list".into()) }
}

/// Settings → Audio & Subtitles: which audio and subtitle tracks mpv picks
/// by itself in each file; empty leaves it to the file's defaults.
#[tauri::command]
/// `forced_only`: when the audio is already in the subtitle language, show
/// only forced subtitles (signs, foreign-language lines).
pub async fn player_set_languages(app: AppHandle, state: State<'_, PlayerState>, audio: String, subtitle: String, forced_only: bool) -> Result<(), String> {
    check_languages(&audio)?;
    check_languages(&subtitle)?;
    #[cfg(target_os = "android")]
    return {
        let _ = (app, state, forced_only);
        android::set_languages(&audio, &subtitle)
    };
    #[cfg(not(target_os = "android"))]
    {
        let mpv = state.mpv(&app)?;
        mpv.set_property("alang", &audio)?;
        mpv.set_property("slang", &subtitle)?;
        mpv.set_property("subs-with-matching-audio", if forced_only { "forced" } else { "yes" })
    }
}

/// Saves the current frame, as shown (with subtitles), to Pictures\Orbit and
/// returns its path. The name and folder are made here, never by the page.
#[tauri::command]
pub async fn player_screenshot(app: AppHandle, state: State<'_, PlayerState>) -> Result<String, String> {
    let dir = app.path().picture_dir().map_err(|_| "err.folder.pictures")?.join("Orbit");
    std::fs::create_dir_all(&dir).map_err(|_| "err.folder.pictures-orbit")?;
    let path = dir.join(format!("orbit-{}.png", crate::library::now_ms()));
    let target = path.to_str().ok_or("err.folder.pictures")?;
    state.mpv(&app)?.command(&["screenshot-to-file", target, "subtitles"])?;
    Ok(path.to_string_lossy().into_owned())
}

/// Settings → Video → Hardware decoding: mpv's safe automatic mode, or software only.
#[tauri::command]
pub async fn player_set_hwdec(app: AppHandle, state: State<'_, PlayerState>, on: bool) -> Result<(), String> {
    state.mpv(&app)?.set_property("hwdec", if on { "auto-safe" } else { "no" })
}

/// Where the picture goes for the end credits, as mpv's margins (fractions of
/// the window: left, right, top, bottom) and alignment (x, y). Next Up's
/// takeover keeps it large at the top right; a film's end screen
/// (end-screen.ts) makes it a small card at the top left, a hole its CSS
/// cuts to the same fractions. Off gives it the whole window back.
fn corner_margins(on: bool, spot: Option<&str>) -> Result<[&'static str; 6], String> {
    match (on, spot) {
        (false, _) => Ok(["0", "0", "0", "0", "0", "0"]),
        (true, None | Some("credits")) => Ok(["0.5", "0.05", "0.1", "0.35", "1", "-1"]),
        (true, Some("card")) => Ok(["0.04", "0.74", "0.12", "0.66", "-1", "-1"]),
        (true, Some(_)) => Err("unknown corner".into()),
    }
}

/// End credits: the picture shrinks into a corner (see `corner_margins`) and
/// the page fills the rest; `false` gives it the whole window back. mpv keeps
/// these across files, so the page turns it off before the next one opens.
#[tauri::command]
pub async fn player_set_corner(app: AppHandle, state: State<'_, PlayerState>, on: bool, spot: Option<String>) -> Result<(), String> {
    let [left, right, top, bottom, align_x, align_y] = corner_margins(on, spot.as_deref())?;
    let mpv = state.mpv(&app)?;
    mpv.set_property("video-margin-ratio-left", left)?;
    mpv.set_property("video-margin-ratio-right", right)?;
    mpv.set_property("video-margin-ratio-top", top)?;
    mpv.set_property("video-margin-ratio-bottom", bottom)?;
    mpv.set_property("video-align-x", align_x)?;
    mpv.set_property("video-align-y", align_y)
}

/// Chooses the audio, subtitle or second subtitle track; `id: None` turns subtitles off.
#[tauri::command]
pub async fn player_select_track(app: AppHandle, state: State<'_, PlayerState>, kind: String, id: Option<i64>) -> Result<(), String> {
    let property = match kind.as_str() {
        "audio" => "aid",
        "sub" => "sid",
        "sub2" => "secondary-sid",
        _ => return Err("unknown track kind".into()),
    };
    let value = id.map_or_else(|| "no".to_string(), |id| id.to_string());
    let mpv = state.mpv(&app)?;
    // mpv won't make the second subtitle the main one too ("Track is already selected", and nothing
    // changes): it stops being the second one first, as picking it as the main one asks.
    if kind == "sub" && id.is_some() && mpv.get_string("secondary-sid").as_deref() == Some(value.as_str()) {
        mpv.set_property("secondary-sid", "no")?;
    }
    mpv.set_property(property, &value)?;
    // Picking a subtitle means wanting to see it, even if the Subtitles key hid them.
    if kind == "sub" && id.is_some() {
        mpv.set_property("sub-visibility", "yes")?;
    }
    Ok(())
}

/// Labels shown in mpv's track list: short, and free of control characters.
fn clean_label(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(120).collect()
}

/// Settings → Audio & Subtitles → Remove hearing-impaired text. Subtitles
/// inside the video go through mpv's own filter (`sub-filter-sdh`); files
/// Orbit adds (addon subtitles, ones the user picks or drops) are cleaned
/// here first (see sdh.rs), which also handles music lines.
#[tauri::command]
pub async fn player_set_sdh_filter(app: AppHandle, state: State<'_, PlayerState>, on: bool, keep_lyrics: bool) -> Result<(), String> {
    state.strip_sdh.store(on, Ordering::SeqCst);
    state.keep_lyrics.store(keep_lyrics, Ordering::SeqCst);
    state.mpv(&app)?.set_property("sub-filter-sdh", if on { "yes" } else { "no" })
}

/// Settings → Audio & Subtitles → Fix ALL-CAPS subtitles. Only files Orbit
/// adds itself can be rewritten (caps.rs); subtitles inside the video stay as they are.
#[tauri::command]
pub async fn player_set_caps_fix(state: State<'_, PlayerState>, on: bool) -> Result<(), String> {
    state.fix_caps.store(on, Ordering::SeqCst);
    Ok(())
}

/// Android: shows (`label`) or removes the player screen's Next up button, which stands in for the page's
/// Next up card while the player screen is in front. Nothing to do on a PC, where the card is over the video.
#[tauri::command]
pub async fn player_next_up(label: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return android::next_up(label.map(|l| clean_label(&l)).filter(|l| !l.is_empty()).as_deref());
    #[cfg(not(target_os = "android"))]
    {
        let _ = label;
        Ok(())
    }
}

/// What this device can decode and show, for ranking sources (Android, from Android itself); None on a
/// PC, where mpv plays anything.
#[tauri::command]
pub async fn player_device_support() -> Result<Option<serde_json::Value>, String> {
    #[cfg(target_os = "android")]
    return android::capabilities().map(Some);
    #[cfg(not(target_os = "android"))]
    Ok(None)
}

/// Android: shows (`label`) or removes the player screen's Skip button, which stands in for the page's
/// while the player screen is in front. Nothing to do on a PC.
#[tauri::command]
pub async fn player_skip_button(label: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return android::skip_button(label.map(|l| clean_label(&l)).filter(|l| !l.is_empty()).as_deref());
    #[cfg(not(target_os = "android"))]
    {
        let _ = label;
        Ok(())
    }
}

/// Adds a subtitle from an addon and shows it. It's fetched here, under the
/// addon rules and `MAX_SUBTITLE_BYTES`, and mpv gets the bytes: mpv itself
/// has no size limit (an addon could hand it gigabytes), would send a Jellyfin
/// or Plex sign-in to the subtitle's host too, and can't remove
/// hearing-impaired text, placement tags or capitals.
#[tauri::command]
pub async fn player_add_subtitle(app: AppHandle, state: State<'_, PlayerState>, url: String, title: String, lang: String) -> Result<(), String> {
    check_stream_url(&url)?;
    let parsed = tauri::Url::parse(&url).map_err(|_| "subtitle address isn't valid")?;
    let asked = state.opens_now();
    let fetched = crate::addons::net::fetch_bytes(parsed.clone(), MAX_SUBTITLE_BYTES, Duration::from_secs(20)).await;
    // The download can take a while: if another file opened meanwhile (the next episode, another
    // source) or the player closed, this subtitle was for the one before and isn't added to it.
    if !state.same_file(asked) {
        return Ok(());
    }
    // Android's player gets subtitles as contents only.
    #[cfg(target_os = "android")]
    return add_subtitle_bytes_as(&app, &state, &fetched.map_err(|_| "err.subtitles.download")?.0, &title, Some(&lang));
    #[cfg(not(target_os = "android"))]
    {
        match fetched {
            Ok((bytes, _)) => {
                // Cleaned first (up to 5 MB of it): only the hand-over waits on the file check.
                let bytes = cleaned_subtitle(&state, &bytes)?;
                let mpv = state.mpv(&app)?;
                on_same_file(&state, asked, || add_subtitle_hex(&mpv, &bytes, &title, Some(&lang))).map(drop)
            }
            Err(e) if mpv_may_fetch_subtitle(&parsed, &e, state.signed_in.load(Ordering::SeqCst)) => {
                let mpv = state.mpv(&app)?;
                on_same_file(&state, asked, || mpv.command(&["sub-add", &url, "select", &clean_label(&title), &clean_label(&lang)])).map(drop)
            }
            Err(_) => Err("err.subtitles.download".into()),
        }
    }
}

/// Runs `add` (which hands mpv a subtitle) only while the file `opens` was taken for is still
/// the one open. Under the lock `player_open` holds while it hands mpv a file, after bumping
/// `opens`: no other file can open between the check and `add`, so a subtitle (or a synced or
/// translated copy) made for one file never lands on the next. None when the file has changed.
#[cfg_attr(target_os = "android", allow(dead_code))]
fn on_same_file<T>(state: &PlayerState, opens: u64, add: impl FnOnce() -> Result<T, String>) -> Result<Option<T>, String> {
    let _handing = state.current.lock().map_err(|_| "player unavailable")?;
    if !state.same_file(opens) {
        return Ok(None);
    }
    add().map(Some)
}

/// Whether mpv may fetch an addon subtitle Orbit couldn't: only a plain-http
/// address (which addons may not use, but some subtitle hosts still serve), as
/// before, where mpv's protocol whitelist still applies. Never one that was too
/// large, unreachable or redirected into the LAN, nor while a media server's
/// sign-in would go with it, nor one on this machine or the LAN (as Orbit
/// itself wouldn't fetch it: the address comes from an addon).
#[cfg_attr(target_os = "android", allow(dead_code))]
fn mpv_may_fetch_subtitle(url: &tauri::Url, err: &crate::addons::AddonError, signed_in: bool) -> bool {
    !signed_in && matches!(err, crate::addons::AddonError::Blocked { reason: "scheme" }) && !crate::addons::net::is_private_host(url)
}

/// A subtitle file the user chose (.srt, .vtt, .ass...), sent as raw bytes.
pub(crate) const MAX_SUBTITLE_BYTES: usize = 5 * 1024 * 1024;

/// Adds a subtitle file from the user's computer. The page sends the file's
/// bytes (it never learns the path); they reach mpv in memory as `hex://`,
/// so nothing is written to disk and mpv still detects the text encoding.
#[tauri::command]
pub async fn player_upload_subtitle(app: AppHandle, state: State<'_, PlayerState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the subtitle file's bytes".into());
    };
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).unwrap_or("Subtitle");
    add_subtitle_bytes(&app, &state, bytes, name)
}

/// Adds subtitles pasted as text (see paste.rs). Only rebuilt cues reach mpv,
/// in memory like a chosen file, so nothing is written to disk. Errors are
/// codes the page words itself ("empty", "too-big", "not-subtitles").
#[tauri::command]
pub async fn player_paste_subtitle(app: AppHandle, state: State<'_, PlayerState>, text: String, name: String) -> Result<(), String> {
    let (rebuilt, _) = paste::rebuild(&text).map_err(|e| e.code().to_string())?;
    add_subtitle_bytes(&app, &state, rebuilt.as_bytes(), &name)
}

/// Adds subtitle file contents and shows them (also for a file dropped onto the window, see local.rs).
pub(crate) fn add_subtitle_bytes(app: &AppHandle, state: &PlayerState, bytes: &[u8], name: &str) -> Result<(), String> {
    add_subtitle_bytes_as(app, state, bytes, name, None)
}

/// Like `add_subtitle_bytes`, with the subtitle's language when it's known.
fn add_subtitle_bytes_as(app: &AppHandle, state: &PlayerState, bytes: &[u8], name: &str, lang: Option<&str>) -> Result<(), String> {
    let bytes = cleaned_subtitle(state, bytes)?;
    #[cfg(target_os = "android")]
    return {
        let _ = app;
        android::add_subtitle(&bytes, name, lang)
    };
    #[cfg(not(target_os = "android"))]
    add_subtitle_hex(&*state.mpv(app)?, &bytes, name, lang)
}

/// Subtitle contents as the settings want them shown: hearing-impaired text, capitals and placement dealt with.
fn cleaned_subtitle(state: &PlayerState, bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.is_empty() || bytes.len() > MAX_SUBTITLE_BYTES {
        return Err("err.subtitles.too-large".into());
    }
    let cleaned = if state.strip_sdh.load(Ordering::SeqCst) { sdh::strip(bytes, state.keep_lyrics.load(Ordering::SeqCst)) } else { None };
    let bytes = cleaned.as_deref().unwrap_or(bytes);
    // After the hearing-impaired filter, which reads capitals as speaker names and sound descriptions.
    let recased = if state.fix_caps.load(Ordering::SeqCst) { caps::fix(bytes) } else { None };
    let bytes = recased.as_deref().unwrap_or(bytes);
    Ok(keep_at_bottom(state, bytes).unwrap_or_else(|| bytes.to_vec()))
}

/// Subtitle contents without placement tags while "Keep at the bottom" is on; None to use them as they are.
pub(crate) fn keep_at_bottom(state: &PlayerState, bytes: &[u8]) -> Option<Vec<u8>> {
    if state.keep_bottom.load(Ordering::SeqCst) { placement::strip(bytes) } else { None }
}

#[cfg(any(target_os = "android", test))]
/// Media3 reads a subtitle by its format's MIME type; mpv sniffs it. Same guess from the contents.
fn subtitle_mime(bytes: &[u8]) -> &'static str {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    if head.starts_with("WEBVTT") {
        "text/vtt"
    } else if head.contains("[Script Info]") || head.contains("[V4+ Styles]") || head.contains("[V4 Styles]") {
        "text/x-ssa"
    } else {
        "application/x-subrip"
    }
}

/// Hands mpv subtitle contents in memory (`hex://`) and shows them.
fn add_subtitle_hex(mpv: &Mpv, bytes: &[u8], name: &str, lang: Option<&str>) -> Result<(), String> {
    add_subtitle_hex_as(mpv, bytes, name, lang, "select")
}

/// Like `add_subtitle_hex`, with mpv's `sub-add` flag: "select" shows it, "auto" only lists it.
fn add_subtitle_hex_as(mpv: &Mpv, bytes: &[u8], name: &str, lang: Option<&str>, flag: &str) -> Result<(), String> {
    use std::fmt::Write;
    let mut hex = String::with_capacity(6 + bytes.len() * 2);
    hex.push_str("hex://");
    for b in bytes {
        let _ = write!(hex, "{b:02x}");
    }
    let (name, lang) = (clean_label(name), lang.map(clean_label));
    let mut args = vec!["sub-add", &hex, flag, &name];
    if let Some(lang) = &lang {
        args.push(lang);
    }
    mpv.command(&args)
}

/// Technical details for the info panel. Never includes the stream address.
const INFO_PROPERTIES: &[&str] = &[
    "frame-drop-count",
    "decoder-frame-drop-count",
    "estimated-vf-fps",
    "file-format",
    "video-format",
    "width",
    "height",
    "container-fps",
    "video-params/gamma",
    "video-params/primaries",
    "hwdec-current",
    "audio-codec-name",
    "audio-params/hr-channels",
    "audio-params/samplerate",
    "video-bitrate",
    "audio-bitrate",
    "demuxer-cache-duration",
    // Where the sound goes, for "no sound" reports: mpv's own volume and mute,
    // the Windows session's (ao-), the output and what's sent to it.
    "volume",
    "mute",
    "ao-volume",
    "ao-mute",
    "current-ao",
    "audio-out-params/hr-channels",
    "audio-out-params/format",
];

#[tauri::command]
pub async fn player_info(state: State<'_, PlayerState>) -> Result<std::collections::HashMap<String, String>, String> {
    let mpv = state.engine.lock().map_err(|_| "player unavailable")?.as_ref().map(|e| e.mpv.clone());
    let Some(mpv) = mpv else { return Ok(Default::default()) };
    Ok(INFO_PROPERTIES.iter().filter_map(|name| mpv.get_string(name).map(|v| ((*name).to_string(), v))).collect())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    transcript::fuzz_input(data);
    paste::fuzz_input(data);
    caps::fuzz_input(data);
    let _ = sdh::strip(data, false);
    subsync::fuzz_input(data);
}

#[cfg(test)]
mod tests {
    use super::{AudioPrefs, BOOSTED_MAX, MAX_CHAPTERS, PlayerEvent, Sound, Status, Tagged, ass_override, audio_options, chapters_from, check_equalizer, check_hex, check_languages, check_passthrough, check_stream_url, check_volume, clean_label, corner_margins, hdr_hint, lifted_position, load_for, local_file_options, mpv_may_fetch_subtitle, passes_through, quality_options, sub_font, subtitle_mime, tracks_from, QUALITY_OPTIONS, SMOOTH_MOTION, HDR_SUBTITLE_NITS};
    use crate::addons::AddonError;

    #[test]
    fn a_subtitle_still_downloading_when_another_file_opens_is_for_the_one_before() {
        let state = super::PlayerState::new(None);
        let asked = state.opens_now();
        assert!(state.same_file(asked));
        // player_open and player_stop both bump it.
        state.opens.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        assert!(!state.same_file(asked));
    }

    #[test]
    fn a_file_opened_while_the_window_is_in_the_tray_stays_paused() {
        let state = super::PlayerState::new(None);
        assert!(!state.opens_paused());
        // Closed to the tray while a source was still loading, or with Next Up counting down.
        state.hide_to_tray();
        assert!(state.opens_paused());
        state.window_shown();
        assert!(!state.opens_paused());
    }

    #[test]
    fn a_subtitle_is_handed_over_under_the_lock_files_are_opened_with() {
        let state = super::PlayerState::new(None);
        let asked = state.opens_now();
        // While it's added, no player_open can hand mpv another file (it needs this lock to).
        assert_eq!(super::on_same_file(&state, asked, || Ok(state.current.try_lock().is_err())), Ok(Some(true)));
        state.opens.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut added = false;
        assert_eq!(
            super::on_same_file(&state, asked, || {
                added = true;
                Ok(())
            }),
            Ok(None)
        );
        assert!(!added);
    }

    #[test]
    fn mpv_never_fetches_a_subtitle_orbit_turned_away_for_its_size() {
        let web = tauri::Url::parse("http://subs.example/a.srt").unwrap();
        assert!(!mpv_may_fetch_subtitle(&web, &AddonError::TooLarge { limit_bytes: super::MAX_SUBTITLE_BYTES }, false));
        assert!(!mpv_may_fetch_subtitle(&web, &AddonError::Blocked { reason: "redirect" }, false));
        assert!(!mpv_may_fetch_subtitle(&web, &AddonError::Timeout, false));
        assert!(!mpv_may_fetch_subtitle(&web, &AddonError::Blocked { reason: "local" }, false));
        // Plain http, as before; never with a media server's sign-in.
        assert!(mpv_may_fetch_subtitle(&web, &AddonError::Blocked { reason: "scheme" }, false));
        assert!(!mpv_may_fetch_subtitle(&web, &AddonError::Blocked { reason: "scheme" }, true));
    }

    #[test]
    fn files_on_this_pc_never_open_what_they_list() {
        // A dropped file (or a download) named .mkv may really be a playlist or an EDL.
        let refuses = |options: &[String]| ["access-references=no", "load-unsafe-playlists=no"].iter().all(|o| options.iter().any(|x| x == o));
        let dropped = local_file_options(None);
        assert!(refuses(&dropped), "{dropped:?}");
        // A dropped file keeps mpv's own search for subtitles beside it.
        assert!(!dropped.iter().any(|o| o.starts_with("sub-auto")));
        let saved = vec![r"C:\Films\a,b.en.srt".to_string()];
        let download = local_file_options(Some(&saved));
        assert!(refuses(&download), "{download:?}");
        assert!(download.contains(&"sub-auto=no".to_string()));
        assert!(download.contains(&format!("sub-files-append=%{}%{}", saved[0].len(), saved[0])));
    }

    #[test]
    fn mpv_never_fetches_an_addons_subtitle_from_the_lan() {
        for lan in ["http://192.168.1.1/sub.srt", "http://10.0.0.2:8080/a.srt", "http://localhost:9000/a.srt", "http://[fe80::1]/a.srt"] {
            let url = tauri::Url::parse(lan).unwrap();
            assert!(!mpv_may_fetch_subtitle(&url, &AddonError::Blocked { reason: "scheme" }, false), "{lan}");
        }
    }

    #[test]
    fn subtitle_formats_are_told_apart() {
        assert_eq!(subtitle_mime(b"\xef\xbb\xbfWEBVTT\n\n00:01.000 --> 00:02.000\nHi"), "text/vtt");
        assert_eq!(subtitle_mime(b"[Script Info]\nTitle: x\n[V4+ Styles]"), "text/x-ssa");
        assert_eq!(subtitle_mime(b"1\n00:00:01,000 --> 00:00:02,000\nHi"), "application/x-subrip");
    }

    #[test]
    fn corners_are_a_fixed_choice() {
        assert_eq!(corner_margins(false, Some("card")).unwrap(), ["0"; 6]);
        assert_eq!(corner_margins(true, None).unwrap(), corner_margins(true, Some("credits")).unwrap());
        // The end screen's card: 22% of each side at the top left, so it keeps the window's shape.
        assert_eq!(corner_margins(true, Some("card")).unwrap(), ["0.04", "0.74", "0.12", "0.66", "-1", "-1"]);
        assert!(corner_margins(true, Some("anywhere")).is_err());
    }

    #[test]
    fn subtitle_fonts_come_from_a_fixed_list() {
        assert_eq!(sub_font(""), Ok("sans-serif"));
        assert_eq!(sub_font("default"), Ok("sans-serif"));
        assert_eq!(sub_font("atkinson"), Ok("Atkinson Hyperlegible"));
        assert_eq!(sub_font("lexend"), Ok("Lexend"));
        assert_eq!(sub_font("opendyslexic"), Ok("OpenDyslexic"));
        assert_eq!(sub_font("arimo"), Ok("Arimo"));
        for bad in ["Arial", "Lexend", "atkinson\n", "../fonts", "OpenDyslexic"] {
            assert!(sub_font(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn passthrough_formats_come_from_a_fixed_list() {
        let list = |f: &[&str]| check_passthrough(&f.iter().map(|s| (*s).to_string()).collect::<Vec<_>>());
        assert_eq!(list(&[]), Ok(vec![]));
        assert_eq!(list(&["truehd", "ac3", "ac3"]), Ok(vec!["ac3", "truehd"]));
        assert_eq!(list(&["ac3", "eac3", "dts", "dts-hd", "truehd"]).unwrap().join(","), "ac3,eac3,dts,dts-hd,truehd");
        for bad in [&["AC3"][..], &["ac3,eac3"], &["dsd"], &["ac3;x"], &[""], &["ac3", "ac3", "ac3", "ac3", "ac3", "ac3"]] {
            assert!(list(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn passthrough_wins_over_sound_filters_for_the_formats_chosen() {
        assert!(passes_through(&["dts-hd"], Some("dts")));
        assert!(passes_through(&["ac3", "eac3"], Some("eac3")));
        assert!(!passes_through(&["ac3", "eac3"], Some("truehd")));
        assert!(!passes_through(&["ac3"], Some("aac")));
        assert!(!passes_through(&["ac3"], None));

        let prefs = |codec: &str| AudioPrefs { normalize: true, sound: Sound::Night, passthrough: vec!["ac3", "eac3"], codec: Some(codec.into()), ..AudioPrefs::default() };
        assert_eq!(audio_options(&prefs("eac3")), ("auto-safe", String::new()));
        let (channels, filters) = audio_options(&prefs("aac"));
        assert_eq!(channels, "stereo");
        assert!(filters.contains("dynaudnorm") && filters.contains("acompressor"));
        assert_eq!(audio_options(&AudioPrefs::default()), ("auto-safe", String::new()));
    }

    #[test]
    fn boost_ceiling_alone_does_not_change_ordinary_volume() {
        let prefs = AudioPrefs { boost_level: 200, ..AudioPrefs::default() };
        assert_eq!(audio_options(&prefs).1, "");
        assert_eq!(super::native_volume(75.0, &prefs), 75.0);
        assert_eq!(super::boost_for(75.0, 200), 100.0);
        assert_eq!(super::boost_for(100.0, 200), 100.0);
    }

    #[test]
    fn steps_above_100_keep_the_filters_and_move_only_the_volume() {
        let at = |volume: f64| {
            let mut prefs = AudioPrefs { boost_level: 200, volume, normalize: true, sound: Sound::Cinema, ..AudioPrefs::default() };
            prefs.boost_volume = super::boost_for(volume, prefs.boost_level);
            prefs
        };
        let (low, high) = (at(105.0), at(195.0));
        assert_eq!(audio_options(&low), audio_options(&high));
        assert_ne!(audio_options(&at(100.0)), audio_options(&low));
        // mpv's volume curve is cubic: the gain is (200/100)^3, and mpv's volume the logical one over 2.
        assert!(audio_options(&low).1.contains("volume=8.000000"));
        assert!((super::native_volume(105.0, &low) - 52.5).abs() < 1e-9);
        assert!((super::native_volume(195.0, &high) - 97.5).abs() < 1e-9);
        // A passed-through track can't be boosted; its logical volume is kept for the next decoded one.
        let passthrough = AudioPrefs { codec: Some("ac3".into()), passthrough: vec!["ac3"], ..high.clone() };
        assert_eq!(audio_options(&passthrough).1, "");
        assert_eq!(super::native_volume(passthrough.volume, &passthrough), 100.0);
        let decoded = AudioPrefs { codec: Some("aac".into()), ..passthrough };
        assert_eq!(super::boost_for(decoded.volume, decoded.boost_level), 200.0);
    }

    #[test]
    fn boost_presets_validate_and_limit_after_gain() {
        for level in [100, 125, 150, 200] {
            assert_eq!(super::check_boost_level(level), Ok(level));
            let prefs = AudioPrefs { boost_level: level, boost_volume: f64::from(level), normalize: true, sound: Sound::Dialogue, ..AudioPrefs::default() };
            let filters = audio_options(&prefs).1;
            if level > 100 {
                assert!(filters.rfind("volume=").unwrap() < filters.rfind("alimiter=limit=0.95:level=false").unwrap());
                assert!(filters.contains("dynaudnorm") && filters.contains("equalizer"));
                assert_eq!(super::native_volume(f64::from(level), &prefs), 100.0);
                assert!((super::native_volume(110.0, &prefs) - 110.0 * 100.0 / f64::from(level)).abs() < 1e-9);
                assert!(filters.contains(&format!("volume={:.6}", (f64::from(level) / 100.0).powi(3))));
                let passthrough = AudioPrefs { codec: Some("ac3".into()), passthrough: vec!["ac3"], ..prefs };
                assert_eq!(audio_options(&passthrough).1, "");
                assert_eq!(super::native_volume(f64::from(level), &passthrough), 100.0);
                assert_eq!(super::native_volume(80.0, &passthrough), 80.0);
            }
        }
        for level in [0, 99, 101, 126, 151, 201, u16::MAX] { assert!(super::check_boost_level(level).is_err()); }
    }

    #[test]
    fn sound_modes_come_from_a_fixed_list() {
        for name in ["off", "night", "cinema", "music", "dialogue"] {
            assert!(Sound::parse(name).is_ok(), "{name}");
        }
        for bad in ["", "Night", "lavfi=[volume=10]", "cinema,night"] {
            assert!(Sound::parse(bad).is_err(), "{bad}");
        }
        // Presets keep surround as it is; only night mode mixes down.
        let with = |sound| audio_options(&AudioPrefs { sound, ..AudioPrefs::default() });
        assert_eq!(with(Sound::Dialogue).0, "auto-safe");
        assert!(with(Sound::Cinema).1.starts_with("lavfi=[bass"));
        assert_eq!(with(Sound::Off).1, "");
    }

    #[test]
    fn hdr_subtitles_stay_within_mpvs_range_and_below_its_default() {
        // mpv takes 10–10000 nits; its default (`sdr`) is 203.
        let nits: f64 = HDR_SUBTITLE_NITS.parse().unwrap();
        assert!((10.0..203.0).contains(&nits));
    }

    #[test]
    fn smooth_motion_needs_a_display_sync_mode() {
        // mpv silently ignores interpolation unless video-sync is one of the display- modes.
        let get = |name: &str| SMOOTH_MOTION.iter().find(|(n, _)| *n == name).map(|(_, v)| *v);
        assert!(get("video-sync").is_some_and(|v| v.starts_with("display-")));
        assert_eq!(get("interpolation"), Some("yes"));
    }

    #[test]
    fn hdr_off_is_mpvs_default() {
        assert_eq!(hdr_hint(true), "yes");
        assert_eq!(hdr_hint(false), "auto");
    }

    #[test]
    fn volume_stays_within_the_allowed_range() {
        assert_eq!(check_volume(100.0, 100.0), Ok(100.0));
        assert_eq!(check_volume(0.0, 100.0), Ok(0.0));
        assert!(check_volume(100.5, 100.0).is_err());
        assert_eq!(check_volume(150.0, BOOSTED_MAX), Ok(150.0));
        for bad in [-1.0, 151.0, f64::NAN, f64::INFINITY] {
            assert!(check_volume(bad, BOOSTED_MAX).is_err(), "{bad}");
        }
    }

    #[test]
    fn only_the_file_asked_for_last_reaches_the_page() {
        // Entry 7 was asked for as the page's load 3; entry 6 (surfed past) is stale.
        assert_eq!(load_for(Some((7, 3)), 7), Some(3));
        assert_eq!(load_for(Some((7, 3)), 6), None);
        assert_eq!(load_for(None, 7), None);
        assert_eq!(load_for(Some((7, 3)), -1), None);
    }

    #[test]
    fn events_carry_their_load() {
        let json = |event| serde_json::to_value(Tagged { load: 4, event }).unwrap();
        assert_eq!(json(PlayerEvent::Loaded), serde_json::json!({"kind": "loaded", "load": 4}));
        assert_eq!(json(PlayerEvent::Error { message: "x".into() }), serde_json::json!({"kind": "error", "load": 4, "message": "x"}));
        let status = json(PlayerEvent::Status(Status { paused: true, ..Status::default() }));
        assert_eq!((status["kind"].as_str(), status["load"].as_u64(), status["paused"].as_bool()), (Some("status"), Some(4), Some(true)));
    }

    #[test]
    fn a_new_file_keeps_the_players_own_settings() {
        let before = Status { paused: true, muted: true, volume: Some(40.0), speed: Some(1.5), time_pos: Some(12.0), eof: true, ..Status::default() };
        let after = before.for_new_file(true);
        // Paused while the file opened: mpv stays paused, so the page must be told so.
        assert!(after.paused && after.muted);
        assert_eq!((after.volume, after.speed), (Some(40.0), Some(1.5)));
        assert_eq!((after.time_pos, after.eof), (None, false));
        // The last file was paused but mpv has already unpaused for this one: the page
        // must not hear the stale pause, even before mpv's own pause=no event arrives.
        let after = before.for_new_file(false);
        assert!(!after.paused && after.muted);
    }

    #[test]
    fn language_lists_are_plain_codes() {
        assert!(check_languages("").is_ok());
        assert!(check_languages("fr,fre,fra").is_ok());
        assert!(check_languages("en,").is_err());
        assert!(check_languages("en;eng").is_err());
        assert!(check_languages("EN").is_err());
        assert!(check_languages(&"en,".repeat(30)).is_err());
        // Regional tags (lowercase, mpv matches them case-insensitively): Brazilian Portuguese, Traditional Chinese.
        assert!(check_languages("pt-br,pob,pb,pt,por").is_ok());
        assert!(check_languages("zh-hant,zh-tw,zh-hk,zht,zh,chi,zho,en,eng").is_ok());
        assert!(check_languages("pt-BR").is_err());
        assert!(check_languages("pt-").is_err());
        assert!(check_languages("pt-br-x").is_err());
        assert!(check_languages("-br").is_err());
        assert!(check_languages("zh-hantx").is_err());
        let long = vec!["zh-hant"; 40].join(",");
        assert!(long.len() > 256 && check_languages(&long).is_err());
    }

    #[test]
    fn keeps_audio_and_subtitle_tracks() {
        let list = serde_json::json!([
            {"id": 1, "type": "video", "codec": "h264"},
            {"id": 1, "type": "audio", "lang": "eng", "codec": "eac3", "demux-channel-count": 6, "selected": true, "default": true},
            {"id": 2, "type": "sub", "lang": "spa", "title": "Forced", "forced": true},
            {"id": 3, "type": "sub", "lang": "eng", "selected": true, "main-selection": 0, "hearing-impaired": true},
            {"id": 4, "type": "sub", "lang": "jpn", "selected": true, "main-selection": 1},
            {"type": "sub"},
        ]);
        let tracks = tracks_from(&list);
        assert_eq!(tracks.len(), 4);
        assert!(tracks[0].selected && tracks[0].channels == Some(6) && tracks[0].kind == "audio");
        assert!(tracks[1].forced && tracks[1].lang.as_deref() == Some("spa"));
        assert!(tracks[2].selected && !tracks[2].secondary && tracks[2].hearing_impaired && !tracks[1].hearing_impaired);
        assert!(!tracks[3].selected && tracks[3].secondary);
    }

    #[test]
    fn chapters_keep_only_real_start_times_and_stop_at_the_cap() {
        let list = serde_json::json!([
            {"title": "Intro", "time": 0.0},
            {"time": 90.5},
            {"title": "Bad", "time": -1.0},
            {"title": "Text", "time": "12"},
            {"title": 7, "time": 120.0},
            {"title": "No time"},
        ]);
        let chapters = chapters_from(&list);
        let got: Vec<_> = chapters.iter().map(|c| (c.title.as_deref(), c.time)).collect();
        assert_eq!(got, [(Some("Intro"), 0.0), (None, 90.5), (None, 120.0)]);
        assert!(chapters_from(&serde_json::json!({"time": 1.0})).is_empty());
        assert!(chapters_from(&serde_json::Value::Null).is_empty());
        let many = serde_json::Value::Array((0..MAX_CHAPTERS + 50).map(|n| serde_json::json!({"time": n as f64})).collect());
        assert_eq!(chapters_from(&many).len(), MAX_CHAPTERS);
    }

    #[test]
    fn tracks_need_a_numeric_id_and_a_known_kind() {
        let list = serde_json::json!([
            {"id": "1", "type": "audio"},
            {"id": 2, "type": "video"},
            {"id": 3},
            {"id": 4, "type": "audio", "selected": "yes", "lang": 5},
        ]);
        let tracks = tracks_from(&list);
        assert_eq!(tracks.len(), 1);
        // Oddly typed fields read as absent, never as set.
        assert!(tracks[0].id == 4 && !tracks[0].selected && tracks[0].lang.is_none());
        assert!(tracks_from(&serde_json::json!("not a list")).is_empty());
    }

    #[test]
    fn subtitle_colours_are_plain_six_digit_hex() {
        assert!(check_hex("#ffffff").is_ok() && check_hex("#00AAcc").is_ok());
        for bad in ["ffffff", "#fff", "#fffffff", "#gggggg", "#ffffff;", "red", "", "#ff ff f", "#ffffé"] {
            assert!(check_hex(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn subtitles_clear_the_controls_from_where_they_were_put() {
        assert_eq!(lifted_position(100, 0), 100);
        assert_eq!(lifted_position(100, 12), 88);
        // Already higher than the controls reach: left alone.
        assert_eq!(lifted_position(80, 12), 80);
        assert_eq!(lifted_position(60, 30), 60);
        assert_eq!(lifted_position(55, 30), 55);
        assert_eq!(lifted_position(100, 200), 50);
    }

    #[test]
    fn labels_are_short_and_plain() {
        assert_eq!(clean_label("Eng\nlish\u{7}"), "English");
        assert_eq!(clean_label(&"x".repeat(500)).len(), 120);
    }

    #[test]
    fn plays_only_web_addresses() {
        assert!(check_stream_url("https://cdn.example/video.mkv").is_ok());
        assert!(check_stream_url("http://127.0.0.1:11470/stream").is_ok());
        assert!(check_stream_url("HTTPS://cdn.example/video.mkv").is_ok());
        for bad in ["file:///C:/Windows/win.ini", "C:\\video.mkv", "ytdl://x", "av://dshow:video=cam", "memory://x", "not a url", "https:x\\..\\..\\Windows\\win.ini", "https:/x/video.mkv", "https://x\\..\\video.mkv"] {
            assert!(check_stream_url(bad).is_err(), "{bad}");
        }
        assert!(check_stream_url(&format!("https://x/{}", "a".repeat(9000))).is_err());
        for bad in ["ht\u{9}tp://x/video.mkv", "http://x/a\u{a}b", " http://x/video.mkv", "http://x/video.mkv\u{d}"] {
            assert!(check_stream_url(bad).is_err(), "{bad:?}");
        }
        // Every mpv that opens a stream gets the same hardening (see thumbs.rs).
        for option in [("config", "no"), ("load-scripts", "no"), ("ytdl", "no")] {
            assert!(super::STREAM_HARDENING.contains(&option), "{option:?}");
        }
        assert!(super::STREAM_HARDENING.iter().any(|(n, v)| *n == "stream-lavf-o" && v.contains("protocol_whitelist")));
    }

    #[test]
    fn picture_adjustments_stay_in_mpvs_range() {
        assert_eq!(check_equalizer([0, 0, 0, 0]), Ok([0, 0, 0, 0]));
        assert_eq!(check_equalizer([-100, 100, 6, -4]), Ok([-100, 100, 6, -4]));
        for bad in [[101, 0, 0, 0], [0, -101, 0, 0], [0, 0, i64::MAX, 0], [0, 0, 0, i64::MIN]] {
            assert!(check_equalizer(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn subtitle_override_comes_from_a_fixed_list() {
        assert_eq!(ass_override("strip"), Ok("strip"));
        assert_eq!(ass_override("scale"), Ok("scale"));
        for bad in ["", "force", "no", "yes", "Strip", "strip;sub-pos=0", "strip\n"] {
            assert!(ass_override(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn quality_presets_come_from_a_fixed_list() {
        assert_eq!(quality_options("balanced"), Ok(None));
        for preset in ["fast", "high"] {
            let options = quality_options(preset).unwrap().unwrap();
            // Each is reset by Balanced, and values are plain words or numbers.
            for (name, value) in options {
                assert!(QUALITY_OPTIONS.contains(name), "{name}");
                assert!(value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.'), "{value}");
            }
        }
        for bad in ["", "Balanced", "high-quality", "fast;scale=x", "ewa_lanczossharp"] {
            assert!(quality_options(bad).is_err(), "{bad}");
        }
    }
}
