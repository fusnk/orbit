//! Backup and restore (Settings → Advanced): the app's settings plus the
//! active profile's My Library, lists, collections, watch history, own
//! ratings and notes, and favourite episodes, as one JSON file.
//!
//! Never included: addons (their URLs can hold credentials), PINs, the TMDB
//! token or anything else in the keychain, downloads (their files stay on
//! this computer), Live TV sources, Jellyfin and Plex servers (their sign-ins
//! are sealed to this computer's keychain), debrid accounts (their keys are
//! in the keychain), and settings that only mean something on
//! this computer (see `LOCAL_SETTINGS`). Per-profile settings are the active
//! profile's only. A backup only ever restores into the active profile, and
//! every value is checked as if it came from outside. On a profile with a
//! content limit, restoring needs a parent's PIN (see `profiles::check_restore`).

use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::db::Db;
use crate::library::{MAX_SNAPSHOT_BYTES, check_id, now_ms};
use crate::profiles::{ActiveProfile, profile_setting};
use crate::episode_favourites::FavouriteEpisode;
use crate::ratings::UserRating;

const FORMAT: u32 = 1;
const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;
const MAX_ROWS: usize = 50_000;
const MAX_SETTING_BYTES: usize = 64 * 1024;
/// Settings left out of backups and never restored: the downloads folder (a
/// path on this computer, which only `download_folder_set` may write), the
/// profile picked last, and Live TV's last channels (Live TV sources aren't
/// backed up, so they'd point at nothing), and the external player (a program
/// on this computer that Orbit starts: a backup from anywhere must not pick it;
/// only `external_player_set` writes it). Orbit Connect's switch and this
/// device's name belong to this device too: a backup restored on the TV must
/// not turn Connect on there or name it after the PC. So do the window's
/// placement (this computer's screens), Settings' "Show all settings", and the
/// Android TV home screen's Watch Next row. Stremio and AniList sync (per
/// profile, matched by prefix) stay too: restored on a new device they would
/// start syncing before the person signed in there. So does what was still
/// waiting to be sent to Stremio, which this device's next start sends.
/// And every switch that sends something off this device once it's on
/// (Discord presence, TVmaze air times, AniSkip, AI subtitle translation,
/// torrents, background trailers from YouTube, update checks and automatic
/// updates): each is the person's choice for this device, so a backup made
/// elsewhere (or someone else's) can't turn one on here.
const LOCAL_SETTINGS: [&str; 23] = [
    "downloads:folder",
    "profiles.last",
    "live.last",
    crate::external::SETTING,
    "updates.last-check",
    "updates.whats-new",
    "connect.enabled",
    "connect.name",
    "general.window-placement",
    "settings.show-all",
    "android.watch-next",
    "stremio.sync",
    "stremio.pending",
    "anilist.sync",
    "integrations.discord",
    crate::tvmaze::SETTING,
    "playback.aniskip",
    "subtitles.ai-translate",
    "playback.torrents",
    "video.hero-trailer",
    "video.banner-trailers",
    "updates.check",
    "updates.auto",
];

/// Whether `key` is one of this device's own settings, or a profile's copy of one.
fn local(key: &str) -> bool {
    LOCAL_SETTINGS.contains(&key) || profile_setting(key).is_some_and(|(prefix, _)| LOCAL_SETTINGS.contains(&prefix))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    orbit_backup: u32,
    created_at: i64,
    settings: Vec<Setting>,
    library: Vec<Saved>,
    lists: Vec<List>,
    /// Absent from backups made before collections.
    #[serde(default)]
    collections: Vec<BackupCollection>,
    watch_titles: Vec<WatchTitle>,
    watch_progress: Vec<WatchProgress>,
    /// Absent from backups made before ratings.
    #[serde(default)]
    ratings: Vec<UserRating>,
    /// Absent from backups made before favourite episodes.
    #[serde(default)]
    favourite_episodes: Vec<FavouriteEpisode>,
}

/// A custom collection; its titles' `added_at` holds their place in it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupCollection {
    name: String,
    group: Option<String>,
    art: Value,
    sources: Value,
    created_at: i64,
    items: Vec<Saved>,
}

