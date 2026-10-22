//! Pictures for the seek bar (Theme Studio / Settings → Appearance → Seek
//! bar): a tiled bar image and a custom dot. Kept like uploaded profile
//! pictures (avatars.rs): files in Orbit's data folder named `upload-{random}`,
//! a setting stores only that name, and the page reads the bytes back to show
//! them as a blob: URL. Only PNG, JPEG, WebP and GIF (animated is fine) are
//! accepted, by their first bytes rather than a file name.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::avatars::is_upload_name;

/// Seek-bar pictures are tiny; this leaves room for a short animated GIF.
const MAX_BYTES: usize = 2 * 1024 * 1024;
/// More than any number of saved themes could reference.
const MAX_KEEP: usize = 256;

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("theme-images"))
}

fn is_picture(bytes: &[u8]) -> bool {
    crate::wallpaper::is_image(bytes) || bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

/// Saves the image sent as the raw request body and returns its name.
#[tauri::command]
pub async fn theme_image_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected the image's bytes".into()) };
    if bytes.len() > MAX_BYTES {
        return Err("err.picture.too-large-2mb".into());
    }
    if !is_picture(bytes) {
        return Err("err.picture.format-gif".into());
    }
    let dir = dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Unused ones are pruned (theme_image_prune); this only stops a runaway page filling the disk.
    if std::fs::read_dir(&dir).map_err(|e| e.to_string())?.count() >= MAX_KEEP * 2 {
        return Err("err.picture.too-many".into());
    }
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let name = format!("upload-{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>());
    std::fs::write(dir.join(&name), bytes).map_err(|_| "err.picture.save")?;
    Ok(name)
}

/// A saved picture's bytes (empty if it's gone).
#[tauri::command]
pub async fn theme_image_get(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    if !is_upload_name(&name) {
        return Err("invalid picture".into());
    }
    match std::fs::read(dir(&app)?.join(&name)) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(tauri::ipc::Response::new(Vec::new())),
        Err(_) => Err("err.picture.read".into()),
    }
}

/// Removes saved pictures not in `keep` (the page knows which ones its settings and themes use).
#[tauri::command]
pub async fn theme_image_prune(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    if keep.len() > MAX_KEEP {
        return Err("too many pictures".into());
    }
    let Ok(entries) = std::fs::read_dir(dir(&app)?) else { return Ok(()) };
    for name in entries.filter_map(|e| e.ok()?.file_name().into_string().ok()) {
        if is_upload_name(&name) && !keep.contains(&name) {
            let _ = std::fs::remove_file(dir(&app)?.join(name));
        }
    }
    Ok(())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let _ = is_picture(data);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_pictures_by_their_first_bytes() {
        assert!(is_picture(b"GIF89a....") && is_picture(b"GIF87a....") && is_picture(b"\x89PNG\r\n\x1a\n...."));
        assert!(!is_picture(b"<svg xmlns=") && !is_picture(b"GIF") && !is_picture(b""));
    }
}
