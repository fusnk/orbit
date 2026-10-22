//! The soundtrack of a video on this PC as 8 kHz mono, for finding speech
//! (vad.rs). A second, windowless mpv decodes only the audio, as fast as it
//! can, in encoding mode (like seek-bar previews in thumbs.rs) into a raw
//! file in Orbit's cache, which is read in pieces and deleted.
//!
//! Only for files on this PC (downloads, dropped videos): for a stream it
//! would mean downloading the whole video.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::super::{STREAM_HARDENING, set_required};
use super::super::mpv::{Mpv, event};
use super::vad::{Framer, SAMPLE_RATE};

/// Even a long film decodes in a few minutes; past this something's wrong.
const LIMIT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, PartialEq, Eq)]
pub enum AudioError {
    Cancelled,
    Failed,
}

/// Deletes the raw audio however extraction ends.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Decodes `video`'s audio track `aid` (mpv's id; None for its default) and
/// returns each 10 ms frame's energy. `progress` gets 0..1 now and then.
/// Runs on the calling thread (a blocking one); `cancel` stops it.
pub fn energies(library: &Path, cache: &Path, video: &str, aid: Option<u32>, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<Vec<f32>, AudioError> {
    std::fs::create_dir_all(cache).map_err(|_| AudioError::Failed)?;
    let mut name = [0u8; 8];
    getrandom::fill(&mut name).map_err(|_| AudioError::Failed)?;
    let out = TempFile(cache.join(format!("{}.pcm", name.iter().map(|b| format!("{b:02x}")).collect::<String>())));
    {
        let mpv = Mpv::load(library).map_err(|_| AudioError::Failed)?;
        let out_text = out.0.to_str().ok_or(AudioError::Failed)?;
        let rate = SAMPLE_RATE.to_string();
        let aid = aid.map_or_else(|| "auto".to_string(), |a| a.to_string());
        let options: [(&str, &str); 15] = [
            // The file may have come from an addon: if it's really a playlist or an EDL, it
            // mustn't open what it lists (files on this PC, devices, lavfi). The rest of the
            // hardening (no config or scripts, no yt-dlp, a protocol whitelist) is STREAM_HARDENING, below.
            ("access-references", "no"),
            ("terminal", "no"),
            ("input-default-bindings", "no"),
            // Ends (and stops the encoder) once the file is done.
            ("idle", "no"),
            ("o", out_text),
            ("of", "s16le"),
            ("oac", "pcm_s16le"),
            ("vid", "no"),
            ("sid", "no"),
            ("aid", &aid),
            ("audio-channels", "mono"),
            ("audio-samplerate", &rate),
            // Rumble and explosions carry no speech; without them dialogue stands out.
            ("af", "lavfi=[highpass=f=150]"),
            ("hwdec", "no"),
            ("ocopy-metadata", "no"),
        ];
        for (name, value) in STREAM_HARDENING.iter().copied().chain(options) {
            set_required(&mpv, name, value).map_err(|_| AudioError::Failed)?;
        }
        for name in ["osc", "load-stats-overlay", "load-osd-console", "load-auto-profiles"] {
            let _ = mpv.set_option(name, "no");
        }
        mpv.initialize().map_err(|_| AudioError::Failed)?;
        mpv.command(&["loadfile", video]).map_err(|_| AudioError::Failed)?;
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(AudioError::Cancelled);
            }
            if started.elapsed() > LIMIT {
                return Err(AudioError::Failed);
            }
            let ev = mpv.wait_event(0.25);
            match ev.event_id {
                event::END_FILE => {
                    // SAFETY: END_FILE events carry an mpv_event_end_file.
                    let end = unsafe { &*(ev.data as *const super::super::mpv::EventEndFile) };
                    if end.reason == super::super::mpv::end_reason::ERROR {
                        return Err(AudioError::Failed);
                    }
                    break;
                }
                event::SHUTDOWN => break,
                _ => {}
            }
            let number = |name| mpv.get_string(name).and_then(|v| v.parse::<f64>().ok());
            if let (Some(at), Some(total)) = (number("time-pos"), number("duration"))
                && total > 0.0
            {
                progress((at / total).clamp(0.0, 1.0));
            }
        }
        // Dropping mpv here finishes and closes the output file.
    }
    read_frames(&out.0, cancel)
}

fn read_frames(path: &Path, cancel: &AtomicBool) -> Result<Vec<f32>, AudioError> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|_| AudioError::Failed)?;
    let mut framer = Framer::default();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(AudioError::Cancelled);
        }
        let n = file.read(&mut buf).map_err(|_| AudioError::Failed)?;
        if n == 0 {
            break;
        }
        framer.push_bytes(&buf[..n]);
    }
    Ok(framer.frames)
}
