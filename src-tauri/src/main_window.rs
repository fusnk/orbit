//! The main window: Settings → General → "When Orbit opens" (a normal
//! window, maximized or full screen), on Windows a fix that lets full
//! screen cover the whole screen, and on macOS the window's own buttons.

use serde_json::Value;
use tauri::{App, Manager, WebviewWindowBuilder};

use crate::db::Db;

const LABEL: &str = "main";
/// 'normal', 'maximized' (default) or 'fullscreen'; written by the General settings page.
const OPEN_SETTING: &str = "general.window";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenAs {
    Normal,
    Maximized,
    FullScreen,
}

/// Anything unknown (or nothing saved) opens maximized, as the settings page shows it.
fn open_as(value: Option<&Value>) -> OpenAs {
    match value.and_then(Value::as_str) {
        Some("normal") => OpenAs::Normal,
        Some("fullscreen") => OpenAs::FullScreen,
        _ => OpenAs::Maximized,
    }
}

/// Whether `url` is one of Orbit's own pages: the bundled app (`tauri://localhost`
/// on macOS and Linux, `http(s)://tauri.localhost` on Windows and Android), or
/// the dev server (`dev`) in a dev build. Nothing else may load in a webview:
/// a page from anywhere else would run where Orbit's pages do, so it could pose
/// as Orbit (asking for a debrid key, say). The page shows no links; anything
/// Orbit opens outside goes to the person's browser through `open_external` or
/// `open_addon_configure`, which check the address first.
fn is_app_page(url: &tauri::Url, dev: Option<&tauri::Url>) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let bundled = match url.scheme() {
        "tauri" => url.host_str() == Some("localhost") && url.port().is_none(),
        "http" | "https" => url.host_str() == Some("tauri.localhost") && url.port().is_none(),
        _ => false,
    };
    bundled || dev.is_some_and(|dev| url.origin() == dev.origin())
}

/// Keeps a webview on Orbit's own pages (see `is_app_page`) and refuses every
/// new window (`window.open`, a link with a target): Orbit only ever has its
/// main window, and a new one could load anything.
fn guarded<'a, R: tauri::Runtime, M: Manager<R>>(app: &App<R>, builder: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    let dev = if tauri::is_dev() { app.config().build.dev_url.clone() } else { None };
    builder
        .on_navigation(move |url| {
            let allowed = is_app_page(url, dev.as_ref());
            if !allowed {
                crate::diagnostics::warn(&format!("blocked a page from leaving Orbit for {url}"));
            }
            allowed
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
}

/// Creates the main window (tauri.conf.json describes it with `create: false`)
/// already in the chosen state, so it never appears at one size and then jumps
/// to another. Needs the database managed first.
pub fn create(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let open = open_as(app.state::<Db>().setting(OPEN_SETTING).as_ref());
    let config = app.config().app.windows.iter().find(|w| w.label == LABEL).ok_or("tauri.conf.json has no main window")?;
    // Full screen remembers the 1280×800 window from the config to go back to.
    let builder = guarded(app, WebviewWindowBuilder::from_config(app.handle(), config)?);
    // A Mac window keeps its own close, minimize and zoom buttons, over the page's header
    // (whose start leaves room for them, app/titlebar.ts) instead of drawn ones on the right.
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(mac_buttons::X, mac_buttons::Y));
    // An Android Activity always fills the screen; there's no window state to choose.
    #[cfg(not(target_os = "android"))]
    {
        app.manage(placement::Tracked::default());
        // A normal window opens where it was left: its place, size, screen and maximized state.
        // "Maximized" opens maximized, on the screen it was left on.
        let default = (config.width, config.height);
        let restore = match open {
            OpenAs::Normal => placement::saved(app, default),
            OpenAs::Maximized => placement::saved(app, default).map(|p| placement::Placement { maximized: true, ..p }),
            OpenAs::FullScreen => None,
        };
        // With a rectangle to go back to, `apply` maximizes once the window is on its screen.
        let maximized = restore.as_ref().map_or(open == OpenAs::Maximized, |p| p.maximized && p.rect.is_none());
        // Placed while hidden and shown after, so it doesn't appear centred and then jump.
        let builder = builder.maximized(maximized).fullscreen(open == OpenAs::FullScreen).visible(restore.as_ref().is_none_or(|p| p.rect.is_none()));
        let window = builder.build()?;
        if let Some(placement) = restore.filter(|p| p.rect.is_some()) {
            placement::apply(&window, &placement);
        }
        let tracked = window.clone();
        window.on_window_event(move |event| placement::on_window_event(&tracked, event));
        #[cfg(windows)]
        full_screen::install(&window);
    }
    #[cfg(target_os = "android")]
    {
        let _ = open;
        builder.build()?;
    }
    Ok(())
}

