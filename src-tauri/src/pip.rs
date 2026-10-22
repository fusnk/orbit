//! Picture in picture: the main window (which mpv draws into) becomes a
//! small, always-on-top video window in a corner of the current screen, and
//! later goes back exactly where and how it was. Window logic only; playback
//! carries on untouched.

// Android keeps only the command's stub below; the window logic is desktop's.
#![cfg_attr(target_os = "android", allow(dead_code, unused_imports))]

use std::sync::{Mutex, TryLockError};

use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, State, WebviewWindow};

/// The window's normal minimum (matches tauri.conf.json).
const NORMAL_MIN: LogicalSize<f64> = LogicalSize { width: 960.0, height: 600.0 };
const PIP_MIN: LogicalSize<f64> = LogicalSize { width: 240.0, height: 135.0 };
const PIP_WIDTH: f64 = 480.0;
const MARGIN: f64 = 24.0;

struct Saved {
    /// Outer position (as `set_position` takes it) and inner size (as `set_size` takes it).
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
}

#[derive(Default)]
pub struct Pip(Mutex<Option<Saved>>);

impl Pip {
    /// Whether the window is in picture in picture, or going in or out of it (`window_pip` holds
    /// the lock meanwhile; never waited for, as that runs while window events are being handled).
    pub fn active(&self) -> bool {
        match self.0.try_lock() {
            Ok(saved) => saved.is_some(),
            Err(TryLockError::WouldBlock) => true,
            Err(TryLockError::Poisoned(saved)) => saved.into_inner().is_some(),
        }
    }
}

/// Height for `width` at the video's `aspect`, kept to sensible shapes.
fn height_for(width: f64, aspect: f64) -> f64 {
    let aspect = if aspect.is_finite() && aspect > 0.0 { aspect.clamp(1.0, 2.6) } else { 16.0 / 9.0 };
    (width / aspect).round()
}

/// Turns picture in picture on (`aspect` = the video's width / height) or off.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn window_pip(window: WebviewWindow, pip: State<'_, Pip>, on: bool, aspect: f64) -> Result<(), String> {
    let err = |e: tauri::Error| e.to_string();
    let mut saved = pip.0.lock().map_err(|_| "unavailable")?;
    if on {
        if saved.is_some() {
            return Ok(());
        }
        // Looked up before anything changes: failing after `saved` is set would leave it set, so the
        // window stayed as it was while every later "on" took it as already in picture in picture.
        let monitor = window.current_monitor().map_err(err)?.ok_or("no screen")?;
        if window.is_fullscreen().map_err(err)? {
            window.set_fullscreen(false).map_err(err)?;
        }
        let maximized = window.is_maximized().map_err(err)?;
        if maximized {
            window.unmaximize().map_err(err)?;
        }
        *saved = Some(Saved { position: window.outer_position().map_err(err)?, size: window.inner_size().map_err(err)?, maximized });
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let size = PhysicalSize::new((PIP_WIDTH * scale).round() as u32, (height_for(PIP_WIDTH, aspect) * scale).round() as u32);
        let margin = (MARGIN * scale).round() as i32;
        let position = PhysicalPosition::new(
            area.position.x + area.size.width as i32 - size.width as i32 - margin,
            area.position.y + area.size.height as i32 - size.height as i32 - margin,
        );
        window.set_min_size(Some(PIP_MIN)).map_err(err)?;
        window.set_size(size).map_err(err)?;
        window.set_position(position).map_err(err)?;
        window.set_always_on_top(true).map_err(err)?;
    } else if let Some(before) = saved.take() {
        window.set_always_on_top(false).map_err(err)?;
        window.set_min_size(Some(NORMAL_MIN)).map_err(err)?;
        // Moved back first, then sized: the small window may have been dragged to a screen with
        // another scale, and moving between scales resizes a window to keep its logical size, which
        // would scale a size set before the move (a window 1.5× too large going from 100% to 150%).
        window.set_position(before.position).map_err(err)?;
        window.set_size(before.size).map_err(err)?;
        if before.maximized {
            window.maximize().map_err(err)?;
        }
        window.set_focus().map_err(err)?;
    }
    Ok(())
}

/// Android has no movable windows; its picture in picture belongs to the native player Activity (docs/android-tv.md).
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn window_pip(_pip: State<'_, Pip>, _on: bool, _aspect: f64) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::{Pip, Saved, height_for};
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn heights_follow_the_video() {
        assert_eq!(height_for(480.0, 16.0 / 9.0), 270.0);
        assert_eq!(height_for(480.0, 2.39), 201.0);
        assert_eq!(height_for(480.0, 0.5), 480.0);
        assert_eq!(height_for(480.0, f64::NAN), 270.0);
    }

    #[test]
    fn active_while_in_picture_in_picture_or_changing() {
        let pip = Pip::default();
        assert!(!pip.active());
        let held = pip.0.lock().unwrap();
        assert!(pip.active());
        drop(held);
        *pip.0.lock().unwrap() = Some(Saved { position: PhysicalPosition::new(0, 0), size: PhysicalSize::new(1280, 800), maximized: false });
        assert!(pip.active());
    }
}
