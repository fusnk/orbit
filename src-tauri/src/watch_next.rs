//! Orbit's Continue Watching on the Android TV home screen (gen/android WatchNext.kt), off until the
//! person turns it on (src/library/watch-next.ts). The page says what to show; this keeps it to public
//! names, whole numbers and https pictures before Android's launcher sees any of it. Not on a PC.

use serde::{Deserialize, Serialize};

/// More than any home-screen row shows.
const MAX_ITEMS: usize = 20;
const MAX_TEXT_CHARS: usize = 200;
const MAX_URL_CHARS: usize = 2048;

#[derive(Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    id: String,
    kind: String,
    title: String,
    season: Option<u32>,
    episode: Option<u32>,
    art: Option<String>,
    #[serde(default)]
    wide: bool,
    #[serde(default)]
    position_ms: u64,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    next: bool,
    last_watched: u64,
}

fn clean(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(MAX_TEXT_CHARS).collect::<String>().trim().to_owned()
}

/// The launcher fetches the picture itself, so: https, on the internet (not this TV or the home
/// network), and with no sign-in in the address.
fn public_https(art: &str) -> bool {
    reqwest::Url::parse(art).is_ok_and(|url| url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && !crate::addons::net::is_private_host(&url))
}

/// The items fit to hand over: unnamed or oddly typed ones dropped, text cleaned and capped, and a
/// picture only when it's a public https address (Jellyfin and Plex art needs a sign-in, so it never goes).
fn checked(items: Vec<Item>) -> Vec<Item> {
    items
        .into_iter()
        .filter_map(|item| {
            let id = clean(&item.id);
            let title = clean(&item.title);
            if id.is_empty() || title.is_empty() || !matches!(item.kind.as_str(), "movie" | "series") {
                return None;
            }
            let art = item.art.filter(|art| art.len() <= MAX_URL_CHARS && public_https(art));
            Some(Item { id, title, art, ..item })
        })
        .take(MAX_ITEMS)
        .collect()
}

/// Shows `items` on the home screen, in place of what was there; an empty list clears it.
#[tauri::command]
pub async fn watch_next_publish(items: Vec<Item>) -> Result<(), String> {
    let items = checked(items);
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || crate::player::android::watch_next(&items)).await.map_err(|_| "unavailable")?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = items;
        Err("unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, art: Option<&str>) -> Item {
        Item { id: id.into(), kind: "movie".into(), title: "A film".into(), season: None, episode: None, art: art.map(Into::into), wide: true, position_ms: 1, duration_ms: 2, next: false, last_watched: 3 }
    }

    #[test]
    fn keeps_public_https_art_only() {
        let out = checked(vec![item("a", Some("https://image.tmdb.org/t/p/w780/x.jpg")), item("b", Some("http://example.com/x.jpg")), item("c", Some("https://127.0.0.1/x.jpg")), item("d", Some("jellyfin-art://item/1"))]);
        let art: Vec<_> = out.iter().map(|i| i.art.as_deref()).collect();
        assert_eq!(art, [Some("https://image.tmdb.org/t/p/w780/x.jpg"), None, None, None]);
    }

    #[test]
    fn drops_unnamed_and_unknown_kinds_and_caps_the_list() {
        let mut odd = item("x", None);
        odd.kind = "tv".into();
        let mut items = vec![item(" \u{7}", None), odd];
        items.extend((0..30).map(|n| item(&format!("t{n}"), None)));
        let out = checked(items);
        assert_eq!(out.len(), MAX_ITEMS);
        assert_eq!(out[0].id, "t0");
    }

    #[test]
    fn text_is_stripped_of_control_characters_trimmed_and_capped() {
        let mut long = item("  tt1\u{0}\n ", None);
        long.title = format!(" {}\u{1b}[31m", "é".repeat(300));
        long.kind = "series".into();
        let out = checked(vec![long]);
        assert_eq!(out[0].id, "tt1");
        assert_eq!(out[0].title.chars().count(), MAX_TEXT_CHARS - 1);
        assert!(!out[0].title.chars().any(char::is_control));
        // The rest of the item is passed on as given.
        assert_eq!((out[0].kind.as_str(), out[0].position_ms, out[0].duration_ms, out[0].last_watched), ("series", 1, 2, 3));
    }

    #[test]
    fn art_with_a_sign_in_or_too_long_an_address_is_dropped() {
        let long = format!("https://image.tmdb.org/{}.jpg", "a".repeat(MAX_URL_CHARS));
        let out = checked(vec![
            item("a", Some("https://user:pass@image.tmdb.org/x.jpg")),
            item("b", Some("https://token@image.tmdb.org/x.jpg")),
            item("c", Some(&long)),
            item("d", Some("https://192.168.1.4/x.jpg")),
            item("e", Some("https://[::1]/x.jpg")),
            item("f", Some("https://localhost/x.jpg")),
            item("g", Some("not a url")),
        ]);
        assert_eq!(out.len(), 7);
        assert!(out.iter().all(|i| i.art.is_none()), "{out:?}");
    }

    #[test]
    fn the_page_cannot_add_fields_or_leave_out_required_ones() {
        let ok = serde_json::json!({"id": "tt1", "kind": "movie", "title": "A", "season": null, "episode": null, "art": null, "lastWatched": 1});
        assert!(serde_json::from_value::<Item>(ok.clone()).is_ok());
        let mut extra = ok.clone();
        extra["intent"] = "android-app://evil".into();
        assert!(serde_json::from_value::<Item>(extra).is_err());
        let mut negative = ok.clone();
        negative["positionMs"] = (-1).into();
        assert!(serde_json::from_value::<Item>(negative).is_err());
        let mut missing = ok;
        missing.as_object_mut().unwrap().remove("lastWatched");
        assert!(serde_json::from_value::<Item>(missing).is_err());
    }
}
