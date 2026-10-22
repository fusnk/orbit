//! Downloads in SQLite. The stream's address (a web link that often embeds a
//! debrid key, or a magnet) is sealed with `vault`, bound to its row; to find
//! the same stream again when a link expires, the row keeps the addon's key
//! and a hash of the stream's identifying fields, never the address itself.

use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use serde_json::Value;

use crate::vault::{self, VaultError};

/// Where a download is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Queued,
    Running,
    Paused,
    /// The link stopped working; waiting for a fresh one from the addon.
    Expired,
    Failed,
    Done,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Expired => "expired",
            Self::Failed => "failed",
            Self::Done => "done",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "queued" => Self::Queued,
            "running" => Self::Running,
            "expired" => Self::Expired,
            "failed" => Self::Failed,
            "done" => Self::Done,
            _ => Self::Paused,
        }
    }
}

/// What a new download is, as the page describes it (already checked).
pub struct NewDownload<'a> {
    pub id: &'a str,
    pub profile: &'a str,
    pub title_id: &'a str,
    pub video_id: &'a str,
    pub title: &'a str,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub episode_title: Option<&'a str>,
    pub label: &'a str,
    pub addon_key: &'a str,
    pub stream_type: &'a str,
    pub stream_id: &'a str,
    pub identity: &'a str,
    pub torrent: bool,
    pub upload: bool,
    pub root: &'a str,
    pub folder: &'a str,
    pub base: &'a str,
}

/// A row as Rust uses it (paths included; they never reach the page).
#[derive(Clone, Debug)]
pub struct Download {
    pub id: String,
    pub profile: String,
    pub title_id: String,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub torrent: bool,
    pub upload: bool,
    pub state: State,
    pub root: PathBuf,
    pub folder: PathBuf,
    pub base: String,
    pub ext: Option<String>,
    pub validator: Option<String>,
    pub total: Option<u64>,
    sealed: Vec<u8>,
}

impl Download {
    /// The finished video.
    pub fn video(&self) -> Option<PathBuf> {
        self.ext.as_ref().map(|ext| self.folder.join(format!("{}.{ext}", self.base)))
    }

    /// Where the title's poster and logo go: the movie's folder, or the series' (above its seasons).
    pub fn art_folder(&self) -> PathBuf {
        match (self.season, self.folder.parent()) {
            (Some(_), Some(parent)) => parent.to_path_buf(),
            _ => self.folder.clone(),
        }
    }
}

/// What the page sees of a download: no paths, no address.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    title_id: String,
    video_id: String,
    /// Validated by the frontend on read, like any stored JSON.
    title: Value,
    season: Option<i64>,
    episode: Option<i64>,
    episode_title: Option<String>,
    label: String,
    addon_key: String,
    stream_type: String,
    stream_id: String,
    identity: String,
    torrent: bool,
    state: &'static str,
    error: Option<Value>,
    done_bytes: u64,
    total_bytes: Option<u64>,
    created_at: i64,
    finished_at: Option<i64>,
}

/// Binds a sealed address to its row and its profile (see `vault`): with the
/// id alone, a row's `profile_id` could be changed in the database and another
/// profile would get the address (a debrid link with its token) to play.
/// Ids are hex, so the parts can't run into each other.
fn aad(id: &str, profile: &str) -> Vec<u8> {
    format!("download-url:v2:{id}:{profile}").into_bytes()
}

/// What addresses sealed before the profile was bound used. Still read, so
/// those downloads keep working until `reseal_legacy` binds them.
fn legacy_aad(id: &str) -> Vec<u8> {
    format!("download-url:{id}").into_bytes()
}

pub fn seal(cipher: &aes_gcm::Aes256Gcm, id: &str, profile: &str, source: &str) -> Result<Vec<u8>, VaultError> {
    vault::seal(cipher, &aad(id, profile), source.as_bytes())
}

