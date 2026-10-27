//! Quitting with the page's last saves. Closing the window (when it doesn't
//! go to the tray) and the tray's Quit don't end Orbit at once: the page is
//! told (`app://quitting`) so the video playing saves where it got to and
//! what's waiting for Stremio is sent, and answers `quit_ready`. Ending
//! straight away lost everything since the player's last periodic save
//! (up to 15 s, enough to leave a finished episode unwatched) and the
//! Stremio changes not yet sent.
//!
//! The page gets `PAGE_WAIT` at most, so one that hangs (or never loaded)
//! can't keep Orbit open: after that Orbit ends anyway. Closing the window a
//! second time while it waits closes it at once (see tray.rs).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

const QUITTING_EVENT: &str = "app://quitting";
/// Longer than the page's own limit for sending to Stremio (app/quit.ts `SEND_WAIT_MS`).
const PAGE_WAIT: Duration = Duration::from_secs(4);

#[derive(Default)]
pub struct Quit {
    asked: AtomicBool,
}

impl Quit {
    /// True the first time only: whether this request is the one that asks the page.
    fn first(&self) -> bool {
        !self.asked.swap(true, Ordering::SeqCst)
    }

    /// Whether Orbit is already on its way out.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub fn started(&self) -> bool {
        self.asked.load(Ordering::SeqCst)
    }
}

/// Starts quitting: asks the page to save, and ends Orbit once it has or
/// `PAGE_WAIT` has passed. Asked again meanwhile (the tray's Quit twice), Orbit ends now.
#[cfg_attr(target_os = "android", allow(dead_code))]
pub fn request(app: &AppHandle) {
    if !app.state::<Quit>().first() {
        app.exit(0);
        return;
    }
    // Nothing there to save: no page to ask.
    let Some(window) = app.get_webview_window("main") else {
        app.exit(0);
        return;
    };
    if window.emit(QUITTING_EVENT, ()).is_err() {
        app.exit(0);
        return;
    }
    // Gone from the screen at once, as a close looks; the page keeps running while it saves.
    let _ = window.hide();
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PAGE_WAIT);
        handle.exit(0);
    });
}

/// The menu item that replaces the macOS app menu's own Quit.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const MENU_QUIT: &str = "app-quit";

/// Whether an app-menu item is the stock Quit, which `menu_quit` replaces.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_stock_quit(text: &str) -> bool {
    text.starts_with("Quit")
}

/// On macOS, Cmd+Q is the app menu's Quit, which ended Orbit at once and skipped
/// the page's last saves (macOS gives no chance to wait). It's replaced by one
/// that quits as closing the window does.
#[cfg(target_os = "macos")]
pub fn menu_quit(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app.handle())?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        for item in app_menu.items()? {
            if let MenuItemKind::Predefined(stock) = &item
                && is_stock_quit(&stock.text()?)
            {
                app_menu.remove(stock)?;
            }
        }
        app_menu.append(&MenuItem::with_id(app, MENU_QUIT, "Quit Orbit", true, Some("CmdOrCtrl+Q"))?)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == MENU_QUIT {
            request(app);
        }
    });
    Ok(())
}

/// The page has saved what it had to: Orbit ends.
#[tauri::command]
pub fn quit_ready(app: AppHandle, quit: tauri::State<'_, Quit>) {
    // Only as the answer to a quit Rust started.
    if quit.started() {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::{Quit, is_stock_quit};

    #[test]
    fn only_the_stock_quit_is_replaced() {
        assert!(is_stock_quit("Quit Orbit"));
        for other in ["About Orbit", "Services", "Hide Orbit", "Hide Others", ""] {
            assert!(!is_stock_quit(other), "{other}");
        }
    }

    #[test]
    fn only_the_first_request_asks_the_page() {
        let quit = Quit::default();
        assert!(quit.first());
        assert!(!quit.first());
        assert!(!quit.first());
    }
}
