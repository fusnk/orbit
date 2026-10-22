//! Custom collections, each a profile's own, in the person's order. A
//! collection is either a fixed set of titles (kept as display snapshots, like
//! lists) or one or more dynamic sources (an addon catalog, a TMDB query…)
//! that the page resolves when it draws. Sources and artwork are checked
//! here for shape and size; the page validates them field by field on read.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::backup::chrono_date;
use crate::db::Db;
use crate::library::{MAX_SNAPSHOT_BYTES, check_id, now_ms};
use crate::profiles::ActiveProfile;

pub(crate) const MAX_NAME_CHARS: usize = 60;
pub(crate) const MAX_COLLECTIONS: i64 = 250;
pub(crate) const MAX_ITEMS: i64 = 1000;
const MAX_SOURCES: usize = 20;
const MAX_SOURCES_BYTES: usize = 16 * 1024;
const MAX_URL_BYTES: usize = 2048;
/// An exported file; the import side (`MAX_FILE_CHARS` in the page) caps what it
/// reads at the same size, so whatever Orbit exports can be imported again.
/// 2 MiB ran out near 1,500 titles; 8 MiB holds the biggest library Orbit stores.
const MAX_EXPORT_BYTES: usize = 8 * 1024 * 1024;
const SOURCE_KINDS: [&str; 3] = ["addon", "tmdb", "trakt"];
const SHAPES: [&str; 3] = ["poster", "landscape", "square"];

/// Cover art: https only (anything else would be blocked by CSP, or is a downgrade).
#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Art {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    backdrop: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInput {
    name: String,
    group: Option<String>,
    art: Art,
    sources: Value,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub(crate) title_id: String,
    /// Validated by the frontend on read, like any stored JSON.
    pub(crate) title: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInput {
    #[serde(flatten)]
    collection: CollectionInput,
    #[serde(default)]
    items: Vec<Item>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    id: String,
    name: String,
    group: Option<String>,
    art: Value,
    sources: Value,
    created_at: i64,
    /// In the order they were added.
    items: Vec<Item>,
}

/// A checked collection, ready to store.
pub(crate) struct Checked {
    pub(crate) name: String,
    pub(crate) group: Option<String>,
    pub(crate) art: String,
    pub(crate) sources: String,
}

/// `code`: the error (see user_error.rs) for a name that is empty or too long.
fn check_text(text: &str, code: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > MAX_NAME_CHARS || text.chars().any(char::is_control) {
        return Err(crate::user_error::coded(code, &[("max", &MAX_NAME_CHARS.to_string())]));
    }
    Ok(text.to_string())
}

fn check_url(url: &str) -> Result<(), String> {
    let ok = url.len() <= MAX_URL_BYTES && url.starts_with("https://") && url.len() > "https://".len() && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok { Ok(()) } else { Err("err.collections.cover-https".into()) }
}

fn check_art(art: &Art) -> Result<String, String> {
    for url in [&art.cover, &art.backdrop].into_iter().flatten() {
        check_url(url)?;
    }
    if art.shape.as_deref().is_some_and(|s| !SHAPES.contains(&s)) {
        return Err("unknown tile shape".into());
    }
    serde_json::to_string(art).map_err(|e| e.to_string())
}

const SOURCES_TOO_LARGE: &str = "err.collections.sources-too-large";

/// Sources are checked for shape and size only; the page knows their fields.
fn check_sources(sources: &Value) -> Result<String, String> {
    let list = sources.as_array().ok_or("invalid sources")?;
    if list.len() > MAX_SOURCES {
        return Err(crate::user_error::coded("collections.source-limit", &[("max", &MAX_SOURCES.to_string())]));
    }
    let known = |s: &Value| s.get("kind").and_then(Value::as_str).is_some_and(|k| SOURCE_KINDS.contains(&k));
    if !list.iter().all(|s| s.is_object() && known(s)) {
        return Err("invalid source".into());
    }
    let json = sources.to_string();
    if json.len() > MAX_SOURCES_BYTES {
        return Err(SOURCES_TOO_LARGE.into());
    }
    Ok(json)
}

