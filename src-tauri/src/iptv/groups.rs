//! Live TV groups as each profile arranges them: in its own order, hidden,
//! or locked behind a PIN. Groups are kept by name across the profile's
//! sources (as the channel list groups them).
//!
//! Hidden and locked groups are filtered here, in Rust, rather than by the
//! page, so every list of channels (Live TV, the guide, Home's favourites,
//! surfing in the player) leaves them out alike, and a locked channel can't be
//! played by its address either. A locked group opens with a parent's PIN (or
//! the profile's own, when it has no limit or there's no parent; see
//! `profiles::check_group_pin`), once per session: the
//! unlock lasts until Orbit closes, the profile changes, or "Lock" is chosen.

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::profiles::{self, ActiveProfile};

/// The profile whose locked groups are open this session, if any.
static UNLOCKED: Mutex<Option<String>> = Mutex::new(None);
/// Longer than any provider's group name (they're capped when read).
const MAX_NAME: usize = 300;
const MAX_GROUPS: usize = 10_000;
/// The error the page answers by asking for the PIN.
const PIN_NEEDED: &str = "pin-needed";

/// Closes every locked group again (Orbit starting, a profile change, "Lock").
pub fn lock_groups() {
    if let Ok(mut unlocked) = UNLOCKED.lock() {
        *unlocked = None;
    }
}

/// Whether `profile`'s locked groups are open this session.
pub fn unlocked(profile: &str) -> bool {
    UNLOCKED.lock().is_ok_and(|u| u.as_deref() == Some(profile))
}

fn flags(conn: &Connection, profile: &str, group: &str) -> (bool, bool) {
    conn.query_row("SELECT hidden, locked FROM iptv_groups WHERE profile_id = ?1 AND name = ?2", params![profile, group], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap_or((false, false))
}

/// Whether a group may be listed: not hidden, and if locked, opened this session.
#[cfg(test)]
fn shown(conn: &Connection, profile: &str, group: Option<&str>) -> bool {
    let Some(group) = group else { return true };
    let (hidden, locked) = flags(conn, profile, group);
    !hidden && (!locked || unlocked(profile))
}

/// Whether a group is locked and not opened this session (its channels can't play).
pub fn locked_now(conn: &Connection, profile: &str, group: Option<&str>) -> bool {
    group.is_some_and(|g| flags(conn, profile, g).1 && !unlocked(profile))
}

/// A group as the group list and its editor show it.
#[derive(Serialize, Debug, PartialEq)]
pub struct GroupInfo {
    name: String,
    /// Channels in it (counted whether or not it's shown).
    count: i64,
    hidden: bool,
    locked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Groups {
    /// Every group, in the profile's order (hidden ones included, for the editor).
    groups: Vec<GroupInfo>,
    /// Locked groups are open this session.
    unlocked: bool,
    /// A PIN exists that a lock could ask for (the profile's own or a parent's).
    pin_set: bool,
}

#[derive(Clone, Copy, Default)]
struct Pref {
    position: Option<i64>,
    hidden: bool,
    locked: bool,
}

/// Groups in the person's order: those they placed by their position, then
/// the rest as the channel list first meets them (`found`, with counts).
fn order_groups(found: Vec<(String, i64)>, prefs: &HashMap<String, Pref>) -> Vec<GroupInfo> {
    let mut groups: Vec<(Option<i64>, usize, GroupInfo)> = found
        .into_iter()
        .enumerate()
        .map(|(i, (name, count))| {
            let pref = prefs.get(&name).copied().unwrap_or_default();
            (pref.position, i, GroupInfo { name, count, hidden: pref.hidden, locked: pref.locked })
        })
        .collect();
    groups.sort_by_key(|(position, i, _)| (position.is_none(), position.unwrap_or(0), *i));
    groups.into_iter().map(|(_, _, g)| g).collect()
}

fn list(conn: &Connection, profile: &str) -> rusqlite::Result<Vec<GroupInfo>> {
    let mut found: Vec<(String, i64)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT c.grp FROM iptv_channels c JOIN iptv_sources s ON s.id = c.source_id
             WHERE s.profile_id = ?1 AND c.grp IS NOT NULL ORDER BY s.added_at, c.position",
        )?;
        let mut rows = stmt.query([profile])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(0)?;
            match index.get(&name) {
                Some(&i) => found[i].1 += 1,
                None => {
                    index.insert(name.clone(), found.len());
                    found.push((name, 1));
                }
            }
        }
    }
    let mut stmt = conn.prepare("SELECT name, position, hidden, locked FROM iptv_groups WHERE profile_id = ?1")?;
    let prefs: HashMap<String, Pref> = stmt
        .query_map([profile], |r| Ok((r.get(0)?, Pref { position: r.get(1)?, hidden: r.get(2)?, locked: r.get(3)? })))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(order_groups(found, &prefs))
}

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().count() > MAX_NAME { Err("invalid group".into()) } else { Ok(()) }
}

fn set_flags(conn: &Connection, profile: &str, name: &str, hidden: Option<bool>, locked: Option<bool>) -> rusqlite::Result<()> {
    conn.execute("INSERT OR IGNORE INTO iptv_groups (profile_id, name) VALUES (?1, ?2)", params![profile, name])?;
    conn.execute(
        "UPDATE iptv_groups SET hidden = COALESCE(?3, hidden), locked = COALESCE(?4, locked) WHERE profile_id = ?1 AND name = ?2",
        params![profile, name, hidden, locked],
    )?;
    Ok(())
}

