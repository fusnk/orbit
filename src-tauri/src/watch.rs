//! Watch history: how far into each movie or episode, whether it's watched,
//! and per title a display snapshot plus what to play next, so Continue
//! Watching and the Library render without the network.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db::Db;
use crate::library::{MAX_SNAPSHOT_BYTES, check_id, now_ms};
use crate::profiles::ActiveProfile;

/// A single save batches at most this many rows (e.g. "mark season watched").
const MAX_BATCH: usize = 2000;
/// Longer than any real video; rejects nonsense from a buggy caller.
pub(crate) const MAX_SECONDS: f64 = 7.0 * 24.0 * 3600.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchTitle {
    title_id: String,
    /// Validated by the frontend on read, like any stored JSON.
    title: Value,
    next: Option<Value>,
    completed: bool,
    updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// The movie's id, or the episode's video id (e.g. "tt0944947:1:2").
    video_id: String,
    title_id: String,
    season: Option<i64>,
    episode: Option<i64>,
    /// Seconds.
    position: f64,
    duration: f64,
    watched: bool,
    /// Set by Orbit when saving; ignored on input.
    #[serde(default)]
    updated_at: i64,
}

#[derive(Serialize)]
pub struct WatchState {
    titles: Vec<WatchTitle>,
    progress: Vec<Progress>,
}

fn check_json(value: &Value) -> Result<String, String> {
    let json = value.to_string();
    if !value.is_object() || json.len() > MAX_SNAPSHOT_BYTES {
        return Err("invalid snapshot".into());
    }
    Ok(json)
}

fn check_progress(p: &Progress) -> Result<(), String> {
    check_id(&p.video_id)?;
    check_id(&p.title_id)?;
    let seconds = |v: f64| v.is_finite() && (0.0..=MAX_SECONDS).contains(&v);
    if !seconds(p.position) || !seconds(p.duration) {
        return Err("invalid position".into());
    }
    Ok(())
}

