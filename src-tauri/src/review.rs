//! Saving the "Your year in Orbit" card (My Library → Stats) as a PNG in
//! Pictures\Orbit. The page draws the card and sends its bytes raw; this
//! checks they're a PNG of sensible size and makes the file name itself from
//! the year, so the page never chooses where anything is written.

use tauri::{AppHandle, Manager};

/// A 1080×1350 card with five posters is a few MB at most.
const MAX_BYTES: usize = 16 * 1024 * 1024;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// The year from the `orbit-year` header: four digits, within reason.
fn year_of(header: Option<&str>) -> Option<u16> {
    let text = header?;
    if text.len() != 4 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok().filter(|y| (1970..=2200).contains(y))
}

/// Saves the PNG sent as the raw request body and returns its path.
#[tauri::command]
pub async fn review_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected the picture's bytes".into()) };
    if bytes.len() > MAX_BYTES || !bytes.starts_with(PNG) {
        return Err("err.picture.save".into());
    }
    let year = year_of(request.headers().get("orbit-year").and_then(|v| v.to_str().ok())).ok_or("missing the year")?;
    let dir = app.path().picture_dir().map_err(|_| "err.folder.pictures")?.join("Orbit");
    std::fs::create_dir_all(&dir).map_err(|_| "err.folder.pictures-orbit")?;
    // A newer card for the same year replaces the older one.
    let path = dir.join(format!("orbit-{year}-in-review.png"));
    std::fs::write(&path, bytes).map_err(|_| "err.picture.save")?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn years_are_four_plain_digits() {
        assert_eq!(year_of(Some("2026")), Some(2026));
        assert_eq!(year_of(Some("../2026")), None);
        assert_eq!(year_of(Some("20266")), None);
        assert_eq!(year_of(Some("+202")), None);
        assert_eq!(year_of(Some("1066")), None);
        assert_eq!(year_of(None), None);
    }
}
