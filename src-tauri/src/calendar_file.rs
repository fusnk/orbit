//! Release Radar's "Export to calendar (.ics)": the page builds the
//! iCalendar text (src/catalog/ical.ts); this checks it is one and writes it
//! where the person chose. Nothing else is written, and nothing is fetched.

use tauri::AppHandle;

use crate::backup::chrono_date;
use crate::library::now_ms;

/// A Radar of a few hundred releases is well under this.
const MAX_BYTES: usize = 2 * 1024 * 1024;

/// Whether `text` has an iCalendar file's shape: it opens and closes a
/// VCALENDAR, its lines end in CRLF, and it has no other control characters.
fn is_calendar(text: &str) -> bool {
    text.len() <= MAX_BYTES
        && text.starts_with("BEGIN:VCALENDAR\r\n")
        && text.ends_with("END:VCALENDAR\r\n")
        && text.split("\r\n").all(|line| !line.chars().any(char::is_control))
}

/// Asks where to save the calendar (Downloads suggested), writes it, and
/// returns the path, or `None` if the person cancelled.
#[tauri::command]
pub async fn calendar_export_save(app: AppHandle, text: String) -> Result<Option<String>, String> {
    if !is_calendar(&text) {
        return Err("invalid calendar".into());
    }
    let Some(path) = crate::dialog::save_ics(&app, &format!("orbit-release-radar-{}", chrono_date(now_ms()))).await else { return Ok(None) };
    std::fs::write(&path, text).map_err(|_| "err.file.save")?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_a_calendar() {
        assert!(is_calendar("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nSUMMARY:Caf\u{e9}\\, Paris\r\nEND:VCALENDAR\r\n"));
        for bad in [
            "",
            "{\"json\":true}",
            "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n",
            "BEGIN:VCALENDAR\r\nSUMMARY:a\nb\r\nEND:VCALENDAR\r\n",
            "BEGIN:VCALENDAR\r\nSUMMARY:a\u{0}\r\nEND:VCALENDAR\r\n",
            "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\ntrailing",
        ] {
            assert!(!is_calendar(bad), "{bad:?}");
        }
        let huge = format!("BEGIN:VCALENDAR\r\n{}END:VCALENDAR\r\n", "X:y\r\n".repeat(MAX_BYTES / 5));
        assert!(!is_calendar(&huge));
    }
}