pub fn open(cipher: &aes_gcm::Aes256Gcm, row: &Download) -> Result<String, VaultError> {
    let plain = vault::open(cipher, &aad(&row.id, &row.profile), &row.sealed).or_else(|_| vault::open(cipher, &legacy_aad(&row.id), &row.sealed))?;
    String::from_utf8(plain).map_err(|_| VaultError::Undecryptable)
}

/// Re-seals addresses still sealed the legacy way under `aad`, binding them to
/// their profile, as `addons::reseal_legacy` does for addon URLs: each row
/// changes only if its re-seal succeeded and it still holds the ciphertext
/// that was read (compare-and-set), all in one transaction, so a failure
/// leaves the old, still readable address. Rows already bound, or unreadable,
/// are left alone. Returns how many rows changed.
pub fn reseal_legacy(conn: &mut Connection, cipher: &aes_gcm::Aes256Gcm) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, Vec<u8>)> = tx
        .prepare("SELECT id, profile_id, source FROM downloads")
        .and_then(|mut stmt| stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect())
        .map_err(|e| e.to_string())?;
    let mut changed = 0;
    for (id, profile, sealed) in rows {
        if vault::open(cipher, &aad(&id, &profile), &sealed).is_ok() {
            continue;
        }
        let Ok(plain) = vault::open(cipher, &legacy_aad(&id), &sealed) else { continue };
        let resealed = vault::seal(cipher, &aad(&id, &profile), &plain).map_err(|_| "couldn't re-seal a download's address")?;
        changed += tx.execute("UPDATE downloads SET source = ?1 WHERE id = ?2 AND source = ?3", params![resealed, id, sealed]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}

const COLUMNS: &str = "id, profile_id, title_id, season, torrent, upload, state, root, folder, base, ext, validator, total_bytes, source, episode";

fn download(row: &Row) -> rusqlite::Result<Download> {
    Ok(Download {
        id: row.get(0)?,
        profile: row.get(1)?,
        title_id: row.get(2)?,
        season: row.get(3)?,
        torrent: row.get(4)?,
        upload: row.get(5)?,
        state: State::parse(&row.get::<_, String>(6)?),
        root: PathBuf::from(row.get::<_, String>(7)?),
        folder: PathBuf::from(row.get::<_, String>(8)?),
        base: row.get(9)?,
        ext: row.get(10)?,
        validator: row.get(11)?,
        total: row.get::<_, Option<i64>>(12)?.map(|t| t.max(0) as u64),
        sealed: row.get(13)?,
        episode: row.get(14)?,
    })
}

pub fn insert(conn: &Connection, d: &NewDownload, sealed: &[u8], now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO downloads (id, profile_id, title_id, video_id, title, season, episode, episode_title, label, addon_key,
                                stream_type, stream_id, identity, torrent, upload, source, state, root, folder, base, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'queued', ?17, ?18, ?19, ?20)",
        params![
            d.id, d.profile, d.title_id, d.video_id, d.title, d.season, d.episode, d.episode_title, d.label, d.addon_key, d.stream_type, d.stream_id, d.identity, d.torrent,
            d.upload, sealed, d.root, d.folder, d.base, now
        ],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<Download>> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM downloads WHERE id = ?1"), [id], download).optional()
}

/// Download `id`, if it belongs to `profile`.
pub fn owned(conn: &Connection, profile: &str, id: &str) -> rusqlite::Result<Option<Download>> {
    Ok(get(conn, id)?.filter(|d| d.profile == profile))
}

/// `profile`'s earlier download of the same movie or episode, if any.
pub fn for_video(conn: &Connection, profile: &str, video_id: &str) -> rusqlite::Result<Vec<Download>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM downloads WHERE profile_id = ?1 AND video_id = ?2"))?;
    stmt.query_map(params![profile, video_id], download)?.collect()
}

/// All of `profile`'s downloads (to remove them with the profile).
pub fn for_profile(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<Download>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM downloads WHERE profile_id = ?1"))?;
    stmt.query_map([profile], download)?.collect()
}

