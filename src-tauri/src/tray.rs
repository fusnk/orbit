//! Settings → General → "When I close the window: Minimize to tray". Closing
//! then hides the window (pausing any video) and shows a tray icon; clicking
//! the icon brings Orbit back, and its menu can quit (saving first, see quit.rs). The icon only shows
//! while the window is hidden. The page names the menu's items in the
//! person's language (`tray_labels`); until then they're in English.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent, Wry};

use crate::db::Db;
use crate::player::PlayerState;
use crate::quit::{self, Quit};

const TRAY: &str = "main";
const CLOSE_SETTING: &str = "general.close";
/// Longer than any language's "Show Orbit" needs.
const MAX_LABEL_CHARS: usize = 64;

/// The tray menu's items, kept so `tray_labels` can rename them.
struct Items {
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Orbit", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?;
    app.manage(Items { show: show.clone(), quit: quit.clone() });
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("Orbit")
        .menu(&Menu::with_items(app, &[&show, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => quit::request(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?.set_visible(false)
}

/// Brings the main window back (from the tray, or when Orbit is launched again).
pub fn show_main(app: &AppHandle) {
    if let Some(player) = app.try_state::<PlayerState>() {
        player.window_shown();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_visible(false);
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let app = window.app_handle();
    if window.label() != "main" {
        return;
    }
    let to_tray = app.state::<Db>().setting(CLOSE_SETTING).is_some_and(|v| v == "tray");
    // Without a tray icon (it failed to install at startup) a hidden window
    // couldn't be brought back, so closing closes.
    let Some(tray) = app.tray_by_id(TRAY).filter(|_| to_tray) else {
        // Closing quits: the page saves first (see quit.rs). Closed again while
        // it does, the window just closes.
        if !app.state::<Quit>().started() {
            api.prevent_close();
            quit::request(app);
        }
        return;
    };
    api.prevent_close();
    // Nobody is watching a hidden window.
    app.state::<PlayerState>().hide_to_tray();
    let _ = window.hide();
    let _ = tray.set_visible(true);
}

/// A menu label from the page: one line of printable text, not too long.
fn label(text: &str) -> Option<&str> {
    let text = text.trim();
    (!text.is_empty() && text.chars().count() <= MAX_LABEL_CHARS && !text.chars().any(char::is_control)).then_some(text)
}

/// Names the tray menu's items in the page's language. Without a tray (it
/// couldn't be installed, or on Android) there's nothing to name.
#[tauri::command]
pub fn tray_labels(app: AppHandle, show: String, quit: String) -> Result<(), String> {
    let Some(items) = app.try_state::<Items>() else { return Ok(()) };
    let (Some(show), Some(quit)) = (label(&show), label(&quit)) else { return Err("invalid label".into()) };
    items.show.set_text(show).map_err(|e| e.to_string())?;
    items.quit.set_text(quit).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::label;

    #[test]
    fn takes_one_short_line_of_text() {
        assert_eq!(label("  Afficher Orbit "), Some("Afficher Orbit"));
        assert_eq!(label("إظهار Orbit"), Some("إظهار Orbit"));
        assert_eq!(label(""), None);
        assert_eq!(label("Show\nOrbit"), None);
        assert_eq!(label(&"x".repeat(65)), None);
    }
}
