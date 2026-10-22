//! My Library: saved titles with a small display snapshot each.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::db::Db;
use crate::profiles::ActiveProfile;

/// A snapshot is a catalog preview (name, artwork URLs, year, genres…); the
/// cap keeps a misbehaving caller from filling the database.
pub(crate) const MAX_SNAPSHOT_BYTES: usize = 16 * 1024;
/// Addon ids are short (e.g. "tt0133093"); the cap bounds what we store and index.
const MAX_ID_BYTES: usize = 256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    id: String,
    added_at: i64,
    /// Validated by the frontend on read, like any stored JSON.
    title: Value,
}

pub(crate) fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_BYTES || id.chars().any(char::is_control) {
        return Err("invalid title id".into());
    }
    Ok(())
}

fn list(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<LibraryItem>> {
    let mut stmt = conn.prepare("SELECT id, added_at, title FROM library WHERE profile_id = ?1 ORDER BY added_at DESC")?;
    let rows = stmt.query_map([profile], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?)))?;
    let mut items = Vec::new();
    for row in rows {
        let (id, added_at, json) = row?;
        // A corrupt row is skipped rather than hiding the whole library.
        if let Ok(title) = serde_json::from_str(&json) {
            items.push(LibraryItem { id, added_at, title });
        }
    }
    Ok(items)
}

/// Saves `title` under `id`; saving again refreshes the snapshot but keeps when it was added.
fn add(conn: &Connection, profile: &str, id: &str, title: &Value, now: i64) -> Result<(), String> {
    check_id(id)?;
    let json = title.to_string();
    if !title.is_object() || json.len() > MAX_SNAPSHOT_BYTES {
        return Err("invalid title snapshot".into());
    }
    conn.execute(
        "INSERT INTO library (profile_id, id, added_at, title) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(profile_id, id) DO UPDATE SET title = excluded.title",
        params![profile, id, now, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// Whether a cache entry saved at `saved_at` is still younger than `max_age`
/// at `now` (all in ms). One saved "in the future" is stale: the clock was set
/// back since, and its age can't be known, so it mustn't stay fresh for as long
/// as the clock went back.
pub(crate) fn fresh(saved_at: i64, now: i64, max_age: i64) -> bool {
    saved_at <= now && now - saved_at < max_age
}

#[tauri::command]
pub async fn library_list(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<LibraryItem>, String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    list(&conn, &profile).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn library_add(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, title: Value, profile: Option<String>, added_at: Option<i64>) -> Result<(), String> {
    let profile = active.id_for(profile.as_deref())?;
    let conn = db.lock()?;
    let now = now_ms();
    add(&conn, &profile, &id, &title, added_when(added_at, now))
}

/// When a title being saved was added: now, or for Undo after removing it the
/// time it was first added (so it goes back to its place in "Recently added"),
/// never in the future.
fn added_when(added_at: Option<i64>, now: i64) -> i64 {
    added_at.map_or(now, |at| at.clamp(0, now))
}

#[tauri::command]
pub async fn library_remove(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, profile: Option<String>) -> Result<(), String> {
    check_id(&id)?;
    let profile = active.id_for(profile.as_deref())?;
    db.lock()?.execute("DELETE FROM library WHERE profile_id = ?1 AND id = ?2", params![profile, id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn cache_entries_saved_in_the_future_are_stale() {
        assert!(fresh(100, 150, 60));
        assert!(!fresh(100, 160, 60));
        assert!(fresh(100, 100, 60));
        // The clock was set back after this was saved.
        assert!(!fresh(200, 150, 60));
    }

    #[test]
    fn lists_newest_first_and_keeps_added_time_on_resave() {
        let conn = conn();
        add(&conn, "main", "tt1", &json!({"name": "One"}), 1).unwrap();
        add(&conn, "main", "tt2", &json!({"name": "Two"}), 2).unwrap();
        add(&conn, "main", "tt1", &json!({"name": "One (new art)"}), 3).unwrap();
        add(&conn, "other", "tt3", &json!({"name": "Someone else's"}), 4).unwrap();
        let items = list(&conn, "main").unwrap();
        assert_eq!(items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["tt2", "tt1"]);
        assert_eq!(items[1].added_at, 1);
        assert_eq!(items[1].title["name"], "One (new art)");
    }

    #[test]
    fn undo_keeps_when_a_title_was_first_added_but_never_a_future_time() {
        assert_eq!(added_when(None, 500), 500);
        assert_eq!(added_when(Some(100), 500), 100);
        assert_eq!(added_when(Some(900), 500), 500);
        assert_eq!(added_when(Some(-5), 500), 0);
    }

    #[test]
    fn a_save_made_for_another_profile_is_refused() {
        let active = ActiveProfile::default();
        crate::profiles::select_for_test(&active, "kids");
        assert_eq!(active.id_for(None).unwrap(), "kids");
        assert_eq!(active.id_for(Some("kids")).unwrap(), "kids");
        assert!(active.id_for(Some("main")).is_err());
    }

    #[test]
    fn rejects_bad_ids_and_snapshots() {
        let conn = conn();
        assert!(add(&conn, "main", "", &json!({}), 0).is_err());
        assert!(add(&conn, "main", "a\nb", &json!({}), 0).is_err());
        assert!(add(&conn, "main", "tt1", &json!("not an object"), 0).is_err());
        assert!(add(&conn, "main", "tt1", &json!({"name": "x".repeat(MAX_SNAPSHOT_BYTES)}), 0).is_err());
    }
}