/// Every download, of every profile (to know which files on disk are in use).
pub fn all(conn: &Connection) -> rusqlite::Result<Vec<Download>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM downloads"))?;
    stmt.query_map([], download)?.collect()
}

/// Every download of the title kept under `root` (any profile), to know when its folder is unused.
pub fn title_users(conn: &Connection, title_id: &str, root: &str) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM downloads WHERE title_id = ?1 AND root = ?2", params![title_id, root], |r| r.get(0))
}

/// The names (`base`) of the other downloads saved in `folder` (any profile), all but `except`.
/// Folders are matched ignoring case, as Windows and macOS do.
pub fn bases_in(conn: &Connection, folder: &str, except: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT base FROM downloads WHERE folder = ?1 COLLATE NOCASE AND id != ?2")?;
    stmt.query_map(params![folder, except], |r| r.get(0))?.collect()
}

pub fn list(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<Item>> {
    let mut stmt = conn.prepare(
        "SELECT id, title_id, video_id, title, season, episode, episode_title, label, addon_key, stream_type, stream_id, identity,
                torrent, state, error, done_bytes, total_bytes, created_at, finished_at
         FROM downloads WHERE profile_id = ?1 ORDER BY created_at",
    )?;
    stmt.query_map([profile], |row| {
        Ok(Item {
            id: row.get(0)?,
            title_id: row.get(1)?,
            video_id: row.get(2)?,
            title: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or(Value::Null),
            season: row.get(4)?,
            episode: row.get(5)?,
            episode_title: row.get(6)?,
            label: row.get(7)?,
            addon_key: row.get(8)?,
            stream_type: row.get(9)?,
            stream_id: row.get(10)?,
            identity: row.get(11)?,
            torrent: row.get(12)?,
            state: State::parse(&row.get::<_, String>(13)?).as_str(),
            error: row.get::<_, Option<String>>(14)?.and_then(|e| serde_json::from_str(&e).ok()),
            done_bytes: row.get::<_, i64>(15)?.max(0) as u64,
            total_bytes: row.get::<_, Option<i64>>(16)?.map(|t| t.max(0) as u64),
            created_at: row.get(17)?,
            finished_at: row.get(18)?,
        })
    })?
    .collect()
}

/// More waiting downloads than anyone queues; `queued` reads at most this many.
pub const MAX_QUEUED: usize = 10_000;

/// Up to `limit` queued downloads, oldest first, from every profile (the queue is shared).
pub fn queued(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM downloads WHERE state = 'queued' ORDER BY created_at LIMIT ?1")?;
    stmt.query_map([limit as i64], |r| r.get(0))?.collect()
}

pub fn set_state(conn: &Connection, id: &str, state: State, error: Option<&Value>) -> rusqlite::Result<()> {
    let error = error.map(Value::to_string);
    let finished = (state == State::Done).then(crate::library::now_ms);
    conn.execute("UPDATE downloads SET state = ?1, error = ?2, finished_at = COALESCE(?3, finished_at) WHERE id = ?4", params![state.as_str(), error, finished, id])?;
    Ok(())
}

/// What's needed to resume, saved as the transfer goes.
pub fn save_progress(conn: &Connection, id: &str, done: u64, total: Option<u64>, validator: Option<&str>, ext: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE downloads SET done_bytes = ?1, total_bytes = ?2, validator = ?3, ext = ?4 WHERE id = ?5",
        params![done as i64, total.map(|t| t as i64), validator, ext, id],
    )?;
    Ok(())
}

/// A fresh address for a stopped (expired, failed or paused) download, which
/// then waits its turn again. False if it isn't stopped (or is gone).
pub fn replace_source(conn: &Connection, id: &str, sealed: &[u8]) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE downloads SET source = ?1, state = 'queued', error = NULL WHERE id = ?2 AND state IN ('expired', 'failed', 'paused')",
        params![sealed, id],
    )?;
    Ok(changed == 1)
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM downloads WHERE id = ?1", [id])?;
    Ok(())
}

