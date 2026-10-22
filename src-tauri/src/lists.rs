//! Custom lists ("Date night", "Halloween"…): named collections of titles,
//! each a profile's own, with an optional description. Titles are kept as
//! small display snapshots, like My Library's.
//!
//! A single list can be exported to a JSON file (written here, to a path the
//! person picked in the save dialog) and imported from one. An imported file
//! is untrusted: the page validates it first, and everything is checked again
//! here (names, ids, snapshot sizes, the limits) before any row is written.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::db::Db;
use crate::library::{MAX_SNAPSHOT_BYTES, check_id, now_ms};
use crate::profiles::ActiveProfile;

const MAX_NAME_CHARS: usize = 40;
const MAX_DESCRIPTION_CHARS: usize = 300;
const MAX_LISTS: i64 = 100;
const MAX_ITEMS: i64 = 1000;
/// A list's export: up to 1000 snapshots of 16 KB at most, with room to spare.
const MAX_EXPORT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    title_id: String,
    added_at: i64,
    /// Validated by the frontend on read, like any stored JSON.
    title: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomList {
    id: String,
    name: String,
    description: String,
    created_at: i64,
    /// Newest first.
    items: Vec<ListItem>,
}

fn check_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(crate::user_error::coded("lists.name", &[("max", &MAX_NAME_CHARS.to_string())]));
    }
    Ok(name.to_string())
}

/// One paragraph of plain text, possibly empty.
fn check_description(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.chars().count() > MAX_DESCRIPTION_CHARS || text.chars().any(char::is_control) {
        return Err(crate::user_error::coded("lists.description", &[("max", &MAX_DESCRIPTION_CHARS.to_string())]));
    }
    Ok(text.to_string())
}

/// A new list id: 16 random hex digits.
fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|_| "couldn't create a list id")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// A stored title snapshot: an object of bounded size.
fn check_snapshot(title: &Value) -> Result<String, String> {
    let json = title.to_string();
    if !title.is_object() || json.len() > MAX_SNAPSHOT_BYTES {
        return Err("invalid title snapshot".into());
    }
    Ok(json)
}

fn all(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<CustomList>> {
    let mut lists: Vec<CustomList> = conn
        .prepare("SELECT id, name, description, created_at FROM lists WHERE profile_id = ?1 ORDER BY created_at")?
        .query_map([profile], |row| Ok(CustomList { id: row.get(0)?, name: row.get(1)?, description: row.get(2)?, created_at: row.get(3)?, items: Vec::new() }))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare("SELECT title_id, added_at, title FROM list_items WHERE list_id = ?1 ORDER BY added_at DESC")?;
    for list in &mut lists {
        let rows = stmt.query_map([&list.id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?)))?;
        for row in rows {
            let (title_id, added_at, json) = row?;
            // A corrupt row is skipped rather than hiding the whole list.
            if let Ok(title) = serde_json::from_str(&json) {
                list.items.push(ListItem { title_id, added_at, title });
            }
        }
    }
    Ok(lists)
}

/// The list, if it belongs to `profile`; other profiles' lists don't exist here.
fn owned(conn: &Connection, profile: &str, id: &str) -> Result<(), String> {
    conn.query_row("SELECT 1 FROM lists WHERE id = ?1 AND profile_id = ?2", params![id, profile], |_| Ok(()))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "err.lists.gone".into())
}