#[derive(Serialize, Deserialize)]
struct Setting {
    key: String,
    value: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    id: String,
    added_at: i64,
    title: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct List {
    name: String,
    /// Missing in backups made before lists had descriptions.
    #[serde(default)]
    description: String,
    created_at: i64,
    items: Vec<Saved>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchTitle {
    title_id: String,
    title: Value,
    next: Option<Value>,
    completed: bool,
    updated_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchProgress {
    video_id: String,
    title_id: String,
    season: Option<i64>,
    episode: Option<i64>,
    position: f64,
    duration: f64,
    watched: bool,
    updated_at: i64,
}

fn json(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or(Value::Null)
}

/// Whether a setting goes into `profile`'s backup: not one of this computer's
/// own, and not another profile's copy of a per-profile setting.
fn exported(key: &str, profile: &str) -> bool {
    !local(key) && profile_setting(key).is_none_or(|(_, id)| id == profile)
}

/// The backup's settings as they restore into `profile`: this computer's own
/// left out, and each per-profile setting under `profile`'s key. Backups made
/// before they were limited to one profile hold every profile's copy; then the
/// one with `profile`'s id is used, or the only one, or none.
fn restored<'a>(settings: &'a [Setting], profile: &str) -> Vec<(String, &'a Value)> {
    let mut out = Vec::new();
    for s in settings.iter().filter(|s| !local(&s.key)) {
        let Some((prefix, id)) = profile_setting(&s.key) else {
            out.push((s.key.clone(), &s.value));
            continue;
        };
        let copies = settings.iter().filter(|o| profile_setting(&o.key).is_some_and(|(p, _)| p == prefix)).count();
        let ours = settings.iter().any(|o| o.key == format!("{prefix}.{profile}"));
        if id == profile || (!ours && copies == 1) {
            out.push((format!("{prefix}.{profile}"), &s.value));
        }
    }
    out
}

fn collect(conn: &Connection, profile: &str) -> rusqlite::Result<Backup> {
    let settings = conn
        .prepare("SELECT key, value FROM settings ORDER BY key")?
        .query_map([], |r| Ok(Setting { key: r.get(0)?, value: json(&r.get::<_, String>(1)?) }))?
        .filter(|s| s.as_ref().map_or(true, |s| exported(&s.key, profile)))
        .collect::<Result<_, _>>()?;
    let library = conn
        .prepare("SELECT id, added_at, title FROM library WHERE profile_id = ?1")?
        .query_map([profile], |r| Ok(Saved { id: r.get(0)?, added_at: r.get(1)?, title: json(&r.get::<_, String>(2)?) }))?
        .collect::<Result<_, _>>()?;
    let mut lists: Vec<(String, List)> = conn
        .prepare("SELECT id, name, description, created_at FROM lists WHERE profile_id = ?1 ORDER BY created_at")?
        .query_map([profile], |r| Ok((r.get(0)?, List { name: r.get(1)?, description: r.get(2)?, created_at: r.get(3)?, items: Vec::new() })))?
        .collect::<Result<_, _>>()?;
    let mut items = conn.prepare("SELECT title_id, added_at, title FROM list_items WHERE list_id = ?1")?;
    for (id, list) in &mut lists {
        list.items = items
            .query_map([&*id], |r| Ok(Saved { id: r.get(0)?, added_at: r.get(1)?, title: json(&r.get::<_, String>(2)?) }))?
            .collect::<Result<_, _>>()?;
    }
    let mut collections: Vec<(String, BackupCollection)> = conn
        .prepare("SELECT id, name, grp, art, sources, created_at FROM collections WHERE profile_id = ?1 ORDER BY position, created_at")?
        .query_map([profile], |r| {
            Ok((r.get(0)?, BackupCollection { name: r.get(1)?, group: r.get(2)?, art: json(&r.get::<_, String>(3)?), sources: json(&r.get::<_, String>(4)?), created_at: r.get(5)?, items: Vec::new() }))
        })?
        .collect::<Result<_, _>>()?;
    let mut collection_items = conn.prepare("SELECT title_id, position, title FROM collection_items WHERE collection_id = ?1 ORDER BY position")?;
    for (id, collection) in &mut collections {
        collection.items = collection_items
            .query_map([&*id], |r| Ok(Saved { id: r.get(0)?, added_at: r.get(1)?, title: json(&r.get::<_, String>(2)?) }))?
            .collect::<Result<_, _>>()?;
    }
    let watch_titles = conn
        .prepare("SELECT title_id, title, next, completed, updated_at FROM watch_titles WHERE profile_id = ?1")?
        .query_map([profile], |r| {
            Ok(WatchTitle {
                title_id: r.get(0)?,
                title: json(&r.get::<_, String>(1)?),
                next: r.get::<_, Option<String>>(2)?.map(|n| json(&n)),
                completed: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let watch_progress = conn
        .prepare("SELECT video_id, title_id, season, episode, position, duration, watched, updated_at FROM watch_progress WHERE profile_id = ?1")?
        .query_map([profile], |r| {
            Ok(WatchProgress {
                video_id: r.get(0)?,
                title_id: r.get(1)?,
                season: r.get(2)?,
                episode: r.get(3)?,
                position: r.get(4)?,
                duration: r.get(5)?,
                watched: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let ratings = crate::ratings::all(conn, profile)?;
    let favourite_episodes = crate::episode_favourites::all(conn, profile)?;
    Ok(Backup { orbit_backup: FORMAT, created_at: now_ms(), settings, library, lists: lists.into_iter().map(|(_, l)| l).collect(),
        collections: collections.into_iter().map(|(_, c)| c).collect(),
        watch_titles,
        watch_progress,
        ratings,
        favourite_episodes,
    })
}

fn snapshot(title: &Value) -> Result<String, String> {
    let text = title.to_string();
    if !title.is_object() || text.len() > MAX_SNAPSHOT_BYTES {
        return Err("err.backup.bad-title".into());
    }
    Ok(text)
}

/// Checks everything first, then writes it all or nothing.
fn restore(conn: &mut Connection, profile: &str, backup: &Backup) -> Result<(), String> {
    let invalid = |what: &str| format!("err.backup.bad-{what}");
    if backup.orbit_backup != FORMAT {
        return Err("err.backup.version".into());
    }
    let rows = backup.settings.len()
        + backup.library.len()
        + backup.lists.iter().map(|l| l.items.len() + 1).sum::<usize>()
        + backup.collections.iter().map(|c| c.items.len() + 1).sum::<usize>()
        + backup.watch_titles.len()
        + backup.watch_progress.len()
        + backup.ratings.len()
        + backup.favourite_episodes.len();
    if rows > MAX_ROWS {
        return Err("err.backup.too-large".into());
    }
    // As a save from the player is held to (see `watch::check_progress`).
    let finite = |v: f64| v.is_finite() && (0.0..=crate::watch::MAX_SECONDS).contains(&v);
    let settings = restored(&backup.settings, profile);
    for (key, value) in &settings {
        crate::check_name(key).map_err(|_| invalid("setting"))?;
        if value.to_string().len() > MAX_SETTING_BYTES {
            return Err(invalid("setting"));
        }
        // Only `tmdb_set_region` writes the region (see `db::check_writable`): a backup's is held to its check.
        if key == crate::tmdb::REGION_SETTING && value.as_str().is_none_or(|region| crate::tmdb::check_region(region).is_err()) {
            return Err(invalid("setting"));
        }
    }
    let collections = backup
        .collections
        .iter()
        .map(|c| {
            let checked = crate::collections::check_parts(&c.name, c.group.as_deref(), &c.art, &c.sources).map_err(|_| invalid("collection"))?;
            let items = c.items.iter().map(|i| Ok((i.id.clone(), check_id(&i.id).map_err(|_| invalid("collection")).and(snapshot(&i.title))?))).collect::<Result<Vec<_>, String>>()?;
            Ok((checked, c.created_at, items))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let ratings = backup
        .ratings
        .iter()
        .map(|r| crate::ratings::check(&r.title_id, r.rating, r.liked, r.note.as_deref()).map(|checked| (checked, r.updated_at)).map_err(|_| invalid("rating")))
        .collect::<Result<Vec<_>, String>>()?;
    let favourite_episodes = backup
        .favourite_episodes
        .iter()
        .map(|f| crate::episode_favourites::check(f).map_err(|_| invalid("favourite")))
        .collect::<Result<Vec<_>, String>>()?;
    // A time the page can turn into a date (JavaScript's limit, ±8.64e15 ms): My Library → History fails to draw past it.
    let date = |at: i64| (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&at);
    if backup.watch_titles.iter().any(|t| !date(t.updated_at)) {
        return Err(invalid("history"));
    }
    for p in &backup.watch_progress {
        check_id(&p.video_id).and(check_id(&p.title_id)).map_err(|_| invalid("history"))?;
        if !finite(p.position) || !finite(p.duration) || !date(p.updated_at) {
            return Err(invalid("history"));
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sql = |e: rusqlite::Error| e.to_string();
    // Under the same key cap as `settings_set`: the page hands this text over,
    // so repeated imports with new keys must not grow the table without bound.
    for (key, value) in &settings {
        crate::db::write_capped(&tx, key, &value.to_string()).map_err(|e| if e == crate::db::TOO_MANY_SETTINGS { "err.backup.too-large".into() } else { e })?;
    }
    for item in &backup.library {
        check_id(&item.id).map_err(|_| invalid("title"))?;
        tx.execute(
            "INSERT INTO library (profile_id, id, added_at, title) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(profile_id, id) DO UPDATE SET title = excluded.title",
            params![profile, item.id, item.added_at, snapshot(&item.title)?],
        )
        .map_err(sql)?;
    }
    for list in &backup.lists {
        let name = list.name.trim();
        let description = list.description.trim();
        if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) || description.chars().count() > 300 || description.chars().any(char::is_control) {
            return Err(invalid("list"));
        }
        // A list of the same name is merged into, so restoring twice doesn't duplicate it.
        let existing: Option<String> = tx
            .query_row("SELECT id FROM lists WHERE profile_id = ?1 AND name = ?2", params![profile, name], |r| r.get(0))
            .optional()
            .map_err(sql)?;
        let id = match existing {
            Some(id) => id,
            None => {
                let mut bytes = [0u8; 8];
                getrandom::fill(&mut bytes).map_err(|_| "couldn't create a list id")?;
                let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                tx.execute("INSERT INTO lists (id, profile_id, name, description, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, profile, name, description, list.created_at]).map_err(sql)?;
                id
            }
        };
        for item in &list.items {
            check_id(&item.id).map_err(|_| invalid("list"))?;
            tx.execute(
                "INSERT INTO list_items (list_id, title_id, added_at, title) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(list_id, title_id) DO NOTHING",
                params![id, item.id, item.added_at, snapshot(&item.title)?],
            )
            .map_err(sql)?;
        }
    }
    for (collection, created_at, items) in &collections {
        // A collection of the same name (and group) is merged into, so restoring twice doesn't duplicate it.
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM collections WHERE profile_id = ?1 AND name = ?2 AND grp IS ?3",
                params![profile, collection.name, collection.group],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        match existing {
            Some(id) => {
                for (title_id, title) in items {
                    tx.execute(
                        "INSERT INTO collection_items (collection_id, title_id, position, title)
                         VALUES (?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM collection_items WHERE collection_id = ?1), ?3)
                         ON CONFLICT(collection_id, title_id) DO NOTHING",
                        params![id, title_id, title],
                    )
                    .map_err(sql)?;
                }
            }
            None => {
                let count: i64 = tx.query_row("SELECT COUNT(*) FROM collections WHERE profile_id = ?1", [profile], |r| r.get(0)).map_err(sql)?;
                if count >= crate::collections::MAX_COLLECTIONS {
                    return Err(crate::user_error::coded("collections.limit", &[("max", &crate::collections::MAX_COLLECTIONS.to_string())]));
                }
                crate::collections::insert(&tx, profile, collection, items, *created_at)?;
            }
        }
    }
    for t in &backup.watch_titles {
        check_id(&t.title_id).map_err(|_| invalid("history"))?;
        let next = t.next.as_ref().filter(|n| !n.is_null()).map(snapshot).transpose()?;
        // Newer history already here wins over the backup's.
        tx.execute(
            "INSERT INTO watch_titles (profile_id, title_id, title, next, completed, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(profile_id, title_id) DO UPDATE SET title = excluded.title, next = excluded.next, completed = excluded.completed, updated_at = excluded.updated_at
             WHERE excluded.updated_at > watch_titles.updated_at",
            params![profile, t.title_id, snapshot(&t.title)?, next, t.completed, t.updated_at],
        )
        .map_err(sql)?;
    }
    for p in &backup.watch_progress {
        tx.execute(
            "INSERT INTO watch_progress (profile_id, video_id, title_id, season, episode, position, duration, watched, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(profile_id, video_id) DO UPDATE SET title_id = excluded.title_id, season = excluded.season, episode = excluded.episode, position = excluded.position,
               duration = excluded.duration, watched = excluded.watched, updated_at = excluded.updated_at
             WHERE excluded.updated_at > watch_progress.updated_at",
            params![profile, p.video_id, p.title_id, p.season, p.episode, p.position, p.duration, p.watched, p.updated_at],
        )
        .map_err(sql)?;
    }
    // Newer ratings and notes already here win over the backup's.
    for (rating, updated_at) in &ratings {
        crate::ratings::save(&tx, profile, rating, *updated_at, true).map_err(sql)?;
    }
    // Favourite episodes already here stay as they are.
    for favourite in &favourite_episodes {
        crate::episode_favourites::save(&tx, profile, favourite, true)?;
    }
    tx.commit().map_err(sql)
}

/// Asks where to save a backup (Downloads suggested), writes it there and
/// returns the path; `None` if the person cancelled.
#[tauri::command]
pub async fn backup_export(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Option<String>, String> {
    let profile = active.id()?;
    let backup = collect(&*db.lock()?, &profile).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    let Some(path) = crate::dialog::save_json(&app, &format!("orbit-backup-{}", chrono_date(backup.created_at))).await else { return Ok(None) };
    std::fs::write(&path, text).map_err(|_| "err.backup.save")?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// "YYYY-MM-DD" (UTC) for a time in milliseconds, without a date library.
pub(crate) fn chrono_date(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Restores a backup (the file's text) into the active profile. On a limited
/// profile this needs a parent, by `guardian_pin` (see `profiles::check_restore`).
/// Held while a backup restores: a second restore (Restore pressed twice) is
/// refused rather than run again behind the first, which would import it twice.
static RESTORING: AtomicBool = AtomicBool::new(false);

struct RestoreGuard;

impl RestoreGuard {
    fn start() -> Result<Self, String> {
        if RESTORING.swap(true, Ordering::AcqRel) { Err("err.backup.busy".into()) } else { Ok(RestoreGuard) }
    }
}

impl Drop for RestoreGuard {
    fn drop(&mut self) {
        RESTORING.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn backup_import(db: State<'_, Db>, active: State<'_, ActiveProfile>, text: String, guardian_pin: Option<String>) -> Result<(), String> {
    let _restoring = RestoreGuard::start()?;
    if text.len() > MAX_FILE_BYTES {
        return Err("err.backup.too-large".into());
    }
    let backup: Backup = serde_json::from_str(&text).map_err(|_| "err.backup.not-backup")?;
    crate::profiles::check_restore(&db, &active, guardian_pin.as_deref())?;
    let profile = active.id()?;
    restore(&mut *db.lock()?, &profile, &backup)
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let _ = snapshot(&serde_json::from_slice(data).unwrap_or(Value::Null));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_restore_at_a_time() {
        let first = RestoreGuard::start().unwrap();
        assert_eq!(RestoreGuard::start().err().unwrap(), "err.backup.busy");
        drop(first);
        assert!(RestoreGuard::start().is_ok());
    }

    #[test]
    fn formats_dates() {
        assert_eq!(chrono_date(0), "1970-01-01");
        assert_eq!(chrono_date(1_790_000_000_000), "2026-09-21");
    }

    #[test]
    fn settings_are_this_profiles_and_not_this_computers() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        for (key, value) in [
            ("theme", "\"black\""),
            ("downloads:folder", "\"D:\\\\Videos\""),
            ("profiles.last", "\"kid\""),
            ("live.last", "{\"main\":{}}"),
            ("player.track-memory.main", "[[\"tt1\",\"fr\",\"\"]]"),
            ("player.track-memory.kid", "[[\"tt2\",\"en\",\"\"]]"),
            ("player.external", "{\"kind\":\"vlc\"}"),
        ] {
            conn.execute("INSERT INTO settings VALUES (?1, ?2)", [key, value]).unwrap();
        }
        let backup = collect(&conn, "main").unwrap();
        let keys: Vec<&str> = backup.settings.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["player.track-memory.main", "theme"]);

        // Restored into another profile, the per-profile copy becomes that profile's; the others are untouched.
        restore(&mut conn, "kid", &backup).unwrap();
        let value = |key: &str| -> String { conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).unwrap() };
        assert_eq!(value("player.track-memory.kid"), "[[\"tt1\",\"fr\",\"\"]]");
        assert_eq!(value("player.track-memory.main"), "[[\"tt1\",\"fr\",\"\"]]");
        assert_eq!(value("profiles.last"), "\"kid\"");

        // An older backup with every profile's copy: the restoring profile's own is used, else none.
        let old = |key: &str| Setting { key: key.into(), value: Value::Null };
        let all = [old("home.layout.main"), old("home.layout.kid"), old("live.last"), old("downloads:folder")];
        let keys = |profile| restored(&all, profile).into_iter().map(|(k, _)| k).collect::<Vec<_>>();
        assert_eq!(keys("kid"), ["home.layout.kid"]);
        assert!(keys("other").is_empty());
    }

    #[test]
    fn a_backup_from_the_first_version_restores() {
        // As the first backups were written: every setting (this computer's and every profile's), lists
        // without descriptions, and no collections, ratings or favourite episodes.
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let backup: Backup = serde_json::from_value(serde_json::json!({
            "orbitBackup": 1, "createdAt": 1_759_300_000_000_i64,
            "settings": [
                { "key": "downloads:folder", "value": "D:\\Videos" },
                { "key": "profiles.last", "value": "kid" },
                { "key": "home.layout.main", "value": { "order": ["continue"] } },
                { "key": "home.layout.kid", "value": { "order": ["top"] } },
                { "key": "theme", "value": "black" },
            ],
            "library": [{ "id": "tt1", "addedAt": 1, "title": { "name": "One" } }],
            "lists": [{ "name": "Date night", "createdAt": 1, "items": [{ "id": "tt1", "addedAt": 2, "title": { "name": "One" } }] }],
            "watchTitles": [{ "titleId": "tt2", "title": { "name": "Two" }, "next": null, "completed": false, "updatedAt": 3 }],
            "watchProgress": [{ "videoId": "tt2:1:1", "titleId": "tt2", "season": 1, "episode": 1, "position": 60.0, "duration": 1200.0, "watched": false, "updatedAt": 3 }],
        }))
        .unwrap();
        restore(&mut conn, "main", &backup).unwrap();
        let value = |key: &str| -> Option<String> { conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional().unwrap() };
        assert_eq!(value("home.layout.main").as_deref(), Some("{\"order\":[\"continue\"]}"));
        assert_eq!(value("home.layout.kid"), None);
        assert_eq!((value("downloads:folder"), value("profiles.last")), (None, None));
        let description: String = conn.query_row("SELECT description FROM lists WHERE profile_id = 'main'", [], |r| r.get(0)).unwrap();
        assert_eq!(description, "");
        let next: Option<String> = conn.query_row("SELECT next FROM watch_titles WHERE title_id = 'tt2'", [], |r| r.get(0)).unwrap();
        assert_eq!(next, None);
        let position: f64 = conn.query_row("SELECT position FROM watch_progress WHERE video_id = 'tt2:1:1'", [], |r| r.get(0)).unwrap();
        assert_eq!(position, 60.0);
    }

    #[test]
    fn device_settings_stay_on_this_device() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let device = ["general.window-placement", "settings.show-all", "android.watch-next", "stremio.sync.main", "stremio.pending.main", "anilist.sync.main"];
        for key in device.iter().chain(&["theme"]) {
            conn.execute("INSERT INTO settings VALUES (?1, 'true')", [key]).unwrap();
        }
        let keys: Vec<String> = collect(&conn, "main").unwrap().settings.into_iter().map(|s| s.key).collect();
        assert_eq!(keys, ["theme"]);

        // A backup that holds them anyway (an older or crafted one) doesn't restore them.
        let mut fresh = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut fresh).unwrap();
        let settings: Vec<Value> = device.iter().map(|key| serde_json::json!({ "key": key, "value": true })).collect();
        let backup: Backup = serde_json::from_value(serde_json::json!({
            "orbitBackup": FORMAT, "createdAt": 1, "settings": settings, "library": [], "lists": [], "watchTitles": [], "watchProgress": [],
        }))
        .unwrap();
        restore(&mut fresh, "main", &backup).unwrap();
        let rows: i64 = fresh.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_backup_never_turns_on_sharing_this_device_has_off() {
        let sharing = [
            "integrations.discord",
            "alerts.air-times",
            "playback.aniskip",
            "subtitles.ai-translate",
            "video.hero-trailer",
            "video.banner-trailers",
            "updates.check",
            "updates.auto",
        ];
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        for key in sharing.iter().chain(&["playback.torrents"]) {
            conn.execute("INSERT INTO settings VALUES (?1, 'false')", [key]).unwrap();
        }
        conn.execute("INSERT INTO settings VALUES ('theme', '\"black\"')", []).unwrap();
        // Not in a backup made here...
        let keys: Vec<String> = collect(&conn, "main").unwrap().settings.into_iter().map(|s| s.key).collect();
        assert_eq!(keys, ["theme"]);
        // ...and one made on another device (or by someone else) that has them on doesn't turn them on here.
        let mut settings: Vec<Value> = sharing.iter().map(|key| serde_json::json!({ "key": key, "value": true })).collect();
        settings.push(serde_json::json!({ "key": "playback.torrents", "value": "always" }));
        settings.push(serde_json::json!({ "key": "theme", "value": "midnight" }));
        let backup: Backup = serde_json::from_value(serde_json::json!({
            "orbitBackup": FORMAT, "createdAt": 1, "settings": settings, "library": [], "lists": [], "watchTitles": [], "watchProgress": [],
        }))
        .unwrap();
        restore(&mut conn, "main", &backup).unwrap();
        for key in sharing.iter().chain(&["playback.torrents"]) {
            let value: String = conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).unwrap();
            assert_eq!(value, "false", "{key}");
        }
        // Everything else comes back as before.
        let theme: String = conn.query_row("SELECT value FROM settings WHERE key = 'theme'", [], |r| r.get(0)).unwrap();
        assert_eq!(theme, "\"midnight\"");
    }

    #[test]
    fn a_backup_never_picks_the_external_player() {
        // A crafted backup naming a program: restoring must not save it.
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let backup: Backup = serde_json::from_value(serde_json::json!({
            "orbitBackup": FORMAT, "createdAt": 1,
            "settings": [{ "key": "player.external", "value": { "kind": "custom", "path": "C:/Users/x/evil.exe" } }, { "key": "theme", "value": "black" }],
            "library": [], "lists": [], "watchTitles": [], "watchProgress": [],
        }))
        .unwrap();
        restore(&mut conn, "main", &backup).unwrap();
        let external: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = 'player.external'", [], |r| r.get(0)).optional().unwrap();
        assert_eq!(external, None);
        let theme: String = conn.query_row("SELECT value FROM settings WHERE key = 'theme'", [], |r| r.get(0)).unwrap();
        assert_eq!(theme, "\"black\"");
    }

    #[test]
    fn a_backups_progress_is_held_to_a_real_videos_length() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let backup = |position: f64| -> Backup {
            serde_json::from_value(serde_json::json!({
                "orbitBackup": FORMAT, "createdAt": 1, "settings": [], "library": [], "lists": [], "watchTitles": [],
                "watchProgress": [{ "videoId": "tt1", "titleId": "tt1", "season": null, "episode": null, "position": position, "duration": 5400.0, "watched": false, "updatedAt": 1 }],
            }))
            .unwrap()
        };
        assert!(restore(&mut conn, "main", &backup(1e300)).is_err());
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM watch_progress", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        restore(&mut conn, "main", &backup(600.0)).unwrap();
    }

    #[test]
    fn a_backups_history_times_are_dates_the_page_can_show() {
        // Past 8.64e15 ms a time is no date at all for the page: My Library → History would fail to draw.
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let backup = |title_at: i64, progress_at: i64| -> Backup {
            serde_json::from_value(serde_json::json!({
                "orbitBackup": FORMAT, "createdAt": 1, "settings": [], "library": [], "lists": [],
                "watchTitles": [{ "titleId": "tt1", "title": { "name": "One" }, "next": null, "completed": false, "updatedAt": title_at }],
                "watchProgress": [{ "videoId": "tt1", "titleId": "tt1", "season": null, "episode": null, "position": 60.0, "duration": 5400.0, "watched": false, "updatedAt": progress_at }],
            }))
            .unwrap()
        };
        assert!(restore(&mut conn, "main", &backup(1, 9_000_000_000_000_000)).is_err());
        assert!(restore(&mut conn, "main", &backup(i64::MIN, 1)).is_err());
        let rows: i64 = conn.query_row("SELECT (SELECT COUNT(*) FROM watch_progress) + (SELECT COUNT(*) FROM watch_titles)", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        restore(&mut conn, "main", &backup(1_759_300_000_000, 1_759_300_000_000)).unwrap();
    }

    #[test]
    fn a_backups_region_is_checked_like_the_picker() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let backup = |region: Value| -> Backup {
            serde_json::from_value(serde_json::json!({
                "orbitBackup": FORMAT, "createdAt": 1,
                "settings": [{ "key": crate::tmdb::REGION_SETTING, "value": region }, { "key": "theme", "value": "black" }],
                "library": [], "lists": [], "watchTitles": [], "watchProgress": [],
            }))
            .unwrap()
        };
        let region = |conn: &Connection| -> Option<String> { conn.query_row("SELECT value FROM settings WHERE key = 'streaming.region'", [], |r| r.get(0)).optional().unwrap() };
        for bad in [serde_json::json!("gb"), serde_json::json!("GBR"), serde_json::json!(7), serde_json::json!({ "x": 1 })] {
            assert!(restore(&mut conn, "main", &backup(bad.clone())).is_err(), "{bad}");
            assert_eq!(region(&conn), None);
        }
        restore(&mut conn, "main", &backup(serde_json::json!("GB"))).unwrap();
        assert_eq!(region(&conn).as_deref(), Some("\"GB\""));
    }

    #[test]
    fn round_trips_into_another_profile() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO settings VALUES ('theme', '\"black\"')", []).unwrap();
        conn.execute("INSERT INTO library VALUES ('main', 'tt1', 1, '{\"name\":\"One\"}')", []).unwrap();
        conn.execute("INSERT INTO lists (id, profile_id, name, description, created_at) VALUES ('l1', 'main', 'Date night', 'Fridays', 1)", []).unwrap();
        conn.execute("INSERT INTO list_items VALUES ('l1', 'tt1', 2, '{\"name\":\"One\"}')", []).unwrap();
        conn.execute(
            "INSERT INTO collections VALUES ('c1', 'main', 0, 'Saga', 'Studios', '{\"cover\":\"https://img.example/c.jpg\"}', '[{\"kind\":\"tmdb\",\"tmdb\":\"collection\",\"id\":10,\"media\":\"movie\"}]', 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO collections VALUES ('c2', 'main', 1, 'Picks', NULL, '{}', '[]', 1)", []).unwrap();
        conn.execute("INSERT INTO collection_items VALUES ('c2', 'tt2', 0, '{\"name\":\"Two\"}')", []).unwrap();
        conn.execute("INSERT INTO collection_items VALUES ('c2', 'tt1', 1, '{\"name\":\"One\"}')", []).unwrap();
        let backup = collect(&conn, "main").unwrap();
        restore(&mut conn, "kid", &backup).unwrap();
        // Restoring again merges into the same list.
        restore(&mut conn, "kid", &backup).unwrap();
        let kid_lists: i64 = conn.query_row("SELECT COUNT(*) FROM lists WHERE profile_id = 'kid'", [], |r| r.get(0)).unwrap();
        assert_eq!(kid_lists, 1);
        let description: String = conn.query_row("SELECT description FROM lists WHERE profile_id = 'kid'", [], |r| r.get(0)).unwrap();
        assert_eq!(description, "Fridays");
        let kid_lib: i64 = conn.query_row("SELECT COUNT(*) FROM library WHERE profile_id = 'kid'", [], |r| r.get(0)).unwrap();
        let kid_items: i64 = conn.query_row("SELECT COUNT(*) FROM list_items i JOIN lists l ON l.id = i.list_id WHERE l.profile_id = 'kid'", [], |r| r.get(0)).unwrap();
        assert_eq!((kid_lib, kid_items), (1, 1));
        // Collections come back in order, with their sources, art and titles (in their order), merged on a second restore.
        let kid: Vec<(String, Option<String>, String, String)> = conn
            .prepare("SELECT name, grp, art, sources FROM collections WHERE profile_id = 'kid' ORDER BY position")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(kid.iter().map(|c| c.0.as_str()).collect::<Vec<_>>(), ["Saga", "Picks"]);
        assert_eq!((kid[0].1.as_deref(), kid[0].2.as_str()), (Some("Studios"), "{\"cover\":\"https://img.example/c.jpg\"}"));
        assert!(kid[0].3.contains("\"collection\""));
        let picks: Vec<String> = conn
            .prepare("SELECT i.title_id FROM collection_items i JOIN collections c ON c.id = i.collection_id WHERE c.profile_id = 'kid' ORDER BY i.position")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(picks, ["tt2", "tt1"]);
        // A collection whose cover isn't https is refused, and nothing is written.
        let mut evil = collect(&conn, "main").unwrap();
        evil.collections[0].art = serde_json::json!({ "cover": "http://img.example/c.jpg" });
        evil.collections[0].name = "Other".into();
        assert!(restore(&mut conn, "kid", &evil).is_err());
        let other: i64 = conn.query_row("SELECT COUNT(*) FROM collections WHERE name = 'Other'", [], |r| r.get(0)).unwrap();
        assert_eq!(other, 0);
        // A backup made after choosing a downloads folder still restores.
        conn.execute("INSERT INTO settings VALUES ('downloads:folder', '\"D:\\\\Videos\"')", []).unwrap();
        let backup = collect(&conn, "main").unwrap();
        restore(&mut conn, "kid", &backup).unwrap();
        // A file that isn't a backup changes nothing.
        let bad = Backup { orbit_backup: 99, ..collect(&conn, "main").unwrap() };
        assert!(restore(&mut conn, "kid", &bad).is_err());
    }

    #[test]
    fn ratings_round_trip_and_are_checked() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO user_ratings VALUES ('main', 'tt1', 7, 1, 'Rewatch', 5)", []).unwrap();
        conn.execute("INSERT INTO user_ratings VALUES ('kid', 'tt1', 2, 0, NULL, 9)", []).unwrap();
        let backup = collect(&conn, "main").unwrap();
        assert_eq!(backup.ratings.len(), 1);
        restore(&mut conn, "other", &backup).unwrap();
        let rating = |profile: &str| -> (i64, String) { conn.query_row("SELECT rating, note FROM user_ratings WHERE profile_id = ?1", [profile], |r| Ok((r.get(0)?, r.get(1)?))).unwrap() };
        assert_eq!(rating("other"), (7, "Rewatch".into()));
        // The kid's newer rating stays; an older one in a backup doesn't replace it.
        restore(&mut conn, "kid", &backup).unwrap();
        let kid: i64 = conn.query_row("SELECT rating FROM user_ratings WHERE profile_id = 'kid'", [], |r| r.get(0)).unwrap();
        assert_eq!(kid, 2);
        // Backups from before ratings still restore; a crafted rating is refused, and nothing is written.
        let old: Backup = serde_json::from_value(serde_json::json!({ "orbitBackup": FORMAT, "createdAt": 1, "settings": [], "library": [], "lists": [], "watchTitles": [], "watchProgress": [] })).unwrap();
        restore(&mut conn, "main", &old).unwrap();
        let mut evil = collect(&conn, "main").unwrap();
        evil.ratings[0].rating = Some(9.0);
        evil.library.push(Saved { id: "tt9".into(), added_at: 1, title: serde_json::json!({}) });
        assert!(restore(&mut conn, "fresh", &evil).is_err());
        let fresh: i64 = conn.query_row("SELECT COUNT(*) FROM library WHERE profile_id = 'fresh'", [], |r| r.get(0)).unwrap();
        assert_eq!(fresh, 0);
    }

    #[test]
    fn favourite_episodes_round_trip_and_are_checked() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO favourite_episodes VALUES ('main', 'tt1', 2, 4, 'tt1:2:4', 'Pilot', 'https://img.example/s.jpg', '{\"meta\":{}}', 5)", []).unwrap();
        conn.execute("INSERT INTO favourite_episodes VALUES ('kid', 'tt1', 2, 4, 'tt1:2:4', 'Kid copy', NULL, '{}', 9)", []).unwrap();
        let backup = collect(&conn, "main").unwrap();
        assert_eq!(backup.favourite_episodes.len(), 1);
        restore(&mut conn, "other", &backup).unwrap();
        let name = |conn: &Connection, profile: &str| -> String { conn.query_row("SELECT title FROM favourite_episodes WHERE profile_id = ?1", [profile], |r| r.get(0)).unwrap() };
        assert_eq!(name(&conn, "other"), "Pilot");
        // One already kept stays as it is.
        restore(&mut conn, "kid", &backup).unwrap();
        assert_eq!(name(&conn, "kid"), "Kid copy");
        // A crafted favourite (a still that isn't https) is refused, and nothing is written.
        let mut evil = collect(&conn, "main").unwrap();
        evil.favourite_episodes[0].still = Some("http://img.example/s.jpg".into());
        assert!(restore(&mut conn, "fresh", &evil).is_err());
        let fresh: i64 = conn.query_row("SELECT COUNT(*) FROM favourite_episodes WHERE profile_id = 'fresh'", [], |r| r.get(0)).unwrap();
        assert_eq!(fresh, 0);
    }
}