/// The Mac's window buttons hide while the player is open, as the whole header does
/// (and with it the caption buttons elsewhere). A no-op on other systems.
#[tauri::command]
pub fn window_buttons(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac_buttons::show(&window, visible);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, visible);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod mac_buttons {
    use std::ffi::{CStr, c_char, c_void};

    /// The close button's place in the 60px header (--header-height): level with the
    /// header's round buttons, and as far in as the header's start (--space-5).
    pub const X: f64 = 20.0;
    pub const Y: f64 = 23.0;

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "objc", kind = "dylib")]
    unsafe extern "C" {
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
    }

    fn sel(name: &CStr) -> Sel {
        // SAFETY: a NUL-terminated selector name; registering one is thread-safe.
        unsafe { sel_registerName(name.as_ptr()) }
    }

    /// `NSWindowCloseButton`, `NSWindowMiniaturizeButton` and `NSWindowZoomButton`.
    const BUTTONS: [usize; 3] = [0, 1, 2];

    pub fn show(window: &tauri::WebviewWindow, visible: bool) -> Result<(), String> {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || {
                let ns_window = ns_window as Id;
                for kind in BUTTONS {
                    // SAFETY: on the main thread, with the live NSWindow: `standardWindowButton:` takes an
                    // NSWindowButton and returns an NSButton (or nil, which ignores `setHidden:`).
                    unsafe {
                        let send_button = std::mem::transmute::<unsafe extern "C" fn(), unsafe extern "C" fn(Id, Sel, usize) -> Id>(objc_msgSend);
                        let button = send_button(ns_window, sel(c"standardWindowButton:"), kind);
                        let send_hidden = std::mem::transmute::<unsafe extern "C" fn(), unsafe extern "C" fn(Id, Sel, i8)>(objc_msgSend);
                        send_hidden(button, sel(c"setHidden:"), i8::from(!visible));
                    }
                }
            })
            .map_err(|e| e.to_string())
    }
}

/// Saves where the main window is, for the next start (on closing it and on quitting).
#[cfg(not(target_os = "android"))]
pub fn save_placement(app: &tauri::AppHandle) {
    placement::save(app);
}

/// The main window's place, size and maximized state, kept across restarts
/// for "When Orbit opens: Normal window". Positions are physical pixels on the
/// desktop as Windows/macOS/X11 lay it out; a saved place is used only if it's
/// still on a connected screen (a monitor may have been unplugged since).
#[cfg(not(target_os = "android"))]
mod placement {
    use std::sync::Mutex;

