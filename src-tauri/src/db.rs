//! SQLite storage. Holds non-secret data only; secrets go through `keychain`.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use tauri::State;

use crate::check_name;
use crate::profiles::ActiveProfile;

/// Append-only: entry `i` upgrades the schema from version `i` to `i + 1`.
pub(crate) const MIGRATIONS: &[&str] = &[
    // v1
    "CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;",
    // v2 — `transport_url` is sealed by `vault`, never plaintext.
    "CREATE TABLE addons (
        key TEXT PRIMARY KEY NOT NULL,
        position INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        installed_at INTEGER NOT NULL,
        display_host TEXT NOT NULL,
        manifest TEXT NOT NULL,
        transport_url BLOB NOT NULL
    ) STRICT;",
    // v3 — built-in addons (Cinemeta) can be disabled but not removed.
    "ALTER TABLE addons ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0;",
    // v4 — My Library: a display snapshot per saved title, so the page renders offline.
    "CREATE TABLE library (
        id TEXT PRIMARY KEY NOT NULL,
        added_at INTEGER NOT NULL,
        title TEXT NOT NULL
    ) STRICT;",
    // v5 — watch history: progress per movie or episode, and per title a
    // display snapshot plus what to play next (for Continue Watching).
    "CREATE TABLE watch_titles (
        title_id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        next TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE watch_progress (
        video_id TEXT PRIMARY KEY NOT NULL,
        title_id TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        position REAL NOT NULL,
        duration REAL NOT NULL,
        watched INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX watch_progress_title ON watch_progress (title_id);",
    // v6 — profiles. Library and watch history become per profile; what's
    // already there belongs to the first profile. Addons get an owner (none for
    // built-ins) and a shared flag; each profile keeps its own order, on/off
    // state and "removed from my list" for every addon it can see.
    "CREATE TABLE profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO profiles (id, name, color, position, created_at) VALUES ('main', 'Me', '#e5484d', 0, 0);

    CREATE TABLE library_v6 (
        profile_id TEXT NOT NULL,
        id TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (profile_id, id)
    ) STRICT;
    INSERT INTO library_v6 SELECT 'main', id, added_at, title FROM library;
    DROP TABLE library;
    ALTER TABLE library_v6 RENAME TO library;

    CREATE TABLE watch_titles_v6 (
        profile_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        title TEXT NOT NULL,
        next TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, title_id)
    ) STRICT;
    INSERT INTO watch_titles_v6 SELECT 'main', title_id, title, next, completed, updated_at FROM watch_titles;
    DROP TABLE watch_titles;
    ALTER TABLE watch_titles_v6 RENAME TO watch_titles;

    CREATE TABLE watch_progress_v6 (
        profile_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        position REAL NOT NULL,
        duration REAL NOT NULL,
        watched INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, video_id)
    ) STRICT;
    INSERT INTO watch_progress_v6 SELECT 'main', video_id, title_id, season, episode, position, duration, watched, updated_at FROM watch_progress;
    DROP TABLE watch_progress;
    ALTER TABLE watch_progress_v6 RENAME TO watch_progress;
    CREATE INDEX watch_progress_title ON watch_progress (profile_id, title_id);

    ALTER TABLE addons ADD COLUMN owner TEXT;
    ALTER TABLE addons ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
    UPDATE addons SET owner = 'main', shared = 1 WHERE builtin = 0;
    CREATE TABLE addon_prefs (
        profile_id TEXT NOT NULL,
        addon_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (profile_id, addon_key)
    ) STRICT;
    INSERT INTO addon_prefs (profile_id, addon_key, enabled, position) SELECT 'main', key, enabled, position FROM addons;
    ALTER TABLE addons DROP COLUMN enabled;
    ALTER TABLE addons DROP COLUMN position;",
    // v7 — a profile can show a picture (one of Orbit's bundled avatars, by
    // name) instead of its coloured initial.
    "ALTER TABLE profiles ADD COLUMN avatar TEXT;",
    // v8 — a profile can use another profile's addon list (read-only) instead
    // of its own, e.g. a kid's profile following a parent's.
    "ALTER TABLE profiles ADD COLUMN addons_from TEXT;",
    // v9 — custom lists, each a profile's own.
    "CREATE TABLE lists (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX lists_profile ON lists (profile_id);
    CREATE TABLE list_items (
        list_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (list_id, title_id)
    ) STRICT;",
    // v10 — Live TV: the person's IPTV sources (address and login sealed by
    // `vault`), their channels (M3U addresses sealed per row), the guide, and
    // favourites. `iptv_programmes_new` stages a guide while it downloads.
    "CREATE TABLE iptv_sources (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        host TEXT NOT NULL,
        insecure INTEGER NOT NULL,
        secret BLOB NOT NULL,
        channel_count INTEGER NOT NULL,
        channels_at INTEGER,
        epg_at INTEGER,
        epg_error TEXT,
        added_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE iptv_channels (
        source_id TEXT NOT NULL,
        key TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        logo TEXT,
        grp TEXT,
        tvg_id TEXT,
        epg_id TEXT,
        stream_id TEXT,
        sealed BLOB,
        PRIMARY KEY (source_id, key)
    ) STRICT;
    CREATE TABLE iptv_programmes (
        source_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        start INTEGER NOT NULL,
        stop INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT
    ) STRICT;
    CREATE INDEX iptv_programmes_channel ON iptv_programmes (source_id, channel, stop);
    CREATE TABLE iptv_programmes_new (
        source_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        start INTEGER NOT NULL,
        stop INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT
    ) STRICT;
    CREATE TABLE iptv_favourites (
        profile_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        key TEXT NOT NULL,
        PRIMARY KEY (profile_id, source_id, key)
    ) STRICT;",
    // v11 — Live TV catch-up: how many days back each channel's archive goes
    // (how to reach it is sealed with the channel's address).
    "ALTER TABLE iptv_channels ADD COLUMN archive_days INTEGER NOT NULL DEFAULT 0;",
    // v12 — Letterboxd films matched to titles (by Letterboxd's slug), kept so
    // each is looked up once; `title` is NULL when no match was found.
    "CREATE TABLE letterboxd_films (
        slug TEXT PRIMARY KEY,
        title TEXT,
        checked_at INTEGER NOT NULL
    ) STRICT;",
    // v13 — Live TV favourites in the person's own order (ties, such as
    // favourites from before this, fall back to the channel list's order).
    "ALTER TABLE iptv_favourites ADD COLUMN position INTEGER NOT NULL DEFAULT 0;",
    // v14 — offline downloads, each a profile's own. `source` (the stream's
    // address or magnet) is sealed by `vault`; `addon_key`, `stream_*` and
    // `identity` find the same stream again when a link expires.
    "CREATE TABLE downloads (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        episode_title TEXT,
        label TEXT NOT NULL,
        addon_key TEXT NOT NULL,
        stream_type TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        identity TEXT NOT NULL,
        torrent INTEGER NOT NULL,
        upload INTEGER NOT NULL,
        source BLOB NOT NULL,
        state TEXT NOT NULL,
        error TEXT,
        root TEXT NOT NULL,
        folder TEXT NOT NULL,
        base TEXT NOT NULL,
        ext TEXT,
        validator TEXT,
        total_bytes INTEGER,
        done_bytes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
    ) STRICT;
    CREATE INDEX downloads_video ON downloads (profile_id, video_id);",
    // v15 — each profile's Jellyfin server. `secret` (the server's address,
    // access token, user id and device id) is sealed by `vault`; the password
    // is never kept.
    "CREATE TABLE jellyfin_servers (
        profile_id TEXT PRIMARY KEY NOT NULL,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        host TEXT NOT NULL,
        insecure INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        secret BLOB NOT NULL,
        connected_at INTEGER NOT NULL
    ) STRICT;",
    // v16 — a content limit per profile. It lives here, not in `settings`, so
    // only `profile_set_limit` (which checks who may loosen it) can change it.
    // `title_ratings` caches TMDB's certifications per title ({"US": "PG-13", …}).
    "ALTER TABLE profiles ADD COLUMN content_limit TEXT NOT NULL DEFAULT 'off'
        CHECK (content_limit IN ('off', 'kids', 'older-kids', 'teens', 'no-adult'));
    ALTER TABLE profiles ADD COLUMN limit_unrated INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE profiles ADD COLUMN limit_live_tv INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE title_ratings (
        imdb_id TEXT PRIMARY KEY NOT NULL,
        certs TEXT NOT NULL,
        adult INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL
    ) STRICT;",
    // v17 — each profile's Plex server. `secret` (the server's addresses, its
    // token, the account token and this connection's client identifier) is
    // sealed by `vault`; the Plex password is never seen.
    "CREATE TABLE plex_servers (
        profile_id TEXT PRIMARY KEY NOT NULL,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        host TEXT NOT NULL,
        insecure INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        secret BLOB NOT NULL,
        connected_at INTEGER NOT NULL
    ) STRICT;",
    // v18 — each profile's debrid accounts (My cloud), one row per provider.
    // Only what Settings shows lives here; the API key is in the OS keychain
    // (`debrid.{provider}.{profile}`), never in SQLite.
    "CREATE TABLE debrid_accounts (
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        user_name TEXT NOT NULL,
        premium_until INTEGER,
        connected_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, provider)
    ) STRICT;",
    // v19 — custom collections, each a profile's own, in the person's order:
    // `art` (https covers) and `sources` (addon catalogs, TMDB queries…) are
    // JSON checked by `collections`; a fixed collection's titles are snapshots.
    "CREATE TABLE collections (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        grp TEXT,
        art TEXT NOT NULL,
        sources TEXT NOT NULL,
        created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX collections_profile ON collections (profile_id, position);
    CREATE TABLE collection_items (
        collection_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (collection_id, title_id)
    ) STRICT;",
    // v20 — Live TV groups as each profile arranges them (by group name,
    // across its sources): their order, and whether each is hidden or behind
    // a PIN. `account` is what an Xtream panel last said about the account
    // (status, expiry, connections: JSON, no login).
    "CREATE TABLE iptv_groups (
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER,
        hidden INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (profile_id, name)
    ) STRICT;
    ALTER TABLE iptv_sources ADD COLUMN account TEXT;",
    // v21 — each profile's own ratings and notes (see `ratings`): stars as
    // half steps (1–10, NULL when only liked or noted), a heart, a private note.
    "CREATE TABLE user_ratings (
        profile_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        rating INTEGER CHECK (rating BETWEEN 1 AND 10),
        liked INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, title_id)
    ) STRICT;",
    // v22 — opt-in IPTV movies/episodes; locators never contain credentials.
    "ALTER TABLE iptv_sources ADD COLUMN use_vod INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE iptv_vod_locators (
        source_id TEXT NOT NULL REFERENCES iptv_sources(id) ON DELETE CASCADE, key TEXT NOT NULL, stream_id TEXT NOT NULL,
        ext TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (source_id, key)
    ) STRICT;",
    // v23 — each profile's favourite episodes (see `episode_favourites`): the
    // episode's name and still, and a snapshot of its show, so My Library
    // lists them without the network.
    "CREATE TABLE favourite_episodes (
        profile_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        still TEXT,
        show TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, series_id, season, episode)
    ) STRICT;",
    // v24 — a source's guide is refreshed as its next generation of
    // programmes, written beside the one shown until `guide_gen` switches to
    // it; the old one is then deleted in chunks. Copying a staged guide over
    // in one transaction held the database for seconds. Stages straight into
    // `iptv_programmes`, so the staging table goes.
    "ALTER TABLE iptv_programmes ADD COLUMN gen INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE iptv_sources ADD COLUMN guide_gen INTEGER NOT NULL DEFAULT 0;
    DROP INDEX iptv_programmes_channel;
    CREATE INDEX iptv_programmes_channel ON iptv_programmes (source_id, gen, channel, stop);
    DROP TABLE iptv_programmes_new;",
    // v25 — each Xtream account's film and series lists, as a local index
    // (see iptv/vod.rs): names, years, TMDB/IMDb ids and stream ids, never
    // credentials. Written as a generation beside the one in use, like the
    // guide; `vod_at` is when the one in use was built.
    "CREATE TABLE iptv_vod_index (
        source_id TEXT NOT NULL REFERENCES iptv_sources(id) ON DELETE CASCADE,
        gen INTEGER NOT NULL,
        kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        norm TEXT NOT NULL,
        year INTEGER,
        tmdb TEXT,
        imdb TEXT,
        ext TEXT NOT NULL
    ) STRICT;
    CREATE INDEX iptv_vod_index_norm ON iptv_vod_index (source_id, kind, norm);
    CREATE INDEX iptv_vod_index_tmdb ON iptv_vod_index (source_id, kind, tmdb) WHERE tmdb IS NOT NULL;
    CREATE INDEX iptv_vod_index_imdb ON iptv_vod_index (source_id, kind, imdb) WHERE imdb IS NOT NULL;
    CREATE INDEX iptv_vod_index_gen ON iptv_vod_index (source_id, gen);
    ALTER TABLE iptv_sources ADD COLUMN vod_gen INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE iptv_sources ADD COLUMN vod_at INTEGER;",
    // v26 — a custom list's optional description (empty when it has none).
    "ALTER TABLE lists ADD COLUMN description TEXT NOT NULL DEFAULT '';",
    // v27 — wrong PINs in a row per profile, and until when (ms) its PIN is
    // refused: kept here so restarting Orbit doesn't reset them (see profiles.rs).
    "CREATE TABLE pin_failures (
        profile_id TEXT PRIMARY KEY NOT NULL,
        failures INTEGER NOT NULL,
        locked_until INTEGER NOT NULL
    ) STRICT;",
    // v28 — Orbit Connect's paired devices: their random id, the name and kind
    // they gave, and when. Each pair's secret is in the keychain, never here
    // (see connect/mod.rs). Not backed up: a pairing belongs to this device.
    "CREATE TABLE connect_peers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        paired_at INTEGER NOT NULL
    ) STRICT;",
    // v29 — a paired device's long-term public key, kept from pairing and held to (see
    // connect/auth.rs). None: paired with a typed code before keys, so it has to pair again.
    "ALTER TABLE connect_peers ADD COLUMN key TEXT;",
    // v30 — Live TV's last group and channel were one setting for every profile
    // (`{ "<profile id>": … }`), readable from any profile, PIN-locked ones
    // included. Each profile's entry becomes its own `live.last.<id>`, which
    // only that profile reaches (see `check_owner`); entries for profiles that
    // no longer exist, and anything that isn't an object, are dropped.
    "INSERT OR REPLACE INTO settings (key, value)
        SELECT 'live.last.' || entry.key, entry.value
        FROM settings AS shared, json_each(shared.value) AS entry
        WHERE shared.key = 'live.last' AND json_valid(shared.value) AND json_type(shared.value) = 'object'
          AND entry.type = 'object' AND entry.key IN (SELECT id FROM profiles);
     DELETE FROM settings WHERE key = 'live.last';",
];

