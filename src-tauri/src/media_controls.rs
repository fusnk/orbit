//! Windows' media controls (System Media Transport Controls): while the
//! player is open, the media flyout (by the volume, on the lock screen) shows
//! what's playing with play/pause, next and previous, and a keyboard's media
//! keys work it even while another window has the focus.
//!
//! The page decides what's shown (`media_controls_set`): just "Orbit" on a
//! profile with a content limit, while watch history is paused, and for a
//! file from this PC (see rooms/player/media-session.ts). Play and pause
//! states come straight from mpv's events (`playback`). Buttons pressed there
//! come back to the page as `media-controls://button` and run through the
//! same path as the player's own media keys.
//!
//! The poster is fetched here with the same checks as the app's own artwork
//! and handed over as bytes: Windows never fetches an addon's address itself.
//!
//! Paused with Orbit in the background for a while (`DORMANT_AFTER`), the
//! controls step aside so the media keys reach other apps (music, a browser)
//! again: Windows sends them to the session it takes as current, and a paused
//! one left showing keeps them. They come back on playing, or when Orbit's
//! window gets the focus.
//!
//! On Linux the same controls are offered over MPRIS (the `mpris` module
//! below): the desktop's media applet, lock screen and media keys see and
//! work the player the same way. The poster is passed as its address there
//! (the desktop fetches it), so only a public https image with no query or
//! login in its address is passed; anything else is left out.
//!
//! Other platforms get no-ops.

use serde::Deserialize;
use tauri::{AppHandle, State};

/// The event a pressed button reaches the page as: "play", "pause", "next" or "previous".
#[cfg(any(windows, target_os = "linux"))]
const BUTTON_EVENT: &str = "media-controls://button";
/// Paused this long while another window has the focus: the controls step aside.
const DORMANT_AFTER: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Whether the controls should step aside: paused for `DORMANT_AFTER` or more (`paused_for`) and Orbit not focused.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
fn dormant_due(paused_for: Option<std::time::Duration>, focused: bool) -> bool {
    !focused && paused_for.is_some_and(|d| d >= DORMANT_AFTER)
}

/// What fits on the flyout; anything longer is cut.
const MAX_TEXT: usize = 200;
#[cfg(windows)]
const ART_LIMIT: usize = 4 * 1024 * 1024;
#[cfg(windows)]
const ART_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// What the flyout shows, as the page describes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    /// The episode, or nothing.
    subtitle: Option<String>,
    /// The poster's address (from an addon or TMDB), if one should show.
    poster: Option<String>,
    can_next: bool,
    can_previous: bool,
}

/// Text Windows shows: no control characters, at most `MAX_TEXT` characters.
fn clean(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect::<String>().trim().to_owned()
}

/// The image types the flyout's thumbnail is given; anything else (SVG, which can carry script, say) isn't.
#[cfg_attr(not(windows), allow(dead_code))]
fn thumbnail_type(content_type: Option<&str>) -> bool {
    let Some(kind) = content_type.and_then(|t| t.split(';').next()) else { return false };
    matches!(kind.trim().to_ascii_lowercase().as_str(), "image/jpeg" | "image/png")
}

/// The poster's address as the Linux desktop may be handed it: a public https image whose address
/// carries no login, query or fragment (where an addon could have put a token), or nothing. Nor
/// RPDB's: its key is in the path, and catalog addons hand such posters out (as for Discord).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn public_art_url(poster: &str) -> Option<String> {
    const MAX_URL: usize = 2048;
    let url = reqwest::Url::parse(poster).ok()?;
    crate::addons::net::check_artwork_url(&url).ok()?;
    let plain = url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && !url.host_str().is_some_and(|h| h.eq_ignore_ascii_case(crate::rpdb::HOST));
    (plain && url.as_str().len() <= MAX_URL).then(|| url.into())
}

#[cfg(windows)]
pub use win::MediaControls;

#[cfg(target_os = "linux")]
pub use mpris::MediaControls;

#[cfg(not(any(windows, target_os = "linux")))]
pub struct MediaControls;

#[cfg(not(any(windows, target_os = "linux")))]
impl MediaControls {
    pub fn new(_app: &AppHandle) -> Self {
        Self
    }
}

