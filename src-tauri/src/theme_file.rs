//! Exporting a colour theme (Settings → Appearance → Your themes) as a small
//! JSON file, saved where the person picks (Downloads suggested), to share
//! or keep. The page builds the file from colours, a font choice and, from
//! Theme Studio, the layout, seek bar and custom CSS; this only checks it's
//! small, valid JSON and suggests a safe file name.

use tauri::AppHandle;

/// Room for up to 64 KB of custom CSS (escaped in JSON) and the rest.
const MAX_BYTES: usize = 160 * 1024;

/// "Late Night!" as "late-night": letters and digits only, for a file name.
fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= 40 {
            break;
        }
    }
    let out = out.trim_end_matches('-');
    if out.is_empty() { "theme".into() } else { out.into() }
}

/// Asks where to save the theme (Downloads suggested) and returns the path, or `None` if cancelled.
#[tauri::command]
pub async fn theme_export(app: AppHandle, name: String, text: String) -> Result<Option<String>, String> {
    if text.len() > MAX_BYTES || serde_json::from_str::<serde_json::Value>(&text).is_err() {
        return Err("err.theme.save".into());
    }
    let Some(path) = crate::dialog::save_json(&app, &format!("orbit-theme-{}", slug(&name))).await else { return Ok(None) };
    std::fs::write(&path, text).map_err(|_| "err.theme.save")?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let name = slug(&String::from_utf8_lossy(data));
    assert!(!name.contains(['/', '\\']));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_become_safe_file_names() {
        assert_eq!(slug("Late Night!"), "late-night");
        assert_eq!(slug("../../etc/passwd"), "etc-passwd");
        assert_eq!(slug("★★★"), "theme");
        assert_eq!(slug("Été 2026"), "t-2026");
    }
}