/// Settings are small preferences; the cap stops a runaway caller from bloating the DB.
const MAX_SETTING_BYTES: usize = 64 * 1024;
/// How many settings keys the page may create. Orbit itself uses a few
/// hundred (a few dozen more per profile); without a cap a compromised page
/// could add keys until the disk fills, since each value alone is capped.
const MAX_SETTINGS: i64 = 4096;

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let mut conn = Connection::open(path)?;
        // An Orbit still closing (e.g. "Restart to update") can hold the write
        // lock for a moment; wait for it rather than failing to start.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // With WAL, NORMAL can't corrupt the database; at worst a power cut loses the last transaction.
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&mut conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    /// Never fails: a panic while the lock was held only poisons the mutex, and
    /// the connection itself is still sound (an open transaction rolls back as
    /// it's dropped), so the guard is taken back rather than leaving the
    /// database unusable until restart.
    pub(crate) fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        Ok(self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner))
    }

    /// Whether nothing holds the database now (tests).
    #[cfg(test)]
    pub(crate) fn is_free(&self) -> bool {
        self.0.try_lock().is_ok()
    }

    /// A saved setting, for the shell's own decisions (e.g. what closing the window does).
    pub(crate) fn setting(&self, key: &str) -> Option<Value> {
        let raw: String = self.lock().ok()?.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// Saves a setting the shell itself keeps (e.g. when Orbit last checked for updates).
    #[cfg(not(target_os = "android"))]
    pub(crate) fn set_setting(&self, key: &str, value: &Value) -> Result<(), String> {
        self.lock()?
            .execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value.to_string()])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

