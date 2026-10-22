//! Settings → About Orbit → "Open-source licences": opens the bundled
//! THIRD-PARTY-NOTICES.txt (written by `pnpm run notices`, bundled by
//! tauri.conf.json) in the system's text viewer. The path is fixed here, so
//! the page can't use this to open anything else.

use tauri::{AppHandle, Manager};

const NOTICES: &str = "licenses/THIRD-PARTY-NOTICES.txt";

#[tauri::command]
pub async fn licences_open(app: AppHandle) -> Result<(), String> {
    let path = app.path().resource_dir().map_err(|e| e.to_string())?.join(NOTICES);
    if !path.is_file() {
        return Err("the licence file isn't in this build".into());
    }
    #[cfg(windows)]
    let mut cmd = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    crate::browser::launch(cmd.arg(path)).map(|_| ()).map_err(|e| e.to_string())
}
