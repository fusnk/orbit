//! Each profile's favourite episodes: a heart on an episode keeps it in
//! My Library → Favourite episodes. Kept only in Orbit. A row holds what the
//! list shows without the network: the episode's name and still, and a
//! snapshot of its show (as My Library keeps one), plus the episode's video
//! id so it can be played from there. All of it came from an addon, so it's
//! checked here and validated again when the page reads it back.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db::Db;
use crate::library::{MAX_SNAPSHOT_BYTES, check_id, now_ms};
use crate::profiles::ActiveProfile;

/// Enough for any real collection; the cap bounds what's stored and backed up.
pub(crate) const MAX_FAVOURITES: i64 = 5000;
const MAX_NAME_CHARS: usize = 300;
const MAX_STILL_BYTES: usize = 2048;
/// Season and episode numbers beyond this are no real show's.
const MAX_NUMBER: i64 = 100_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FavouriteEpisode {
    pub series_id: String,
    pub season: i64,
    pub episode: i64,
    pub video_id: String,
    /// The episode's name.
    pub title: String,
    /// The episode's picture (https only), if it has one.
    pub still: Option<String>,
    /// The show, as My Library's snapshot of a title.
    pub show: Value,
    pub added_at: i64,
}

/// Checks a favourite as if it came from outside (the page, or a backup); the
/// name is trimmed and an empty still is none.
pub(crate) fn check(entry: &FavouriteEpisode) -> Result<FavouriteEpisode, String> {
    check_id(&entry.series_id)?;
    check_id(&entry.video_id)?;
    if !(0..=MAX_NUMBER).contains(&entry.season) || !(0..=MAX_NUMBER).contains(&entry.episode) {
        return Err("invalid episode number".into());
    }
    let title = entry.title.trim();
    if title.chars().count() > MAX_NAME_CHARS || title.chars().any(char::is_control) {
        return Err("invalid episode name".into());
    }
    let still = entry.still.as_deref().map(str::trim).filter(|s| !s.is_empty());
    // Only https pictures: anything else would be blocked by the CSP or is a downgrade.
    if still.is_some_and(|s| !s.starts_with("https://") || s.len() > MAX_STILL_BYTES || s.chars().any(|c| c.is_control() || c.is_whitespace())) {
        return Err("invalid episode picture".into());
    }
    if !entry.show.is_object() || entry.show.to_string().len() > MAX_SNAPSHOT_BYTES {
        return Err("invalid show".into());
    }
    Ok(FavouriteEpisode { title: title.to_string(), still: still.map(str::to_string), ..entry.clone() })
}

/// The profile's favourites, newest first. A row whose show can't be read is skipped.
pub(crate) fn all(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<FavouriteEpisode>> {
    let mut stmt = conn.prepare(
        "SELECT series_id, season, episode, video_id, title, still, show, added_at FROM favourite_episodes WHERE profile_id = ?1 ORDER BY added_at DESC, series_id, season, episode",
    )?;
    let rows = stmt.query_map([profile], |r| {
        Ok((
            FavouriteEpisode { series_id: r.get(0)?, season: r.get(1)?, episode: r.get(2)?, video_id: r.get(3)?, title: r.get(4)?, still: r.get(5)?, show: Value::Null, added_at: r.get(7)? },
            r.get::<_, String>(6)?,
        ))
    })?;
    let mut found = Vec::new();
    for row in rows {
        let (mut entry, show) = row?;
        if let Ok(show) = serde_json::from_str(&show) {
            entry.show = show;
            found.push(entry);
        }
    }
    Ok(found)
}

/// Saves a checked favourite. `keep_existing`: one already there stays as it
/// is (restoring a backup); otherwise its name, still and show are refreshed
/// and it keeps the time it was first added.
pub(crate) fn save(conn: &Connection, profile: &str, entry: &FavouriteEpisode, keep_existing: bool) -> Result<(), String> {
    let sql = |e: rusqlite::Error| e.to_string();
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM favourite_episodes WHERE profile_id = ?1 AND series_id = ?2 AND season = ?3 AND episode = ?4)",
            params![profile, entry.series_id, entry.season, entry.episode],
            |r| r.get(0),
        )
        .map_err(sql)?;
    if !exists {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM favourite_episodes WHERE profile_id = ?1", [profile], |r| r.get(0)).map_err(sql)?;
        if count >= MAX_FAVOURITES {
            return Err(crate::user_error::coded("favourites.limit", &[("max", &MAX_FAVOURITES.to_string())]));
        }
    }
    conn.execute(
        &format!(
            "INSERT INTO favourite_episodes (profile_id, series_id, season, episode, video_id, title, still, show, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(profile_id, series_id, season, episode) DO {}",
            if keep_existing { "NOTHING" } else { "UPDATE SET video_id = excluded.video_id, title = excluded.title, still = excluded.still, show = excluded.show" }
        ),
        params![profile, entry.series_id, entry.season, entry.episode, entry.video_id, entry.title, entry.still, entry.show.to_string(), entry.added_at],
    )
    .map_err(sql)?;
    Ok(())
}