    use serde::{Deserialize, Serialize};
    use serde_json::Value;
    use tauri::{App, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

    use crate::db::Db;

    /// Written by the shell only (not a page setting).
    const SETTING: &str = "general.window-placement";
    /// Sizes outside these aren't a real window (a corrupt or hand-edited value).
    const MIN_SIDE: u32 = 200;
    const MAX_SIDE: u32 = 32_768;
    /// The point that must be on a screen: the middle of the window's top strip, where it's dragged from.
    const GRAB_DEPTH: i32 = 16;

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Rect {
        pub x: i32,
        pub y: i32,
        pub width: u32,
        pub height: u32,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
    pub struct Placement {
        /// The normal (not maximized) window; unknown if it was never seen un-maximized.
        pub rect: Option<Rect>,
        pub maximized: bool,
    }

    /// The placement as last seen while the app runs.
    #[derive(Default)]
    pub struct Tracked(Mutex<Option<Placement>>);

    /// A saved placement, if it reads as one.
    pub fn parse(value: Option<&Value>) -> Option<Placement> {
        let placement: Placement = serde_json::from_value(value?.clone()).ok()?;
        let sane = |r: &Rect| (MIN_SIDE..=MAX_SIDE).contains(&r.width) && (MIN_SIDE..=MAX_SIDE).contains(&r.height);
        Some(Placement { rect: placement.rect.filter(sane), ..placement })
    }

    /// A connected screen: its work area, and its scale for sizing a default window on it.
    pub struct Screen {
        pub area: Rect,
        pub scale: f64,
    }

    /// Whether `rect` covers all of `area`: a maximized or full-screen window, not a normal one.
    pub fn covers(rect: Rect, area: Rect) -> bool {
        rect.width >= area.width && rect.height >= area.height
    }

    /// `rect` as it can open on the screens there are now: kept if its top strip is
    /// on one of them, shrunk to fit that one; None if it's on none. One covering
    /// that whole screen (saved by mistake by earlier versions, so "Restore down"
    /// gave a window as big as the screen) becomes a `default`-sized (logical
    /// pixels) window centred there.
    pub fn fit(rect: Rect, screens: &[Screen], default: (f64, f64)) -> Option<Rect> {
        let (x, y) = (rect.x.saturating_add((rect.width / 2) as i32), rect.y.saturating_add(GRAB_DEPTH));
        let screen = screens.iter().find(|s| {
            let s = s.area;
            x >= s.x && y >= s.y && i64::from(x) < i64::from(s.x) + i64::from(s.width) && i64::from(y) < i64::from(s.y) + i64::from(s.height)
        })?;
        let area = screen.area;
        if covers(rect, area) {
            return Some(centred((default.0 * screen.scale) as u32, (default.1 * screen.scale) as u32, area));
        }
        Some(Rect { width: rect.width.min(area.width), height: rect.height.min(area.height), ..rect })
    }

    /// The saved placement, its window rectangle checked against the screens connected now.
    pub fn saved(app: &App, default: (f64, f64)) -> Option<Placement> {
        let placement = parse(app.state::<Db>().setting(SETTING).as_ref())?;
        let screens: Vec<Screen> = app
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| {
                let area = m.work_area();
                Screen { area: Rect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height }, scale: m.scale_factor() }
            })
            .collect();
        Some(Placement { rect: placement.rect.and_then(|r| fit(r, &screens, default)), ..placement })
    }

    /// Puts the (hidden) window where it was, maximizes it there if it was, and shows it.
    pub fn apply(window: &WebviewWindow, placement: &Placement) {
        if let Some(r) = placement.rect {
            // Moved first: on a screen with another scale the move rescales the window, and the size then lands exactly.
            let _ = window.set_position(PhysicalPosition::new(r.x, r.y));
            let _ = window.set_size(PhysicalSize::new(r.width, r.height));
        }
        if placement.maximized {
            let _ = window.maximize();
        }
        let _ = window.show();
        let _ = window.set_focus();
        if let Ok(mut tracked) = window.state::<Tracked>().0.lock() {
            *tracked = Some(*placement);
        }
    }

    /// Whether the window is maximized now, as Windows has it. tao updates its own
    /// flag on WM_SIZE, which comes after the WM_WINDOWPOSCHANGED it reports as
    /// `Moved`: asked during a maximize's `Moved`, it said "not maximized" while the
    /// window already had its maximized rectangle, which was then kept as the
    /// normal one (so "Restore down" gave a screen-sized window after a restart).
    #[cfg(windows)]
    fn is_maximized(window: &WebviewWindow) -> tauri::Result<bool> {
        let hwnd = window.hwnd()?;
        // SAFETY: a plain query on the window's handle.
        Ok(unsafe { windows_sys::Win32::UI::WindowsAndMessaging::IsZoomed(hwnd.0) } != 0)
    }

    #[cfg(not(windows))]
    fn is_maximized(window: &WebviewWindow) -> tauri::Result<bool> {
        window.is_maximized()
    }