/// At startup nothing is downloading: what was running or waiting is paused,
/// for the person to resume, rather than lost or started unasked.
pub fn pause_unfinished(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("UPDATE downloads SET state = 'paused' WHERE state IN ('running', 'queued')", [])?;
    Ok(())
}

/// A download not marked done, its finished file's path and the size it must have.
pub struct Unfinished {
    pub id: String,
    video: PathBuf,
    expected: i64,
}

/// At startup: downloads not marked done whose finished file may already be in
/// place, because Orbit quit between renaming it (from its `.part` or staging
/// folder) and recording it. The size it must have is the total, or (a web
/// download that never said its size) the progress saved at its end.
pub fn unfinished(conn: &Connection) -> rusqlite::Result<Vec<Unfinished>> {
    let rows: Vec<(String, String, String, String, Option<i64>, i64)> = conn
        .prepare("SELECT id, folder, base, ext, total_bytes, done_bytes FROM downloads WHERE state != 'done' AND ext IS NOT NULL")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, folder, base, ext, total, done)| {
            let expected = total.or((done > 0).then_some(done))?;
            Some(Unfinished { id, video: PathBuf::from(folder).join(format!("{base}.{ext}")), expected })
        })
        .collect())
}

/// Those of `unfinished` whose file is on disk, whole (exactly the expected
/// size). Reads the disk, so call it without holding the database.
pub fn on_disk(unfinished: Vec<Unfinished>) -> Vec<Unfinished> {
    unfinished.into_iter().filter(|u| std::fs::metadata(&u.video).is_ok_and(|m| m.is_file() && i64::try_from(m.len()) == Ok(u.expected))).collect()
}

/// Every finished download (any profile), to check its file is still there.
pub fn done(conn: &Connection) -> rusqlite::Result<Vec<Download>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM downloads WHERE state = 'done'"))?;
    stmt.query_map([], download)?.collect()
}

/// Marks a finished download failed because its file is gone (`error` says
/// so), with nothing downloaded: tried again, it starts from the beginning.
/// False if it isn't done (or is gone).
pub fn mark_missing(conn: &Connection, id: &str, error: Option<&Value>) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE downloads SET state = 'failed', error = ?1, done_bytes = 0 WHERE id = ?2 AND state = 'done'",
        params![error.map(Value::to_string), id],
    )?;
    Ok(changed == 1)
}

/// Marks a download found whole on disk done, rather than downloading it again.
/// False if it's gone or was marked done meanwhile.
pub fn mark_done(conn: &Connection, finished: &Unfinished) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE downloads SET state = 'done', error = NULL, done_bytes = ?1, total_bytes = ?1, finished_at = COALESCE(finished_at, ?2) WHERE id = ?3 AND state != 'done'",
        params![finished.expected, crate::library::now_ms(), finished.id],
    )?;
    Ok(changed == 1)
}