pub(crate) fn migrate(conn: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let current = usize::try_from(current)?;
    // A newer schema means an older build is opening the file; writing to it
    // could corrupt data the newer build relies on, so refuse instead.
    if current > MIGRATIONS.len() {
        return Err(Box::new(NewerSchema(current)));
    }
    for (version, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i64::try_from(version + 1)?)?;
        tx.commit()?;
    }
    Ok(())
}

/// The database was last written by a newer Orbit (an older installer ran over it).
#[derive(Debug)]
pub(crate) struct NewerSchema(usize);

impl std::fmt::Display for NewerSchema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "database schema v{} is newer than this build supports", self.0)
    }
}

impl std::error::Error for NewerSchema {}

/// What to tell the person when the database can't be opened, so Orbit
/// doesn't just fail to start. Nothing is deleted or recreated in any case:
/// the file is left as it is for a newer Orbit, a retry, or recovery.
pub(crate) fn open_failure_message(err: &(dyn std::error::Error + 'static), path: &Path) -> String {
    use rusqlite::ErrorCode;
    if err.downcast_ref::<NewerSchema>().is_some() {
        return "Your Orbit data was last saved by a newer version of Orbit, so this older version won't open it. That keeps your profiles and watch history safe.\n\nInstall the latest Orbit to carry on.".into();
    }
    let code = err.downcast_ref::<rusqlite::Error>().and_then(rusqlite::Error::sqlite_error_code);
    let place = path.display();
    match code {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => "Orbit's data is still in use, probably by an Orbit that's still closing.\n\nWait a moment, then open Orbit again.".into(),
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt) => format!("Orbit couldn't read its data file, which may be damaged. Nothing was deleted.\n\nThe file is {place}"),
        _ => format!("Orbit couldn't open its data ({err}). Nothing was deleted.\n\nThe file is {place}"),
    }
}