    /// Follows moves and resizes. Full screen, minimized and picture in picture aren't places
    /// to come back to; maximized keeps the normal rectangle from before it.
    pub fn on_window_event(window: &WebviewWindow, event: &WindowEvent) {
        match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                let (Ok(maximized), Ok(full), Ok(minimized)) = (is_maximized(window), window.is_fullscreen(), window.is_minimized()) else { return };
                // Nor is picture in picture: the window goes back to where it was before it (see pip.rs),
                // and quitting while in it must not keep the little corner window for the next start.
                if full || minimized || window.try_state::<crate::pip::Pip>().is_some_and(|pip| pip.active()) {
                    return;
                }
                let rect = if maximized {
                    // Moved while maximized (Win+Shift+arrow): the normal rectangle follows to this screen.
                    let before = window.state::<Tracked>().0.lock().ok().and_then(|t| t.and_then(|p| p.rect));
                    match (before, window.current_monitor()) {
                        (Some(r), Ok(Some(m))) => Some(onto(r, Rect { x: m.position().x, y: m.position().y, width: m.size().width, height: m.size().height })),
                        _ => None,
                    }
                } else {
                    // Never a rectangle covering the whole screen: that's a maximized or full-screen
                    // window caught mid-change (leaving full screen restyles it before putting it back).
                    let area = window.current_monitor().ok().flatten().map(|m| {
                        let a = m.work_area();
                        Rect { x: a.position.x, y: a.position.y, width: a.size.width, height: a.size.height }
                    });
                    match (window.outer_position(), window.inner_size()) {
                        (Ok(p), Ok(s)) => Some(Rect { x: p.x, y: p.y, width: s.width, height: s.height }).filter(|r| area.is_none_or(|a| !covers(*r, a))),
                        _ => None,
                    }
                };
                if let Ok(mut tracked) = window.state::<Tracked>().0.lock() {
                    let before = tracked.unwrap_or_default();
                    *tracked = Some(Placement { rect: rect.or(before.rect), maximized });
                }
            }
            WindowEvent::CloseRequested { .. } => save(window.app_handle()),
            _ => {}
        }
    }

    /// `r` unchanged when its centre is on `screen`, else the same size (no bigger than
    /// the screen) centred on it.
    pub fn onto(r: Rect, screen: Rect) -> Rect {
        let (cx, cy) = (r.x + r.width as i32 / 2, r.y + r.height as i32 / 2);
        if cx >= screen.x && cx < screen.x + screen.width as i32 && cy >= screen.y && cy < screen.y + screen.height as i32 {
            return r;
        }
        centred(r.width, r.height, screen)
    }

    /// A `width`×`height` window (no bigger than `screen`) centred on it.
    fn centred(width: u32, height: u32, screen: Rect) -> Rect {
        let (width, height) = (width.min(screen.width), height.min(screen.height));
        Rect { x: screen.x + (screen.width - width) as i32 / 2, y: screen.y + (screen.height - height) as i32 / 2, width, height }
    }

    pub fn save(app: &AppHandle) {
        let Some(placement) = app.try_state::<Tracked>().and_then(|t| t.0.lock().ok().and_then(|p| *p)) else { return };
        if let Ok(value) = serde_json::to_value(placement) {
            let _ = app.state::<Db>().set_setting(SETTING, &value);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;

        const LEFT: Rect = Rect { x: 0, y: 0, width: 1920, height: 1040 };
        const RIGHT: Rect = Rect { x: 1920, y: 0, width: 2560, height: 1400 };

        #[test]
        fn reads_only_real_placements() {
            let saved = json!({ "rect": { "x": 100, "y": 50, "width": 1280, "height": 800 }, "maximized": true });
            assert_eq!(parse(Some(&saved)), Some(Placement { rect: Some(Rect { x: 100, y: 50, width: 1280, height: 800 }), maximized: true }));
            // A size no window has is dropped, the maximized state kept.
            let tiny = json!({ "rect": { "x": 0, "y": 0, "width": 10, "height": 800 }, "maximized": true });
            assert_eq!(parse(Some(&tiny)), Some(Placement { rect: None, maximized: true }));
            for junk in [json!(null), json!("normal"), json!({ "rect": "big" }), json!({ "rect": { "x": 0 } })] {
                assert_eq!(parse(Some(&junk)), None, "{junk}");
            }
            assert_eq!(parse(None), None);
        }

        #[test]
        fn a_maximized_move_carries_the_rectangle_to_the_new_screen() {
            let on_left = Rect { x: 100, y: 100, width: 1280, height: 800 };
            assert_eq!(onto(on_left, LEFT), on_left);
            assert_eq!(onto(on_left, RIGHT), Rect { x: 1920 + 640, y: 300, width: 1280, height: 800 });
            // Too big for the new screen: shrunk to it.
            assert_eq!(onto(Rect { x: 1920, y: 0, width: 2560, height: 1400 }, LEFT), LEFT);
        }

        const DEFAULT: (f64, f64) = (1280.0, 800.0);

        fn screens(areas: &[Rect]) -> Vec<Screen> {
            areas.iter().map(|&area| Screen { area, scale: 1.0 }).collect()
        }

        #[test]
        fn opens_on_a_screen_that_is_still_there() {
            let on_right = Rect { x: 2200, y: 100, width: 1600, height: 900 };
            assert_eq!(fit(on_right, &screens(&[LEFT, RIGHT]), DEFAULT), Some(on_right));
            // That screen was unplugged: not restored there.
            assert_eq!(fit(on_right, &screens(&[LEFT]), DEFAULT), None);
            // Hanging off an edge is fine while its top strip can still be grabbed.
            let hanging = Rect { x: -400, y: 10, width: 1280, height: 800 };
            assert_eq!(fit(hanging, &screens(&[LEFT]), DEFAULT), Some(hanging));
            // Its top above every screen: not reachable.
            assert_eq!(fit(Rect { x: 100, y: -200, width: 1280, height: 800 }, &screens(&[LEFT]), DEFAULT), None);
            // Wider than the screen now (a lower resolution): shrunk to it.
            assert_eq!(fit(Rect { x: 0, y: 0, width: 3000, height: 900 }, &screens(&[LEFT]), DEFAULT), Some(Rect { x: 0, y: 0, width: 1920, height: 900 }));
        }

        #[test]
        fn a_saved_screen_sized_normal_window_opens_at_the_default_size() {
            // What earlier versions saved after a maximize: the maximized rectangle as the normal one.
            let saved = Rect { x: -8, y: -8, width: 2560, height: 1400 };
            assert_eq!(fit(saved, &screens(&[LEFT, RIGHT]), DEFAULT), Some(Rect { x: 320, y: 120, width: 1280, height: 800 }));
            // Centred on the screen it was on, at that screen's scale.
            let on_right = Rect { x: 1920, y: 0, width: 2560, height: 1400 };
            let scaled = [Screen { area: LEFT, scale: 1.0 }, Screen { area: RIGHT, scale: 1.5 }];
            assert_eq!(fit(on_right, &scaled, DEFAULT), Some(Rect { x: 1920 + 320, y: 100, width: 1920, height: 1200 }));
            // A default bigger than the screen is shrunk to it.
            assert_eq!(fit(Rect { x: 0, y: 0, width: 1100, height: 750 }, &screens(&[Rect { x: 0, y: 0, width: 1024, height: 700 }]), DEFAULT), Some(Rect { x: 0, y: 0, width: 1024, height: 700 }));
        }

        #[test]
        fn only_a_window_smaller_than_the_screen_is_a_normal_one() {
            assert!(covers(RIGHT, RIGHT));
            assert!(covers(Rect { x: -8, y: -8, width: 2576, height: 1456 }, RIGHT));
            assert!(!covers(Rect { x: 1920, y: 0, width: 2560, height: 1300 }, RIGHT));
            assert!(!covers(Rect { x: 1920, y: 0, width: 1600, height: 1400 }, RIGHT));
        }
    }
}