fn remove(conn: &Connection, profile: &str, series_id: &str, season: i64, episode: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM favourite_episodes WHERE profile_id = ?1 AND series_id = ?2 AND season = ?3 AND episode = ?4",
        params![profile, series_id, season, episode],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn favourite_episode_all(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<FavouriteEpisode>, String> {
    let profile = active.id()?;
    all(&*db.lock()?, &profile).map_err(|e| e.to_string())
}

/// Adds an episode to the favourites (the time it's added is Rust's).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn favourite_episode_add(
    db: State<'_, Db>,
    active: State<'_, ActiveProfile>,
    series_id: String,
    season: i64,
    episode: i64,
    video_id: String,
    title: String,
    still: Option<String>,
    show: Value,
) -> Result<(), String> {
    let entry = check(&FavouriteEpisode { series_id, season, episode, video_id, title, still, show, added_at: now_ms() })?;
    let profile = active.id()?;
    save(&*db.lock()?, &profile, &entry, false)
}

#[tauri::command]
pub async fn favourite_episode_remove(db: State<'_, Db>, active: State<'_, ActiveProfile>, series_id: String, season: i64, episode: i64) -> Result<(), String> {
    check_id(&series_id)?;
    let profile = active.id()?;
    remove(&*db.lock()?, &profile, &series_id, season, episode).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(series: &str, season: i64, episode: i64, added_at: i64) -> FavouriteEpisode {
        FavouriteEpisode {
            series_id: series.into(),
            season,
            episode,
            video_id: format!("{series}:{season}:{episode}"),
            title: " Pilot ".into(),
            still: Some("https://img.example/still.jpg".into()),
            show: json!({"meta": {"id": series, "type": "series", "name": "Show"}}),
            added_at,
        }
    }

    #[test]
    fn checks_what_arrives() {
        let ok = check(&entry("tt1", 1, 2, 5)).unwrap();
        assert_eq!(ok.title, "Pilot");
        assert!(check(&FavouriteEpisode { still: Some("  ".into()), ..entry("tt1", 1, 2, 5) }).unwrap().still.is_none());
        for bad in [
            FavouriteEpisode { series_id: String::new(), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { video_id: "a\u{0}b".into(), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { season: -1, ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { episode: MAX_NUMBER + 1, ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { title: "x".repeat(MAX_NAME_CHARS + 1), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { title: "bell\u{7}".into(), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { still: Some("http://img.example/a.jpg".into()), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { still: Some("javascript:alert(1)".into()), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { show: json!("Show"), ..entry("tt1", 1, 2, 5) },
            FavouriteEpisode { show: json!({"name": "x".repeat(MAX_SNAPSHOT_BYTES)}), ..entry("tt1", 1, 2, 5) },
        ] {
            assert!(check(&bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn rows_belong_to_a_profile_newest_first() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        save(&conn, "main", &check(&entry("tt1", 1, 1, 1)).unwrap(), false).unwrap();
        save(&conn, "main", &check(&entry("tt2", 2, 4, 3)).unwrap(), false).unwrap();
        save(&conn, "kid", &check(&entry("tt1", 1, 1, 2)).unwrap(), false).unwrap();
        let mine = all(&conn, "main").unwrap();
        assert_eq!(mine.iter().map(|e| (e.series_id.as_str(), e.season, e.episode)).collect::<Vec<_>>(), [("tt2", 2, 4), ("tt1", 1, 1)]);
        assert_eq!(mine[1].title, "Pilot");
        assert_eq!(mine[1].show["meta"]["name"], "Show");

        // Adding again refreshes the details but keeps when it was first added; a backup's copy changes nothing.
        save(&conn, "main", &FavouriteEpisode { title: "New name".into(), ..entry("tt1", 1, 1, 9) }, false).unwrap();
        save(&conn, "main", &FavouriteEpisode { title: "Backup".into(), ..entry("tt1", 1, 1, 10) }, true).unwrap();
        let again = all(&conn, "main").unwrap();
        assert_eq!((again[1].title.as_str(), again[1].added_at), ("New name", 1));

        remove(&conn, "main", "tt1", 1, 1).unwrap();
        assert_eq!(all(&conn, "main").unwrap().len(), 1);
        assert_eq!(all(&conn, "kid").unwrap().len(), 1);
    }

    #[test]
    fn a_profile_holds_a_bounded_number() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute_batch(&format!(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {MAX_FAVOURITES})
             INSERT INTO favourite_episodes SELECT 'main', 'tt1', 1, i, 'v' || i, 'E', NULL, '{{}}', i FROM n;"
        ))
        .unwrap();
        assert!(save(&conn, "main", &entry("tt1", 2, 1, 1), false).is_err());
        // One already kept can still be refreshed, and other profiles aren't affected.
        assert!(save(&conn, "main", &entry("tt1", 1, 1, 1), false).is_ok());
        assert!(save(&conn, "kid", &entry("tt1", 2, 1, 1), false).is_ok());
    }
}
