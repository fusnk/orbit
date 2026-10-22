//! Each profile's own ratings and notes: 0.5–5 stars in half steps, a "liked"
//! heart and a private note per title. Kept only in Orbit (Stremio has no
//! ratings, and Letterboxd is only ever read). A row exists while any of the
//! three is set; clearing all three removes it.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::library::{check_id, now_ms};
use crate::profiles::ActiveProfile;

/// A note is a few lines, not an essay; the cap bounds what's stored and backed up.
pub(crate) const MAX_NOTE_CHARS: usize = 2000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserRating {
    pub title_id: String,
    /// Stars, 0.5–5 in half steps; None when only liked or noted.
    pub rating: Option<f64>,
    pub liked: bool,
    pub note: Option<String>,
    pub updated_at: i64,
}

/// Stars as half steps (1–10), which is how they're stored: no float compares in SQL.
fn half_steps(rating: f64) -> Result<i64, String> {
    let halves = rating * 2.0;
    if !rating.is_finite() || halves.fract() != 0.0 || !(1.0..=10.0).contains(&halves) {
        return Err("err.ratings.stars".into());
    }
    // Checked above: a whole number from 1 to 10.
    Ok(halves as i64)
}

/// The note trimmed, or None when empty. Line breaks and tabs are fine; other
/// control characters aren't (they'd only ever arrive from a crafted call or backup).
fn check_note(note: Option<&str>) -> Result<Option<String>, String> {
    let Some(note) = note.map(str::trim).filter(|n| !n.is_empty()) else { return Ok(None) };
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(crate::user_error::coded("ratings.note-length", &[("max", &MAX_NOTE_CHARS.to_string())]));
    }
    if note.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
        return Err("invalid note".into());
    }
    Ok(Some(note.to_string()))
}

/// The checked values to store: title id, half steps, liked, note.
pub(crate) type Checked = (String, Option<i64>, bool, Option<String>);

pub(crate) fn check(title_id: &str, rating: Option<f64>, liked: bool, note: Option<&str>) -> Result<Checked, String> {
    check_id(title_id)?;
    Ok((title_id.to_string(), rating.map(half_steps).transpose()?, liked, check_note(note)?))
}

pub(crate) fn all(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<UserRating>> {
    conn.prepare("SELECT title_id, rating, liked, note, updated_at FROM user_ratings WHERE profile_id = ?1")?
        .query_map([profile], |r| {
            Ok(UserRating {
                title_id: r.get(0)?,
                rating: r.get::<_, Option<i64>>(1)?.map(|halves| halves as f64 / 2.0),
                liked: r.get(2)?,
                note: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?
        .collect()
}

/// Saves a checked entry, or removes the row when nothing is left in it.
/// `newer_only`: an existing row changed after `updated_at` is kept (restoring a backup).
pub(crate) fn save(conn: &Connection, profile: &str, entry: &Checked, updated_at: i64, newer_only: bool) -> rusqlite::Result<()> {
    let (title_id, rating, liked, note) = entry;
    if rating.is_none() && !liked && note.is_none() {
        if !newer_only {
            conn.execute("DELETE FROM user_ratings WHERE profile_id = ?1 AND title_id = ?2", params![profile, title_id])?;
        }
        return Ok(());
    }
    conn.execute(
        &format!(
            "INSERT INTO user_ratings (profile_id, title_id, rating, liked, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(profile_id, title_id) DO UPDATE SET rating = excluded.rating, liked = excluded.liked, note = excluded.note, updated_at = excluded.updated_at{}",
            if newer_only { " WHERE excluded.updated_at > user_ratings.updated_at" } else { "" }
        ),
        params![profile, title_id, rating, liked, note, updated_at],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn rating_all(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<UserRating>, String> {
    let profile = active.id()?;
    all(&*db.lock()?, &profile).map_err(|e| e.to_string())
}

/// Sets a title's rating, heart and note together (None and false clear them).
#[tauri::command]
pub async fn rating_set(db: State<'_, Db>, active: State<'_, ActiveProfile>, title_id: String, rating: Option<f64>, liked: bool, note: Option<String>) -> Result<(), String> {
    let entry = check(&title_id, rating, liked, note.as_deref())?;
    let profile = active.id()?;
    save(&*db.lock()?, &profile, &entry, now_ms(), false).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_ratings_notes_and_ids() {
        assert_eq!(check("tt1", Some(3.5), false, None).unwrap().1, Some(7));
        assert_eq!(check("tt1", Some(0.5), false, None).unwrap().1, Some(1));
        assert_eq!(check("tt1", Some(5.0), false, None).unwrap().1, Some(10));
        for bad in [0.0, 0.25, 3.7, 5.5, -1.0, f64::NAN, f64::INFINITY] {
            assert!(check("tt1", Some(bad), false, None).is_err(), "{bad}");
        }
        assert!(check("", Some(1.0), false, None).is_err());
        assert!(check("tt\u{0}1", Some(1.0), false, None).is_err());
        assert!(check(&"x".repeat(300), Some(1.0), false, None).is_err());
        // Notes: trimmed, empty is none, line breaks fine, capped in characters (not bytes).
        assert_eq!(check("tt1", None, false, Some("  ")).unwrap().3, None);
        assert_eq!(check("tt1", None, false, Some(" Great\n\tscore ")).unwrap().3.as_deref(), Some("Great\n\tscore"));
        assert!(check("tt1", None, false, Some("bell\u{7}")).is_err());
        assert!(check("tt1", None, false, Some(&"é".repeat(MAX_NOTE_CHARS))).is_ok());
        assert!(check("tt1", None, false, Some(&"a".repeat(MAX_NOTE_CHARS + 1))).is_err());
    }

    #[test]
    fn rows_belong_to_a_profile_and_go_when_emptied() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        save(&conn, "main", &check("tt1", Some(4.5), true, Some("Rewatch")).unwrap(), 5, false).unwrap();
        save(&conn, "kid", &check("tt1", None, true, None).unwrap(), 5, false).unwrap();
        let mine = all(&conn, "main").unwrap();
        assert_eq!(mine, [UserRating { title_id: "tt1".into(), rating: Some(4.5), liked: true, note: Some("Rewatch".into()), updated_at: 5 }]);
        assert_eq!(all(&conn, "kid").unwrap()[0].rating, None);
        // Older backup rows don't replace newer ones.
        save(&conn, "main", &check("tt1", Some(1.0), false, None).unwrap(), 4, true).unwrap();
        assert_eq!(all(&conn, "main").unwrap()[0].rating, Some(4.5));
        save(&conn, "main", &check("tt1", None, false, None).unwrap(), 6, false).unwrap();
        assert!(all(&conn, "main").unwrap().is_empty());
        assert_eq!(all(&conn, "kid").unwrap().len(), 1);
    }
}