fn count(conn: &Connection, sql: &str, arg: &str) -> Result<i64, String> {
    conn.query_row(sql, [arg], |row| row.get(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<CustomList>, String> {
    let profile = active.id()?;
    all(&*db.lock()?, &profile).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_create(db: State<'_, Db>, active: State<'_, ActiveProfile>, name: String) -> Result<String, String> {
    let name = check_name(&name)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    if count(&conn, "SELECT COUNT(*) FROM lists WHERE profile_id = ?1", &profile)? >= MAX_LISTS {
        return Err(crate::user_error::coded("lists.limit", &[("max", &MAX_LISTS.to_string())]));
    }
    let id = new_id()?;
    conn.execute("INSERT INTO lists (id, profile_id, name, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, profile, name, now_ms()])
        .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn list_rename(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, name: String) -> Result<(), String> {
    let name = check_name(&name)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &id)?;
    conn.execute("UPDATE lists SET name = ?1 WHERE id = ?2", params![name, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Sets (or, when empty, clears) a list's description.
#[tauri::command]
pub async fn list_describe(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, description: String) -> Result<(), String> {
    let description = check_description(&description)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &id)?;
    conn.execute("UPDATE lists SET description = ?1 WHERE id = ?2", params![description, id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_delete(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), String> {
    let profile = active.id()?;
    let mut conn = db.lock()?;
    owned(&conn, &profile, &id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM list_items WHERE list_id = ?1", [&id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM lists WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Adds `title` to the list; adding it again refreshes its snapshot.
#[tauri::command]
pub async fn list_add(db: State<'_, Db>, active: State<'_, ActiveProfile>, list_id: String, title_id: String, title: Value) -> Result<(), String> {
    check_id(&title_id)?;
    let json = check_snapshot(&title)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &list_id)?;
    if count(&conn, "SELECT COUNT(*) FROM list_items WHERE list_id = ?1", &list_id)? >= MAX_ITEMS {
        return Err(crate::user_error::coded("lists.item-limit", &[("max", &MAX_ITEMS.to_string())]));
    }
    conn.execute(
        "INSERT INTO list_items (list_id, title_id, added_at, title) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(list_id, title_id) DO UPDATE SET title = excluded.title",
        params![list_id, title_id, now_ms(), json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_remove(db: State<'_, Db>, active: State<'_, ActiveProfile>, list_id: String, title_id: String) -> Result<(), String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &list_id)?;
    conn.execute("DELETE FROM list_items WHERE list_id = ?1 AND title_id = ?2", params![list_id, title_id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// One title of an imported list, already validated by the page.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    title_id: String,
    added_at: i64,
    title: Value,
}

/// Creates a list from an imported file, with all its titles or none.
fn import(conn: &mut Connection, profile: &str, name: &str, description: &str, items: &[ImportItem]) -> Result<String, String> {
    let name = check_name(name)?;
    let description = check_description(description)?;
    if items.len() > usize::try_from(MAX_ITEMS).unwrap_or(usize::MAX) {
        return Err(crate::user_error::coded("lists.item-limit", &[("max", &MAX_ITEMS.to_string())]));
    }
    let rows = items
        .iter()
        .map(|item| {
            check_id(&item.title_id)?;
            Ok((item.title_id.as_str(), item.added_at.clamp(0, now_ms()), check_snapshot(&item.title)?))
        })
        .collect::<Result<Vec<_>, String>>()?;
    if count(conn, "SELECT COUNT(*) FROM lists WHERE profile_id = ?1", profile)? >= MAX_LISTS {
        return Err(crate::user_error::coded("lists.limit", &[("max", &MAX_LISTS.to_string())]));
    }
    let id = new_id()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO lists (id, profile_id, name, description, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, profile, name, description, now_ms()])
        .map_err(|e| e.to_string())?;
    for (title_id, added_at, json) in rows {
        // The same title twice in a file is kept once.
        tx.execute("INSERT INTO list_items (list_id, title_id, added_at, title) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(list_id, title_id) DO NOTHING", params![id, title_id, added_at, json])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn list_import(db: State<'_, Db>, active: State<'_, ActiveProfile>, name: String, description: String, items: Vec<ImportItem>) -> Result<String, String> {
    let profile = active.id()?;
    import(&mut *db.lock()?, &profile, &name, &description, &items)
}

/// Asks where to save one list's export (built by the page; Downloads
/// suggested), writes it there and returns the path, or `None` if the person
/// cancelled. Only JSON of a bounded size is written.
#[tauri::command]
pub async fn list_export_save(app: AppHandle, text: String) -> Result<Option<String>, String> {
    if text.len() > MAX_EXPORT_BYTES {
        return Err("err.collections.export-too-large".into());
    }
    serde_json::from_str::<Value>(&text).map_err(|_| "invalid export")?;
    let Some(path) = crate::dialog::save_json(&app, &format!("orbit-list-{}", crate::backup::chrono_date(now_ms()))).await else { return Ok(None) };
    std::fs::write(&path, text).map_err(|_| "err.file.save")?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lists_belong_to_their_profile() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO lists (id, profile_id, name, created_at) VALUES ('l1', 'main', 'Date night', 1)", []).unwrap();
        conn.execute("INSERT INTO list_items VALUES ('l1', 'tt1', 2, ?1)", [json!({"name": "One"}).to_string()]).unwrap();
        let lists = all(&conn, "main").unwrap();
        assert_eq!((lists.len(), lists[0].items.len(), lists[0].name.as_str()), (1, 1, "Date night"));
        assert!(all(&conn, "kid").unwrap().is_empty());
        assert!(owned(&conn, "kid", "l1").is_err() && owned(&conn, "main", "l1").is_ok());
        assert!(check_name("  ").is_err() && check_name(&"x".repeat(41)).is_err() && check_name(" Halloween ").unwrap() == "Halloween");
        assert_eq!(lists[0].description, "");
    }

    #[test]
    fn descriptions_are_one_short_paragraph() {
        assert_eq!(check_description("  Films for a rainy Sunday ").unwrap(), "Films for a rainy Sunday");
        assert_eq!(check_description("").unwrap(), "");
        assert!(check_description(&"x".repeat(301)).is_err());
        assert!(check_description("line one\nline two").is_err());
    }

    #[test]
    fn imports_a_whole_list_or_nothing() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let item = |id: &str, title: Value| ImportItem { title_id: id.into(), added_at: 5, title };
        let id = import(&mut conn, "main", " Noir ", "Shadows", &[item("tt1", json!({"meta": {"id": "tt1"}})), item("tt1", json!({"meta": {"id": "tt1"}})), item("tt2", json!({}))]).unwrap();
        let lists = all(&conn, "main").unwrap();
        assert_eq!((lists[0].id.as_str(), lists[0].name.as_str(), lists[0].description.as_str(), lists[0].items.len()), (id.as_str(), "Noir", "Shadows", 2));
        // One bad title (not an object) and nothing is created.
        assert!(import(&mut conn, "main", "Bad", "", &[item("tt3", json!({})), item("tt4", json!("x"))]).is_err());
        assert!(import(&mut conn, "main", "Bad", "", &[item("", json!({}))]).is_err());
        assert_eq!(all(&conn, "main").unwrap().len(), 1);
    }
}