/// Full screen entered from a maximized window stopped short of the screen's
/// bottom edge, showing the desktop through a strip of the transparent window.
///
/// tao keeps `WS_MAXIMIZE` while full screen (so leaving it restores the
/// maximized window), and its `WM_NCCALCSIZE` handler for undecorated windows
/// checks "maximized" before "full screen": it shrinks the client area to the
/// monitor's work area, less 1 px on an auto-hidden taskbar's edge (so the
/// taskbar can still be revealed), or above the taskbar when it isn't hidden.
/// That's right for a maximized window, wrong for full screen. This subclass
/// runs before tao's and, only for that combination, keeps the client area as
/// the whole window (the whole monitor). A maximized window covers the whole
/// monitor too, except while the mouse is at an auto-hidden taskbar's edge (see
/// `EDGE_OPEN`).
#[cfg(windows)]
mod full_screen {
    use std::sync::atomic::{AtomicBool, Ordering};

    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromRect, MonitorFromWindow};
    use windows_sys::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows_sys::Win32::UI::Shell::{ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_GETAUTOHIDEBAREX, APPBARDATA, DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetCursorPos, GetWindowLongW, IsWindow, IsZoomed, NCCALCSIZE_PARAMS, PostMessageW, RegisterWindowMessageW, SM_CXPADDEDBORDER, SM_CXSIZEFRAME, SM_CYSIZEFRAME, STYLESTRUCT,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos, WM_NCCALCSIZE, WM_NCDESTROY, WM_STYLECHANGED, WS_CAPTION, WS_MAXIMIZE, WS_MINIMIZE, WS_VISIBLE,
    };

    use crate::diagnostics;

    /// Any number unique among this window's subclasses ("ORBT").
    const ID: usize = 0x4f52_4254;

    /// A maximized window covers the whole monitor: tao leaves 1 px at an
    /// auto-hidden taskbar's edge (so the taskbar isn't taken for covered by a
    /// full-screen app and can still be revealed), and through the transparent
    /// window that pixel showed the desktop as a line along the edge. Instead the
    /// gap opens only while the mouse is at that edge, so the taskbar still
    /// slides up as usual, and closes once the mouse moves well away.
    static EDGE_OPEN: AtomicBool = AtomicBool::new(false);

    /// How often the mouse is checked, and how far from the edge it must go before the gap closes again.
    const CHECK_EVERY: Duration = Duration::from_millis(125);
    /// How often it's looked at otherwise (a normal, minimised or hidden window), just to notice a maximize.
    const IDLE_CHECK_EVERY: Duration = Duration::from_secs(1);
    const CLOSE_AFTER_PX: i32 = 96;

    fn recalc_frame(hwnd: HWND) {
        // SAFETY: a live window; nothing moves, resizes or changes order.
        unsafe { SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) };
    }

    /// The edge of `monitor` with an auto-hidden taskbar, if any.
    fn auto_hide_edge(monitor: RECT) -> Option<u32> {
        [ABE_BOTTOM, ABE_TOP, ABE_LEFT, ABE_RIGHT].into_iter().find(|&edge| {
            // SAFETY: a zeroed APPBARDATA with its size, edge and monitor rectangle, as ABM_GETAUTOHIDEBAREX expects.
            unsafe {
                let mut data: APPBARDATA = std::mem::zeroed();
                data.cbSize = size_of::<APPBARDATA>() as u32;
                data.uEdge = edge;
                data.rc = monitor;
                SHAppBarMessage(ABM_GETAUTOHIDEBAREX, &mut data) != 0
            }
        })
    }

    /// How far `point` is from `edge` of `monitor`, inside it (far when outside).
    fn distance_to_edge(point: POINT, monitor: RECT, edge: u32) -> i32 {
        let inside = point.x >= monitor.left && point.x < monitor.right && point.y >= monitor.top && point.y < monitor.bottom;
        if !inside {
            return i32::MAX;
        }
        match edge {
            ABE_BOTTOM => monitor.bottom - 1 - point.y,
            ABE_TOP => point.y - monitor.top,
            ABE_LEFT => point.x - monitor.left,
            _ => monitor.right - 1 - point.x,
        }
    }

    /// How long until the edge is looked at again: often only while a gap could matter (maximized and
    /// shown), so a window left minimised or in the tray for days doesn't wake the CPU eight times a second.
    fn edge_check_wait(style: u32) -> Duration {
        if style & WS_MAXIMIZE != 0 && style & WS_VISIBLE != 0 && style & WS_MINIMIZE == 0 { CHECK_EVERY } else { IDLE_CHECK_EVERY }
    }

    /// Opens or closes the edge gap as the mouse comes and goes; ends with the window.
    fn watch_edge(window: tauri::WebviewWindow, hwnd: usize) {
        let mut edge: Option<(RECT, Option<u32>, Instant)> = None;
        let mut wait = CHECK_EVERY;
        loop {
            std::thread::sleep(wait);
            let h = hwnd as HWND;
            // SAFETY: plain queries on a window handle, its monitor and the cursor; a gone window ends the loop.
            let open = unsafe {
                if IsWindow(h) == 0 {
                    return;
                }
                wait = edge_check_wait(GetWindowLongW(h, GWL_STYLE) as u32);
                let mut open = false;
                let mut info: MONITORINFO = std::mem::zeroed();
                info.cbSize = size_of::<MONITORINFO>() as u32;
                let mut point = POINT { x: 0, y: 0 };
                if IsZoomed(h) != 0 && GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut info) != 0 && GetCursorPos(&mut point) != 0 {
                    // Which edge the taskbar hides on, looked up again every few seconds (it can be moved).
                    let monitor = info.rcMonitor;
                    let stale = edge.is_none_or(|(rect, _, at)| rect.left != monitor.left || rect.top != monitor.top || at.elapsed() > Duration::from_secs(3));
                    if stale {
                        edge = Some((monitor, auto_hide_edge(monitor), Instant::now()));
                    }
                    if let Some((_, Some(side), _)) = edge {
                        let distance = distance_to_edge(point, monitor, side);
                        open = if EDGE_OPEN.load(Ordering::SeqCst) { distance <= CLOSE_AFTER_PX } else { distance <= 1 };
                    }
                }
                open
            };
            if EDGE_OPEN.swap(open, Ordering::SeqCst) != open {
                // On the window's own thread, in step with its other messages.
                let _ = window.run_on_main_thread(move || recalc_frame(hwnd as HWND));
            }
        }
    }

    pub fn install(window: &tauri::WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else { return };
        let hwnd = hwnd.0;
        // SAFETY: a live window owned by this (the main) thread, as SetWindowSubclass requires.
        if unsafe { SetWindowSubclass(hwnd, Some(subclass), ID, 0) } == 0 {
            diagnostics::warn("full screen fix: could not subclass the window");
        }
        // A window created maximized keeps the client area it had while still
        // hidden (the whole monitor, so an auto-hidden taskbar couldn't be
        // revealed) until its frame is next recalculated; recalculate it now,
        // so it matches a window maximized by hand.
        recalc_frame(hwnd);
        let (window, hwnd) = (window.clone(), hwnd as usize);
        if let Err(e) = std::thread::Builder::new().name("taskbar-edge".into()).spawn(move || watch_edge(window, hwnd)) {
            diagnostics::warn(&format!("taskbar edge: {e}"));
        }
    }

    /// tao drops the caption style only in full screen, so maximized without
    /// it means full screen entered from a maximized window.
    fn full_screen_while_maximized(style: u32) -> bool {
        style & WS_MAXIMIZE != 0 && style & WS_CAPTION == 0
    }

    /// Whether a style change is full screen being left for the maximized window it came from.
    fn leaves_full_screen_for_maximized(old: u32, new: u32) -> bool {
        full_screen_while_maximized(old) && new & WS_MAXIMIZE != 0 && new & WS_CAPTION != 0
    }

    /// Posted by the window to itself once full screen is left for a maximized window (see `subclass`).
    fn remaximize_message() -> u32 {
        static ID: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
        *ID.get_or_init(|| {
            let name: Vec<u16> = "Orbit.Remaximize".encode_utf16().chain([0]).collect();
            // SAFETY: a null-terminated UTF-16 string.
            unsafe { RegisterWindowMessageW(name.as_ptr()) }
        })
    }

    /// Lays a maximized window out again as Windows maximizes one: its screen's
    /// work area with the sizing frame hanging past each edge.
    fn remaximize(hwnd: HWND) {
        // SAFETY: plain queries and a move of a live window owned by this thread.
        unsafe {
            if IsZoomed(hwnd) == 0 || GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CAPTION == 0 {
                return;
            }
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
                return;
            }
            let dpi = GetDpiForWindow(hwnd);
            let padding = GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
            let (fx, fy) = (GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) + padding, GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + padding);
            let work = info.rcWork;
            SetWindowPos(hwnd, std::ptr::null_mut(), work.left - fx, work.top - fy, work.right - work.left + 2 * fx, work.bottom - work.top + 2 * fy, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }

    unsafe extern "system" fn subclass(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, id: usize, _data: usize) -> LRESULT {
        // SAFETY: called by Windows for a live window with this subclass installed.
        unsafe {
            match msg {
                // Leaving full screen for a maximized window, tao restores the
                // placement from before it, which Windows skips for a window that's
                // still maximized: it stayed at the monitor's size and place instead
                // of the maximized one (over a taskbar that isn't hidden, and with no
                // move or resize to tell the page it left full screen). Once tao is
                // done (hence posted), it's laid out as a maximized window again.
                WM_STYLECHANGED if wparam as i32 == GWL_STYLE => {
                    let change = &*(lparam as *const STYLESTRUCT);
                    if leaves_full_screen_for_maximized(change.styleOld, change.styleNew) {
                        PostMessageW(hwnd, remaximize_message(), 0, 0);
                    }
                    DefSubclassProc(hwnd, msg, wparam, lparam)
                }
                m if m == remaximize_message() => {
                    remaximize(hwnd);
                    0
                }
                // Returning 0 without touching the proposed rectangle makes the client area the whole window.
                WM_NCCALCSIZE if wparam != 0 && full_screen_while_maximized(GetWindowLongW(hwnd, GWL_STYLE) as u32) => 0,
                // A maximized window hangs past the monitor's edges by its
                // invisible frame, so its client area is the monitor itself
                // (not the whole window, which would spill onto a monitor beside it).
                WM_NCCALCSIZE if wparam != 0 && !EDGE_OPEN.load(Ordering::SeqCst) && GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_MAXIMIZE != 0 => {
                    // The monitor of the window's new place (it may be moving to another one), as tao does.
                    let params = &mut *(lparam as *mut NCCALCSIZE_PARAMS);
                    let mut info: MONITORINFO = std::mem::zeroed();
                    info.cbSize = size_of::<MONITORINFO>() as u32;
                    if GetMonitorInfoW(MonitorFromRect(&params.rgrc[0], MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
                        return DefSubclassProc(hwnd, msg, wparam, lparam);
                    }
                    params.rgrc[0] = info.rcMonitor;
                    0
                }
                WM_NCDESTROY => {
                    RemoveWindowSubclass(hwnd, Some(subclass), id);
                    DefSubclassProc(hwnd, msg, wparam, lparam)
                }
                _ => DefSubclassProc(hwnd, msg, wparam, lparam),
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::UI::WindowsAndMessaging::{WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW};

        #[test]
        fn only_full_screen_from_maximized_is_taken_over() {
            let base = WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
            // The styles tao gives an undecorated window, as measured.
            assert!(full_screen_while_maximized(base | WS_MAXIMIZE));
            assert!(!full_screen_while_maximized(base | WS_OVERLAPPEDWINDOW | WS_MAXIMIZE));
            assert!(!full_screen_while_maximized(base | WS_OVERLAPPEDWINDOW));
            assert!(!full_screen_while_maximized(base));
        }

        #[test]
        fn the_edge_is_watched_closely_only_while_maximized_and_shown() {
            let base = WS_CLIPSIBLINGS | WS_CLIPCHILDREN | WS_OVERLAPPEDWINDOW;
            assert_eq!(edge_check_wait(base | WS_VISIBLE | WS_MAXIMIZE), CHECK_EVERY);
            // A normal window, one minimised, or one hidden in the tray (still maximized) has no gap to open:
            // looking eight times a second kept the CPU waking for nothing all session.
            assert_eq!(edge_check_wait(base | WS_VISIBLE), IDLE_CHECK_EVERY);
            assert_eq!(edge_check_wait(base | WS_VISIBLE | WS_MINIMIZE), IDLE_CHECK_EVERY);
            assert_eq!(edge_check_wait(base | WS_MAXIMIZE), IDLE_CHECK_EVERY);
        }

        #[test]
        fn only_leaving_full_screen_for_maximized_lays_it_out_again() {
            let base = WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
            let (full, maximized, normal) = (base | WS_MAXIMIZE, base | WS_OVERLAPPEDWINDOW | WS_MAXIMIZE, base | WS_OVERLAPPEDWINDOW);
            assert!(leaves_full_screen_for_maximized(full, maximized));
            // Entering it, leaving it for a normal window, or any other change: left alone.
            assert!(!leaves_full_screen_for_maximized(maximized, full));
            assert!(!leaves_full_screen_for_maximized(base, normal));
            assert!(!leaves_full_screen_for_maximized(normal, maximized));
            assert!(!leaves_full_screen_for_maximized(maximized, maximized));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_window_stays_on_orbits_own_pages() {
        let url = |s: &str| tauri::Url::parse(s).unwrap();
        let dev = url("http://127.0.0.1:1420");
        for ok in ["tauri://localhost/", "tauri://localhost/index.html#/home", "http://tauri.localhost/", "https://tauri.localhost/x"] {
            assert!(is_app_page(&url(ok), None), "{ok}");
        }
        assert!(is_app_page(&url("http://127.0.0.1:1420/#/settings"), Some(&dev)));
        for bad in [
            "https://evil.example/",
            "http://tauri.localhost.evil.example/",
            "http://tauri.localhost:8080/",
            "http://user@tauri.localhost/",
            "tauri://evil/",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,<p>x</p>",
            "http://jellyfin-art.localhost/x",
            "http://127.0.0.1:1421/",
        ] {
            assert!(!is_app_page(&url(bad), Some(&dev)), "{bad}");
        }
        // The dev server only counts in a build that uses it.
        assert!(!is_app_page(&url("http://127.0.0.1:1420/"), None));
    }

    #[test]
    fn opens_maximized_unless_chosen_otherwise() {
        assert_eq!(open_as(None), OpenAs::Maximized);
        assert_eq!(open_as(Some(&json!("maximized"))), OpenAs::Maximized);
        assert_eq!(open_as(Some(&json!("normal"))), OpenAs::Normal);
        assert_eq!(open_as(Some(&json!("fullscreen"))), OpenAs::FullScreen);
        for odd in [json!("Fullscreen"), json!(true), json!(1), json!(null), json!({ "mode": "normal" })] {
            assert_eq!(open_as(Some(&odd)), OpenAs::Maximized, "{odd}");
        }
    }
}
