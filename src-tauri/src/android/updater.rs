//! Android TV updates come from the store, not from GitHub Releases. Keep
//! command compatibility without checking, downloading or installing anything.

use serde_json::{Value, json};
use tauri::AppHandle;

#[derive(Default)]
pub struct Updates;

pub fn start(app: &AppHandle) {
    let _ = app;
}

pub fn install_on_exit(app: &AppHandle) {
    let _ = app;
}

#[tauri::command]
pub fn update_status() -> Value {
    json!({ "enabled": false, "busy": false, "ready": null })
}

#[tauri::command]
pub fn update_check() -> Value {
    json!({ "state": "off" })
}

#[tauri::command]
pub fn update_install() -> Result<(), String> {
    Err("updates are off on this platform".into())
}
