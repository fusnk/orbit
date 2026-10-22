//! System notifications for new episodes (see src/library/alerts.ts).
//!
//! The WebView never talks to the notification plugin itself: it asks this
//! command with plain text, which is cut to a toast's size here. Episode and
//! show names come from addons, so they're shown as text only (escaped where
//! the notification server reads markup, as Linux's do) and never logged.
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 400;

fn clip(text: &str, max: usize) -> String {
    let cleaned: String = text.chars().filter(|c| !c.is_control()).collect();
    if cleaned.chars().count() <= max {
        return cleaned;
    }
    let mut short: String = cleaned.chars().take(max.saturating_sub(1)).collect();
    short.push('…');
    short
}

/// Shows one system notification. Fails quietly when the system has no notifications to offer.
#[tauri::command]
pub async fn alerts_notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title = clip(&title, MAX_TITLE);
    let body = clip(&body, MAX_BODY);
    // Linux notification servers read the body as markup (`<a href>`, `<img>`), so an
    // addon's episode name could show as a link that looks like it's from Orbit.
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
    let body = escape_markup(&body);
    if title.trim().is_empty() {
        return Err("notification needs a title".into());
    }
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/// The body as plain text for a server that reads markup.
#[cfg_attr(not(all(unix, not(target_os = "macos"), not(target_os = "android"))), allow(dead_code))]
fn escape_markup(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::{clip, escape_markup};

    #[test]
    fn markup_shows_as_text() {
        assert_eq!(escape_markup("<a href=\"https://x\">S1 & S2</a>"), "&lt;a href=\"https://x\"&gt;S1 &amp; S2&lt;/a&gt;");
    }

    #[test]
    fn clips_long_text_and_drops_control_characters() {
        assert_eq!(clip("Sever\u{7}ance\n", 10), "Severance");
        assert_eq!(clip("abcdefghij", 10), "abcdefghij");
        assert_eq!(clip("abcdefghijk", 10), "abcdefghi…");
    }
}