/// Puts the profile's groups in `order`; groups left out follow in the channel list's order.
fn set_order(conn: &mut Connection, profile: &str, order: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE iptv_groups SET position = NULL WHERE profile_id = ?1", [profile])?;
    {
        let mut add = tx.prepare("INSERT OR IGNORE INTO iptv_groups (profile_id, name) VALUES (?1, ?2)")?;
        let mut set = tx.prepare("UPDATE iptv_groups SET position = ?3 WHERE profile_id = ?1 AND name = ?2")?;
        for (position, name) in (0_i64..).zip(order) {
            add.execute(params![profile, name])?;
            set.execute(params![profile, name, position])?;
        }
    }
    // Rows that no longer say anything go.
    tx.execute("DELETE FROM iptv_groups WHERE profile_id = ?1 AND position IS NULL AND hidden = 0 AND locked = 0", [profile])?;
    tx.commit()
}

#[tauri::command]
pub async fn iptv_groups(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Groups, String> {
    let profile = active.id()?;
    let groups = list(&*db.lock()?, &profile).map_err(|e| e.to_string())?;
    // Reads the keychain: without the database locked.
    let pin_set = profiles::has_group_pin(&db, &active)?;
    Ok(Groups { groups, unlocked: unlocked(&profile), pin_set })
}

/// Hides or shows a group, or locks or unlocks it. Locking needs a PIN to
/// exist; taking a lock off needs the groups to have been opened with it.
#[tauri::command]
pub async fn iptv_group_set(db: State<'_, Db>, active: State<'_, ActiveProfile>, name: String, hidden: Option<bool>, locked: Option<bool>) -> Result<(), String> {
    check_name(&name)?;
    let profile = active.id()?;
    match locked {
        Some(true) if !profiles::has_group_pin(&db, &active)? => return Err("no-pin".into()),
        Some(false) if !unlocked(&profile) && profiles::has_group_pin(&db, &active)? => return Err(PIN_NEEDED.into()),
        _ => {}
    }
    set_flags(&*db.lock()?, &profile, &name, hidden, locked).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn iptv_groups_order(db: State<'_, Db>, active: State<'_, ActiveProfile>, order: Vec<String>) -> Result<(), String> {
    if order.len() > MAX_GROUPS {
        return Err("too many groups".into());
    }
    for name in &order {
        check_name(name)?;
    }
    let profile = active.id()?;
    set_order(&mut *db.lock()?, &profile, &order).map_err(|e| e.to_string())
}

/// Opens the profile's locked groups for this session, given its PIN or a parent's.
#[tauri::command]
pub async fn iptv_groups_unlock(db: State<'_, Db>, active: State<'_, ActiveProfile>, pin: String) -> Result<(), String> {
    let profile = active.id()?;
    profiles::check_group_pin(&db, &active, &pin)?;
    *UNLOCKED.lock().map_err(|_| "busy")? = Some(profile);
    Ok(())
}

#[tauri::command]
pub async fn iptv_groups_lock() -> Result<(), String> {
    lock_groups();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
        for (i, (key, group)) in [("a", Some("News")), ("b", Some("Sport")), ("c", Some("News")), ("d", None), ("e", Some("Adult"))].into_iter().enumerate() {
            conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, grp) VALUES ('s', ?1, ?2, ?1, ?3)", params![key, i64::try_from(i).unwrap(), group]).unwrap();
        }
        conn
    }

    fn names(conn: &Connection) -> Vec<String> {
        list(conn, "p").unwrap().into_iter().map(|g| g.name).collect()
    }

    #[test]
    fn groups_come_in_the_lists_order_until_arranged() {
        let mut conn = conn();
        assert_eq!(names(&conn), ["News", "Sport", "Adult"]);
        assert_eq!(list(&conn, "p").unwrap()[0], GroupInfo { name: "News".into(), count: 2, hidden: false, locked: false });
        set_order(&mut conn, "p", &["Adult".into(), "News".into()]).unwrap();
        // Left out (Sport) follows; another profile's order is its own.
        assert_eq!(names(&conn), ["Adult", "News", "Sport"]);
        assert!(list(&conn, "q").unwrap().is_empty());
        set_flags(&conn, "p", "Sport", Some(true), None).unwrap();
        set_order(&mut conn, "p", &[]).unwrap();
        // Back to the list's order; the hidden flag stays.
        assert_eq!(names(&conn), ["News", "Sport", "Adult"]);
        assert!(list(&conn, "p").unwrap()[1].hidden);
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM iptv_groups", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn hidden_and_locked_groups_are_not_shown() {
        let conn = conn();
        set_flags(&conn, "p", "Sport", Some(true), None).unwrap();
        set_flags(&conn, "p", "Adult", None, Some(true)).unwrap();
        lock_groups();
        assert!(shown(&conn, "p", Some("News")) && shown(&conn, "p", None));
        assert!(!shown(&conn, "p", Some("Sport")) && !shown(&conn, "p", Some("Adult")));
        // Another profile's flags are its own.
        assert!(shown(&conn, "q", Some("Adult")));
        *UNLOCKED.lock().unwrap() = Some("p".into());
        assert!(shown(&conn, "p", Some("Adult")) && !shown(&conn, "p", Some("Sport")));
        assert!(!unlocked("q"));
        lock_groups();
        assert!(!shown(&conn, "p", Some("Adult")));
        assert!(locked_now(&conn, "p", Some("Adult")) && !locked_now(&conn, "p", Some("Sport")) && !locked_now(&conn, "p", None));
        // Changing one flag leaves the other.
        set_flags(&conn, "p", "Adult", Some(true), None).unwrap();
        let g = list(&conn, "p").unwrap().into_iter().find(|g| g.name == "Adult").unwrap();
        assert!(g.hidden && g.locked);
    }
}