pub(crate) fn check(input: &CollectionInput) -> Result<Checked, String> {
    let group = match input.group.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(group) => Some(check_text(group, "collections.group-name")?),
    };
    Ok(Checked { name: check_text(&input.name, "collections.name")?, group, art: check_art(&input.art)?, sources: check_sources(&input.sources)? })
}

/// Checks a collection as a backup holds it (artwork as plain JSON).
pub(crate) fn check_parts(name: &str, group: Option<&str>, art: &Value, sources: &Value) -> Result<Checked, String> {
    let art: Art = serde_json::from_value(art.clone()).map_err(|_| "invalid cover art")?;
    check(&CollectionInput { name: name.into(), group: group.map(Into::into), art, sources: sources.clone() })
}

pub(crate) fn check_item(item: &Item) -> Result<String, String> {
    check_id(&item.title_id)?;
    let json = item.title.to_string();
    if !item.title.is_object() || json.len() > MAX_SNAPSHOT_BYTES {
        return Err("invalid title snapshot".into());
    }
    Ok(json)
}

pub(crate) fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|_| "couldn't create a collection id")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn sql(e: rusqlite::Error) -> String {
    e.to_string()
}

fn count(conn: &Connection, sql_text: &str, arg: &str) -> Result<i64, String> {
    conn.query_row(sql_text, [arg], |row| row.get(0)).map_err(sql)
}

