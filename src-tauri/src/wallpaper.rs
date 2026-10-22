//! The person's own wallpaper image (Settings → Appearance), kept as a file
//! in Orbit's data folder. Only PNG, JPEG and WebP are accepted, checked by
//! their first bytes rather than trusting a file name.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 20 * 1024 * 1024;
const FILE: &str = "wallpaper";

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(FILE))
}

pub(crate) fn is_image(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n") || bytes.starts_with(&[0xff, 0xd8, 0xff]) || (bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP")
}

/// Saves the image sent as the raw request body.
#[tauri::command]
pub async fn wallpaper_set(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the image's bytes".into());
    };
    if bytes.len() > MAX_BYTES {
        return Err("err.wallpaper.too-large".into());
    }
    if !is_image(bytes) {
        return Err("err.picture.format".into());
    }
    // Written beside it, then renamed over it: a crash mid-save leaves the old
    // wallpaper (or none), never a half-written file.
    let path = path(&app)?;
    let temp = path.with_extension("tmp");
    let saved = std::fs::write(&temp, bytes).and_then(|()| std::fs::rename(&temp, &path));
    if saved.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    saved.map_err(|_| "err.wallpaper.save".into())
}

/// The saved image's bytes, or an empty response when there is none.
#[tauri::command]
pub async fn wallpaper_get(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    match std::fs::read(path(&app)?) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(tauri::ipc::Response::new(Vec::new())),
        Err(_) => Err("err.wallpaper.read".into()),
    }
}

#[tauri::command]
pub async fn wallpaper_clear(app: AppHandle) -> Result<(), String> {
    match std::fs::remove_file(path(&app)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("err.wallpaper.remove".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_images_by_their_first_bytes() {
        assert!(is_image(b"\x89PNG\r\n\x1a\n...."));
        assert!(is_image(&[0xff, 0xd8, 0xff, 0xe0]));
        assert!(is_image(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!is_image(b"<svg xmlns=") && !is_image(b"GIF89a") && !is_image(b""));
    }
}
