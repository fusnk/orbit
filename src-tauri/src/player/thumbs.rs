//! Seek-bar previews (Settings → Video), the way ThumbFast does it for mpv: a
//! second, windowless mpv opens the same stream with no audio or subtitles,
//! and for each preview seeks to the nearest keyframe and writes that one
//! frame, scaled small, as raw BGRA to a file the page then draws. It runs
//! on a blocking thread, one preview at a time; the page coalesces requests.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use tauri::{AppHandle, Manager, State};

use super::mpv::{Mpv, event};
use super::{STREAM_HARDENING, check_stream_url};

const WIDTH: u32 = 288;
const WAIT_LOADED: Duration = Duration::from_secs(15);
const WAIT_FRAME: Duration = Duration::from_secs(6);

struct Thumbnailer {
    mpv: Mpv,
    out: PathBuf,
    width: u32,
    height: u32,
    loaded: bool,
    /// The start that made it (see `Thumbs`): a later start or stop ends its waits.
    run: u64,
}

impl Drop for Thumbnailer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.out);
    }
}

/// The preview mpv, and a count bumped by every start and stop: a start
/// that a later start or stop overtook (they run on separate threads, in
/// either order) doesn't open its stream, so no preview mpv keeps
/// downloading after the player has moved on.
#[derive(Default)]
pub struct Thumbs(Arc<Mutex<Option<Thumbnailer>>>, Arc<AtomicU64>);

/// Preview height for a video of `width`×`height`: even, and within sensible bounds.
fn preview_height(width: u32, height: u32) -> u32 {
    if width == 0 || height == 0 {
        return 162;
    }
    let h = (f64::from(WIDTH) * f64::from(height) / f64::from(width)).round() as u32;
    (h.clamp(80, 360) / 2) * 2
}

#[derive(Debug, PartialEq)]
enum Waited {
    Arrived,
    /// The stream ended (it couldn't be opened, or broke off): nothing more will come.
    Ended,
    /// Timed out, or previews moved on (`stopped`).
    NotNow,
}

/// Waits for `wanted` from `next` (mpv's next event id, waiting up to the
/// seconds given), dropping other events. Gives up within half a second of
/// `stopped`, so closing the player or opening the next file doesn't wait
/// out the time limit (holding the preview mpv, its download, and the lock).
fn wait_for(mut next: impl FnMut(f64) -> i32, wanted: i32, limit: Duration, stopped: impl Fn() -> bool) -> Waited {
    let until = Instant::now() + limit;
    while let Some(left) = until.checked_duration_since(Instant::now()) {
        if stopped() {
            return Waited::NotNow;
        }
        match next(left.as_secs_f64().min(0.5)) {
            id if id == wanted => return Waited::Arrived,
            // With `keep-open`, the end of the video ends no file: an END_FILE is an error.
            event::SHUTDOWN | event::END_FILE => return Waited::Ended,
            _ => {}
        }
    }
    Waited::NotNow
}

