//! Android TV has no system tray. Keep command compatibility: there's nothing to name.

#[tauri::command]
pub fn tray_labels(show: String, quit: String) -> Result<(), String> {
    let _ = (show, quit);
    Ok(())
}