/// mpv paused or played (from the player's event thread); shown on the flyout while it's in use.
#[cfg(any(windows, target_os = "linux"))]
pub fn playback(app: &AppHandle, paused: bool) {
    use tauri::Manager;
    if let Some(controls) = app.try_state::<MediaControls>() {
        controls.playback(paused);
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn playback(_app: &AppHandle, _paused: bool) {}

/// Where playback is (from the player's event thread): MPRIS clients read the position and length.
#[cfg(target_os = "linux")]
pub fn progress(app: &AppHandle, position: Option<f64>, duration: Option<f64>, speed: Option<f64>) {
    use tauri::Manager;
    if let Some(controls) = app.try_state::<mpris::MediaControls>() {
        controls.progress(position, duration, speed);
    }
}

/// mpv started playing again after a seek (or a new file): MPRIS clients are told the new position.
#[cfg(target_os = "linux")]
pub fn restarted(app: &AppHandle) {
    use tauri::Manager;
    if let Some(controls) = app.try_state::<mpris::MediaControls>() {
        controls.restarted();
    }
}

/// Shows (or updates) what's playing on Windows' media controls.
#[tauri::command]
pub async fn media_controls_set(controls: State<'_, MediaControls>, playing: NowPlaying) -> Result<(), String> {
    #[cfg(any(windows, target_os = "linux"))]
    return controls.set(playing).await;
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (controls, playing);
        Ok(())
    }
}

/// The player closed: Windows' media controls go away.
#[tauri::command]
pub fn media_controls_clear(controls: State<'_, MediaControls>) -> Result<(), String> {
    #[cfg(any(windows, target_os = "linux"))]
    return controls.clear();
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = controls;
        Ok(())
    }
}

#[cfg(windows)]
mod win {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::time::Instant;

    use tauri::{AppHandle, Emitter, Manager, WindowEvent};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::{MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs};
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
    use windows::core::HSTRING;

    use super::{ART_LIMIT, ART_TIMEOUT, BUTTON_EVENT, DORMANT_AFTER, NowPlaying, clean, dormant_due, thumbnail_type};

    struct Shown {
        title: String,
        subtitle: String,
        art: Option<Vec<u8>>,
        can_next: bool,
        can_previous: bool,
    }

    enum Message {
        Show(Shown),
        Playback(bool),
        /// The main window got (true) or lost the focus.
        Focus(bool),
        Clear,
    }

    /// Unknown, playing, paused: the last state sent, so each status event doesn't send it again.
    const UNKNOWN: u8 = 0;
    const PLAYING: u8 = 1;
    const PAUSED: u8 = 2;

    pub struct MediaControls {
        tx: Mutex<Sender<Message>>,
        /// Bumped by every set and clear: a poster that arrives after the next one was asked for is dropped.
        seq: AtomicU64,
        state: AtomicU8,
    }

    impl MediaControls {
        pub fn new(app: &AppHandle) -> Self {
            let (tx, rx) = mpsc::channel();
            let window = app.get_webview_window("main");
            // The main window's handle, as a number (it's only used on the thread below).
            let hwnd = window.as_ref().and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize);
            if let Some(window) = window {
                let focus = Mutex::new(tx.clone());
                window.on_window_event(move |event| {
                    if let (WindowEvent::Focused(focused), Ok(tx)) = (event, focus.lock()) {
                        let _ = tx.send(Message::Focus(*focused));
                    }
                });
            }
            let app = app.clone();
            // WinRT calls (and waiting for one) don't belong on the UI thread or the async runtime:
            // one thread of its own does them all, in order.
            if let Err(e) = std::thread::Builder::new().name("media-controls".into()).spawn(move || run(&app, hwnd, &rx)) {
                crate::diagnostics::warn(&format!("media controls: {e}"));
            }
            Self { tx: Mutex::new(tx), seq: AtomicU64::new(0), state: AtomicU8::new(UNKNOWN) }
        }

        fn send(&self, message: Message) -> Result<(), String> {
            self.tx.lock().map_err(|_| "media controls unavailable")?.send(message).map_err(|_| "media controls unavailable".into())
        }