fn modified(path: &PathBuf) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Starts previews for `url` (the playing stream, http/https only) at the
/// video's size. Replaces any previous one.
#[tauri::command]
pub async fn thumbs_start(app: AppHandle, thumbs: State<'_, Thumbs>, url: String, width: u32, height: u32) -> Result<(u32, u32), String> {
    check_stream_url(&url)?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut name = [0u8; 8];
    getrandom::fill(&mut name).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{}.raw", name.iter().map(|b| format!("{b:02x}")).collect::<String>()));
    let library = super::libmpv(&app)?;
    let preview = (WIDTH, preview_height(width, height));
    let (slot, latest) = (thumbs.0.clone(), thumbs.1.clone());
    let run = latest.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = slot.lock().map_err(|_| "previews unavailable")?;
        if latest.load(Ordering::SeqCst) != run {
            return Err("previews stopped".to_string());
        }
        *slot = None;
        let mpv = Mpv::load(&library)?;
        let out_text = out.to_str().ok_or("unusable cache path")?;
        let scale = format!("scale=w={}:h={},format=fmt=bgra", preview.0, preview.1);
        // Encoding mode writes each shown frame to `o`; `update=1` overwrites one file.
        let options: [(&str, &str); 18] = [
            ("o", out_text),
            ("of", "image2"),
            ("ofopts", "update=1"),
            ("ovc", "rawvideo"),
            ("vf", &scale),
            ("aid", "no"),
            ("sid", "no"),
            ("pause", "yes"),
            ("keep-open", "always"),
            ("idle", "yes"),
            ("hr-seek", "no"),
            ("hwdec", "no"),
            ("demuxer-readahead-secs", "0"),
            ("demuxer-max-bytes", "512KiB"),
            ("vd-lavc-skiploopfilter", "all"),
            ("vd-lavc-fast", "yes"),
            ("terminal", "no"),
            ("input-default-bindings", "no"),
        ];
        // The same hardening as the player: no mpv config or scripts, no
        // yt-dlp, and a remote playlist may not reach local files.
        for (name, value) in STREAM_HARDENING.iter().copied().chain(options) {
            mpv.set_option(name, value).map_err(|e| format!("preview option {name}: {e}"))?;
        }
        for name in ["osc", "load-stats-overlay", "load-osd-console", "load-auto-profiles"] {
            let _ = mpv.set_option(name, "no");
        }
        mpv.initialize()?;
        mpv.command(&["loadfile", &url])?;
        *slot = Some(Thumbnailer { mpv, out, width: preview.0, height: preview.1, loaded: false, run });
        Ok::<_, String>(preview)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The frame nearest `seconds` as raw BGRA (width×height×4 bytes), or empty
/// if previews aren't running or the stream didn't answer in time.
#[tauri::command]
pub async fn thumbs_at(thumbs: State<'_, Thumbs>, seconds: f64) -> Result<tauri::ipc::Response, String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("invalid position".into());
    }
    let (slot, latest) = (thumbs.0.clone(), thumbs.1.clone());
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let mut slot = slot.lock().ok()?;
        let t = slot.as_mut()?;
        let run = t.run;
        let stopped = || latest.load(Ordering::SeqCst) != run;
        if !t.loaded {
            match wait_for(|s| t.mpv.wait_event(s).event_id, event::FILE_LOADED, WAIT_LOADED, stopped) {
                Waited::Arrived => t.loaded = true,
                // A stream that won't open isn't waited for again on every hover.
                Waited::Ended => {
                    *slot = None;
                    return None;
                }
                Waited::NotNow => return None,
            }
        }
        // A restart already queued (the first frame after loading, or a seek that timed out last
        // time) would end the wait below at once, and the frame would be the last request's.
        while !matches!(t.mpv.wait_event(0.0).event_id, event::NONE | event::SHUTDOWN) {}
        let before = modified(&t.out);
        t.mpv.command(&["seek", &format!("{seconds:.3}"), "absolute+keyframes"]).ok()?;
        match wait_for(|s| t.mpv.wait_event(s).event_id, event::PLAYBACK_RESTART, WAIT_FRAME, stopped) {
            Waited::Arrived => {}
            Waited::Ended => {
                *slot = None;
                return None;
            }
            Waited::NotNow => return None,
        }
        // The frame is written just after the seek completes.
        let until = Instant::now() + Duration::from_millis(800);
        while modified(&t.out) == before && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(15));
        }
        let bytes = std::fs::read(&t.out).ok()?;
        (bytes.len() == (t.width * t.height * 4) as usize).then_some(bytes)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

/// Playback ended or moved on: closes the preview mpv and its file.
#[tauri::command]
pub async fn thumbs_stop(thumbs: State<'_, Thumbs>) -> Result<(), String> {
    thumbs.1.fetch_add(1, Ordering::SeqCst);
    let slot = thumbs.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut slot) = slot.lock() {
            *slot = None;
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{Waited, event, preview_height, wait_for};
    use std::time::{Duration, Instant};

    #[test]
    fn a_stream_that_wont_open_is_not_waited_out() {
        let started = Instant::now();
        let mut events = [event::START_FILE, event::END_FILE].into_iter();
        let waited = wait_for(|_| events.next().unwrap_or(event::NONE), event::FILE_LOADED, Duration::from_secs(15), || false);
        assert_eq!(waited, Waited::Ended);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_stop_ends_the_wait_at_once() {
        let started = Instant::now();
        let waits = std::cell::Cell::new(0);
        let waited = wait_for(
            |_| {
                waits.set(waits.get() + 1);
                event::NONE
            },
            event::FILE_LOADED,
            Duration::from_secs(15),
            || waits.get() >= 2,
        );
        assert_eq!(waited, Waited::NotNow);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn heights_follow_the_aspect_ratio() {
        assert_eq!(preview_height(1920, 1080), 162);
        assert_eq!(preview_height(1920, 800), 120);
        assert_eq!(preview_height(0, 0), 162);
        assert_eq!(preview_height(100, 1000), 360);
    }
}
