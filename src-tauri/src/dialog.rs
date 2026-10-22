//! The system's own folder and save dialogs, opened from Rust.
//!
//! The page asks a command (choose the downloads folder, save an export) and
//! gets back at most the path the person picked. The dialog plugin's own
//! commands stay unreachable (no `dialog:` permission is granted), so the
//! WebView can't open dialogs itself or gain file-system access through one,
//! and everything written to the chosen path is built or checked here.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};
use tokio::sync::oneshot;

/// A file dialog in front of the main window, so it is modal to it.
fn builder(app: &AppHandle) -> FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    #[cfg(not(target_os = "android"))]
    let dialog = match app.get_webview_window("main") {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    };
    dialog
}

/// Waits for the dialog's callback without holding a runtime thread; `None` when it was cancelled.
async fn answer(open: impl FnOnce(Box<dyn FnOnce(Option<FilePath>) + Send>)) -> Option<PathBuf> {
    let (tx, rx) = oneshot::channel();
    open(Box::new(move |picked| {
        let _ = tx.send(picked);
    }));
    rx.await.ok().flatten().and_then(|picked| picked.into_path().ok())
}

/// `{stem}.{ext}`, or `{stem}-2.{ext}` and so on if that's already in `dir`:
/// what the save dialog suggests, so saving straight away replaces nothing.
fn unused_name(dir: &Path, stem: &str, ext: &str) -> String {
    let mut name = format!("{stem}.{ext}");
    for n in 2..100 {
        if !dir.join(&name).exists() {
            break;
        }
        name = format!("{stem}-{n}.{ext}");
    }
    name
}

/// Asks where to save a file of type `filter` (`ext`), starting in Downloads with `{stem}.{ext}`.
async fn save_file(app: &AppHandle, stem: &str, filter: &str, ext: &str) -> Option<PathBuf> {
    let downloads = app.path().download_dir().ok();
    let name = downloads.as_deref().map_or_else(|| format!("{stem}.{ext}"), |dir| unused_name(dir, stem, ext));
    let mut dialog = builder(app).add_filter(filter, &[ext]).set_file_name(name);
    if let Some(dir) = downloads {
        dialog = dialog.set_directory(dir);
    }
    answer(|done| dialog.save_file(done)).await
}

/// Asks where to save a JSON file, starting in Downloads with `{stem}.json`.
pub async fn save_json(app: &AppHandle, stem: &str) -> Option<PathBuf> {
    save_file(app, stem, "JSON", "json").await
}

/// Asks where to save a calendar file, starting in Downloads with `{stem}.ics`.
pub async fn save_ics(app: &AppHandle, stem: &str) -> Option<PathBuf> {
    save_file(app, stem, "iCalendar", "ics").await
}

/// Asks for a folder, starting in `start` when it exists. Android has no folder dialog.
pub async fn pick_folder(app: &AppHandle, start: Option<&Path>) -> Option<PathBuf> {
    #[cfg(not(target_os = "android"))]
    {
        let mut dialog = builder(app);
        if let Some(dir) = start.filter(|d| d.is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        answer(|done| dialog.pick_folder(done)).await
    }
    #[cfg(target_os = "android")]
    {
        let _ = (app, start);
        None
    }
}

/// Asks for a program file (`.exe` on Windows). Android has no external players.
pub async fn pick_program(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(not(target_os = "android"))]
    {
        let dialog = builder(app);
        #[cfg(windows)]
        let dialog = dialog.add_filter("Programs", &["exe"]);
        answer(|done| dialog.pick_file(done)).await
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_a_name_not_yet_taken() {
        let dir = std::env::temp_dir().join(format!("orbit-dialog-name-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unused_name(&dir, "orbit-backup", "json"), "orbit-backup.json");
        std::fs::write(dir.join("orbit-backup.json"), "").unwrap();
        std::fs::write(dir.join("orbit-backup-2.json"), "").unwrap();
        assert_eq!(unused_name(&dir, "orbit-backup", "json"), "orbit-backup-3.json");
        assert_eq!(unused_name(&dir, "orbit-backup", "ics"), "orbit-backup.ics");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