        pub async fn set(&self, playing: NowPlaying) -> Result<(), String> {
            let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
            let art = match playing.poster.as_deref() {
                Some(poster) => poster_bytes(poster).await,
                None => None,
            };
            let shown = Shown {
                title: clean(&playing.title),
                subtitle: playing.subtitle.as_deref().map(clean).unwrap_or_default(),
                art,
                can_next: playing.can_next,
                can_previous: playing.can_previous,
            };
            // Checked and sent under the sender's lock, which `clear` also holds, so a
            // clear can't land between the check and the send and leave this showing.
            let tx = self.tx.lock().map_err(|_| "media controls unavailable")?;
            // Another title (or the player closing) came while the poster loaded: that one stands.
            if self.seq.load(Ordering::SeqCst) != seq {
                return Ok(());
            }
            tx.send(Message::Show(shown)).map_err(|_| "media controls unavailable".into())
        }

        pub fn clear(&self) -> Result<(), String> {
            let tx = self.tx.lock().map_err(|_| "media controls unavailable")?;
            self.seq.fetch_add(1, Ordering::SeqCst);
            self.state.store(UNKNOWN, Ordering::SeqCst);
            tx.send(Message::Clear).map_err(|_| "media controls unavailable".into())
        }

        pub fn playback(&self, paused: bool) {
            let state = if paused { PAUSED } else { PLAYING };
            if self.state.swap(state, Ordering::SeqCst) != state {
                let _ = self.send(Message::Playback(paused));
            }
        }
    }

    /// The poster, if it's an https JPEG or PNG within the size limit, fetched with the app's artwork checks.
    async fn poster_bytes(poster: &str) -> Option<Vec<u8>> {
        let url = reqwest::Url::parse(poster).ok()?;
        crate::addons::net::check_artwork_url(&url).ok()?;
        let (bytes, content_type) = crate::addons::net::fetch_bytes(url, ART_LIMIT, ART_TIMEOUT).await.ok()?;
        thumbnail_type(content_type.as_deref()).then_some(bytes)
    }

    fn run(app: &AppHandle, hwnd: Option<isize>, rx: &Receiver<Message>) {
        let mut controls: Option<SystemMediaTransportControls> = None;
        let mut active = false;
        // mpv's latest play/pause, kept while hidden so it's right when shown.
        let mut paused: Option<bool> = None;
        // What's showing (to show again after stepping aside), since when it's paused, and whether Orbit has the focus.
        let mut last: Option<Shown> = None;
        let mut paused_since: Option<Instant> = None;
        let mut focused = true;
        let mut dormant = false;
        loop {
            // A message, or (paused in the background) the time to step aside.
            let wait = paused_since.filter(|_| active && !dormant && !focused).map(|since| DORMANT_AFTER.saturating_sub(since.elapsed()));
            let message = match wait {
                Some(wait) => match rx.recv_timeout(wait) {
                    Ok(message) => Some(message),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                },
                None => match rx.recv() {
                    Ok(message) => Some(message),
                    Err(_) => break,
                },
            };
            // Back from stepping aside: shown as it was, with mpv's play/pause.
            let wake = |c: &SystemMediaTransportControls, last: Option<&Shown>, paused: Option<bool>| match last {
                Some(shown) => show(c, shown).and_then(|()| c.SetPlaybackStatus(status(paused.unwrap_or(true)))),
                None => Ok(()),
            };
            let result = match message {
                None => match controls.as_ref() {
                    Some(c) if dormant_due(paused_since.map(|since| since.elapsed()), focused) => {
                        dormant = true;
                        hide(c)
                    }
                    _ => Ok(()),
                },
                Some(Message::Show(shown)) => {
                    if controls.is_none() {
                        controls = hwnd.and_then(|h| create(app, h).inspect_err(|e| crate::diagnostics::warn(&format!("media controls: {e}"))).ok());
                    }
                    let Some(c) = controls.as_ref() else { continue };
                    let result = show(c, &shown).and_then(|()| match paused {
                        Some(p) => c.SetPlaybackStatus(status(p)),
                        None => Ok(()),
                    });
                    active = result.is_ok();
                    dormant = false;
                    last = Some(shown);
                    result
                }
                Some(Message::Playback(p)) => {
                    paused = Some(p);
                    paused_since = if p { paused_since.or_else(|| Some(Instant::now())) } else { None };
                    match controls.as_ref().filter(|_| active) {
                        Some(c) if dormant && !p => {
                            dormant = false;
                            wake(c, last.as_ref(), paused)
                        }
                        Some(c) if !dormant => c.SetPlaybackStatus(status(p)),
                        _ => Ok(()),
                    }
                }
                Some(Message::Focus(f)) => {
                    focused = f;
                    match controls.as_ref().filter(|_| active && dormant && f) {
                        Some(c) => {
                            dormant = false;
                            wake(c, last.as_ref(), paused)
                        }
                        None => Ok(()),
                    }
                }
                Some(Message::Clear) => {
                    paused = None;
                    paused_since = None;
                    last = None;
                    // Already hidden while stepped aside.
                    let was = active && !dormant;
                    active = false;
                    dormant = false;
                    match controls.as_ref().filter(|_| was) {
                        Some(c) => hide(c),
                        None => Ok(()),
                    }
                }
            };
            if let Err(e) = result {
                crate::diagnostics::warn(&format!("media controls: {e}"));
            }
        }
    }

    const fn status(paused: bool) -> MediaPlaybackStatus {
        if paused { MediaPlaybackStatus::Paused } else { MediaPlaybackStatus::Playing }
    }

    /// The window's media controls, with their buttons wired to the page.
    fn create(app: &AppHandle, hwnd: isize) -> windows::core::Result<SystemMediaTransportControls> {
        let interop = windows::core::factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
        // SAFETY: `hwnd` is the main window's handle, which lives as long as the app.
        let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(HWND(hwnd as *mut core::ffi::c_void)) }?;
        let app = app.clone();
        controls.ButtonPressed(&TypedEventHandler::<SystemMediaTransportControls, SystemMediaTransportControlsButtonPressedEventArgs>::new(move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            let name = match args.Button()? {
                SystemMediaTransportControlsButton::Play => "play",
                SystemMediaTransportControlsButton::Pause => "pause",
                SystemMediaTransportControlsButton::Next => "next",
                SystemMediaTransportControlsButton::Previous => "previous",
                _ => return Ok(()),
            };
            let _ = app.emit(BUTTON_EVENT, name);
            Ok(())
        }))?;
        Ok(controls)
    }

    fn show(c: &SystemMediaTransportControls, shown: &Shown) -> windows::core::Result<()> {
        c.SetIsEnabled(true)?;
        c.SetIsPlayEnabled(true)?;
        c.SetIsPauseEnabled(true)?;
        c.SetIsNextEnabled(shown.can_next)?;
        c.SetIsPreviousEnabled(shown.can_previous)?;
        let display = c.DisplayUpdater()?;
        display.ClearAll()?;
        display.SetType(MediaPlaybackType::Video)?;
        let video = display.VideoProperties()?;
        video.SetTitle(&HSTRING::from(shown.title.as_str()))?;
        video.SetSubtitle(&HSTRING::from(shown.subtitle.as_str()))?;
        if let Some(bytes) = &shown.art {
            // A broken image just leaves the thumbnail out.
            if let Ok(art) = thumbnail(bytes) {
                display.SetThumbnail(&art)?;
            }
        }
        display.Update()
    }

    fn thumbnail(bytes: &[u8]) -> windows::core::Result<RandomAccessStreamReference> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(bytes)?;
        // This thread isn't the UI's, so waiting here blocks nothing.
        writer.StoreAsync()?.get()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        RandomAccessStreamReference::CreateFromStream(&stream)
    }

    fn hide(c: &SystemMediaTransportControls) -> windows::core::Result<()> {
        c.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
        c.DisplayUpdater()?.ClearAll()?;
        c.SetIsEnabled(false)
    }
}

