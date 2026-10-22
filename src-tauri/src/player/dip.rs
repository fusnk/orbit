//! The audio dip of a smooth skip (Settings → Playback → Smooth skip): the
//! sound fades down while the picture fades to black, the player seeks, and
//! both fade back. A cut in the middle of a line reads as a glitch; a short
//! fade reads as a deliberate jump.
//!
//! It ramps mpv's `volume-gain` (dB, applied on top of `volume`), never the
//! `volume` the person set: the page shows and saves `volume`, so a dip there
//! could end up as their saved level, flash the volume popup, or fight a
//! volume key pressed mid-skip. The gain before the dip is kept as mpv wrote
//! it and put back verbatim, so it returns exactly. It's restored at the end
//! of the rise, by a safety timer if the page never asks (an error, a closed
//! window), and on every open and stop.
//!
//! The ramp runs on the async runtime, never in an mpv callback. An mpv
//! without `volume-gain` (an older system libmpv on Linux) gets no dip; the
//! skip itself is unchanged.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, State};

use super::mpv::Mpv;
use super::PlayerState;

/// How far the sound goes down: quiet enough to hide the cut, not a hard mute.
const DEPTH_DB: f64 = 30.0;
/// mpv's own floor for `volume-gain` (`volume-gain-min`).
const FLOOR_DB: f64 = -96.0;
const STEPS: u32 = 10;
/// The longest fade the page may ask for.
const MAX_MS: u32 = 1000;
/// A dip the page never lifts is lifted after this.
const SAFETY: Duration = Duration::from_secs(3);

#[derive(Default)]
pub(super) struct Dip {
    /// Bumped by every ramp and restore: an older ramp stops when it sees a newer one.
    run: AtomicU64,
    /// The gain before the dip, as mpv wrote it (to restore verbatim) and as a number (to ramp from).
    saved: Mutex<Option<(String, f64)>>,
}

impl Dip {
    /// Puts the gain back as it was before the dip, if one is under way, and stops any ramp.
    pub(super) fn restore(&self, mpv: &Mpv) {
        self.restore_with(None, |text| {
            let _ = mpv.set_property("volume-gain", text);
        });
    }

    /// `restore` through `set`; with `only`, just if ramp `only` is still the latest.
    ///
    /// Under the same lock as a ramp's steps: a stop can't land between a
    /// step's check and its write, which would leave the sound dipped after
    /// the restore with nothing left to bring it back.
    fn restore_with(&self, only: Option<u64>, set: impl FnOnce(&str)) {
        let Ok(mut saved) = self.saved.lock() else {
            self.run.fetch_add(1, Ordering::SeqCst);
            return;
        };
        if only.is_some_and(|run| self.run.load(Ordering::SeqCst) != run) {
            return;
        }
        self.run.fetch_add(1, Ordering::SeqCst);
        if let Some((text, _)) = saved.take() {
            set(&text);
        }
    }

    /// Starts a ramp, stopping any before it: its number and the gain to ramp
    /// around (saved by `read` on the way down), or None with nothing to bring back.
    fn begin(&self, down: bool, read: impl FnOnce() -> Option<(String, f64)>) -> Result<Option<(u64, f64)>, String> {
        let mut saved = self.saved.lock().map_err(|_| "player unavailable")?;
        let run = self.run.fetch_add(1, Ordering::SeqCst) + 1;
        if down && saved.is_none() {
            *saved = Some(read().ok_or("audio dip unavailable")?);
        }
        Ok(saved.as_ref().map(|(_, base)| (run, *base)))
    }

    /// One step of ramp `run`: `set` runs only while no later ramp or restore has come. False once one has.
    fn step(&self, run: u64, set: impl FnOnce()) -> bool {
        let Ok(_saved) = self.saved.lock() else { return false };
        if self.run.load(Ordering::SeqCst) != run {
            return false;
        }
        set();
        true
    }
}

fn gain(mpv: &Mpv) -> Option<(String, f64)> {
    let text = mpv.get_string("volume-gain")?;
    let value = text.trim().parse::<f64>().ok().filter(|v| v.is_finite())?;
    Some((text, value))
}

/// The gain `step` of `STEPS` along a ramp from `from` to `to`.
fn level(from: f64, to: f64, step: u32) -> f64 {
    from + (to - from) * f64::from(step.min(STEPS)) / f64::from(STEPS)
}

/// Lowers the sound over `ms` (`down`), or brings it back to where it was over `ms`.
#[tauri::command]
pub async fn player_audio_dip(app: AppHandle, state: State<'_, PlayerState>, down: bool, ms: u32) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return {
        let _ = (app, state, down, ms);
        Ok(())
    };
    #[cfg(not(target_os = "android"))]
    {
        let mpv = state.mpv(&app)?;
        let Some((run, base)) = state.dip.begin(down, || gain(&mpv))? else {
            // Nothing to bring back.
            return Ok(());
        };
        let from = gain(&mpv).map_or(base, |(_, v)| v);
        let to = if down { (base - DEPTH_DB).max(FLOOR_DB) } else { base };
        let pause = Duration::from_millis(u64::from(ms.min(MAX_MS) / STEPS));
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = tauri::Manager::state::<PlayerState>(&app);
            let set = |text: &str| {
                let _ = mpv.set_property("volume-gain", text);
            };
            for step in 1..=STEPS {
                tokio::time::sleep(pause).await;
                if !state.dip.step(run, || set(&format!("{:.2}", level(from, to, step)))) {
                    return;
                }
            }
            if !down {
                // Exactly as it was, not the last step's rounding.
                state.dip.restore_with(Some(run), set);
                return;
            }
            tokio::time::sleep(SAFETY).await;
            state.dip.restore_with(Some(run), set);
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ramps_end_where_they_aim() {
        assert_eq!(level(0.0, -30.0, 0), 0.0);
        assert_eq!(level(0.0, -30.0, STEPS), -30.0);
        assert_eq!(level(-30.0, 0.0, STEPS / 2), -15.0);
        assert_eq!(level(0.0, -30.0, STEPS + 5), -30.0);
    }

    #[test]
    fn a_stop_during_a_ramp_step_leaves_the_sound_restored() {
        use std::sync::{Arc, Mutex as Gain};
        let dip = Arc::new(Dip::default());
        let gain = Arc::new(Gain::new(String::from("0.000000")));
        let (run, _) = dip.begin(true, || Some((gain.lock().unwrap().clone(), 0.0))).unwrap().unwrap();
        let mut stop = None;
        let stepped = dip.step(run, || {
            // Stop arrives after the step's check, before its write lands.
            let (d, g) = (dip.clone(), gain.clone());
            stop = Some(std::thread::spawn(move || d.restore_with(None, |text| *g.lock().unwrap() = text.to_string())));
            std::thread::sleep(Duration::from_millis(50));
            *gain.lock().unwrap() = String::from("-30.00");
        });
        stop.unwrap().join().unwrap();
        assert!(stepped);
        assert_eq!(*gain.lock().unwrap(), "0.000000");
        // The ramp's next step sees the stop and writes nothing.
        assert!(!dip.step(run, || *gain.lock().unwrap() = String::from("-30.00")));
        assert_eq!(*gain.lock().unwrap(), "0.000000");
    }
}