fn list(conn: &Connection, profile: &str) -> rusqlite::Result<WatchState> {
    let mut stmt = conn.prepare("SELECT title_id, title, next, completed, updated_at FROM watch_titles WHERE profile_id = ?1")?;
    let titles = stmt
        .query_map([profile], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, bool>(3)?, row.get::<_, i64>(4)?))
        })?
        .filter_map(Result::ok)
        // A corrupt row is skipped rather than hiding the whole history.
        .filter_map(|(title_id, title, next, completed, updated_at)| {
            Some(WatchTitle {
                title_id,
                title: serde_json::from_str(&title).ok()?,
                next: next.and_then(|n| serde_json::from_str(&n).ok()),
                completed,
                updated_at,
            })
        })
        .collect();
    let mut stmt = conn.prepare("SELECT video_id, title_id, season, episode, position, duration, watched, updated_at FROM watch_progress WHERE profile_id = ?1")?;
    let progress = stmt
        .query_map([profile], |row| {
            Ok(Progress {
                video_id: row.get(0)?,
                title_id: row.get(1)?,
                season: row.get(2)?,
                episode: row.get(3)?,
                position: row.get(4)?,
                duration: row.get(5)?,
                watched: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();
    Ok(WatchState { titles, progress })
}

fn put_title(conn: &Connection, profile: &str, title_id: &str, title: &Value, next: Option<&Value>, completed: bool, now: i64) -> Result<(), String> {
    check_id(title_id)?;
    let title = check_json(title)?;
    let next = next.map(check_json).transpose()?;
    conn.execute(
        "INSERT INTO watch_titles (profile_id, title_id, title, next, completed, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(profile_id, title_id) DO UPDATE SET title = excluded.title, next = excluded.next,
           completed = excluded.completed, updated_at = excluded.updated_at",
        params![profile, title_id, title, next, completed, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn put_progress(conn: &mut Connection, profile: &str, rows: &[Progress], now: i64) -> Result<(), String> {
    if rows.len() > MAX_BATCH {
        return Err("too many entries".into());
    }
    rows.iter().try_for_each(check_progress)?;
    // All or nothing, so "mark season watched" can't half-apply.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO watch_progress (profile_id, video_id, title_id, season, episode, position, duration, watched, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(profile_id, video_id) DO UPDATE SET title_id = excluded.title_id, season = excluded.season,
                   episode = excluded.episode, position = excluded.position, duration = excluded.duration,
                   watched = excluded.watched, updated_at = excluded.updated_at",
            )
            .map_err(|e| e.to_string())?;
        for p in rows {
            stmt.execute(params![profile, p.video_id, p.title_id, p.season, p.episode, p.position, p.duration, p.watched, now]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Takes watch history out (My Library → History): the given movie's or
/// episodes' rows of `title_id`, or all of them with `video_ids` None; the
/// title's own row goes once none of its rows are left. Only this profile's
/// history on this PC changes: nothing is sent anywhere from here.
fn remove(conn: &mut Connection, profile: &str, title_id: &str, video_ids: Option<&[String]>) -> Result<(), String> {
    check_id(title_id)?;
    if let Some(ids) = video_ids {
        if ids.len() > MAX_BATCH {
            return Err("too many entries".into());
        }
        ids.iter().try_for_each(|id| check_id(id))?;
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    match video_ids {
        Some(ids) => {
            let mut stmt = tx.prepare("DELETE FROM watch_progress WHERE profile_id = ?1 AND title_id = ?2 AND video_id = ?3").map_err(|e| e.to_string())?;
            for id in ids {
                stmt.execute(params![profile, title_id, id]).map_err(|e| e.to_string())?;
            }
        }
        None => {
            tx.execute("DELETE FROM watch_progress WHERE profile_id = ?1 AND title_id = ?2", params![profile, title_id]).map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        "DELETE FROM watch_titles WHERE profile_id = ?1 AND title_id = ?2
           AND NOT EXISTS (SELECT 1 FROM watch_progress WHERE profile_id = ?1 AND title_id = ?2)",
        params![profile, title_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_list(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<WatchState, String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    list(&conn, &profile).map_err(|e| e.to_string())
}

/// When a change happened: now, or `at` for history brought in from elsewhere
/// (a Stremio account), so it sorts where it belongs. Never in the future.
fn when(at: Option<i64>) -> i64 {
    let now = now_ms();
    at.filter(|t| (1..=now).contains(t)).unwrap_or(now)
}

/// Saves a title's snapshot, what plays next (if anything), and whether it's finished.
#[tauri::command]
pub async fn watch_put_title(
    db: State<'_, Db>,
    active: State<'_, ActiveProfile>,
    title_id: String,
    title: Value,
    next: Option<Value>,
    completed: bool,
    at: Option<i64>,
) -> Result<(), String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    put_title(&conn, &profile, &title_id, &title, next.as_ref(), completed, when(at))
}

#[tauri::command]
pub async fn watch_put_progress(db: State<'_, Db>, active: State<'_, ActiveProfile>, rows: Vec<Progress>, at: Option<i64>) -> Result<(), String> {
    let profile = active.id()?;
    let mut conn = db.lock()?;
    put_progress(&mut conn, &profile, &rows, when(at))
}

#[tauri::command]
pub async fn watch_remove(db: State<'_, Db>, active: State<'_, ActiveProfile>, title_id: String, video_ids: Option<Vec<String>>) -> Result<(), String> {
    let profile = active.id()?;
    let mut conn = db.lock()?;
    remove(&mut conn, &profile, &title_id, video_ids.as_deref())
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

    fn row(video: &str, position: f64) -> Progress {
        Progress { video_id: video.into(), title_id: "tt1".into(), season: Some(1), episode: Some(2), position, duration: 1200.0, watched: false, updated_at: 0 }
    }

    #[test]
    fn saves_and_updates_progress_and_titles() {
        let mut conn = conn();
        put_title(&conn, "main", "tt1", &json!({"name": "Show"}), Some(&json!({"videoId": "tt1:1:3"})), false, 5).unwrap();
        put_progress(&mut conn, "main", &[row("tt1:1:2", 30.0)], 6).unwrap();
        put_progress(&mut conn, "main", &[row("tt1:1:2", 90.0)], 7).unwrap();
        // Another profile's history is separate.
        put_progress(&mut conn, "other", &[row("tt1:1:2", 500.0)], 8).unwrap();
        let state = list(&conn, "main").unwrap();
        assert_eq!(state.titles.len(), 1);
        assert_eq!(state.titles[0].next.as_ref().unwrap()["videoId"], "tt1:1:3");
        assert_eq!(state.progress.len(), 1);
        assert_eq!((state.progress[0].position, state.progress[0].updated_at), (90.0, 7));
        assert_eq!(list(&conn, "other").unwrap().progress[0].position, 500.0);
    }

    #[test]
    fn removes_rows_then_the_title_once_none_are_left() {
        let mut conn = conn();
        put_title(&conn, "main", "tt1", &json!({"name": "Show"}), None, false, 5).unwrap();
        put_progress(&mut conn, "main", &[row("tt1:1:1", 30.0), row("tt1:1:2", 60.0)], 6).unwrap();
        put_progress(&mut conn, "other", &[row("tt1:1:1", 30.0)], 6).unwrap();
        remove(&mut conn, "main", "tt1", Some(&["tt1:1:1".to_string()])).unwrap();
        let state = list(&conn, "main").unwrap();
        assert_eq!(state.progress.iter().map(|p| p.video_id.as_str()).collect::<Vec<_>>(), ["tt1:1:2"]);
        assert_eq!(state.titles.len(), 1);
        // Another title's id can't take this title's rows.
        remove(&mut conn, "main", "tt9", Some(&["tt1:1:2".to_string()])).unwrap();
        assert_eq!(list(&conn, "main").unwrap().progress.len(), 1);
        remove(&mut conn, "main", "tt1", None).unwrap();
        let state = list(&conn, "main").unwrap();
        assert!(state.progress.is_empty() && state.titles.is_empty());
        // Another profile's history stays.
        assert_eq!(list(&conn, "other").unwrap().progress.len(), 1);
        assert!(remove(&mut conn, "main", "", None).is_err());
    }

    #[test]
    fn rejects_bad_input_without_saving_any_of_it() {
        let mut conn = conn();
        for bad in [f64::NAN, -1.0, f64::INFINITY, 1e9] {
            assert!(put_progress(&mut conn, "main", &[row("tt1:1:1", 10.0), row("tt1:1:2", bad)], 1).is_err());
        }
        assert!(put_progress(&mut conn, "main", &[row("", 10.0)], 1).is_err());
        assert!(list(&conn, "main").unwrap().progress.is_empty());
        assert!(put_title(&conn, "main", "tt1", &json!("text"), None, false, 1).is_err());
    }

    #[test]
    fn a_batch_is_capped_and_applies_all_or_nothing() {
        let mut conn = conn();
        let rows: Vec<Progress> = (0..MAX_BATCH).map(|n| row(&format!("tt1:1:{n}"), 1.0)).collect();
        put_progress(&mut conn, "main", &rows, 1).unwrap();
        assert_eq!(list(&conn, "main").unwrap().progress.len(), MAX_BATCH);
        let mut too_many = rows.clone();
        too_many.push(row("tt1:2:1", 1.0));
        assert_eq!(put_progress(&mut conn, "main", &too_many, 2).unwrap_err(), "too many entries");
        // Nothing of the refused batch was written, not even the rows that would have been updates.
        assert!(list(&conn, "main").unwrap().progress.iter().all(|p| p.updated_at == 1));
        put_progress(&mut conn, "main", &[], 3).unwrap();
    }

    #[test]
    fn durations_and_title_ids_are_checked_like_positions() {
        let mut conn = conn();
        let with = |f: fn(&mut Progress)| {
            let mut p = row("tt1:1:1", 10.0);
            f(&mut p);
            p
        };
        for bad in [with(|p| p.duration = f64::NAN), with(|p| p.duration = MAX_SECONDS + 1.0), with(|p| p.title_id = "tt\u{0}1".into()), with(|p| p.title_id = "x".repeat(257))] {
            assert!(put_progress(&mut conn, "main", std::slice::from_ref(&bad), 1).is_err(), "{bad:?}");
        }
        assert!(list(&conn, "main").unwrap().progress.is_empty());
        // The edges themselves are fine.
        put_progress(&mut conn, "main", &[with(|p| (p.position, p.duration) = (MAX_SECONDS, 0.0))], 1).unwrap();
    }

    #[test]
    fn oversized_or_non_object_snapshots_are_refused() {
        let conn = conn();
        let big = json!({"name": "x".repeat(MAX_SNAPSHOT_BYTES)});
        let show = json!({"name": "Show"});
        assert!(put_title(&conn, "main", "tt1", &big, None, false, 1).is_err());
        // What plays next is held to the same rules as the title.
        assert!(put_title(&conn, "main", "tt1", &show, Some(&big), false, 1).is_err());
        assert!(put_title(&conn, "main", "tt1", &show, Some(&json!([1, 2])), false, 1).is_err());
        assert!(put_title(&conn, "main", "", &show, None, false, 1).is_err());
        assert!(list(&conn, "main").unwrap().titles.is_empty());
    }

    #[test]
    fn resaving_a_title_can_clear_what_plays_next_and_mark_it_finished() {
        let conn = conn();
        put_title(&conn, "main", "tt1", &json!({"name": "Show"}), Some(&json!({"videoId": "tt1:1:3"})), false, 5).unwrap();
        put_title(&conn, "main", "tt1", &json!({"name": "Show"}), None, true, 9).unwrap();
        let state = list(&conn, "main").unwrap();
        assert_eq!(state.titles.len(), 1);
        assert!(state.titles[0].next.is_none() && state.titles[0].completed);
        assert_eq!(state.titles[0].updated_at, 9);
    }

    #[test]
    fn a_corrupt_row_is_skipped_without_hiding_the_rest() {
        let conn = conn();
        put_title(&conn, "main", "tt1", &json!({"name": "Fine"}), None, false, 1).unwrap();
        conn.execute("INSERT INTO watch_titles (profile_id, title_id, title, next, completed, updated_at) VALUES ('main', 'tt2', '{not json', NULL, 0, 2)", []).unwrap();
        // A damaged "next" only loses the next episode, not the title.
        conn.execute("INSERT INTO watch_titles (profile_id, title_id, title, next, completed, updated_at) VALUES ('main', 'tt3', '{}', '{bad', 0, 3)", []).unwrap();
        let mut ids: Vec<_> = list(&conn, "main").unwrap().titles.into_iter().map(|t| (t.title_id, t.next.is_none())).collect();
        ids.sort();
        assert_eq!(ids, [("tt1".to_string(), true), ("tt3".to_string(), true)]);
    }

    #[test]
    fn removing_is_capped_and_checks_every_id_first() {
        let mut conn = conn();
        put_progress(&mut conn, "main", &[row("tt1:1:1", 30.0), row("tt1:1:2", 60.0)], 6).unwrap();
        let too_many = vec!["tt1:1:1".to_string(); MAX_BATCH + 1];
        assert!(remove(&mut conn, "main", "tt1", Some(&too_many)).is_err());
        // One bad id refuses the whole removal: the good one before it stays.
        assert!(remove(&mut conn, "main", "tt1", Some(&["tt1:1:1".to_string(), String::new()])).is_err());
        assert_eq!(list(&conn, "main").unwrap().progress.len(), 2);
    }

    #[test]
    fn times_from_elsewhere_are_kept_only_when_in_the_past() {
        let before = now_ms();
        assert_eq!(when(Some(1_000)), 1_000);
        for odd in [None, Some(0), Some(-5), Some(i64::MAX)] {
            let t = when(odd);
            assert!(t >= before && t <= now_ms(), "{odd:?} gave {t}");
        }
    }
}