fn all(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<Collection>> {
    let json = |text: String| serde_json::from_str(&text).unwrap_or(Value::Null);
    let mut collections: Vec<Collection> = conn
        .prepare("SELECT id, name, grp, art, sources, created_at FROM collections WHERE profile_id = ?1 ORDER BY position, created_at")?
        .query_map([profile], |row| {
            Ok(Collection { id: row.get(0)?, name: row.get(1)?, group: row.get(2)?, art: json(row.get(3)?), sources: json(row.get(4)?), created_at: row.get(5)?, items: Vec::new() })
        })?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare("SELECT title_id, title FROM collection_items WHERE collection_id = ?1 ORDER BY position")?;
    for collection in &mut collections {
        let rows = stmt.query_map([&collection.id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (title_id, text) = row?;
            // A corrupt row is skipped rather than hiding the whole collection.
            if let Ok(title) = serde_json::from_str(&text) {
                collection.items.push(Item { title_id, title });
            }
        }
    }
    Ok(collections)
}

/// The collection, if it belongs to `profile`; other profiles' collections don't exist here.
fn owned(conn: &Connection, profile: &str, id: &str) -> Result<(), String> {
    conn.query_row("SELECT 1 FROM collections WHERE id = ?1 AND profile_id = ?2", params![id, profile], |_| Ok(()))
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "err.collections.gone".into())
}

/// Stores a checked collection (and its titles) at the end of `profile`'s order.
pub(crate) fn insert(conn: &Connection, profile: &str, collection: &Checked, items: &[(String, String)], created_at: i64) -> Result<String, String> {
    let id = new_id()?;
    let position: i64 = conn.query_row("SELECT COALESCE(MAX(position) + 1, 0) FROM collections WHERE profile_id = ?1", [profile], |r| r.get(0)).map_err(sql)?;
    conn.execute(
        "INSERT INTO collections (id, profile_id, position, name, grp, art, sources, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, profile, position, collection.name, collection.group, collection.art, collection.sources, created_at],
    )
    .map_err(sql)?;
    for (n, (title_id, title)) in items.iter().enumerate() {
        conn.execute(
            "INSERT INTO collection_items (collection_id, title_id, position, title) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(collection_id, title_id) DO NOTHING",
            params![id, title_id, i64::try_from(n).unwrap_or(i64::MAX), title],
        )
        .map_err(sql)?;
    }
    Ok(id)
}

fn import(conn: &mut Connection, profile: &str, collections: &[ImportInput]) -> Result<usize, String> {
    // Everything is checked first, then written all or nothing.
    let mut checked = Vec::with_capacity(collections.len());
    for c in collections {
        if c.items.len() > usize::try_from(MAX_ITEMS).unwrap_or(usize::MAX) {
            return Err(crate::user_error::coded("collections.item-limit", &[("max", &MAX_ITEMS.to_string())]));
        }
        let items = c.items.iter().map(|i| Ok((i.title_id.clone(), check_item(i)?))).collect::<Result<Vec<_>, String>>()?;
        // A file can hold many collections: say which one is too large (nothing is imported).
        let collection = check(&c.collection).map_err(|e| if e == SOURCES_TOO_LARGE { crate::user_error::coded("collections.import-sources-too-large", &[("name", c.collection.name.trim())]) } else { e })?;
        checked.push((collection, items));
    }
    let tx = conn.transaction().map_err(sql)?;
    let existing = count(&tx, "SELECT COUNT(*) FROM collections WHERE profile_id = ?1", profile)?;
    if existing + i64::try_from(checked.len()).unwrap_or(i64::MAX) > MAX_COLLECTIONS {
        return Err(crate::user_error::coded("collections.limit", &[("max", &MAX_COLLECTIONS.to_string())]));
    }
    let now = now_ms();
    for (collection, items) in &checked {
        insert(&tx, profile, collection, items, now)?;
    }
    tx.commit().map_err(sql)?;
    Ok(checked.len())
}

/// `id` moved to `to` (clamped) in `profile`'s order; positions are renumbered.
fn move_to(conn: &mut Connection, profile: &str, id: &str, to: usize) -> Result<(), String> {
    owned(conn, profile, id)?;
    let tx = conn.transaction().map_err(sql)?;
    let mut ids: Vec<String> = tx
        .prepare("SELECT id FROM collections WHERE profile_id = ?1 ORDER BY position, created_at")
        .and_then(|mut stmt| stmt.query_map([profile], |r| r.get(0))?.collect())
        .map_err(sql)?;
    let from = ids.iter().position(|other| other == id).ok_or("err.collections.gone")?;
    let moved = ids.remove(from);
    ids.insert(to.min(ids.len()), moved);
    for (position, id) in ids.iter().enumerate() {
        tx.execute("UPDATE collections SET position = ?1 WHERE id = ?2", params![i64::try_from(position).unwrap_or(i64::MAX), id]).map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

#[tauri::command]
pub async fn collection_all(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<Collection>, String> {
    let profile = active.id()?;
    all(&*db.lock()?, &profile).map_err(sql)
}

#[tauri::command]
pub async fn collection_create(db: State<'_, Db>, active: State<'_, ActiveProfile>, collection: CollectionInput) -> Result<String, String> {
    let checked = check(&collection)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    if count(&conn, "SELECT COUNT(*) FROM collections WHERE profile_id = ?1", &profile)? >= MAX_COLLECTIONS {
        return Err(crate::user_error::coded("collections.limit", &[("max", &MAX_COLLECTIONS.to_string())]));
    }
    insert(&conn, &profile, &checked, &[], now_ms())
}

#[tauri::command]
pub async fn collection_update(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, collection: CollectionInput) -> Result<(), String> {
    let checked = check(&collection)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &id)?;
    conn.execute(
        "UPDATE collections SET name = ?1, grp = ?2, art = ?3, sources = ?4 WHERE id = ?5",
        params![checked.name, checked.group, checked.art, checked.sources, id],
    )
    .map_err(sql)?;
    Ok(())
}

#[tauri::command]
pub async fn collection_delete(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), String> {
    let profile = active.id()?;
    let mut conn = db.lock()?;
    owned(&conn, &profile, &id)?;
    let tx = conn.transaction().map_err(sql)?;
    tx.execute("DELETE FROM collection_items WHERE collection_id = ?1", [&id]).map_err(sql)?;
    tx.execute("DELETE FROM collections WHERE id = ?1", [&id]).map_err(sql)?;
    tx.commit().map_err(sql)
}

#[tauri::command]
pub async fn collection_move(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, to: usize) -> Result<(), String> {
    let profile = active.id()?;
    move_to(&mut *db.lock()?, &profile, &id, to)
}

/// Adds a title to a fixed collection (at the end); adding it again refreshes its snapshot.
#[tauri::command]
pub async fn collection_add(db: State<'_, Db>, active: State<'_, ActiveProfile>, collection_id: String, title_id: String, title: Value) -> Result<(), String> {
    let item = Item { title_id, title };
    let json = check_item(&item)?;
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &collection_id)?;
    if count(&conn, "SELECT COUNT(*) FROM collection_items WHERE collection_id = ?1", &collection_id)? >= MAX_ITEMS {
        return Err(crate::user_error::coded("collections.item-limit", &[("max", &MAX_ITEMS.to_string())]));
    }
    conn.execute(
        "INSERT INTO collection_items (collection_id, title_id, position, title)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM collection_items WHERE collection_id = ?1), ?3)
         ON CONFLICT(collection_id, title_id) DO UPDATE SET title = excluded.title",
        params![collection_id, item.title_id, json],
    )
    .map_err(sql)?;
    Ok(())
}

#[tauri::command]
pub async fn collection_remove(db: State<'_, Db>, active: State<'_, ActiveProfile>, collection_id: String, title_id: String) -> Result<(), String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    owned(&conn, &profile, &collection_id)?;
    conn.execute("DELETE FROM collection_items WHERE collection_id = ?1 AND title_id = ?2", params![collection_id, title_id]).map_err(sql)?;
    Ok(())
}

/// Creates several collections at once (an imported file), all or none.
#[tauri::command]
pub async fn collection_import(db: State<'_, Db>, active: State<'_, ActiveProfile>, collections: Vec<ImportInput>) -> Result<usize, String> {
    let profile = active.id()?;
    import(&mut *db.lock()?, &profile, &collections)
}

/// Asks where to save an export (built by the page; Downloads suggested),
/// writes it there and returns the path, or `None` if the person cancelled.
#[tauri::command]
pub async fn collection_export_save(app: AppHandle, text: String) -> Result<Option<String>, String> {
    check_export(&text)?;
    let Some(path) = crate::dialog::save_json(&app, &format!("orbit-collections-{}", chrono_date(now_ms()))).await else { return Ok(None) };
    std::fs::write(&path, text).map_err(|_| "err.file.save")?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Only JSON of a bounded size is written.
fn check_export(text: &str) -> Result<(), String> {
    if text.len() > MAX_EXPORT_BYTES {
        return Err("err.collections.export-too-large".into());
    }
    serde_json::from_str::<Value>(text).map_err(|_| "invalid export")?;
    Ok(())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let value = serde_json::from_slice(data).unwrap_or(Value::Null);
    let _ = check_parts("synthetic", None, &value, &value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(name: &str, sources: Value) -> CollectionInput {
        CollectionInput { name: name.into(), group: Some(" Studios ".into()), art: Art { cover: Some("https://img.example/c.jpg".into()), backdrop: None, shape: Some("landscape".into()) }, sources }
    }

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn export_holds_eight_megabytes() {
        // About 1,500 titles already passed 2 MiB; a full library fits in 8.
        let chunk = format!("\"{}\"", "x".repeat(MAX_EXPORT_BYTES / 5 - 4));
        let big = format!("[{}]", vec![chunk; 5].join(","));
        assert!(big.len() > 2 * 1024 * 1024 && big.len() <= MAX_EXPORT_BYTES);
        assert!(check_export(&big).is_ok());
        assert_eq!(check_export(&format!("\"{}\"", "x".repeat(MAX_EXPORT_BYTES))).unwrap_err(), "err.collections.export-too-large");
        assert!(check_export("not json").is_err());
    }

    #[test]
    fn checks_names_art_and_sources() {
        let ok = check(&input(" Marvel ", json!([{ "kind": "tmdb", "tmdb": "collection", "id": 86311, "media": "movie" }]))).unwrap();
        assert_eq!((ok.name.as_str(), ok.group.as_deref()), ("Marvel", Some("Studios")));
        assert!(check(&input("  ", json!([]))).is_err());
        assert!(check(&input(&"x".repeat(61), json!([]))).is_err());
        assert!(check(&input("A", json!({}))).is_err());
        assert!(check(&input("A", json!([{ "kind": "script" }]))).is_err());
        assert!(check(&input("A", json!(vec![json!({ "kind": "trakt" }); 21]))).is_err());
        let mut bad = input("A", json!([]));
        bad.art.cover = Some("http://img.example/c.jpg".into());
        assert!(check(&bad).is_err());
        bad.art.cover = Some("javascript:alert(1)".into());
        assert!(check(&bad).is_err());
        bad.art.cover = None;
        bad.art.shape = Some("circle".into());
        assert!(check(&bad).is_err());
        // Unknown art fields are refused rather than stored.
        assert!(serde_json::from_value::<Art>(json!({ "cover": "https://a.b/c", "onload": "x" })).is_err());
    }

    #[test]
    fn collections_belong_to_their_profile_and_keep_their_order() {
        let mut conn = db();
        let a = insert(&conn, "main", &check(&input("A", json!([]))).unwrap(), &[("tt1".into(), "{\"name\":\"One\"}".into())], 1).unwrap();
        let b = insert(&conn, "main", &check(&input("B", json!([]))).unwrap(), &[], 2).unwrap();
        let c = insert(&conn, "main", &check(&input("C", json!([]))).unwrap(), &[], 3).unwrap();
        let names = |conn: &Connection| all(conn, "main").unwrap().into_iter().map(|c| c.name).collect::<Vec<_>>();
        assert_eq!(names(&conn), ["A", "B", "C"]);
        move_to(&mut conn, "main", &c, 0).unwrap();
        assert_eq!(names(&conn), ["C", "A", "B"]);
        move_to(&mut conn, "main", &c, 99).unwrap();
        assert_eq!(names(&conn), ["A", "B", "C"]);
        assert!(all(&conn, "kid").unwrap().is_empty());
        assert!(owned(&conn, "kid", &a).is_err() && owned(&conn, "main", &b).is_ok());
        assert!(move_to(&mut conn, "kid", &a, 0).is_err());
        let first = &all(&conn, "main").unwrap()[0];
        assert_eq!((first.items.len(), first.group.as_deref()), (1, Some("Studios")));
        assert_eq!(first.art, json!({ "cover": "https://img.example/c.jpg", "shape": "landscape" }));
    }

    #[test]
    fn imports_all_or_nothing() {
        let mut conn = db();
        let good = || ImportInput { collection: input("Good", json!([{ "kind": "addon" }])), items: vec![Item { title_id: "tt1".into(), title: json!({ "meta": {} }) }] };
        assert_eq!(import(&mut conn, "main", &[good(), good()]).unwrap(), 2);
        let bad = ImportInput { collection: input("", json!([])), items: Vec::new() };
        assert!(import(&mut conn, "main", &[good(), bad]).is_err());
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0)).unwrap();
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM collection_items", [], |r| r.get(0)).unwrap();
        assert_eq!((total, items), (2, 2));
        let too_many: Vec<ImportInput> = (0..MAX_COLLECTIONS).map(|_| good()).collect();
        assert!(import(&mut conn, "main", &too_many).is_err());
    }

    #[test]
    fn an_import_names_the_collection_whose_sources_are_too_large() {
        let mut conn = db();
        let label = "x".repeat(1000);
        let big = ImportInput { collection: input("Big One", json!(vec![json!({ "kind": "addon", "label": label }); MAX_SOURCES])), items: Vec::new() };
        let good = ImportInput { collection: input("Good", json!([])), items: Vec::new() };
        assert_eq!(import(&mut conn, "main", &[good, big]).unwrap_err(), "err.collections.import-sources-too-large|name=Big One");
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 0);
    }
}