/// Bytes on disk for every download (all profiles share the folder): whole
/// files, and what unfinished ones have so far — from `live` (bytes by id)
/// where it's ahead of what was last saved.
pub fn bytes_used(conn: &Connection, live: &std::collections::HashMap<String, u64>) -> rusqlite::Result<u64> {
    let mut stmt = conn.prepare("SELECT id, state, done_bytes, total_bytes FROM downloads")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<i64>>(3)?)))?;
    let mut used = 0u64;
    for row in rows {
        let (id, state, done, total) = row?;
        let bytes = if State::parse(&state) == State::Done {
            total.unwrap_or(0).max(0) as u64
        } else {
            (done.max(0) as u64).max(live.get(&id).copied().unwrap_or(0))
        };
        used = used.saturating_add(bytes);
    }
    Ok(used)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::KeyInit;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn
    }

    fn new<'a>(id: &'a str, profile: &'a str, video: &'a str) -> NewDownload<'a> {
        NewDownload {
            id,
            profile,
            title_id: "tt1",
            video_id: video,
            title: "{\"meta\":{}}",
            season: Some(1),
            episode: Some(2),
            episode_title: Some("Two"),
            label: "1080p",
            addon_key: "addon",
            stream_type: "series",
            stream_id: "tt1:1:2",
            identity: "abc",
            torrent: false,
            upload: false,
            root: "/videos/Orbit",
            folder: "/videos/Orbit/Series/Show/Season 01",
            base: "Show - S01E02 - Two",
        }
    }

    fn add(conn: &Connection, cipher: &aes_gcm::Aes256Gcm, d: &NewDownload, at: i64) {
        let sealed = seal(cipher, d.id, d.profile, "https://debrid.example/SECRET/file.mkv").unwrap();
        insert(conn, d, &sealed, at).unwrap();
    }

    #[test]
    fn seals_addresses_to_their_row() {
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        add(&conn, &cipher, &new("a", "main", "tt1:1:2"), 1);
        let raw: Vec<u8> = conn.query_row("SELECT source FROM downloads WHERE id = 'a'", [], |r| r.get(0)).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("SECRET"));
        let row = get(&conn, "a").unwrap().unwrap();
        assert_eq!(open(&cipher, &row).unwrap(), "https://debrid.example/SECRET/file.mkv");
        // Copied onto another row, it no longer opens.
        add(&conn, &cipher, &new("b", "main", "tt1:1:3"), 2);
        conn.execute("UPDATE downloads SET source = ?1 WHERE id = 'b'", [&raw]).unwrap();
        assert!(open(&cipher, &get(&conn, "b").unwrap().unwrap()).is_err());
        // Handed to another profile in the database, it no longer opens either.
        conn.execute("UPDATE downloads SET profile_id = 'kid' WHERE id = 'a'", []).unwrap();
        assert!(open(&cipher, &get(&conn, "a").unwrap().unwrap()).is_err());
    }

    #[test]
    fn old_rows_are_resealed_with_their_profile_once_and_never_lost() {
        let mut conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        let url = "https://debrid.example/SECRET/file.mkv";
        add(&conn, &cipher, &new("a", "main", "v1"), 1);
        add(&conn, &cipher, &new("b", "main", "v2"), 2);
        let old = vault::seal(&cipher, &legacy_aad("a"), url.as_bytes()).unwrap();
        conn.execute("UPDATE downloads SET source = ?1 WHERE id = 'a'", [&old]).unwrap();
        // A row nothing can open (another key, say) is left exactly as it is.
        let other = aes_gcm::Aes256Gcm::new_from_slice(&[8; 32]).unwrap();
        let unreadable = vault::seal(&other, &legacy_aad("b"), url.as_bytes()).unwrap();
        conn.execute("UPDATE downloads SET source = ?1 WHERE id = 'b'", [&unreadable]).unwrap();
        // Still read the old way until it's re-sealed, so nothing stops working.
        assert_eq!(open(&cipher, &get(&conn, "a").unwrap().unwrap()).unwrap(), url);

        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 1);
        let row = get(&conn, "a").unwrap().unwrap();
        assert_eq!(open(&cipher, &row).unwrap(), url);
        assert!(vault::open(&cipher, &legacy_aad("a"), &row.sealed).is_err(), "bound to its profile now");
        assert_eq!(get(&conn, "b").unwrap().unwrap().sealed, unreadable);
        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 0, "nothing left to do");
        conn.execute("UPDATE downloads SET profile_id = 'kid' WHERE id = 'a'", []).unwrap();
        assert!(open(&cipher, &get(&conn, "a").unwrap().unwrap()).is_err());
    }

    #[test]
    fn lists_per_profile_without_secrets() {
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        add(&conn, &cipher, &new("a", "main", "tt1:1:2"), 1);
        add(&conn, &cipher, &new("b", "kid", "tt1:1:2"), 2);
        let items = list(&conn, "main").unwrap();
        assert_eq!(items.len(), 1);
        let json = serde_json::to_string(&items).unwrap();
        assert!(!json.contains("SECRET") && !json.contains("/videos"), "{json}");
        assert!(owned(&conn, "kid", "a").unwrap().is_none());
        assert_eq!(for_video(&conn, "main", "tt1:1:2").unwrap().len(), 1);
        let kid: Vec<String> = for_profile(&conn, "kid").unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(kid, ["b"]);
        assert_eq!(title_users(&conn, "tt1", "/videos/Orbit").unwrap(), 2);
        // The other downloads beside one (any profile), to tell their files from its own.
        assert_eq!(bases_in(&conn, "/videos/Orbit/Series/Show/Season 01", "a").unwrap(), ["Show - S01E02 - Two"]);
        assert_eq!(bases_in(&conn, "/videos/orbit/series/show/season 01", "b").unwrap(), ["Show - S01E02 - Two"]);
        assert!(bases_in(&conn, "/videos/Orbit/Movies/Film", "a").unwrap().is_empty());
    }

    #[test]
    fn queue_progress_and_startup() {
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        add(&conn, &cipher, &new("a", "main", "v1"), 1);
        add(&conn, &cipher, &new("b", "main", "v2"), 2);
        add(&conn, &cipher, &new("c", "main", "v3"), 3);
        assert_eq!(queued(&conn, 2).unwrap(), ["a", "b"]);
        set_state(&conn, "a", State::Running, None).unwrap();
        save_progress(&conn, "a", 500, Some(1000), Some("\"v\""), Some("mkv")).unwrap();
        let row = get(&conn, "a").unwrap().unwrap();
        assert_eq!((row.state, row.total, row.validator.as_deref()), (State::Running, Some(1000), Some("\"v\"")));
        assert!(row.video().unwrap().ends_with("Show - S01E02 - Two.mkv"));
        assert!(row.art_folder().ends_with("Show"));
        set_state(&conn, "c", State::Done, None).unwrap();
        save_progress(&conn, "c", 2000, Some(2000), None, Some("mp4")).unwrap();
        assert_eq!(bytes_used(&conn, &Default::default()).unwrap(), 2500);
        // A running download counts what it has now, not what was last saved.
        let live = std::collections::HashMap::from([("a".to_string(), 800), ("c".to_string(), 1)]);
        assert_eq!(bytes_used(&conn, &live).unwrap(), 2800);

        pause_unfinished(&conn).unwrap();
        let states: Vec<&str> = list(&conn, "main").unwrap().iter().map(|i| i.state).collect();
        assert_eq!(states, ["paused", "paused", "done"]);

        set_state(&conn, "b", State::Expired, Some(&serde_json::json!({"kind": "expired"}))).unwrap();
        assert!(replace_source(&conn, "b", &seal(&cipher, "b", "main", "https://fresh.example/x").unwrap()).unwrap());
        let b = get(&conn, "b").unwrap().unwrap();
        assert_eq!(b.state, State::Queued);
        assert_eq!(open(&cipher, &b).unwrap(), "https://fresh.example/x");
        // Already queued again (resumed meanwhile), or gone: left alone.
        assert!(!replace_source(&conn, "b", &seal(&cipher, "b", "main", "https://other.example/y").unwrap()).unwrap());
        assert_eq!(open(&cipher, &get(&conn, "b").unwrap().unwrap()).unwrap(), "https://fresh.example/x");
        assert!(!replace_source(&conn, "zz", b"x").unwrap());
        delete(&conn, "b").unwrap();
        assert!(get(&conn, "b").unwrap().is_none());
    }

    #[test]
    fn a_finished_download_whose_file_went_is_marked_failed() {
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        add(&conn, &cipher, &new("a", "main", "v1"), 1);
        add(&conn, &cipher, &new("b", "main", "v2"), 2);
        set_state(&conn, "a", State::Done, None).unwrap();
        save_progress(&conn, "a", 1000, Some(1000), None, Some("mkv")).unwrap();
        let ids: Vec<String> = done(&conn).unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(ids, ["a"]);
        let error = serde_json::json!({"kind": "missing"});
        assert!(mark_missing(&conn, "a", Some(&error)).unwrap());
        let item = list(&conn, "main").unwrap().into_iter().find(|i| i.id == "a").unwrap();
        assert_eq!((item.state, item.error, item.done_bytes, item.total_bytes), ("failed", Some(error.clone()), 0, Some(1000)));
        // It no longer takes space, and isn't marked twice; one that isn't done is left alone.
        assert_eq!(bytes_used(&conn, &Default::default()).unwrap(), 0);
        assert!(!mark_missing(&conn, "a", Some(&error)).unwrap());
        assert!(!mark_missing(&conn, "b", Some(&error)).unwrap());
        assert_eq!(get(&conn, "b").unwrap().unwrap().state, State::Queued);
        // Put back where it was, the file is found at the next start (see `unfinished`).
        let row = get(&conn, "a").unwrap().unwrap();
        assert_eq!(unfinished(&conn).unwrap().into_iter().find(|u| u.id == "a").map(|u| (u.video, u.expected)), Some((row.video().unwrap(), 1000)));
    }

    #[test]
    fn a_file_renamed_before_quitting_is_marked_done() {
        let conn = conn();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[7; 32]).unwrap();
        let dir = std::env::temp_dir().join(format!("orbit-finished-test-{}", crate::library::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let folder = dir.to_string_lossy().into_owned();
        let at = |id, base| NewDownload { folder: &folder, root: &folder, base, ..new(id, "main", id) };
        // Renamed, but quit before the row said so: the whole file is there.
        add(&conn, &cipher, &at("whole", "Whole"), 1);
        save_progress(&conn, "whole", 1000, Some(1000), None, Some("mkv")).unwrap();
        std::fs::write(dir.join("Whole.mkv"), [0u8; 1000]).unwrap();
        // Total unknown until the end: the last saved progress is the file's size.
        add(&conn, &cipher, &at("unsized", "Unsized"), 2);
        save_progress(&conn, "unsized", 700, None, None, Some("mp4")).unwrap();
        std::fs::write(dir.join("Unsized.mp4"), [0u8; 700]).unwrap();
        // A file of the wrong size, or none: left to download.
        add(&conn, &cipher, &at("short", "Short"), 3);
        save_progress(&conn, "short", 400, Some(1000), None, Some("mkv")).unwrap();
        std::fs::write(dir.join("Short.mkv"), [0u8; 400]).unwrap();
        add(&conn, &cipher, &at("missing", "Missing"), 4);
        save_progress(&conn, "missing", 1000, Some(1000), None, Some("mkv")).unwrap();
        pause_unfinished(&conn).unwrap();

        let mark_finished = |conn: &Connection| -> Vec<String> {
            let found = on_disk(unfinished(conn).unwrap());
            let mut done: Vec<String> = found.into_iter().filter(|f| mark_done(conn, f).unwrap()).map(|f| f.id).collect();
            done.sort();
            done
        };
        assert_eq!(mark_finished(&conn), ["unsized", "whole"]);
        let state = |id: &str| get(&conn, id).unwrap().unwrap().state;
        assert_eq!([state("whole"), state("unsized"), state("short"), state("missing")], [State::Done, State::Done, State::Paused, State::Paused]);
        assert_eq!(get(&conn, "unsized").unwrap().unwrap().total, Some(700));
        let finished: Option<i64> = conn.query_row("SELECT finished_at FROM downloads WHERE id = 'whole'", [], |r| r.get(0)).unwrap();
        assert!(finished.is_some());
        // Already done: not reported again.
        assert!(mark_finished(&conn).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