/// Linux's media controls: MPRIS (`org.mpris.MediaPlayer2`) on the session
/// bus. Orbit holds its bus name only while the controls show, which is what
/// lists it on the desktop; stepping aside gives the name back.
#[cfg(target_os = "linux")]
mod mpris {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
    use std::time::Instant;

    use tauri::{AppHandle, Emitter, Manager, WindowEvent};
    use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
    use zbus::object_server::{InterfaceRef, SignalEmitter};
    use zbus::zvariant::{ObjectPath, OwnedValue, Str, Value};
    use zbus::{Connection, fdo, interface};

    use super::{BUTTON_EVENT, DORMANT_AFTER, NowPlaying, clean, dormant_due, public_art_url};

    /// Only one Orbit runs at a time, so the name needs no instance suffix.
    const NAME: &str = "org.mpris.MediaPlayer2.orbit";
    const PATH: &str = "/org/mpris/MediaPlayer2";
    /// Orbit plays one thing at a time: one track id.
    const TRACK: &str = "/app/orbit/Track";
    /// The speeds the player offers (`player_set_speed`).
    const MIN_RATE: f64 = 0.25;
    const MAX_RATE: f64 = 4.0;
    const MICROS: f64 = 1_000_000.0;
    /// The event a seek asked for here reaches the page as: `{ seconds, relative }` (media-session.ts).
    const SEEK_EVENT: &str = "media-controls://seek";