/// Settings only a dedicated command may write, because each decides
/// something security-sensitive and is checked there first: the external
/// player is a program Orbit starts (see external.rs); the streaming region
/// decides whose age ratings a content limit reads (see tmdb.rs).
const PROTECTED_SETTINGS: [&str; 2] = [crate::external::SETTING, crate::tmdb::REGION_SETTING];

/// Whether the page may write `key` through `settings_set`.
fn check_writable(key: &str) -> Result<(), String> {
    check_name(key)?;
    if PROTECTED_SETTINGS.contains(&key) {
        return Err("this setting can't be changed here".into());
    }
    Ok(())
}

/// A per-profile key (`{prefix}.{profile id}`, see `profiles::PROFILE_SETTINGS`)
/// is only reachable for the active profile. The page only ever builds these
/// from `profile_active`, and without this check a page script could read or
/// change another profile's settings (recent searches, track memory, its
/// queue…), including a PIN-locked profile that was never unlocked.
fn check_owner(key: &str, active: &ActiveProfile) -> Result<(), String> {
    match crate::profiles::profile_setting(key) {
        Some((_, owner)) if active.id().ok().as_deref() != Some(owner) => Err("this setting belongs to another profile".into()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn settings_get(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String) -> Result<Option<Value>, String> {
    check_name(&key)?;
    check_owner(&key, &active)?;
    // Cached: the page asks for dozens of settings as it starts.
    let raw: Option<String> = db
        .lock()?
        .prepare_cached("SELECT value FROM settings WHERE key = ?1")
        .and_then(|mut stmt| stmt.query_row([&key], |row| row.get(0)).optional())
        .map_err(|e| e.to_string())?;
    raw.map(|s| serde_json::from_str(&s)).transpose().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn settings_set(db: State<'_, Db>, active: State<'_, ActiveProfile>, key: String, value: Value) -> Result<(), String> {
    check_writable(&key)?;
    check_owner(&key, &active)?;
    let json = value.to_string();
    if json.len() > MAX_SETTING_BYTES {
        return Err("setting too large".into());
    }
    let conn = db.lock()?;
    write_capped(&conn, &key, &json)
}

pub(crate) const TOO_MANY_SETTINGS: &str = "too many settings";

/// Saves a setting from the page (or a backup it hands over); a new key only
/// while fewer than `MAX_SETTINGS` exist.
pub(crate) fn write_capped(conn: &Connection, key: &str, json: &str) -> Result<(), String> {
    let sql = |e: rusqlite::Error| e.to_string();
    let exists = conn.query_row("SELECT 1 FROM settings WHERE key = ?1", [key], |_| Ok(())).optional().map_err(sql)?.is_some();
    if !exists && conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get::<_, i64>(0)).map_err(sql)? >= MAX_SETTINGS {
        return Err(TOO_MANY_SETTINGS.into());
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, json],
    )
    .map_err(sql)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Db, MAX_SETTINGS, MIGRATIONS, check_owner, check_writable, migrate, open_failure_message, write_capped};
    use crate::profiles::{ActiveProfile, select_for_test};
    use rusqlite::Connection;

    #[test]
    fn a_panic_holding_the_database_doesnt_disable_it() {
        let db = std::sync::Arc::new(super::Db(std::sync::Mutex::new(rusqlite::Connection::open_in_memory().unwrap())));
        let holder = std::sync::Arc::clone(&db);
        let panicked = std::thread::spawn(move || {
            let _conn = holder.lock().unwrap();
            panic!("a bug while the database is held");
        })
        .join();
        assert!(panicked.is_err());
        let one: i64 = db.lock().expect("still usable").query_row("SELECT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(one, 1);
    }

    #[test]
    fn a_profiles_own_settings_are_only_reachable_while_it_is_active() {
        let active = ActiveProfile::default();
        assert!(check_owner("search.recent.main", &active).is_err());
        assert!(check_owner("theme", &active).is_ok());
        select_for_test(&active, "main");
        assert!(check_owner("search.recent.main", &active).is_ok());
        assert!(check_owner("search.recent.kid", &active).is_err());
        assert!(check_owner("home.layout.kid", &active).is_err());
        // The shared (legacy) key a profile's value moves from stays reachable.
        assert!(check_owner("search.recent", &active).is_ok());
    }

    #[test]
    fn new_keys_stop_at_the_cap_but_existing_ones_still_change() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        super::migrate(&mut conn).unwrap();
        conn.execute(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1) INSERT INTO settings SELECT 'k' || i, 'true' FROM n",
            [MAX_SETTINGS],
        )
        .unwrap();
        assert_eq!(write_capped(&conn, "one-more", "1").unwrap_err(), "too many settings");
        write_capped(&conn, "k1", "false").unwrap();
        conn.execute("DELETE FROM settings WHERE key = 'k2'", []).unwrap();
        write_capped(&conn, "one-more", "1").unwrap();
    }

    #[test]
    fn the_shells_own_settings_round_trip_and_damage_reads_as_unset() {
        let db = super::Db::open(std::path::Path::new(":memory:")).unwrap();
        assert_eq!(db.setting("updates.last-check"), None);
        db.set_setting("updates.last-check", &serde_json::json!(123)).unwrap();
        db.set_setting("updates.last-check", &serde_json::json!({"at": 456})).unwrap();
        assert_eq!(db.setting("updates.last-check"), Some(serde_json::json!({"at": 456})));
        db.lock().unwrap().execute("INSERT INTO settings (key, value) VALUES ('broken', '{oops')", []).unwrap();
        assert_eq!(db.setting("broken"), None);
        // Opening turned on what every connection relies on.
        let fk: i64 = db.lock().unwrap().pragma_query_value(None, "foreign_keys", |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn migrating_twice_changes_nothing() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let before = tables(&conn);
        migrate(&mut conn).unwrap();
        assert_eq!(tables(&conn), before);
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    /// A database as version `version` left it.
    fn at(version: usize) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..version] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", version as i64).unwrap();
        conn
    }

    fn tables(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| r.get(0)).unwrap()
    }

    /// One row in every table, each column a plausible value for its type (its default where it has one).
    fn fill(conn: &Connection) {
        for table in tables(conn) {
            let columns: Vec<(String, String, Option<String>)> = conn
                .prepare(&format!("PRAGMA table_info(\"{table}\")"))
                .unwrap()
                .query_map([], |r| Ok((r.get(1)?, r.get(2)?, r.get(4)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            let names: Vec<String> = columns.iter().map(|c| format!("\"{}\"", c.0)).collect();
            let values: Vec<String> = columns
                .iter()
                .map(|(name, kind, default)| match (kind.as_str(), default) {
                    (_, Some(d)) => d.clone(),
                    ("INTEGER", _) => "1".into(),
                    ("REAL", _) => "1.5".into(),
                    ("BLOB", _) => "x'00'".into(),
                    // The same id everywhere, so references (iptv_vod_locators → iptv_sources) hold.
                    _ if name == "id" || name.ends_with("_id") => "'main'".into(),
                    _ => "'{}'".into(),
                })
                .collect();
            conn.execute(&format!("INSERT OR IGNORE INTO \"{table}\" ({}) VALUES ({})", names.join(", "), values.join(", ")), []).unwrap();
        }
    }

    #[test]
    fn live_tvs_last_channels_move_to_each_profiles_own_setting() {
        use rusqlite::OptionalExtension;
        let mut conn = at(28);
        conn.execute("INSERT INTO profiles (id, name, color, position, created_at) VALUES ('kid', 'Kid', '#46c28e', 1, 1)", []).unwrap();
        let shared = r#"{"main":{"group":"all","channel":{"source":"s","key":"k"}},"kid":{"group":"favourites"},"gone":{"group":"all"},"main2":"junk"}"#;
        conn.execute("INSERT INTO settings VALUES ('live.last', ?1)", [shared]).unwrap();
        super::migrate(&mut conn).unwrap();
        let value = |key: &str| -> Option<serde_json::Value> {
            conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get::<_, String>(0)).optional().unwrap().map(|v| serde_json::from_str(&v).unwrap())
        };
        assert_eq!(value("live.last.main"), Some(serde_json::json!({"group": "all", "channel": {"source": "s", "key": "k"}})));
        assert_eq!(value("live.last.kid"), Some(serde_json::json!({"group": "favourites"})));
        // No longer one setting every profile can read; nothing kept for a profile that's gone.
        assert_eq!(value("live.last"), None);
        assert_eq!(value("live.last.gone"), None);
        assert_eq!(value("live.last.main2"), None);
    }

    #[test]
    fn every_older_database_upgrades_without_losing_rows() {
        let fresh = {
            let mut conn = Connection::open_in_memory().unwrap();
            migrate(&mut conn).unwrap();
            conn.query_row("SELECT group_concat(sql, ';') FROM (SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name)", [], |r| r.get::<_, String>(0)).unwrap()
        };
        for version in 0..=MIGRATIONS.len() {
            let mut conn = at(version);
            fill(&conn);
            // The staging table v24 dropped is the only one meant to go.
            let before: Vec<(String, i64)> = tables(&conn).into_iter().filter(|t| t != "iptv_programmes_new").map(|t| (t.clone(), count(&conn, &t))).collect();
            migrate(&mut conn).unwrap_or_else(|e| panic!("from v{version}: {e}"));
            for (table, rows) in before {
                assert!(rows > 0, "{table} at v{version} was left empty");
                assert_eq!(count(&conn, &table), rows, "{table} from v{version}");
            }
            let schema: String = conn.query_row("SELECT group_concat(sql, ';') FROM (SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name)", [], |r| r.get(0)).unwrap();
            assert_eq!(schema, fresh, "schema from v{version}");
            let version_now: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
            assert_eq!(version_now, MIGRATIONS.len() as i64);
            let problems: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
            assert_eq!(problems, 0, "foreign keys from v{version}");
        }
    }

    #[test]
    fn upgraded_rows_get_the_defaults_a_new_row_would() {
        // A v5 database (before profiles) carried all the way up.
        let mut conn = at(5);
        conn.execute("INSERT INTO library VALUES ('tt1', 1, '{}')", []).unwrap();
        conn.execute("INSERT INTO addons (key, position, enabled, installed_at, display_host, manifest, transport_url) VALUES ('k', 2, 1, 1, 'h', '{}', x'00')", []).unwrap();
        migrate(&mut conn).unwrap();
        let profile: (Option<String>, Option<String>, String, i64, i64) = conn
            .query_row("SELECT avatar, addons_from, content_limit, limit_unrated, limit_live_tv FROM profiles WHERE id = 'main'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap();
        assert_eq!(profile, (None, None, "off".into(), 1, 1));
        let addon: (i64, String, i64) = conn.query_row("SELECT builtin, owner, shared FROM addons", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(addon, (0, "main".into(), 1));
        // Lists from before descriptions have an empty one; IPTV sources from before VOD keep it off.
        let mut conn = at(9);
        conn.execute("INSERT INTO lists VALUES ('l', 'main', 'Mine', 1)", []).unwrap();
        migrate(&mut conn).unwrap();
        let description: String = conn.query_row("SELECT description FROM lists", [], |r| r.get(0)).unwrap();
        assert_eq!(description, "");
        let mut conn = at(10);
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'main', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
        conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title) VALUES ('s', 'c', 0, 1, 'News')", []).unwrap();
        migrate(&mut conn).unwrap();
        let source: (i64, i64, i64, Option<i64>) = conn.query_row("SELECT use_vod, guide_gen, vod_gen, vod_at FROM iptv_sources", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(source, (0, 0, 0, None));
        // The guide already there is the generation in use.
        let generation: i64 = conn.query_row("SELECT gen FROM iptv_programmes", [], |r| r.get(0)).unwrap();
        assert_eq!(generation, 0);
    }

    #[test]
    fn a_step_that_fails_partway_leaves_the_database_as_it_was() {
        // As if Orbit stopped in the middle of v6: its first tables are made, then a statement fails.
        let mut conn = at(5);
        conn.execute("INSERT INTO library VALUES ('tt1', 1, '{}')", []).unwrap();
        conn.execute_batch("CREATE TABLE library_v6 (x INTEGER) STRICT;").unwrap();
        assert!(migrate(&mut conn).is_err());
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, 5);
        assert!(!tables(&conn).contains(&"profiles".to_string()));
        assert_eq!(count(&conn, "library"), 1);
        // Once what was in the way is gone, the upgrade runs from where it stopped.
        conn.execute_batch("DROP TABLE library_v6;").unwrap();
        migrate(&mut conn).unwrap();
        let owner: String = conn.query_row("SELECT profile_id FROM library", [], |r| r.get(0)).unwrap();
        assert_eq!(owner, "main");
    }

    #[test]
    fn a_newer_database_is_left_alone() {
        let mut conn = at(MIGRATIONS.len());
        conn.pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1).unwrap();
        assert!(migrate(&mut conn).is_err());
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64 + 1);
    }

    #[test]
    fn a_database_that_wont_open_says_why_instead_of_closing_silently() {
        let dir = std::env::temp_dir().join(format!("orbit-db-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let newer = dir.join("newer.db");
        {
            let mut conn = Connection::open(&newer).unwrap();
            migrate(&mut conn).unwrap();
            conn.pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1).unwrap();
        }
        let err = Db::open(&newer).err().unwrap();
        assert!(open_failure_message(err.as_ref(), &newer).contains("newer version of Orbit"));

        let damaged = dir.join("damaged.db");
        std::fs::write(&damaged, vec![0x5a; 8192]).unwrap();
        let err = Db::open(&damaged).err().unwrap();
        let message = open_failure_message(err.as_ref(), &damaged);
        assert!(message.contains("may be damaged") && message.contains("damaged.db"), "{message}");
        // Left exactly as it was.
        assert_eq!(std::fs::read(&damaged).unwrap(), vec![0x5a; 8192]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_page_cant_choose_which_program_orbit_starts() {
        assert!(check_writable("player.external").is_err());
        assert!(check_writable("player.external-always").is_ok());
        assert!(check_writable("theme").is_ok());
        assert!(check_writable("streaming.region").is_err());
        assert!(check_writable("Bad Key").is_err());
    }
}
