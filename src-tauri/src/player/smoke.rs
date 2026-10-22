//! CI only (built with `--features smoke-test`, never in a release): a few seconds
//! after start, plays the file named by `ORBIT_SMOKE_PLAY` with the page hidden
//! but for one red label, then prints what mpv reports. A screenshot taken then
//! shows whether video draws beneath the WebView with the page still on top, on
//! a machine nobody sits at (macOS on GitHub's runners).

use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::{PlayerState, TRANSPARENT};

const HIDE_PAGE: &str = "document.documentElement.style.background='transparent';\
document.body.style.background='transparent';\
for (const e of document.body.children) e.style.visibility='hidden';\
const m=document.createElement('div');m.textContent='PAGE ABOVE VIDEO';\
m.style.cssText='position:fixed;left:24px;top:24px;padding:12px 16px;background:#e0245e;color:#fff;font:bold 22px sans-serif;z-index:2147483647;visibility:visible';\
document.body.appendChild(m);";

pub fn start(app: &AppHandle) {
    let Ok(file) = std::env::var("ORBIT_SMOKE_PLAY") else { return };
    let app = app.clone();
    let _ = std::thread::Builder::new().name("smoke-test".into()).spawn(move || {
        std::thread::sleep(Duration::from_secs(10));
        println!("smoke: play {:?}", play(&app, &file));
        for _ in 0..10 {
            std::thread::sleep(Duration::from_secs(2));
            println!("smoke: {}", status(&app));
        }
    });
}

fn play(app: &AppHandle, file: &str) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no main window")?;
    window.eval(HIDE_PAGE).map_err(|e| e.to_string())?;
    window.set_background_color(Some(TRANSPARENT)).map_err(|e| e.to_string())?;
    let mpv = app.state::<PlayerState>().mpv(app)?;
    // mpv's own log, for when the file doesn't start.
    if let Ok(log) = std::env::var("ORBIT_SMOKE_LOG") {
        mpv.set_property("msg-level", "all=v")?;
        mpv.set_property("log-file", &log)?;
    }
    // GitHub's Macs have no GPU, so mpv can't draw there: "null" still decodes and plays.
    if let Ok(vo) = std::env::var("ORBIT_SMOKE_VO") {
        mpv.set_property("vo", &vo)?;
    }
    mpv.loadfile(file, "replace", "")?;
    mpv.set_property("pause", "no")
}

fn status(app: &AppHandle) -> String {
    let Some(mpv) = app.state::<PlayerState>().running() else { return "mpv not running".into() };
    ["mpv-version", "current-vo", "hwdec-current", "time-pos", "video-params/w", "video-params/h", "osd-width", "osd-height", "pause", "core-idle", "idle-active", "playlist-count", "path"]
        .iter()
        .map(|p| format!("{p}={}", mpv.get_string(p).unwrap_or_else(|| "-".into())))
        .collect::<Vec<_>>()
        .join(" ")
}