    struct Shown {
        title: String,
        subtitle: String,
        art: Option<String>,
        can_next: bool,
        can_previous: bool,
    }

    /// What the desktop reads: kept by the task below, read by the bus objects.
    #[derive(Default)]
    struct Now {
        /// What's playing, while the controls show.
        shown: Option<Shown>,
        paused: Option<bool>,
        /// Seconds.
        position: f64,
        duration: Option<f64>,
        speed: Option<f64>,
    }

    type Shared = Arc<Mutex<Now>>;

    fn lock(now: &Shared) -> MutexGuard<'_, Now> {
        now.lock().unwrap_or_else(PoisonError::into_inner)
    }

    enum Message {
        Show(Shown),
        Playback(bool),
        Progress { position: Option<f64>, duration: Option<f64>, speed: Option<f64> },
        /// mpv played on after a seek: the next position is a jump.
        Restarted,
        /// The main window got (true) or lost the focus.
        Focus(bool),
        Clear,
    }

    /// Unknown, playing, paused: the last state sent, so each status event doesn't send it again.
    const UNKNOWN: u8 = 0;
    const PLAYING: u8 = 1;
    const PAUSED: u8 = 2;

    pub struct MediaControls {
        tx: UnboundedSender<Message>,
        state: AtomicU8,
    }

    impl MediaControls {
        pub fn new(app: &AppHandle) -> Self {
            let (tx, rx) = unbounded_channel();
            if let Some(window) = app.get_webview_window("main") {
                let focus = tx.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(focused) = event {
                        let _ = focus.send(Message::Focus(*focused));
                    }
                });
            }
            // The bus calls run on a task of their own: never on the player's event thread or the UI's.
            tauri::async_runtime::spawn(run(app.clone(), rx));
            Self { tx, state: AtomicU8::new(UNKNOWN) }
        }

        fn send(&self, message: Message) -> Result<(), String> {
            self.tx.send(message).map_err(|_| "media controls unavailable".into())
        }

        pub async fn set(&self, playing: NowPlaying) -> Result<(), String> {
            self.send(Message::Show(Shown {
                title: clean(&playing.title),
                subtitle: playing.subtitle.as_deref().map(clean).unwrap_or_default(),
                art: playing.poster.as_deref().and_then(public_art_url),
                can_next: playing.can_next,
                can_previous: playing.can_previous,
            }))
        }

        pub fn clear(&self) -> Result<(), String> {
            self.state.store(UNKNOWN, Ordering::SeqCst);
            self.send(Message::Clear)
        }

        pub fn playback(&self, paused: bool) {
            let state = if paused { PAUSED } else { PLAYING };
            if self.state.swap(state, Ordering::SeqCst) != state {
                let _ = self.send(Message::Playback(paused));
            }
        }

        pub fn progress(&self, position: Option<f64>, duration: Option<f64>, speed: Option<f64>) {
            let _ = self.send(Message::Progress { position, duration, speed });
        }

        pub fn restarted(&self) {
            let _ = self.send(Message::Restarted);
        }
    }

    async fn run(app: AppHandle, mut rx: UnboundedReceiver<Message>) {
        let now = Shared::default();
        let mut controls = match Controls::connect(&app, &now).await {
            Ok(controls) => controls,
            Err(e) => {
                crate::diagnostics::warn(&format!("media controls: {e}"));
                // No session bus: messages are still taken, so the page's updates don't fail.
                while rx.recv().await.is_some() {}
                return;
            }
        };
        // Since when it's paused, whether Orbit has the focus, whether the controls stepped aside,
        // and whether the next position follows a seek.
        let mut paused_since: Option<Instant> = None;
        let mut focused = true;
        let mut dormant = false;
        let mut restarted = false;
        loop {
            let active = lock(&now).shown.is_some();
            // A message, or (paused in the background) the time to step aside.
            let wait = paused_since.filter(|_| active && !dormant && !focused).map(|since| DORMANT_AFTER.saturating_sub(since.elapsed()));
            let message = match wait {
                Some(wait) => match tokio::time::timeout(wait, rx.recv()).await {
                    Ok(Some(message)) => Some(message),
                    Ok(None) => break,
                    Err(_) => None,
                },
                None => match rx.recv().await {
                    Some(message) => Some(message),
                    None => break,
                },
            };
            let result = match message {
                None if dormant_due(paused_since.map(|since| since.elapsed()), focused) => {
                    dormant = true;
                    controls.hide().await
                }
                None => Ok(()),
                Some(Message::Show(shown)) => {
                    lock(&now).shown = Some(shown);
                    dormant = false;
                    controls.show().await
                }
                Some(Message::Playback(p)) => {
                    lock(&now).paused = Some(p);
                    paused_since = if p { paused_since.or_else(|| Some(Instant::now())) } else { None };
                    if active && dormant && !p {
                        dormant = false;
                        controls.show().await
                    } else {
                        controls.status_changed().await
                    }
                }
                Some(Message::Focus(f)) => {
                    focused = f;
                    if active && dormant && f {
                        dormant = false;
                        controls.show().await
                    } else {
                        Ok(())
                    }
                }
                Some(Message::Progress { position, duration, speed }) => {
                    let changed = {
                        let mut now = lock(&now);
                        let changed = now.duration != duration || now.speed != speed;
                        now.position = position.unwrap_or(0.0);
                        (now.duration, now.speed) = (duration, speed);
                        changed
                    };
                    let seeked = position.filter(|_| std::mem::take(&mut restarted));
                    controls.progress(changed, seeked).await
                }
                Some(Message::Restarted) => {
                    restarted = true;
                    Ok(())
                }
                Some(Message::Clear) => {
                    {
                        let mut now = lock(&now);
                        now.shown = None;
                        now.paused = None;
                    }
                    paused_since = None;
                    dormant = false;
                    restarted = false;
                    controls.hide().await
                }
            };
            if let Err(e) = result {
                crate::diagnostics::warn(&format!("media controls: {e}"));
            }
        }
    }

    /// The bus connection, with the MPRIS objects served on it.
    struct Controls {
        bus: Connection,
        player: InterfaceRef<Player>,
        /// Whether Orbit holds its MPRIS name: listed on the desktop.
        listed: bool,
    }

    impl Controls {
        async fn connect(app: &AppHandle, now: &Shared) -> zbus::Result<Self> {
            let bus = zbus::connection::Builder::session()?
                .serve_at(PATH, Root { app: app.clone() })?
                .serve_at(PATH, Player { app: app.clone(), now: now.clone() })?
                .build()
                .await?;
            let player = bus.object_server().interface::<_, Player>(PATH).await?;
            Ok(Self { bus, player, listed: false })
        }

        /// Listed on the desktop (which then reads everything), or, already listed, what changed.
        async fn show(&mut self) -> zbus::Result<()> {
            if !self.listed {
                self.bus.request_name(NAME).await?;
                self.listed = true;
                return Ok(());
            }
            let (player, emitter) = (self.player.get().await, self.player.signal_emitter());
            player.metadata_changed(emitter).await?;
            player.playback_status_changed(emitter).await?;
            player.can_go_next_changed(emitter).await?;
            player.can_go_previous_changed(emitter).await?;
            player.can_seek_changed(emitter).await
        }

        async fn hide(&mut self) -> zbus::Result<()> {
            if self.listed {
                self.listed = false;
                self.bus.release_name(NAME).await?;
            }
            Ok(())
        }

        async fn status_changed(&self) -> zbus::Result<()> {
            if !self.listed {
                return Ok(());
            }
            self.player.get().await.playback_status_changed(self.player.signal_emitter()).await
        }

        /// The length or speed `changed`; `seeked` to this position.
        async fn progress(&self, changed: bool, seeked: Option<f64>) -> zbus::Result<()> {
            if !self.listed {
                return Ok(());
            }
            let emitter = self.player.signal_emitter();
            if changed {
                let player = self.player.get().await;
                player.metadata_changed(emitter).await?;
                player.can_seek_changed(emitter).await?;
                player.rate_changed(emitter).await?;
            }
            match seeked {
                Some(position) => Player::seeked(emitter, micros(position)).await,
                None => Ok(()),
            }
        }
    }

    fn micros(seconds: f64) -> i64 {
        // `as` saturates; positions are never negative.
        (seconds.max(0.0) * MICROS) as i64
    }

    fn metadata(now: &Now) -> HashMap<String, OwnedValue> {
        let mut map = HashMap::new();
        let Some(shown) = &now.shown else { return map };
        map.insert("mpris:trackid".into(), OwnedValue::from(ObjectPath::from_static_str_unchecked(TRACK)));
        map.insert("xesam:title".into(), OwnedValue::from(Str::from(shown.title.clone())));
        if !shown.subtitle.is_empty()
            && let Ok(artist) = Value::from(vec![shown.subtitle.clone()]).try_into_owned()
        {
            map.insert("xesam:artist".into(), artist);
        }
        if let Some(art) = &shown.art {
            map.insert("mpris:artUrl".into(), OwnedValue::from(Str::from(art.clone())));
        }
        if let Some(length) = now.duration.filter(|d| d.is_finite() && *d > 0.0) {
            map.insert("mpris:length".into(), OwnedValue::from(micros(length)));
        }
        map
    }

    struct Root {
        app: AppHandle,
    }

    #[interface(name = "org.mpris.MediaPlayer2")]
    impl Root {
        fn raise(&self) {
            crate::tray::show_main(&self.app);
        }

        /// Not offered (`CanQuit` is false): a media applet shouldn't close Orbit.
        fn quit(&self) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("Orbit isn't quit from here".into()))
        }

        #[zbus(property)]
        fn can_quit(&self) -> bool {
            false
        }

        #[zbus(property)]
        fn can_raise(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn has_track_list(&self) -> bool {
            false
        }

        #[zbus(property)]
        fn identity(&self) -> &str {
            "Orbit"
        }

        #[zbus(property)]
        fn supported_uri_schemes(&self) -> Vec<String> {
            Vec::new()
        }

        #[zbus(property)]
        fn supported_mime_types(&self) -> Vec<String> {
            Vec::new()
        }
    }

    /// The player's controls. Buttons go to the page as Windows' do (`BUTTON_EVENT`), and so do
    /// seeks (`SEEK_EVENT`), so the player's lock and Live TV's rules apply to them as to its own.
    /// Volume is left out: Orbit's volume (with its boost) is the page's to set.
    struct Player {
        app: AppHandle,
        now: Shared,
    }

    impl Player {
        fn press(&self, button: &str) {
            if lock(&self.now).shown.is_some() {
                let _ = self.app.emit(BUTTON_EVENT, button);
            }
        }

        fn seek_to(&self, seconds: f64, relative: bool) {
            if seconds.is_finite() && (relative || seconds >= 0.0) && lock(&self.now).shown.is_some() {
                let _ = self.app.emit(SEEK_EVENT, serde_json::json!({ "seconds": seconds, "relative": relative }));
            }
        }
    }

    #[interface(name = "org.mpris.MediaPlayer2.Player")]
    impl Player {
        fn next(&self) {
            self.press("next");
        }

        fn previous(&self) {
            self.press("previous");
        }

        fn pause(&self) {
            self.press("pause");
        }

        fn play_pause(&self) {
            let paused = lock(&self.now).paused.unwrap_or(true);
            self.press(if paused { "play" } else { "pause" });
        }

        /// As the Stop media key does in the player: pauses (closing the player is the page's).
        fn stop(&self) {
            self.press("pause");
        }

        fn play(&self) {
            self.press("play");
        }

        /// Moves by `offset` microseconds.
        fn seek(&self, offset: i64) {
            self.seek_to(offset as f64 / MICROS, true);
        }

        /// Moves to `position` microseconds, if `track_id` is what's playing and it's within the length.
        fn set_position(&self, track_id: ObjectPath<'_>, position: i64) {
            let seconds = position as f64 / MICROS;
            let length = lock(&self.now).duration;
            if track_id.as_str() == TRACK && position >= 0 && length.is_none_or(|l| seconds <= l) {
                self.seek_to(seconds, false);
            }
        }

        fn open_uri(&self, _uri: &str) -> fdo::Result<()> {
            Err(fdo::Error::NotSupported("Orbit doesn't open addresses from here".into()))
        }

        #[zbus(signal)]
        async fn seeked(emitter: &SignalEmitter<'_>, position: i64) -> zbus::Result<()>;

        #[zbus(property)]
        fn playback_status(&self) -> String {
            let now = lock(&self.now);
            match (now.shown.is_some(), now.paused) {
                (false, _) => "Stopped",
                (true, Some(false)) => "Playing",
                (true, _) => "Paused",
            }
            .into()
        }

        #[zbus(property)]
        fn rate(&self) -> f64 {
            lock(&self.now).speed.unwrap_or(1.0)
        }

        #[zbus(property)]
        fn minimum_rate(&self) -> f64 {
            MIN_RATE
        }

        #[zbus(property)]
        fn maximum_rate(&self) -> f64 {
            MAX_RATE
        }

        #[zbus(property)]
        fn metadata(&self) -> HashMap<String, OwnedValue> {
            metadata(&lock(&self.now))
        }

        /// Read when wanted (MPRIS sends no change signal for it); jumps are `Seeked`.
        #[zbus(property(emits_changed_signal = "false"))]
        fn position(&self) -> i64 {
            micros(lock(&self.now).position)
        }

        #[zbus(property)]
        fn can_go_next(&self) -> bool {
            lock(&self.now).shown.as_ref().is_some_and(|s| s.can_next)
        }

        #[zbus(property)]
        fn can_go_previous(&self) -> bool {
            lock(&self.now).shown.as_ref().is_some_and(|s| s.can_previous)
        }

        #[zbus(property)]
        fn can_play(&self) -> bool {
            lock(&self.now).shown.is_some()
        }

        #[zbus(property)]
        fn can_pause(&self) -> bool {
            lock(&self.now).shown.is_some()
        }

        #[zbus(property)]
        fn can_seek(&self) -> bool {
            let now = lock(&self.now);
            now.shown.is_some() && now.duration.is_some()
        }

        #[zbus(property(emits_changed_signal = "const"))]
        fn can_control(&self) -> bool {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_plain_and_short() {
        assert_eq!(clean(" Pilot\u{0007}\n "), "Pilot");
        assert_eq!(clean(&"é".repeat(500)).chars().count(), MAX_TEXT);
    }

    #[test]
    fn steps_aside_only_when_paused_a_while_in_the_background() {
        assert!(dormant_due(Some(DORMANT_AFTER), false));
        assert!(!dormant_due(Some(DORMANT_AFTER), true));
        assert!(!dormant_due(Some(DORMANT_AFTER / 2), false));
        // Playing (not paused) never steps aside.
        assert!(!dormant_due(None, false));
    }

    #[test]
    fn only_plain_public_https_art_reaches_the_desktop() {
        let tmdb = "https://image.tmdb.org/t/p/w500/abc.jpg";
        assert_eq!(public_art_url(tmdb).as_deref(), Some(tmdb));
        assert_eq!(public_art_url("http://image.tmdb.org/t/p/w500/abc.jpg"), None);
        assert_eq!(public_art_url("https://addon.example/poster.jpg?token=secret"), None);
        assert_eq!(public_art_url("https://user:pass@addon.example/poster.jpg"), None);
        assert_eq!(public_art_url("https://127.0.0.1/poster.jpg"), None);
        assert_eq!(public_art_url("https://192.168.1.4/poster.jpg"), None);
        assert_eq!(public_art_url("rpdb-art://localhost/poster-default_tt0111161"), None);
        // RPDB keeps its key in the path; the desktop (and any app on the session bus) would see it.
        assert_eq!(public_art_url("https://api.ratingposterdb.com/t1-SECRETkey/imdb/poster-default/tt0111161.jpg"), None);
        assert_eq!(public_art_url("https://API.RatingPosterDB.com/t1-SECRETkey/imdb/poster-default/tt0111161.jpg"), None);
        assert_eq!(public_art_url(&format!("https://image.tmdb.org/{}.jpg", "a".repeat(3000))), None);
    }

    #[test]
    fn only_jpeg_and_png_thumbnails() {
        assert!(thumbnail_type(Some("image/jpeg")));
        assert!(thumbnail_type(Some("Image/PNG; charset=binary")));
        assert!(!thumbnail_type(Some("image/svg+xml")));
        assert!(!thumbnail_type(Some("text/html")));
        assert!(!thumbnail_type(None));
    }
}
