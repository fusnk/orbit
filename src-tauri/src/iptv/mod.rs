//! Live TV from the person's own IPTV provider (Settings → Live TV): an M3U
//! playlist or an Xtream Codes login, plus an optional XMLTV guide. Orbit
//! ships no channels.
//!
//! Provider addresses and logins are secrets: they're sealed with the vault
//! (bound to their row) and only ever opened here. The page sees channel
//! names, logos, groups and programmes, and plays a channel by asking for
//! `orbit-tv://{source}/{channel}`, which the player resolves through
//! `resolve` — so the real address, which carries the login, never reaches
//! the WebView. A past programme from a channel's archive is
//! `orbit-tv://{source}/{channel}?start=…&end=…&tz=…` (see catchup.rs).

mod catchup;
mod guide_merge;
pub mod groups;
mod m3u;
mod net;
pub(crate) mod xmltv;
mod xtream;
pub mod vod;
pub mod vod_proxy;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::addons::net::is_private_host;
use crate::db::Db;
use crate::library::now_ms;
use crate::profiles::ActiveProfile;
use crate::vault;

pub use groups::lock_groups;

/// What the page asks the player for; resolved by `resolve`.
pub const SCHEME: &str = "orbit-tv://";
const PLAYLIST_LIMIT: u64 = 100 * 1024 * 1024;
const GUIDE_DOWNLOAD_LIMIT: u64 = 300 * 1024 * 1024;
/// Uncompressed: a small .gz can't be allowed to expand forever.
const GUIDE_CONTENT_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const XTREAM_LIMIT: usize = 64 * 1024 * 1024;
/// The guide keeps programmes from a little before now (or as far back as the
/// source's archives go, up to a week) to two days ahead.
const GUIDE_BEHIND_S: i64 = 6 * 3600;
const GUIDE_ARCHIVE_DAYS: i64 = 7;
const GUIDE_AHEAD_S: i64 = 48 * 3600;
const MAX_NAME: usize = 60;
/// Guides one source may merge (each downloaded and capped on its own).
pub const MAX_GUIDES: usize = 5;
/// Sent to the page when a source's channels or guide change.
const UPDATED_EVENT: &str = "iptv://updated";

/// Sources being refreshed, so two refreshes of one never overlap.
pub struct Refreshing(Mutex<HashSet<String>>);

impl Refreshing {
    pub fn new() -> Self {
        Self(Mutex::new(HashSet::new()))
    }

    /// Marks `id` as refreshing, or says it already is.
    fn claim(&self, id: &str) -> Result<(), String> {
        if self.0.lock().map_err(|_| "busy")?.insert(id.to_string()) { Ok(()) } else { Err("err.iptv.refreshing".into()) }
    }

    /// Ends `claim`.
    fn release(&self, id: &str) {
        if let Ok(mut busy) = self.0.lock() {
            busy.remove(id);
        }
    }
}

/// The sealed part of a source.
#[derive(Serialize, Deserialize, Default)]
struct Secret {
    #[serde(skip_serializing_if = "Option::is_none")]
    playlist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    /// The guide the person gave, from before a source could have several
    /// (see `guides`, which replaces it once the list is changed).
    #[serde(skip_serializing_if = "Option::is_none")]
    epg: Option<String>,
    /// The guides the person gave, earlier ones winning; they replace the
    /// provider's own. Addresses can carry logins, so they're sealed too.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    guides: Vec<String>,
    /// The guide named in the playlist's header, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    epg_auto: Option<String>,
    /// Further guides named in the playlist's header.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    epg_auto_more: Vec<String>,
    /// Xtream stream container ("ts" or "m3u8").
    #[serde(skip_serializing_if = "Option::is_none")]
    ext: Option<String>,
    /// The Xtream server's clock, in seconds from UTC (its archive uses local
    /// time). Also asked of the panel behind an M3U playlist with Xtream-style replays.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    offset: Option<i64>,
    /// The server's time zone, when it named one that agrees with `offset`
    /// (see `xtream::clock_at`): replays follow its daylight saving.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    zone: Option<String>,
}

impl Secret {
    /// The server's clock for a programme starting at `at`, if known (see `xtream::clock_at`).
    fn clock_at(&self, at: i64) -> Option<i64> {
        xtream::clock_at(self.offset, self.zone.as_deref(), at)
    }

    fn login(&self) -> Option<xtream::Login> {
        Some(xtream::Login { server: xtream::parse_server(self.server.as_deref()?).ok()?, username: self.username.clone()?, password: self.password.clone()? })
    }

    /// The guides the person gave, in order.
    fn own_guides(&self) -> Vec<String> {
        if self.guides.is_empty() { self.epg.iter().cloned().collect() } else { self.guides.clone() }
    }

    fn set_own_guides(&mut self, guides: Vec<String>) {
        self.epg = None;
        self.guides = guides;
    }

    /// Whether the playlist is on this machine or the LAN: only then may the
    /// addresses it names be there too (a provider's playlist mustn't point
    /// Orbit at the router or other local services).
    fn playlist_is_local(&self) -> bool {
        self.playlist.as_deref().and_then(|p| net::parse_url(p).ok()).is_some_and(|u| is_private_host(&u))
    }

    /// Whether Orbit may hand the player `address`, a stream or replay the
    /// playlist names (or a catch-up template builds): on this machine or the
    /// LAN only if the playlist is too, as for its guides, so a provider can't
    /// aim playback at the router or other local services. (mpv still follows
    /// a public address's redirects on its own: an accepted limit, see docs/DEVELOPMENT.md.)
    fn may_open(&self, address: &str) -> bool {
        self.playlist_is_local() || reqwest::Url::parse(address).is_ok_and(|u| !is_private_host(&u))
    }

    /// Whether the guides are ones the person gave (theirs, or their panel's), not named by a playlist.
    fn guides_are_own(&self) -> bool {
        !self.own_guides().is_empty() || self.login().is_some()
    }

    /// The guides to merge, in order: the person's own, or else the Xtream
    /// panel's, or else those named in the playlist's header.
    fn guide_addresses(&self) -> Result<Vec<reqwest::Url>, String> {
        let own = self.own_guides();
        let list: Vec<reqwest::Url> = if !own.is_empty() {
            own.iter().map(|g| net::parse_url(g)).collect::<Result<_, _>>()?
        } else if let Some(login) = self.login() {
            vec![login.guide()?]
        } else {
            let local = self.playlist_is_local();
            let listed: Vec<reqwest::Url> = self.epg_auto.iter().chain(&self.epg_auto_more).map(|g| net::parse_url(g)).collect::<Result<_, _>>()?;
            listed.into_iter().filter(|u| local || !is_private_host(u)).collect()
        };
        Ok(list.into_iter().take(MAX_GUIDES).collect())
    }
}

/// A sealed M3U channel address with its request headers.
#[derive(Serialize, Deserialize)]
struct Locator {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    ua: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    referrer: Option<String>,
    /// How to reach the channel's archive (see catchup.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay: Option<Replay>,
}

#[derive(Serialize, Deserialize)]
struct Replay {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Binds a source's sealed login to its row and its profile (see `vault`):
/// with the id alone, a row's `profile_id` could be changed in the database
/// and another profile would get the login. Ids are hex, so the parts can't
/// run into each other.
fn source_aad(id: &str, profile: &str) -> Vec<u8> {
    format!("iptv-source:v2:{id}:{profile}").into_bytes()
}

/// A channel's sealed address, likewise bound to its source and the source's
/// profile; the key (any text) comes last.
fn channel_aad(source: &str, profile: &str, key: &str) -> Vec<u8> {
    format!("iptv-channel:v2:{source}:{profile}:{key}").into_bytes()
}

/// What logins and addresses sealed before the profile was bound used. Still
/// read, so nothing stops working until `reseal_legacy` binds them.
fn legacy_source_aad(id: &str) -> Vec<u8> {
    format!("iptv-source:{id}").into_bytes()
}

fn legacy_channel_aad(source: &str, key: &str) -> Vec<u8> {
    format!("iptv-channel:{source}:{key}").into_bytes()
}

fn seal_json<T: Serialize>(aad: &[u8], value: &T) -> Result<Vec<u8>, String> {
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let plain = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    vault::seal(&cipher, aad, &plain).map_err(|_| "err.iptv.encrypt".into())
}

/// Opens what was sealed under `aad`, or under `legacy` before it was re-sealed.
fn open_sealed(cipher: &aes_gcm::Aes256Gcm, aad: &[u8], legacy: &[u8], sealed: &[u8]) -> Result<Vec<u8>, vault::VaultError> {
    vault::open(cipher, aad, sealed).or_else(|_| vault::open(cipher, legacy, sealed))
}

fn open_json<T: for<'de> Deserialize<'de>>(aad: &[u8], legacy: &[u8], sealed: &[u8]) -> Result<T, String> {
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let plain = open_sealed(&cipher, aad, legacy, sealed).map_err(|_| "err.iptv.login-unreadable")?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

/// Re-seals logins and channel addresses still sealed the legacy way, binding
/// them to their profile, as `addons::reseal_legacy` does for addon URLs:
/// each row changes only if its re-seal succeeded and it still holds the
/// ciphertext that was read (compare-and-set), all in one transaction, so a
/// failure leaves the old, still readable rows. Rows already bound, or
/// unreadable, are left alone. Returns how many rows changed.
fn reseal_legacy(conn: &mut Connection, cipher: &aes_gcm::Aes256Gcm) -> Result<usize, String> {
    let sql = |e: rusqlite::Error| e.to_string();
    let tx = conn.transaction().map_err(sql)?;
    let reseal = |aad: &[u8], legacy: &[u8], sealed: &[u8]| -> Result<Option<Vec<u8>>, String> {
        if vault::open(cipher, aad, sealed).is_ok() {
            return Ok(None);
        }
        let Ok(plain) = vault::open(cipher, legacy, sealed) else { return Ok(None) };
        vault::seal(cipher, aad, &plain).map(Some).map_err(|_| "couldn't re-seal an IPTV login".to_string())
    };
    let mut changed = 0;
    let sources: Vec<(String, String, Vec<u8>)> =
        tx.prepare("SELECT id, profile_id, secret FROM iptv_sources").and_then(|mut s| s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect()).map_err(sql)?;
    for (id, profile, sealed) in &sources {
        if let Some(resealed) = reseal(&source_aad(id, profile), &legacy_source_aad(id), sealed)? {
            changed += tx.execute("UPDATE iptv_sources SET secret = ?1 WHERE id = ?2 AND secret = ?3", params![resealed, id, sealed]).map_err(sql)?;
        }
    }
    let channels: Vec<(String, String, String, Vec<u8>)> = tx
        .prepare("SELECT c.source_id, s.profile_id, c.key, c.sealed FROM iptv_channels c JOIN iptv_sources s ON s.id = c.source_id WHERE c.sealed IS NOT NULL")
        .and_then(|mut s| s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect())
        .map_err(sql)?;
    for (source, profile, key, sealed) in &channels {
        if let Some(resealed) = reseal(&channel_aad(source, profile, key), &legacy_channel_aad(source, key), sealed)? {
            changed += tx
                .execute("UPDATE iptv_channels SET sealed = ?1 WHERE source_id = ?2 AND key = ?3 AND sealed = ?4", params![resealed, source, key, sealed])
                .map_err(sql)?;
        }
    }
    tx.commit().map_err(sql)?;
    Ok(changed)
}

/// Whether this run has re-sealed the legacy rows (see `reseal_legacy`); tried again until it succeeds.
static RESEALED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// FNV-1a: a stable key for an M3U channel (its address can change between downloads).
fn fnv(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// An M3U channel's key: its name and group, numbered when several share them.
fn channel_key(seen: &mut HashMap<String, usize>, name: &str, group: Option<&str>) -> String {
    let base = fnv(&format!("{name}|{}", group.unwrap_or_default()));
    let n = seen.entry(base.clone()).and_modify(|n| *n += 1).or_insert(0);
    if *n == 0 { base } else { format!("{base}-{n}") }
}

/// Lower-case letters and digits only, for matching channel names to the guide's.
fn normalize(name: &str) -> String {
    name.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// What the settings page shows about a source.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    id: String,
    name: String,
    kind: String,
    host: String,
    /// Plain http: logins travel unencrypted.
    insecure: bool,
    channels: i64,
    use_vod: bool,
    channels_at: Option<i64>,
    epg_at: Option<i64>,
    epg_error: Option<String>,
    /// What an Xtream panel last said about the account (status, expiry, connections).
    account: Option<xtream::AccountDetails>,
}

#[derive(Deserialize)]
pub struct NewSource {
    name: String,
    kind: String,
    playlist: Option<String>,
    server: Option<String>,
    username: Option<String>,
    password: Option<String>,
    epg: Option<String>,
}

#[derive(Serialize)]
pub struct ChannelInfo {
    source: String,
    key: String,
    name: String,
    logo: Option<String>,
    group: Option<String>,
    favourite: bool,
    /// Where it comes among the favourites (lower first; ties keep the list's order).
    rank: Option<i64>,
    /// Whether the guide has any programmes for it.
    listed: bool,
    /// Days of archive that past programmes can be replayed from (0: none).
    archive: i64,
}

#[derive(Serialize)]
pub struct Showing {
    title: String,
    start: i64,
    stop: i64,
    description: Option<String>,
}

#[derive(Serialize)]
pub struct Guide {
    source: String,
    key: String,
    now: Option<Showing>,
    next: Option<Showing>,
}

/// A channel as downloaded, before it's stored.
struct Fetched {
    key: String,
    /// The key an older version gave it, when that differs (see `m3u::Entry::before_latin1`).
    key_before: Option<String>,
    name: String,
    logo: Option<String>,
    group: Option<String>,
    tvg_id: Option<String>,
    /// Xtream stream id (not secret), or a sealed M3U address.
    stream_id: Option<String>,
    locator: Option<Locator>,
    archive_days: i64,
}

fn host_of(url: &str) -> (String, bool) {
    let parsed = reqwest::Url::parse(url).ok();
    let host = parsed.as_ref().and_then(|u| u.host_str().map(|h| match u.port() {
        Some(p) => format!("{h}:{p}"),
        None => h.to_string(),
    }));
    (host.unwrap_or_default(), parsed.is_some_and(|u| u.scheme() == "http"))
}

fn info(conn: &Connection, profile: &str, id: &str) -> Result<SourceInfo, String> {
    conn.query_row(
        "SELECT id, name, kind, host, insecure, channel_count, channels_at, epg_at, epg_error, account, use_vod FROM iptv_sources WHERE id = ?1 AND profile_id = ?2",
        params![id, profile],
        |r| {
            let account: Option<String> = r.get(9)?;
            Ok(SourceInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                host: r.get(3)?,
                insecure: r.get(4)?,
                channels: r.get(5)?,
                use_vod: r.get(10)?,
                channels_at: r.get(6)?,
                epg_at: r.get(7)?,
                epg_error: r.get(8)?,
                account: account.and_then(|a| serde_json::from_str(&a).ok()),
            })
        },
    )
    .map_err(|_| "err.iptv.source-gone".into())
}

fn secret_of(conn: &Connection, profile: &str, id: &str) -> Result<(String, Secret), String> {
    let (kind, sealed): (String, Vec<u8>) = conn
        .query_row("SELECT kind, secret FROM iptv_sources WHERE id = ?1 AND profile_id = ?2", params![id, profile], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "err.iptv.source-gone")?;
    Ok((kind, open_json(&source_aad(id, profile), &legacy_source_aad(id), &sealed)?))
}

/// Keeps what an Xtream panel said about the account (shown in Settings).
fn store_account(conn: &Connection, id: &str, details: &xtream::AccountDetails) {
    if let Ok(json) = serde_json::to_string(details) {
        let _ = conn.execute("UPDATE iptv_sources SET account = ?2 WHERE id = ?1", params![id, json]);
    }
}

/// Downloads a source's channels (and, for M3U, the guide named in its
/// header). `details` gets what an Xtream panel says about the account, even
/// when the login is refused (an expired account is worth showing).
async fn fetch_channels(kind: &str, secret: &mut Secret, cache: &std::path::Path, details: &mut Option<xtream::AccountDetails>) -> Result<Vec<Fetched>, String> {
    match kind {
        "xtream" => {
            let login = secret.login().ok_or("err.iptv.login-incomplete")?;
            let account = net::fetch_text(login.api(None)?, true, XTREAM_LIMIT).await?;
            *details = xtream::account_details(&account, now_ms());
            let account = xtream::check_account(&account)?;
            secret.ext = Some(account.ext.to_string());
            secret.offset = account.offset;
            secret.zone = account.zone;
            let (categories, streams) = tokio::try_join!(
                net::fetch_text(login.api(Some("get_live_categories"))?, true, XTREAM_LIMIT),
                net::fetch_text(login.api(Some("get_live_streams"))?, true, XTREAM_LIMIT),
            )?;
            Ok(xtream::streams(&categories, &streams, m3u::MAX_CHANNELS)?
                .into_iter()
                .map(|s| Fetched { key: s.id.clone(), key_before: None, name: s.name, logo: s.logo, group: s.group, tvg_id: s.epg_id, stream_id: Some(s.id), locator: None, archive_days: s.archive_days })
                .collect())
        }
        "m3u" => {
            let url = net::parse_url(secret.playlist.as_deref().ok_or("err.iptv.no-playlist")?)?;
            std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
            let file = cache.join(format!("playlist-{}.m3u", random_id()?));
            let result = async {
                net::download(url, true, &file, PLAYLIST_LIMIT).await?;
                let reader = net::open(&file, PLAYLIST_LIMIT * 4, b'\n')?;
                tauri::async_runtime::spawn_blocking(move || m3u::parse(reader)).await.map_err(|e| e.to_string())
            }
            .await;
            let _ = std::fs::remove_file(&file);
            let playlist = result?;
            if playlist.entries.is_empty() {
                return Err("err.iptv.no-channels".into());
            }
            let mut auto = playlist.epg.into_iter();
            secret.epg_auto = auto.next();
            secret.epg_auto_more = auto.collect();
            // Xtream-style replays use the panel's own clock: ask the panel (as an Xtream login would).
            // The panel is named by the playlist: on the LAN only if the playlist is.
            let local = secret.playlist_is_local();
            let panel = playlist
                .entries
                .iter()
                .find(|e| e.catchup.as_ref().is_some_and(|c| c.kind == "xc"))
                .and_then(|e| catchup::xc_parts(&e.url))
                .filter(|(server, ..)| local || !is_private_host(server));
            let account = match panel {
                Some((server, username, password, _, _)) => {
                    let login = xtream::Login { server, username, password };
                    match login.api(None) {
                        Ok(url) => net::fetch_text(url, local, XTREAM_LIMIT).await.ok().and_then(|body| xtream::check_account(&body).ok()),
                        Err(_) => None,
                    }
                }
                None => None,
            };
            (secret.offset, secret.zone) = account.map_or((None, None), |a| (a.offset, a.zone));
            let (mut seen, mut seen_before) = (HashMap::new(), HashMap::new());
            Ok(playlist
                .entries
                .into_iter()
                .map(|e| {
                    let key = channel_key(&mut seen, &e.name, e.group.as_deref());
                    // Numbered among the names as they were read then, as the keys were.
                    let (name_before, group_before) = e.before_latin1.as_ref().map_or((&e.name, e.group.as_ref()), |(n, g)| (n, g.as_ref()));
                    let before = channel_key(&mut seen_before, name_before, group_before.map(String::as_str));
                    let archive_days = e.catchup.as_ref().map_or(0, |c| c.days);
                    let replay = e.catchup.map(|c| Replay { kind: c.kind.to_string(), source: c.source });
                    Fetched {
                        key_before: (before != key).then_some(before),
                        key,
                        name: e.name,
                        logo: e.logo,
                        group: e.group,
                        tvg_id: e.tvg_id,
                        stream_id: None,
                        locator: Some(Locator { url: e.url, ua: e.user_agent, referrer: e.referrer, replay }),
                        archive_days,
                    }
                })
                .collect())
        }
        _ => Err("unknown kind of source".into()),
    }
}

/// A source's sealed login and its channels' sealed addresses, ready to store.
struct SealedChannels {
    secret: Vec<u8>,
    locators: Vec<Option<Vec<u8>>>,
}

/// Seals what `store_channels` stores, before the database is locked: tens of
/// thousands of channels take a while to encrypt.
fn seal_channels(id: &str, profile: &str, channels: &[Fetched], secret: &Secret) -> Result<SealedChannels, String> {
    let sealed_secret = seal_json(&source_aad(id, profile), secret)?;
    let cipher = vault::cipher().map_err(|_| "err.keychain.unavailable")?;
    let locators = channels
        .iter()
        .map(|c| match &c.locator {
            Some(l) => Ok(Some(vault::seal(&cipher, &channel_aad(id, profile, &c.key), &serde_json::to_vec(l).map_err(|e| e.to_string())?).map_err(|_| "err.iptv.encrypt")?)),
            None => Ok(None),
        })
        .collect::<Result<_, String>>()?;
    Ok(SealedChannels { secret: sealed_secret, locators })
}

/// Replaces a source's channels (keeping favourites, which are by key). A
/// channel keeps its match to the guide shown now (also by key) until the
/// next guide is published and matched afresh: without it the guide would
/// vanish while the next one downloads, and stay gone if that download failed.
fn store_channels(conn: &mut Connection, id: &str, channels: &[Fetched], sealed: &SealedChannels) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let matched: HashMap<String, String> = {
        let mut stmt = tx.prepare("SELECT key, epg_id FROM iptv_channels WHERE source_id = ?1 AND epg_id IS NOT NULL").map_err(|e| e.to_string())?;
        stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };
    tx.execute("DELETE FROM iptv_channels WHERE source_id = ?1", [id]).map_err(|e| e.to_string())?;
    // A Latin-1 playlist's channels had other keys before (see `m3u::Entry::before_latin1`): their
    // favourites move to the new keys, unless an old key is still some channel's own. Once moved
    // nothing is left under the old keys, so later refreshes change nothing.
    let keys: HashSet<&str> = channels.iter().map(|c| c.key.as_str()).collect();
    let moved: HashMap<&str, &str> = channels.iter().filter_map(|c| Some((c.key_before.as_deref()?, c.key.as_str()))).filter(|(before, _)| !keys.contains(before)).collect();
    {
        let mut stmt = tx.prepare("UPDATE OR IGNORE iptv_favourites SET key = ?3 WHERE source_id = ?1 AND key = ?2").map_err(|e| e.to_string())?;
        for (before, key) in &moved {
            stmt.execute(params![id, before, key]).map_err(|e| e.to_string())?;
        }
    }
    // Their match to the guide shown now goes with them too.
    let matched: HashMap<String, String> = matched.into_iter().map(|(k, e)| (moved.get(k.as_str()).map_or(k, |key| (*key).to_string()), e)).collect();
    {
        let mut stmt = tx
            .prepare("INSERT OR IGNORE INTO iptv_channels (source_id, key, position, name, logo, grp, tvg_id, stream_id, sealed, archive_days, epg_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
            .map_err(|e| e.to_string())?;
        for (i, (c, locator)) in channels.iter().zip(&sealed.locators).enumerate() {
            stmt.execute(params![id, c.key, i64::try_from(i).unwrap_or(i64::MAX), c.name, c.logo, c.group, c.tvg_id, c.stream_id, locator, c.archive_days, matched.get(&c.key)])
                .map_err(|e| e.to_string())?;
        }
    }
    let updated = tx
        .execute(
            "UPDATE iptv_sources SET secret = ?2, channel_count = (SELECT COUNT(*) FROM iptv_channels WHERE source_id = ?1), channels_at = ?3 WHERE id = ?1",
            params![id, sealed.secret, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    // Removed while its channels downloaded: dropping `tx` rolls the inserts back.
    if updated == 0 {
        return Err("err.iptv.source-gone".into());
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Runs `work` with the database on a blocking thread. The connection's lock
/// is a plain mutex, so long writes on an async worker would also stall the
/// other commands scheduled there.
async fn with_db<T: Send + 'static>(app: &AppHandle, work: impl FnOnce(&Db) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Db>())).await.map_err(|e| e.to_string())?
}

/// Rows deleted per lock when clearing out a guide.
const DELETE_CHUNK: usize = 5000;

/// Deletes a source's programmes of the generations in `gens`, a chunk per
/// lock: a guide can be hundreds of thousands of rows, and every other
/// command (settings, addon requests) waits while the lock is held. Only
/// generations the page can't see are deleted this way, so a half-done
/// delete is never visible.
fn drop_programmes(db: &Db, id: &str, gens: std::ops::RangeInclusive<i64>) -> Result<(), String> {
    drop_generations(db, "iptv_programmes", id, gens)
}

/// `drop_programmes` for any table kept in generations (the guide, the VOD index).
fn drop_generations(db: &Db, table: &'static str, id: &str, gens: std::ops::RangeInclusive<i64>) -> Result<(), String> {
    loop {
        let deleted = db
            .lock()?
            .prepare_cached(&format!("DELETE FROM {table} WHERE rowid IN (SELECT rowid FROM {table} WHERE source_id = ?1 AND gen BETWEEN ?2 AND ?3 LIMIT ?4)"))
            .and_then(|mut stmt| stmt.execute(params![id, gens.start(), gens.end(), DELETE_CHUNK as i64]))
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Ok(());
        }
        // A std mutex isn't fair: without a pause this thread could take the lock straight back.
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
}

/// Deletes all of a source's channels, a chunk per lock (see `drop_programmes`).
fn drop_channels(db: &Db, id: &str) -> Result<(), String> {
    loop {
        let deleted = db
            .lock()?
            .prepare_cached("DELETE FROM iptv_channels WHERE rowid IN (SELECT rowid FROM iptv_channels WHERE source_id = ?1 LIMIT ?2)")
            .and_then(|mut stmt| stmt.execute(params![id, DELETE_CHUNK as i64]))
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
}

/// Clears the VOD index of the profile's sources (or only of `only`, if it's
/// one of them) a chunk per lock, ahead of removing them: an index can be
/// 100,000 rows, and the removal would otherwise cascade them all in one
/// transaction. A build still running can add at most about a chunk before
/// the removal, which the cascade then takes. Returns the sources it cleared.
pub(crate) fn drop_vod_indexes(db: &Db, profile: &str, only: Option<&str>) -> Result<Vec<String>, String> {
    let ids: Vec<String> = {
        let conn = db.lock()?;
        let mut stmt = conn.prepare("SELECT id FROM iptv_sources WHERE profile_id = ?1 AND (?2 IS NULL OR id = ?2)").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![profile, only], |r| r.get(0)).map_err(|e| e.to_string())?;
        let ids: Vec<String> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        // Marked unbuilt first: if the delete that follows fails, the source rebuilds its index on next use
        // rather than looking built with nothing in it.
        conn.execute("UPDATE iptv_sources SET vod_at = NULL WHERE profile_id = ?1 AND (?2 IS NULL OR id = ?2)", params![profile, only])
            .map_err(|e| e.to_string())?;
        ids
    };
    for id in &ids {
        drop_generations(db, "iptv_vod_index", id, i64::MIN..=i64::MAX)?;
    }
    Ok(ids)
}

/// Clears removed sources' guides in the background, a chunk at a time (see
/// `drop_programmes`). With a source gone a refresh still running stops writing
/// (see `stage_guide`), so this catches all of it; a quit midway is finished by
/// the startup sweep.
pub(crate) fn drop_guides_later(app: &AppHandle, ids: Vec<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let cleared = with_db(&app, move |db| ids.iter().try_for_each(|id| drop_programmes(db, id, i64::MIN..=i64::MAX))).await;
        if let Err(e) = cleared {
            crate::diagnostics::warn(&format!("iptv: could not clear a removed source's guide: {e}"));
        }
    });
}

/// Clears out the programmes and channels of sources that no longer exist:
/// a removal cut short by quitting, or rows an older version let a refresh
/// write after one. The distinct source ids are walked through the indexes
/// (`MIN(source_id) > previous`), so a database with nothing to clear costs
/// a few lookups rather than a scan of every programme.
fn sweep_orphans(db: &Db) -> Result<(), String> {
    for table in ["iptv_programmes", "iptv_channels"] {
        let mut after = String::new();
        loop {
            let (id, gone) = {
                let conn = db.lock()?;
                let next: Option<String> =
                    conn.query_row(&format!("SELECT MIN(source_id) FROM {table} WHERE source_id > ?1"), [&after], |r| r.get(0)).map_err(|e| e.to_string())?;
                let Some(id) = next else { break };
                let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM iptv_sources WHERE id = ?1)", [&id], |r| r.get(0)).map_err(|e| e.to_string())?;
                (id, !exists)
            };
            if gone {
                if table == "iptv_programmes" { drop_programmes(db, &id, i64::MIN..=i64::MAX)? } else { drop_channels(db, &id)? }
            }
            after = id;
        }
    }
    Ok(())
}

/// Runs `sweep_orphans` on its own thread, so startup doesn't wait for it.
pub fn sweep_orphans_later(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("iptv-sweep".into()).spawn(move || {
        if let Err(e) = sweep_orphans(&app.state::<Db>()) {
            crate::diagnostics::warn(&format!("iptv: could not clear removed sources' rows: {e}"));
        }
    });
    if let Err(e) = spawned {
        crate::diagnostics::warn(&format!("iptv: could not start the clean-up: {e}"));
    }
}

/// Downloads a source's guides one after another and stores them merged
/// (earlier guides win a channel; see guide_merge.rs), then matches its
/// channels to them (by guide id, then by name). A guide that fails is left
/// out and named in the source's guide error; if every one fails, the old
/// guide stays.
///
/// The new guide is written next to the old one as the source's next
/// generation, which the page can't see until `publish_guide` switches to it.
async fn refresh_guide(app: &AppHandle, id: &str, secret: &Secret, cache: &std::path::Path) -> Result<(), String> {
    let addresses = secret.guide_addresses()?;
    if addresses.is_empty() {
        // No guide (any more): nothing of an old one should linger.
        let id = id.to_string();
        // A chunk per lock (see `drop_programmes`): the last guide removed can be hundreds of thousands of rows.
        return with_db(app, move |db| {
            drop_programmes(db, &id, i64::MIN..=i64::MAX)?;
            db.lock()?.execute("UPDATE iptv_sources SET epg_error = NULL WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
            Ok(())
        })
        .await;
    }
    std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    // Whatever an interrupted refresh left of another generation goes first.
    let live: i64 = {
        let id = id.to_string();
        with_db(app, move |db| {
            let live = db.lock()?.query_row("SELECT guide_gen FROM iptv_sources WHERE id = ?1", [&id], |r| r.get(0)).map_err(|e| e.to_string())?;
            drop_programmes(db, &id, i64::MIN..=live - 1)?;
            drop_programmes(db, &id, live + 1..=i64::MAX)?;
            Ok(live)
        })
        .await?
    };
    let next = live + 1;
    let several = addresses.len() > 1;
    let own = secret.guides_are_own() || secret.playlist_is_local();
    let mut merge = guide_merge::GuideMerge::default();
    let mut failures = Vec::new();
    for (n, address) in addresses.into_iter().enumerate() {
        let file = cache.join(format!("guide-{}.xml", random_id()?));
        let result = match net::download(address, own, &file, GUIDE_DOWNLOAD_LIMIT).await {
            Ok(()) => {
                let (app, id, path, mut taken) = (app.clone(), id.to_string(), file.clone(), std::mem::take(&mut merge));
                let (back, result) = tauri::async_runtime::spawn_blocking(move || {
                    let result = stage_guide(&app, &id, next, &path, &mut taken);
                    (taken, result)
                })
                .await
                .map_err(|e| e.to_string())?;
                merge = back;
                result
            }
            Err(e) => Err(e),
        };
        let _ = std::fs::remove_file(&file);
        match result {
            Ok(()) => merge.finish_guide(),
            Err(e) => {
                let (id, dropped) = (id.to_string(), merge.drop_guide());
                with_db(app, move |db| unstage(db, &id, next, &dropped)).await?;
                failures.push(if several { format!("Guide {}: {e}", n + 1) } else { e });
            }
        }
    }
    let id = id.to_string();
    if merge.kept == 0 {
        let _ = with_db(app, move |db| drop_programmes(db, &id, next..=i64::MAX)).await;
        // Every guide read, none with a programme in the window (or none Orbit could read).
        if failures.is_empty() {
            return Err("err.iptv.guide-empty".into());
        }
        return Err(failures.join(" "));
    }
    let error = (!failures.is_empty()).then(|| failures.join(" "));
    with_db(app, move |db| publish_guide(db, &id, next, &merge, error.as_deref())).await
}

/// Programmes written to the database per transaction while a guide is staged.
const STAGE_BATCH: usize = 5000;

/// A guide's programmes on their way into the database, a batch at a time.
/// Once a write fails the guide is given up (its caller unstages what got
/// in, and the next refresh tries again), so nothing more is kept: the rest
/// of a large guide would otherwise pile up in memory with nowhere to go.
struct Staging<T> {
    batch: Vec<T>,
    failure: Option<String>,
}

impl<T> Default for Staging<T> {
    fn default() -> Self {
        Self { batch: Vec::with_capacity(STAGE_BATCH), failure: None }
    }
}

impl<T> Staging<T> {
    fn push(&mut self, item: T, flush: &mut impl FnMut(&mut Vec<T>) -> Result<(), String>) {
        if self.failure.is_some() {
            return;
        }
        self.batch.push(item);
        if self.batch.len() >= STAGE_BATCH
            && let Err(e) = flush(&mut self.batch)
        {
            self.batch = Vec::new();
            self.failure = Some(e);
        }
    }

    /// Writes what's left; the first failure if a write failed.
    fn finish(mut self, flush: &mut impl FnMut(&mut Vec<T>) -> Result<(), String>) -> Result<(), String> {
        match self.failure {
            Some(e) => Err(e),
            None => flush(&mut self.batch),
        }
    }
}

/// Reads one downloaded guide into generation `gen` of the source's
/// programmes, keeping what `merge` allows.
fn stage_guide(app: &AppHandle, id: &str, generation: i64, path: &std::path::Path, merge: &mut guide_merge::GuideMerge) -> Result<(), String> {
    let reader = net::open(path, GUIDE_CONTENT_LIMIT, b'<')?;
    let now = now_ms() / 1000;
    let db = app.state::<Db>();
    let archive: i64 = db.lock()?.query_row("SELECT COALESCE(MAX(archive_days), 0) FROM iptv_channels WHERE source_id = ?1", [id], |r| r.get(0)).unwrap_or(0);
    let behind = GUIDE_BEHIND_S.max(archive.min(GUIDE_ARCHIVE_DAYS) * 86_400);
    let mut staging: Staging<xmltv::Programme> = Staging::default();
    let mut flush = |batch: &mut Vec<xmltv::Programme>| -> Result<(), String> {
        let mut conn = db.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        // Removed while its guide downloads: stop writing under its id.
        let exists: bool = tx.query_row("SELECT EXISTS (SELECT 1 FROM iptv_sources WHERE id = ?1)", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !exists {
            return Err("err.iptv.source-gone".into());
        }
        {
            let mut stmt = tx.prepare("INSERT INTO iptv_programmes (source_id, channel, start, stop, title, description, gen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").map_err(|e| e.to_string())?;
            for p in batch.drain(..) {
                stmt.execute(params![id, p.channel, p.start, p.stop, p.title, p.description, generation]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    };
    // Both callbacks need the merge: channels and programmes arrive interleaved.
    let merge = std::cell::RefCell::new(merge);
    xmltv::parse(
        reader,
        now - behind,
        now + GUIDE_AHEAD_S,
        |c| merge.borrow_mut().channel(c, normalize),
        |p| {
            if merge.borrow_mut().keep(&p) {
                staging.push(p, &mut flush);
            }
        },
    )?;
    staging.finish(&mut flush)
}

/// Takes a failed guide's programmes back out of the unpublished generation.
fn unstage(db: &Db, id: &str, generation: i64, channels: &[String]) -> Result<(), String> {
    let mut conn = db.lock()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare("DELETE FROM iptv_programmes WHERE source_id = ?1 AND gen = ?2 AND channel = ?3").map_err(|e| e.to_string())?;
        for channel in channels {
            stmt.execute(params![id, generation, channel]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Switches the source to the new guide (generation `gen`) and matches its
/// channels to it in one short transaction, then clears the old guide out a
/// chunk at a time.
fn publish_guide(db: &Db, id: &str, generation: i64, merge: &guide_merge::GuideMerge, error: Option<&str>) -> Result<(), String> {
    let published = {
        let mut conn = db.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let channels: Vec<(String, String, Option<String>)> = {
            let mut stmt = tx.prepare("SELECT key, name, tvg_id FROM iptv_channels WHERE source_id = ?1").map_err(|e| e.to_string())?;
            stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect()
        };
        {
            let mut stmt = tx.prepare("UPDATE iptv_channels SET epg_id = ?3 WHERE source_id = ?1 AND key = ?2").map_err(|e| e.to_string())?;
            for (key, name, tvg_id) in channels {
                let matched = tvg_id.as_deref().and_then(|t| merge.guide_id(t)).map(String::from).or_else(|| merge.names.get(&normalize(&name)).cloned());
                stmt.execute(params![id, key, matched]).map_err(|e| e.to_string())?;
            }
        }
        let updated = tx.execute("UPDATE iptv_sources SET guide_gen = ?2, epg_at = ?3, epg_error = ?4 WHERE id = ?1", params![id, generation, now_ms(), error]).map_err(|e| e.to_string())?;
        if updated > 0 {
            tx.commit().map_err(|e| e.to_string())?;
        }
        updated > 0
    };
    if !published {
        // Removed while the guide downloaded: what was staged goes too.
        drop_programmes(db, id, i64::MIN..=i64::MAX)?;
        return Err("err.iptv.source-gone".into());
    }
    drop_programmes(db, id, i64::MIN..=generation - 1)
}

/// Refreshes channels, then the guide, telling the page as each lands.
async fn refresh(app: &AppHandle, profile: &str, id: &str) -> Result<(), String> {
    // Before the claim: returning early after it would leave the source "refreshing" until Orbit restarts.
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("iptv");
    app.state::<Refreshing>().claim(id)?;
    let result = async {
        let (kind, mut secret) = secret_of(&*app.state::<Db>().lock()?, profile, id)?;
        let mut details = None;
        let fetched = fetch_channels(&kind, &mut secret, &cache, &mut details).await;
        if let Some(details) = &details {
            store_account(&*app.state::<Db>().lock()?, id, details);
        }
        let channels = fetched?;
        let sealed = seal_channels(id, profile, &channels, &secret)?;
        let owned = id.to_string();
        with_db(app, move |db| store_channels(&mut *db.lock()?, &owned, &channels, &sealed)).await?;
        let _ = app.emit(UPDATED_EVENT, id);
        let guide = refresh_guide(app, id, &secret, &cache).await;
        guide_tried(id, guide.is_ok(), now_ms());
        if let Err(e) = guide {
            let _ = app.state::<Db>().lock()?.execute("UPDATE iptv_sources SET epg_error = ?2 WHERE id = ?1", params![id, e]);
        }
        let _ = app.emit(UPDATED_EVENT, id);
        Ok::<_, String>(())
    }
    .await;
    if let Ok(mut busy) = app.state::<Refreshing>().0.lock() {
        busy.remove(id);
    }
    result
}

/// A replay request from an address's `?start=…&end=…&tz=…`: Unix seconds,
/// and the viewer's offset from UTC in minutes (for templates in local time).
fn replay_window(query: &str, archive_days: i64, now: i64) -> Result<catchup::Window, String> {
    let value = |name: &str| query.split('&').find_map(|pair| pair.strip_prefix(name)?.strip_prefix('=')?.parse::<i64>().ok());
    let (start, end) = (value("start").ok_or("invalid replay")?, value("end").ok_or("invalid replay")?);
    if archive_days <= 0 {
        return Err("err.iptv.no-archive".into());
    }
    if end <= start || end - start > 12 * 3600 || start >= now {
        return Err("invalid replay".into());
    }
    // An hour's grace: archives are rarely cut exactly at the day boundary.
    if start < now - archive_days * 86_400 - 3600 {
        return Err("err.iptv.too-old".into());
    }
    let offset = value("tz").unwrap_or(0).clamp(-14 * 60, 14 * 60) * 60;
    Ok(catchup::Window { start, end: end.min(now), now, offset })
}

/// The real address (and headers) for `orbit-tv://{source}/{key}[?start=…]`, for the player.
pub fn resolve(conn: &Connection, profile: &str, address: &str) -> Result<(String, Option<String>, Option<String>), String> {
    let rest = address.strip_prefix(SCHEME).ok_or("not a Live TV address")?;
    let (rest, query) = rest.split_once('?').map_or((rest, None), |(r, q)| (r, Some(q)));
    let (source, key) = rest.split_once('/').ok_or("not a Live TV address")?;
    if let Some(key) = key.strip_prefix("vod/") {
        if query.is_some() { return Err("invalid IPTV VOD address".into()); }
        return vod::resolve(conn, profile, source, key);
    }
    // A content limit with Live TV off: no channel or catch-up plays, however the page asked.
    if !crate::profiles::live_tv_allowed(conn, profile)? {
        return Err("err.iptv.live-tv-off".into());
    }
    let (kind, secret) = secret_of(conn, profile, source)?;
    let (stream_id, sealed, archive_days, group): (Option<String>, Option<Vec<u8>>, i64, Option<String>) = conn
        .query_row("SELECT stream_id, sealed, archive_days, grp FROM iptv_channels WHERE source_id = ?1 AND key = ?2", params![source, key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("err.iptv.channel-gone")?;
    if groups::locked_now(conn, profile, group.as_deref()) {
        return Err("err.iptv.group-locked".into());
    }
    let replay = query.map(|q| replay_window(q, archive_days, now_ms() / 1000)).transpose()?;
    if kind == "xtream" {
        let login = secret.login().ok_or("err.iptv.login-incomplete")?;
        let (id, ext) = (stream_id.ok_or("missing stream")?, secret.ext.as_deref().unwrap_or("ts"));
        let url = match replay {
            // The server's own clock if it told us; otherwise assume it shares the viewer's.
            Some(w) => login.replay(&id, ext, w.start, w.end, secret.clock_at(w.start).unwrap_or(w.offset))?,
            None => login.stream(&id, ext)?,
        };
        return Ok((url.into(), None, None));
    }
    let locator: Locator = open_json(&channel_aad(source, profile, key), &legacy_channel_aad(source, key), &sealed.ok_or("missing stream")?)?;
    let url = match (replay, &locator.replay) {
        (Some(mut w), Some(r)) => {
            if r.kind == "xc" {
                w.offset = secret.clock_at(w.start).unwrap_or(w.offset);
            }
            catchup::address(&locator.url, &r.kind, r.source.as_deref(), w)?.into()
        }
        (Some(_), None) => return Err("err.iptv.no-archive".into()),
        (None, _) => locator.url,
    };
    if !secret.may_open(&url) {
        return Err("err.iptv.local-address".into());
    }
    Ok((url, locator.ua, locator.referrer))
}

#[tauri::command]
pub async fn iptv_sources(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<SourceInfo>, String> {
    let profile = active.id()?;
    let mut conn = db.lock()?;
    // The first list of a run binds older logins and addresses to their profile; a failure keeps them as they were.
    if !RESEALED.load(std::sync::atomic::Ordering::Relaxed)
        && let Ok(cipher) = vault::cipher()
    {
        match reseal_legacy(&mut conn, &cipher) {
            Ok(_) => RESEALED.store(true, std::sync::atomic::Ordering::Relaxed),
            Err(e) => crate::diagnostics::warn(&format!("iptv: could not re-seal older logins: {e}")),
        }
    }
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM iptv_sources WHERE profile_id = ?1 ORDER BY added_at").map_err(|e| e.to_string())?;
        stmt.query_map([&profile], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect()
    };
    ids.iter().map(|id| info(&conn, &profile, id)).collect()
}

/// Whether a new source of `kind` offers its films and episodes as sources
/// from the start: Xtream accounts have an on-demand catalog, playlists don't.
/// Accounts added before keep the choice they had (see vod.rs).
fn offers_vod(kind: &str) -> bool {
    kind == "xtream"
}

/// Checks a new source by downloading its channels, then saves it (sealed)
/// and fetches its guide in the background.
#[tauri::command]
pub async fn iptv_add(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, source: NewSource) -> Result<SourceInfo, String> {
    let profile = active.id()?;
    let name: String = source.name.trim().chars().filter(|c| !c.is_control()).take(MAX_NAME).collect();
    if name.is_empty() {
        return Err("err.iptv.name".into());
    }
    let epg = source.epg.as_deref().map(str::trim).filter(|e| !e.is_empty()).map(|e| net::parse_url(e).map(String::from)).transpose()?;
    let mut secret = match source.kind.as_str() {
        "m3u" => Secret { playlist: Some(net::parse_url(source.playlist.as_deref().unwrap_or_default())?.into()), epg, ..Default::default() },
        "xtream" => {
            let server = xtream::parse_server(source.server.as_deref().unwrap_or_default())?;
            let (username, password) = (source.username.unwrap_or_default().trim().to_string(), source.password.unwrap_or_default());
            if username.is_empty() || password.is_empty() || username.len() > 200 || password.len() > 200 {
                return Err("err.iptv.login".into());
            }
            Secret { server: Some(server.into()), username: Some(username), password: Some(password), epg, ..Default::default() }
        }
        _ => return Err("unknown kind of source".into()),
    };
    let address = secret.playlist.clone().or_else(|| secret.server.clone()).unwrap_or_default();
    let (host, insecure) = host_of(&address);
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("iptv");
    let mut details = None;
    let channels = fetch_channels(&source.kind, &mut secret, &cache, &mut details).await?;
    let id = random_id()?;
    let sealed = seal_channels(&id, &profile, &channels, &secret)?;
    // Claimed like `refresh` does, and before the source is saved: a stale-source
    // refresh (the guide isn't in yet) that found it first would stage the same
    // source's guide alongside this one.
    app.state::<Refreshing>().claim(&id)?;
    let saved = {
        let (id, profile) = (id.clone(), profile.clone());
        with_db(&app, move |db| {
            let mut conn = db.lock()?;
            conn.execute(
                "INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at, use_vod) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)",
                params![id, profile, name, source.kind, host, insecure, sealed.secret, now_ms(), offers_vod(&source.kind)],
            )
            .map_err(|e| e.to_string())?;
            store_channels(&mut conn, &id, &channels, &sealed)?;
            if let Some(details) = &details {
                store_account(&conn, &id, details);
            }
            Ok(())
        })
        .await
    };
    if let Err(e) = saved {
        app.state::<Refreshing>().release(&id);
        return Err(e);
    }
    let (app2, id2) = (app.clone(), id.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = refresh_guide(&app2, &id2, &secret, &cache).await
            && let Ok(conn) = app2.state::<Db>().lock()
        {
            let _ = conn.execute("UPDATE iptv_sources SET epg_error = ?2 WHERE id = ?1", params![id2, e]);
        }
        app2.state::<Refreshing>().release(&id2);
        let _ = app2.emit(UPDATED_EVENT, &id2);
    });
    info(&*db.lock()?, &profile, &id)
}

#[tauri::command]
pub async fn iptv_remove(app: AppHandle, active: State<'_, ActiveProfile>, id: String) -> Result<(), String> {
    let profile = active.id()?;
    let (owner, only) = (profile.clone(), id.clone());
    with_db(&app, move |db| drop_vod_indexes(db, &owner, Some(&only))).await?;
    let removed = {
        let db = app.state::<Db>();
        let mut conn = db.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let removed = tx.execute("DELETE FROM iptv_sources WHERE id = ?1 AND profile_id = ?2", params![id, profile]).map_err(|e| e.to_string())?;
        if removed > 0 {
            vod::invalidate(&id);
            for table in ["iptv_channels", "iptv_vod_locators", "iptv_favourites"] {
                tx.execute(&format!("DELETE FROM {table} WHERE source_id = ?1"), [&id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        removed > 0
    };
    // The guide can be hundreds of thousands of rows: deleted in one go it
    // would hold the database (and every command) for seconds.
    if removed {
        drop_guides_later(&app, vec![id]);
    }
    Ok(())
}

/// Downloads a source's channels and guide again (waits for the channels).
#[tauri::command]
pub async fn iptv_refresh(app: AppHandle, active: State<'_, ActiveProfile>, id: String) -> Result<(), String> {
    refresh(&app, &active.id()?, &id).await
}

const CHANNELS_FRESH_MS: i64 = 86_400_000;
const GUIDE_FRESH_MS: i64 = 43_200_000;
/// How soon a guide that couldn't be had is tried again by `iptv_refresh_stale`.
const GUIDE_RETRY_MS: i64 = 3_600_000;

/// When each source's guide may be asked for again (ms), after a refresh that
/// didn't publish one: a source with no guide, or whose guides all failed,
/// never gets an `epg_at`, and would otherwise count as stale on every visit
/// to Live TV, downloading its whole playlist again each time. Kept in memory:
/// after a restart, one more try is fine.
static GUIDE_DUE: std::sync::LazyLock<Mutex<HashMap<String, i64>>> = std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn guide_tried(id: &str, ok: bool, now: i64) {
    if let Ok(mut due) = GUIDE_DUE.lock() {
        due.insert(id.to_string(), now + if ok { GUIDE_FRESH_MS } else { GUIDE_RETRY_MS });
    }
}

/// Whether a source needs refreshing: channels over a day old, or a guide
/// over 12 hours old that isn't waiting for its next try.
fn is_stale(id: &str, channels_at: Option<i64>, epg_at: Option<i64>, now: i64) -> bool {
    let channels = channels_at.is_none_or(|at| at < now - CHANNELS_FRESH_MS);
    let guide = epg_at.is_none_or(|at| at < now - GUIDE_FRESH_MS) && GUIDE_DUE.lock().ok().and_then(|due| due.get(id).copied()).is_none_or(|due| now >= due);
    channels || guide
}

/// Refreshes, in the background, sources whose channels are over a day old
/// or whose guide is over 12 hours old.
#[tauri::command]
pub async fn iptv_refresh_stale(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<(), String> {
    let profile = active.id()?;
    let now = now_ms();
    let stale: Vec<String> = {
        let conn = db.lock()?;
        let mut stmt = conn.prepare("SELECT id, channels_at, epg_at FROM iptv_sources WHERE profile_id = ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&profile], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<i64>>(2)?))).map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).filter(|(id, channels_at, epg_at)| is_stale(id, *channels_at, *epg_at, now)).map(|(id, ..)| id).collect()
    };
    for id in stale {
        let (app, profile) = (app.clone(), profile.clone());
        tauri::async_runtime::spawn(async move {
            let _ = refresh(&app, &profile, &id).await;
        });
    }
    Ok(())
}

/// How long what a panel said about the account is shown before asking again.
const ACCOUNT_FRESH_MS: i64 = 15 * 60 * 1000;

/// Asks an Xtream panel about the account again (unless it was asked in the
/// last few minutes) and returns what it said. The login stays here: the page
/// gets only the status, expiry and connection counts.
#[tauri::command]
pub async fn iptv_account(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<Option<xtream::AccountDetails>, String> {
    let profile = active.id()?;
    let (kind, secret, known) = {
        let conn = db.lock()?;
        let known = info(&conn, &profile, &id)?.account;
        let (kind, secret) = secret_of(&conn, &profile, &id)?;
        (kind, secret, known)
    };
    if kind != "xtream" {
        return Ok(None);
    }
    if known.as_ref().is_some_and(|k| crate::library::fresh(k.checked_at, now_ms(), ACCOUNT_FRESH_MS)) {
        return Ok(known);
    }
    let login = secret.login().ok_or("err.iptv.login-incomplete")?;
    let body = net::fetch_text(login.api(None)?, true, XTREAM_LIMIT).await?;
    let details = xtream::account_details(&body, now_ms()).ok_or("err.iptv.no-account")?;
    store_account(&*db.lock()?, &id, &details);
    Ok(Some(details))
}

/// A guide address as Settings shows it: its host only (the rest can carry a login).
#[derive(Serialize)]
pub struct GuideAddress {
    host: String,
    insecure: bool,
}

#[derive(Serialize)]
pub struct Guides {
    /// The person's own guides, in order (earlier ones win a channel).
    own: Vec<GuideAddress>,
    /// What's used when there are none: "provider" (the Xtream panel's own),
    /// "playlist" (named in the playlist), or "none".
    fallback: &'static str,
}

fn guides_of(secret: &Secret) -> Guides {
    let own = secret
        .own_guides()
        .iter()
        .map(|g| {
            let (host, insecure) = host_of(g);
            GuideAddress { host, insecure }
        })
        .collect();
    let fallback = if secret.login().is_some() {
        "provider"
    } else if secret.epg_auto.is_some() {
        "playlist"
    } else {
        "none"
    };
    Guides { own, fallback }
}

/// A change to a source's own guides.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GuideChange {
    Add { url: String },
    Remove { index: usize },
    /// Moves a guide one place earlier (it then wins over the one before).
    Up { index: usize },
}

fn apply_guide_change(guides: &mut Vec<String>, change: GuideChange) -> Result<(), String> {
    match change {
        GuideChange::Add { url } => {
            let url = net::parse_url(&url)?;
            if guides.len() >= MAX_GUIDES {
                return Err(crate::user_error::coded("iptv.guide-limit", &[("max", &MAX_GUIDES.to_string())]));
            }
            if guides.iter().any(|g| *g == url.as_str()) {
                return Err("err.iptv.guide-exists".into());
            }
            guides.push(url.into());
        }
        GuideChange::Remove { index } if index < guides.len() => {
            guides.remove(index);
        }
        GuideChange::Up { index } if index > 0 && index < guides.len() => guides.swap(index - 1, index),
        _ => return Err("err.iptv.guide-gone".into()),
    }
    Ok(())
}

/// What Settings shows of a source's guides (hosts only).
#[tauri::command]
pub async fn iptv_guides(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<Guides, String> {
    let profile = active.id()?;
    let (_, secret) = secret_of(&*db.lock()?, &profile, &id)?;
    Ok(guides_of(&secret))
}

/// Adds, removes or moves one of a source's own guides (sealed with the rest
/// of its login), then downloads the guide again in the background.
#[tauri::command]
pub async fn iptv_guides_change(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, change: GuideChange) -> Result<Guides, String> {
    let profile = active.id()?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("iptv");
    // While a refresh runs it holds the source's login, and would write the old guides back.
    app.state::<Refreshing>().claim(&id)?;
    let release = |app: &AppHandle, id: &str| {
        if let Ok(mut busy) = app.state::<Refreshing>().0.lock() {
            busy.remove(id);
        }
    };
    let changed = (|| {
        let conn = db.lock()?;
        let (_, mut secret) = secret_of(&conn, &profile, &id)?;
        let mut own = secret.own_guides();
        apply_guide_change(&mut own, change)?;
        secret.set_own_guides(own);
        conn.execute("UPDATE iptv_sources SET secret = ?2 WHERE id = ?1 AND profile_id = ?3", params![id, seal_json(&source_aad(&id, &profile), &secret)?, profile])
            .map_err(|e| e.to_string())?;
        Ok::<_, String>(secret)
    })();
    let secret = match changed {
        Ok(secret) => secret,
        Err(e) => {
            release(&app, &id);
            return Err(e);
        }
    };
    let guides = guides_of(&secret);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = refresh_guide(&app, &id, &secret, &cache).await
            && let Ok(conn) = app.state::<Db>().lock()
        {
            let _ = conn.execute("UPDATE iptv_sources SET epg_error = ?2 WHERE id = ?1", params![id, e]);
        }
        release(&app, &id);
        let _ = app.emit(UPDATED_EVENT, &id);
    });
    Ok(guides)
}

#[tauri::command]
pub async fn iptv_channels(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<ChannelInfo>, String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    // A content limit with Live TV off: nothing to list, not only a page that hides it.
    if !crate::profiles::live_tv_allowed(&conn, &profile)? {
        return Ok(Vec::new());
    }
    channels(&conn, &profile, groups::unlocked(&profile)).map_err(|e| e.to_string())
}

/// Every listed channel of the profile's sources, in their order. Hidden
/// groups, and locked ones until opened, are left out (see groups.rs).
fn channels(conn: &Connection, profile: &str, unlocked: bool) -> rusqlite::Result<Vec<ChannelInfo>> {
    let mut stmt = conn.prepare(
        "SELECT c.source_id, c.key, c.name, c.logo, c.grp, f.key IS NOT NULL,
                EXISTS (SELECT 1 FROM iptv_programmes p WHERE p.source_id = c.source_id AND p.gen = s.guide_gen AND p.channel = c.epg_id), c.archive_days, f.position
         FROM iptv_channels c JOIN iptv_sources s ON s.id = c.source_id
         LEFT JOIN iptv_favourites f ON f.profile_id = s.profile_id AND f.source_id = c.source_id AND f.key = c.key
         LEFT JOIN iptv_groups g ON g.profile_id = s.profile_id AND g.name = c.grp
         WHERE s.profile_id = ?1 AND NOT COALESCE(g.hidden, 0) AND (?2 OR NOT COALESCE(g.locked, 0))
         ORDER BY s.added_at, c.position",
    )?;
    let rows = stmt.query_map(params![profile, unlocked], |r| Ok(ChannelInfo { source: r.get(0)?, key: r.get(1)?, name: r.get(2)?, logo: r.get(3)?, group: r.get(4)?, favourite: r.get(5)?, listed: r.get(6)?, archive: r.get(7)?, rank: r.get(8)? }))?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// What's on now and next for up to 300 channels (the ones on screen).
#[tauri::command]
pub async fn iptv_guide(db: State<'_, Db>, active: State<'_, ActiveProfile>, channels: Vec<(String, String)>) -> Result<Vec<Guide>, String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    // A content limit with Live TV off: nothing to list, not only a page that hides it.
    if !crate::profiles::live_tv_allowed(&conn, &profile)? {
        return Ok(Vec::new());
    }
    guide(&conn, &profile, groups::unlocked(&profile), channels, now_ms() / 1000).map_err(|e| e.to_string())
}

/// Channels in a hidden group, or a locked one not opened this session, have
/// no programmes here, as they aren't listed (see `iptv_channels`): the page
/// could still ask for them by key.
const SHOWN_GROUP: &str = "LEFT JOIN iptv_groups g ON g.profile_id = s.profile_id AND g.name = c.grp";

fn guide(conn: &Connection, profile: &str, unlocked: bool, channels: Vec<(String, String)>, now: i64) -> rusqlite::Result<Vec<Guide>> {
    let mut lookup = conn.prepare(&format!(
        "SELECT p.title, p.start, p.stop, p.description FROM iptv_channels c
             JOIN iptv_sources s ON s.id = c.source_id AND s.profile_id = ?3
             JOIN iptv_programmes p ON p.source_id = c.source_id AND p.gen = s.guide_gen AND p.channel = c.epg_id
             {SHOWN_GROUP}
             WHERE c.source_id = ?1 AND c.key = ?2 AND p.stop > ?4 AND NOT COALESCE(g.hidden, 0) AND (?5 OR NOT COALESCE(g.locked, 0))
             ORDER BY p.start LIMIT 2"
    ))?;
    Ok(channels
        .into_iter()
        .take(300)
        .map(|(source, key)| {
            let shows: Vec<Showing> = lookup
                .query_map(params![source, key, profile, now, unlocked], |r| Ok(Showing { title: r.get(0)?, start: r.get(1)?, stop: r.get(2)?, description: r.get(3)? }))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default();
            let mut shows = shows.into_iter();
            let first = shows.next();
            let (now_on, next) = match first {
                Some(s) if s.start <= now => (Some(s), shows.next()),
                other => (None, other),
            };
            Guide { source, key, now: now_on, next }
        })
        .collect())
}

/// A channel's programmes in a stretch of time, for the guide grid.
#[derive(Serialize)]
pub struct Schedule {
    source: String,
    key: String,
    programmes: Vec<Showing>,
}

/// Programmes overlapping `from`..`to` (Unix seconds, at most two days) for
/// up to 300 channels, at most [`schedule_limit`] each.
#[tauri::command]
pub async fn iptv_schedule(db: State<'_, Db>, active: State<'_, ActiveProfile>, channels: Vec<(String, String)>, from: i64, to: i64) -> Result<Vec<Schedule>, String> {
    if to <= from || to - from > 2 * 86_400 {
        return Err("invalid time range".into());
    }
    let profile = active.id()?;
    let conn = db.lock()?;
    // A content limit with Live TV off: nothing to list, not only a page that hides it.
    if !crate::profiles::live_tv_allowed(&conn, &profile)? {
        return Ok(Vec::new());
    }
    schedule(&conn, &profile, groups::unlocked(&profile), channels, from, to).map_err(|e| e.to_string())
}

/// Programmes per channel for a window: one per five minutes, so a channel of short
/// programmes still fills a day and a half, within 100..=600 to bound the answer.
fn schedule_limit(from: i64, to: i64) -> i64 {
    ((to - from) / 300).clamp(100, 600)
}

fn schedule(conn: &Connection, profile: &str, unlocked: bool, channels: Vec<(String, String)>, from: i64, to: i64) -> rusqlite::Result<Vec<Schedule>> {
    let limit = schedule_limit(from, to);
    let mut lookup = conn.prepare(&format!(
        "SELECT p.title, p.start, p.stop, p.description FROM iptv_channels c
             JOIN iptv_sources s ON s.id = c.source_id AND s.profile_id = ?3
             JOIN iptv_programmes p ON p.source_id = c.source_id AND p.gen = s.guide_gen AND p.channel = c.epg_id
             {SHOWN_GROUP}
             WHERE c.source_id = ?1 AND c.key = ?2 AND p.stop > ?4 AND p.start < ?5 AND NOT COALESCE(g.hidden, 0) AND (?6 OR NOT COALESCE(g.locked, 0))
             ORDER BY p.start LIMIT ?7"
    ))?;
    Ok(channels
        .into_iter()
        .take(300)
        .map(|(source, key)| {
            let programmes = lookup
                .query_map(params![source, key, profile, from, to, unlocked, limit], |r| Ok(Showing { title: r.get(0)?, start: r.get(1)?, stop: r.get(2)?, description: r.get(3)? }))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default();
            Schedule { source, key, programmes }
        })
        .collect())
}

#[tauri::command]
pub async fn iptv_favourite(db: State<'_, Db>, active: State<'_, ActiveProfile>, source: String, key: String, on: bool) -> Result<(), String> {
    let profile = active.id()?;
    let conn = db.lock()?;
    info(&conn, &profile, &source)?;
    if on {
        add_favourite(&conn, &profile, &source, &key).map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM iptv_favourites WHERE profile_id = ?1 AND source_id = ?2 AND key = ?3", params![profile, source, key]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A new favourite goes last.
fn add_favourite(conn: &Connection, profile: &str, source: &str, key: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT OR IGNORE INTO iptv_favourites (profile_id, source_id, key, position)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position) + 1, 0) FROM iptv_favourites WHERE profile_id = ?1))",
        params![profile, source, key],
    )
}

/// More favourites than anyone keeps; stops a runaway caller holding the lock.
const MAX_FAVOURITES_ORDER: usize = 10_000;

/// Puts the profile's favourites in `order` (source, key). Pairs that aren't
/// favourites are ignored; favourites left out keep their place after these.
#[tauri::command]
pub async fn iptv_favourites_order(db: State<'_, Db>, active: State<'_, ActiveProfile>, order: Vec<(String, String)>) -> Result<(), String> {
    if order.len() > MAX_FAVOURITES_ORDER {
        return Err("too many channels".into());
    }
    let profile = active.id()?;
    let mut conn = db.lock()?;
    order_favourites(&mut conn, &profile, &order).map_err(|e| e.to_string())
}

fn order_favourites(conn: &mut Connection, profile: &str, order: &[(String, String)]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        // Those left out move after the ordered ones, keeping their relative order.
        let after = i64::try_from(order.len()).unwrap_or(i64::MAX);
        tx.execute("UPDATE iptv_favourites SET position = position + ?2 WHERE profile_id = ?1", params![profile, after])?;
        let mut set = tx.prepare("UPDATE iptv_favourites SET position = ?4 WHERE profile_id = ?1 AND source_id = ?2 AND key = ?3")?;
        for (position, (source, key)) in (0_i64..).zip(order) {
            set.execute(params![profile, source, key, position])?;
        }
    }
    tx.commit()
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(target: &str, data: &[u8]) {
    match target {
        "m3u" => m3u::fuzz_input(data),
        "xmltv" => xmltv::fuzz_input(data),
        _ => {
            xtream::fuzz_input(data);
            vod::fuzz_input(data);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_without_a_guide_isnt_refreshed_on_every_visit() {
        let now = 1_800_000_000_000;
        let fresh = Some(now - 1000);
        // Channels fresh, no guide ever published: stale until a refresh has tried it.
        assert!(is_stale("tv-no-guide", fresh, None, now));
        guide_tried("tv-no-guide", true, now);
        assert!(!is_stale("tv-no-guide", fresh, None, now + 1000));
        assert!(is_stale("tv-no-guide", fresh, None, now + GUIDE_FRESH_MS));
        // Every guide failed: tried again within the hour, not on each visit.
        guide_tried("tv-failed", false, now);
        assert!(!is_stale("tv-failed", fresh, Some(now - GUIDE_FRESH_MS * 2), now + 1000));
        assert!(is_stale("tv-failed", fresh, Some(now - GUIDE_FRESH_MS * 2), now + GUIDE_RETRY_MS));
        // Old channels are refreshed whatever the guide's state.
        assert!(is_stale("tv-failed", Some(now - CHANNELS_FRESH_MS - 1), None, now + 1000));
        assert!(!is_stale("tv-fresh", fresh, fresh, now));
    }

    #[test]
    fn logins_and_channels_are_bound_to_their_profile_and_old_ones_resealed() {
        use aes_gcm::KeyInit;
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[5; 32]).unwrap();
        let login = br#"{"playlist":"http://panel.example/get.php?username=u&password=SECRET"}"#;
        let stream = br#"{"url":"http://panel.example/live/u/SECRET/1.ts"}"#;
        let secret = vault::seal(&cipher, &legacy_source_aad("s"), login).unwrap();
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'main', 'TV', 'm3u', 'h', 0, ?1, 2, 1)", [&secret]).unwrap();
        let locator = vault::seal(&cipher, &legacy_channel_aad("s", "k1"), stream).unwrap();
        conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, sealed) VALUES ('s', 'k1', 0, 'One', ?1), ('s', 'k2', 1, 'Two', NULL)", [&locator]).unwrap();
        // Read the old way until re-sealed, so nothing stops working meanwhile.
        assert_eq!(open_sealed(&cipher, &source_aad("s", "main"), &legacy_source_aad("s"), &secret).unwrap(), login);

        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 2);
        let secret: Vec<u8> = conn.query_row("SELECT secret FROM iptv_sources WHERE id = 's'", [], |r| r.get(0)).unwrap();
        let locator: Vec<u8> = conn.query_row("SELECT sealed FROM iptv_channels WHERE key = 'k1'", [], |r| r.get(0)).unwrap();
        assert_eq!(vault::open(&cipher, &source_aad("s", "main"), &secret).unwrap(), login);
        assert_eq!(vault::open(&cipher, &channel_aad("s", "main", "k1"), &locator).unwrap(), stream);
        assert!(open_sealed(&cipher, &source_aad("s", "kid"), &legacy_source_aad("s"), &secret).is_err(), "another profile can't open it");
        assert!(open_sealed(&cipher, &channel_aad("s", "kid", "k1"), &legacy_channel_aad("s", "k1"), &locator).is_err());
        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 0, "nothing left to do");
        // One nothing can open (another key) is left exactly as it is.
        let other = aes_gcm::Aes256Gcm::new_from_slice(&[6; 32]).unwrap();
        let unreadable = vault::seal(&other, &legacy_source_aad("s"), login).unwrap();
        conn.execute("UPDATE iptv_sources SET secret = ?1", [&unreadable]).unwrap();
        assert_eq!(reseal_legacy(&mut conn, &cipher).unwrap(), 0);
        let kept: Vec<u8> = conn.query_row("SELECT secret FROM iptv_sources WHERE id = 's'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, unreadable);
    }

    #[test]
    fn a_limit_that_turns_live_tv_off_stops_channels_in_rust() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("UPDATE profiles SET content_limit = 'kids', limit_live_tv = 0 WHERE id = 'main'", []).unwrap();
        assert_eq!(resolve(&conn, "main", "orbit-tv://s/k1").unwrap_err(), "err.iptv.live-tv-off");
        assert_eq!(resolve(&conn, "main", "orbit-tv://s/k1?start=1&end=2").unwrap_err(), "err.iptv.live-tv-off");
        // With Live TV allowed (or no limit), the address is looked up as before (here: there's no such source).
        conn.execute("UPDATE profiles SET limit_live_tv = 1 WHERE id = 'main'", []).unwrap();
        assert_ne!(resolve(&conn, "main", "orbit-tv://s/k1").unwrap_err(), "err.iptv.live-tv-off");
    }

    #[test]
    fn a_source_already_refreshing_says_so() {
        let busy = Refreshing::new();
        assert_eq!(busy.claim("s"), Ok(()));
        // A second refresh of it doesn't pass for one that ran (Settings would say "Updated").
        assert_eq!(busy.claim("s"), Err("err.iptv.refreshing".to_string()));
        assert_eq!(busy.claim("t"), Ok(()));
        busy.release("s");
        assert_eq!(busy.claim("s"), Ok(()));
    }

    #[test]
    fn a_failed_staging_write_keeps_nothing_more() {
        let mut staging = Staging::default();
        let writes = std::cell::Cell::new(0);
        // The second write fails (the source removed, the disk full): the guide is given up.
        let mut flush = |batch: &mut Vec<u32>| {
            writes.set(writes.get() + 1);
            batch.clear();
            if writes.get() == 2 { Err("err.iptv.source-gone".to_string()) } else { Ok(()) }
        };
        for p in 0..(STAGE_BATCH as u32 * 10) {
            staging.push(p, &mut flush);
            assert!(staging.batch.len() < STAGE_BATCH);
        }
        assert_eq!(writes.get(), 2);
        assert!(staging.batch.is_empty());
        assert_eq!(staging.finish(&mut flush), Err("err.iptv.source-gone".to_string()));
        assert_eq!(writes.get(), 2);
    }

    #[test]
    fn names_match_loosely_and_keys_are_stable() {
        assert_eq!(normalize("BBC One HD!"), "bbconehd");
        assert_eq!(fnv("News One|News"), fnv("News One|News"));
        assert_ne!(fnv("News One|News"), fnv("News Two|News"));
        assert_eq!(host_of("http://panel.example:8080/get.php?u=x"), ("panel.example:8080".to_string(), true));
        assert_eq!(host_of("https://p.example/list.m3u"), ("p.example".to_string(), false));
    }

    #[test]
    fn guides_are_the_persons_own_or_the_providers() {
        // A source saved before several guides kept its one in `epg`.
        let old: Secret = serde_json::from_str(r#"{"playlist":"http://p.example/list.m3u","epg":"https://g.example/a.xml","epg_auto":"https://h.example/b.xml"}"#).unwrap();
        assert_eq!(old.own_guides(), ["https://g.example/a.xml"]);
        assert_eq!(old.guide_addresses().unwrap().len(), 1);
        let mut secret = Secret { epg_auto: Some("https://h.example/1.xml".into()), epg_auto_more: vec!["https://h.example/2.xml".into()], ..old };
        secret.set_own_guides(vec![]);
        let urls: Vec<String> = secret.guide_addresses().unwrap().into_iter().map(String::from).collect();
        assert_eq!(urls, ["https://h.example/1.xml", "https://h.example/2.xml"]);
        assert_eq!(guides_of(&secret).fallback, "playlist");
        // An Xtream login's own guide, when the person gave none.
        let xtream = Secret { server: Some("http://panel.example:8080".into()), username: Some("u".into()), password: Some("p".into()), ..Default::default() };
        assert_eq!(xtream.guide_addresses().unwrap()[0].path(), "/xmltv.php");
        assert_eq!(guides_of(&xtream).fallback, "provider");
        // The page sees hosts, not addresses.
        let shown = serde_json::to_string(&guides_of(&Secret { guides: vec!["http://g.example:8080/epg?user=me&pass=secret".into()], ..Default::default() })).unwrap();
        assert!(shown.contains("g.example:8080") && !shown.contains("secret") && !shown.contains("user=me"));
    }

    #[test]
    fn a_providers_playlist_cannot_name_guides_on_the_lan() {
        let named = |playlist: &str| Secret {
            playlist: Some(playlist.into()),
            epg_auto: Some("http://192.168.1.1/admin".into()),
            epg_auto_more: vec!["http://localhost:8080/x.xml".into(), "https://g.example/guide.xml".into()],
            ..Default::default()
        };
        let public = named("http://p.example/list.m3u");
        let urls: Vec<String> = public.guide_addresses().unwrap().into_iter().map(String::from).collect();
        assert_eq!(urls, ["https://g.example/guide.xml"]);
        assert!(!public.guides_are_own() && !public.playlist_is_local());
        // A playlist on the LAN (a TV server at home) may name guides there too.
        assert_eq!(named("http://192.168.1.5:8000/list.m3u").guide_addresses().unwrap().len(), 3);
    }

    #[test]
    fn a_providers_playlist_cannot_point_streams_or_replays_into_the_lan() {
        let public = Secret { playlist: Some("http://p.example/list.m3u".into()), ..Default::default() };
        assert!(public.may_open("http://stream.example/1.ts"));
        for address in ["http://192.168.1.1/admin", "http://localhost:8080/x.ts", "http://[::1]/x", "http://10.0.0.2/live.m3u8", "http://stream.example@127.0.0.1/x"] {
            assert!(!public.may_open(address), "{address}");
        }
        // A catch-up template is filled in first, then checked as a whole.
        let window = catchup::Window { start: 990_000, end: 993_600, now: 1_000_000, offset: 0 };
        let replay = catchup::address("http://stream.example/1.ts", "default", Some("http://192.168.1.1/{utc}.ts"), window).unwrap();
        assert!(!public.may_open(replay.as_str()));
        let appended = catchup::address("http://stream.example", "append", Some("@192.168.1.1/{utc}.ts"), window).unwrap();
        assert!(!public.may_open(appended.as_str()));
        // A playlist on the LAN (a TV server at home) may name streams there too, as for guides.
        let home = Secret { playlist: Some("http://192.168.1.5:8000/list.m3u".into()), ..Default::default() };
        assert!(home.may_open("http://192.168.1.5:8000/1.ts"));
    }

    #[test]
    fn guides_are_added_moved_and_removed() {
        let mut g = Vec::new();
        let add = |u: &str| GuideChange::Add { url: u.into() };
        apply_guide_change(&mut g, add("https://a.example/1.xml")).unwrap();
        apply_guide_change(&mut g, add("http://b.example/2.xml.gz")).unwrap();
        assert!(apply_guide_change(&mut g, add("https://a.example/1.xml")).is_err());
        assert!(apply_guide_change(&mut g, add("file:///C:/x.xml")).is_err());
        apply_guide_change(&mut g, GuideChange::Up { index: 1 }).unwrap();
        assert_eq!(g, ["http://b.example/2.xml.gz", "https://a.example/1.xml"]);
        assert!(apply_guide_change(&mut g, GuideChange::Up { index: 0 }).is_err());
        assert!(apply_guide_change(&mut g, GuideChange::Remove { index: 2 }).is_err());
        apply_guide_change(&mut g, GuideChange::Remove { index: 0 }).unwrap();
        assert_eq!(g, ["https://a.example/1.xml"]);
        for n in 2..=MAX_GUIDES {
            apply_guide_change(&mut g, add(&format!("https://a.example/{n}.xml"))).unwrap();
        }
        assert!(apply_guide_change(&mut g, add("https://a.example/x.xml")).is_err());
    }

    #[test]
    fn replays_only_inside_the_archive() {
        let now = 1_000_000;
        let w = replay_window("start=990000&end=993600&tz=120", 1, now).unwrap();
        assert_eq!((w.start, w.end, w.now, w.offset), (990_000, 993_600, now, 7200));
        // Still airing: plays up to now.
        assert_eq!(replay_window("start=999000&end=1003600", 1, now).unwrap().end, now);
        assert!(replay_window("start=990000&end=993600", 0, now).is_err());
        assert!(replay_window("start=900000&end=903600", 1, now).is_err());
        assert!(replay_window("start=1000500&end=1003600", 1, now).is_err());
        assert!(replay_window("start=993600&end=990000", 1, now).is_err());
        assert!(replay_window("start=x&end=1", 1, now).is_err());
        assert_eq!(replay_window("start=990000&end=993600&tz=99999", 1, now).unwrap().offset, 14 * 3600);
    }

    fn favourites(conn: &Connection, profile: &str) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT key FROM iptv_favourites WHERE profile_id = ?1 ORDER BY position, key").unwrap();
        stmt.query_map([profile], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn guides_leave_out_hidden_and_locked_groups() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
        for (i, (key, group)) in [("news", Some("News")), ("sport", Some("Sport")), ("adult", Some("Adult")), ("none", None)].into_iter().enumerate() {
            conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, grp, epg_id) VALUES ('s', ?1, ?2, ?1, ?3, ?1)", params![key, i64::try_from(i).unwrap(), group]).unwrap();
            conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title) VALUES ('s', ?1, 100, 200, ?1)", params![key]).unwrap();
        }
        conn.execute("INSERT INTO iptv_groups (profile_id, name, hidden, locked) VALUES ('p', 'Sport', 1, 0), ('p', 'Adult', 0, 1)", []).unwrap();
        let channels = || ["news", "sport", "adult", "none"].map(|k| ("s".to_string(), k.to_string())).to_vec();
        let on_now = |unlocked: bool| -> Vec<String> { guide(&conn, "p", unlocked, channels(), 150).unwrap().into_iter().filter(|g| g.now.is_some()).map(|g| g.key).collect() };
        let scheduled = |unlocked: bool| -> Vec<String> { schedule(&conn, "p", unlocked, channels(), 0, 300).unwrap().into_iter().filter(|s| !s.programmes.is_empty()).map(|s| s.key).collect() };
        assert_eq!(on_now(false), ["news", "none"]);
        assert_eq!(scheduled(false), ["news", "none"]);
        // A locked group once opened; a hidden one stays out.
        assert_eq!(on_now(true), ["news", "adult", "none"]);
        assert_eq!(scheduled(true), ["news", "adult", "none"]);
    }

    /// A large provider: 19,000 channels in 400 groups, most with a guide of 40 programmes.
    fn big_lineup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'xtream', 'h', 0, x'00', 19000, 1)", []).unwrap();
        {
            let mut channel = tx.prepare("INSERT INTO iptv_channels (source_id, key, position, name, logo, grp, epg_id) VALUES ('s', ?1, ?2, ?3, ?4, ?5, ?6)").unwrap();
            let mut programme = tx.prepare("INSERT INTO iptv_programmes (source_id, channel, start, stop, title, gen) VALUES ('s', ?1, ?2, ?3, 'Show', 0)").unwrap();
            for i in 0..19_000_i64 {
                let epg = (i % 5 != 0).then(|| format!("ch{i}.example"));
                channel.execute(params![format!("k{i:05}"), i, format!("Channel {i}"), format!("https://logos.example/{i}.png"), format!("Group {}", i % 400), epg]).unwrap();
                if let Some(epg) = epg {
                    for n in 0..40 {
                        programme.execute(params![epg, n * 3600, (n + 1) * 3600]).unwrap();
                    }
                }
            }
        }
        tx.execute("INSERT INTO iptv_groups (profile_id, name, hidden, locked) VALUES ('p', 'Group 1', 1, 0), ('p', 'Group 2', 0, 1)", []).unwrap();
        tx.execute("INSERT INTO iptv_favourites (profile_id, source_id, key, position) VALUES ('p', 's', 'k00011', 0)", []).unwrap();
        tx.commit().unwrap();
        conn
    }

    #[test]
    fn channels_leave_out_hidden_and_locked_groups_and_mark_the_guide() {
        let conn = big_lineup();
        let shown = channels(&conn, "p", false).unwrap();
        // Two groups of 48 out: Group 1 hidden, and Group 2 locked until opened.
        assert_eq!(shown.len(), 19_000 - 2 * 48);
        assert_eq!(channels(&conn, "p", true).unwrap().len(), 19_000 - 48);
        assert!(shown.windows(2).all(|w| w[0].key < w[1].key));
        let eleven = shown.iter().find(|c| c.key == "k00011").unwrap();
        assert!(eleven.favourite && eleven.listed && eleven.rank == Some(0));
        assert!(!shown.iter().find(|c| c.key == "k00005").unwrap().listed);
        assert!(channels(&conn, "other", true).unwrap().is_empty());
    }

    /// Times `channels` on a large lineup: `cargo test --release -- --ignored channels_of_a_large_lineup --nocapture`.
    #[test]
    #[ignore = "a timing, not a check"]
    fn channels_of_a_large_lineup() {
        let conn = big_lineup();
        let plan: Vec<String> = conn
            .prepare("EXPLAIN QUERY PLAN SELECT c.source_id, c.key, c.name, c.logo, c.grp, f.key IS NOT NULL, EXISTS (SELECT 1 FROM iptv_programmes p WHERE p.source_id = c.source_id AND p.gen = s.guide_gen AND p.channel = c.epg_id), c.archive_days, f.position FROM iptv_channels c JOIN iptv_sources s ON s.id = c.source_id LEFT JOIN iptv_favourites f ON f.profile_id = s.profile_id AND f.source_id = c.source_id AND f.key = c.key LEFT JOIN iptv_groups g ON g.profile_id = s.profile_id AND g.name = c.grp WHERE s.profile_id = ?1 AND NOT COALESCE(g.hidden, 0) AND (?2 OR NOT COALESCE(g.locked, 0)) ORDER BY s.added_at, c.position")
            .unwrap()
            .query_map(params!["p", false], |r| r.get::<_, String>(3))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        println!("plan: {plan:#?}");
        let runs = 10;
        let start = std::time::Instant::now();
        for _ in 0..runs {
            assert!(channels(&conn, "p", false).unwrap().len() > 18_000);
        }
        println!("channels: {:?} per call", start.elapsed() / runs);
    }

    #[test]
    fn the_guide_grid_fills_a_long_window_of_short_programmes() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
        conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, epg_id) VALUES ('s', 'news', 0, 'News', 'n')", []).unwrap();
        // Fifteen-minute bulletins for a day and a half: 144 programmes.
        for i in 0..144_i64 {
            conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title) VALUES ('s', 'n', ?1, ?2, 'Bulletin')", params![i * 900, (i + 1) * 900]).unwrap();
        }
        let from = 0;
        let to = 36 * 3600;
        let got = schedule(&conn, "p", false, vec![("s".into(), "news".into())], from, to).unwrap();
        assert_eq!(got[0].programmes.len(), 144);
        assert_eq!(got[0].programmes.last().unwrap().stop, to);
        assert_eq!(schedule_limit(0, 3600), 100);
        assert_eq!(schedule_limit(0, 2 * 86_400), 576);
        assert_eq!(schedule_limit(0, i64::from(i32::MAX)), 600);
    }

    #[test]
    fn a_new_guide_shows_only_once_published_and_the_old_one_goes() {
        let path = std::env::temp_dir().join(format!("orbit-guide-test-{}.db", random_id().unwrap()));
        let db = Db::open(&path).unwrap();
        let shown = |db: &Db| -> Vec<String> { guide(&db.lock().unwrap(), "p", false, vec![("s".into(), "news".into())], 150).unwrap().into_iter().filter_map(|g| g.now.map(|s| s.title)).collect() };
        {
            let conn = db.lock().unwrap();
            conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
            conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, tvg_id, epg_id) VALUES ('s', 'news', 0, 'News', 'n1', 'n1')", []).unwrap();
            conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title, gen) VALUES ('s', 'n1', 100, 200, 'Old', 0), ('s', 'n1', 100, 200, 'New', 1)", []).unwrap();
        }
        assert_eq!(shown(&db), ["Old"]);
        let mut merge = guide_merge::GuideMerge::default();
        merge.ids.insert("n1".into());
        publish_guide(&db, "s", 1, &merge, None).unwrap();
        assert_eq!(shown(&db), ["New"]);
        let left: i64 = db.lock().unwrap().query_row("SELECT COUNT(*) FROM iptv_programmes", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 1);
        drop(db);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn a_removed_source_takes_no_more_rows_and_its_leftovers_are_swept() {
        let path = std::env::temp_dir().join(format!("orbit-guide-test-{}.db", random_id().unwrap()));
        let db = Db::open(&path).unwrap();
        let count = |db: &Db, table: &str, id: &str| -> i64 { db.lock().unwrap().query_row(&format!("SELECT COUNT(*) FROM {table} WHERE source_id = ?1"), [id], |r| r.get(0)).unwrap() };
        {
            let conn = db.lock().unwrap();
            conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('kept', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
            for id in ["kept", "gone", "old"] {
                conn.execute("INSERT INTO iptv_channels (source_id, key, position, name) VALUES (?1, 'c', 0, 'One')", [id]).unwrap();
                conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title, gen) VALUES (?1, 'c', 100, 200, 'A', 0), (?1, 'c', 100, 200, 'B', 1)", [id]).unwrap();
            }
        }
        // A guide refresh that outlived its source drops what it staged.
        assert!(publish_guide(&db, "gone", 1, &guide_merge::GuideMerge::default(), None).is_err());
        assert_eq!(count(&db, "iptv_programmes", "gone"), 0);
        // So does a channel refresh, rolled back whole.
        let fetched = [Fetched { key: "n".into(), key_before: None, name: "New".into(), logo: None, group: None, tvg_id: None, stream_id: None, locator: None, archive_days: 0 }];
        let sealed = SealedChannels { secret: vec![0], locators: vec![None] };
        assert!(store_channels(&mut db.lock().unwrap(), "gone", &fetched, &sealed).is_err());
        assert_eq!(count(&db, "iptv_channels", "gone"), 1);
        store_channels(&mut db.lock().unwrap(), "kept", &fetched, &sealed).unwrap();
        // The startup sweep clears every source that's gone and nothing else.
        sweep_orphans(&db).unwrap();
        sweep_orphans(&db).unwrap();
        for table in ["iptv_programmes", "iptv_channels"] {
            assert_eq!((count(&db, table, "gone"), count(&db, table, "old")), (0, 0), "{table}");
        }
        assert_eq!((count(&db, "iptv_programmes", "kept"), count(&db, "iptv_channels", "kept")), (2, 1));
        drop(db);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn new_channels_keep_their_guide_until_the_next_one_is_published() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
        conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, epg_id) VALUES ('s', 'news', 0, 'News', 'n1')", []).unwrap();
        conn.execute("INSERT INTO iptv_programmes (source_id, channel, start, stop, title) VALUES ('s', 'n1', 100, 200, 'Bulletin')", []).unwrap();
        let fetched = |key: &str, name: &str| Fetched { key: key.into(), key_before: None, name: name.into(), logo: None, group: None, tvg_id: None, stream_id: None, locator: None, archive_days: 0 };
        let sealed = SealedChannels { secret: vec![0], locators: vec![None, None] };
        // The day's channel refresh: the guide (downloaded next, or failing to) mustn't vanish meanwhile.
        store_channels(&mut conn, "s", &[fetched("news", "News"), fetched("film", "Film")], &sealed).unwrap();
        let on_now: Vec<Option<String>> = guide(&conn, "p", false, vec![("s".into(), "news".into()), ("s".into(), "film".into())], 150).unwrap().into_iter().map(|g| g.now.map(|s| s.title)).collect();
        assert_eq!(on_now, [Some("Bulletin".to_string()), None]);
    }

    #[test]
    fn a_latin1_channels_favourite_and_guide_move_to_its_new_key() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s', 'p', 'TV', 'm3u', 'h', 0, x'00', 0, 1)", []).unwrap();
        // Read before with a replacement character (key "old"), and "Other", whose key "kept" an old key mustn't take.
        conn.execute("INSERT INTO iptv_channels (source_id, key, position, name, epg_id) VALUES ('s', 'old', 0, 'Cha\u{fffd}ne', 'c1')", []).unwrap();
        for key in ["old", "kept"] {
            add_favourite(&conn, "p", "s", key).unwrap();
        }
        let fetched = |key: &str, before: Option<&str>| Fetched { key: key.into(), key_before: before.map(Into::into), name: key.into(), logo: None, group: None, tvg_id: None, stream_id: None, locator: None, archive_days: 0 };
        let sealed = SealedChannels { secret: vec![0], locators: vec![None, None, None] };
        store_channels(&mut conn, "s", &[fetched("new", Some("old")), fetched("kept", None), fetched("third", Some("kept"))], &sealed).unwrap();
        assert_eq!(favourites(&conn, "p"), ["new", "kept"]);
        let epg: Option<String> = conn.query_row("SELECT epg_id FROM iptv_channels WHERE key = 'new'", [], |r| r.get(0)).unwrap();
        assert_eq!(epg.as_deref(), Some("c1"));
        // The next refresh finds nothing under the old key: nothing changes.
        store_channels(&mut conn, "s", &[fetched("new", Some("old")), fetched("kept", None), fetched("third", Some("kept"))], &sealed).unwrap();
        assert_eq!(favourites(&conn, "p"), ["new", "kept"]);
    }

    #[test]
    fn vod_indexes_are_cleared_before_their_sources_go() {
        let path = std::env::temp_dir().join(format!("orbit-vod-drop-test-{}.db", random_id().unwrap()));
        let db = Db::open(&path).unwrap();
        let count = |db: &Db, id: &str| -> i64 { db.lock().unwrap().query_row("SELECT COUNT(*) FROM iptv_vod_index WHERE source_id = ?1", [id], |r| r.get(0)).unwrap() };
        {
            let conn = db.lock().unwrap();
            for (id, profile) in [("a", "p"), ("b", "p"), ("c", "q")] {
                conn.execute("INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at, vod_at) VALUES (?1, ?2, 'TV', 'xtream', 'h', 0, x'00', 0, 1, 1)", [id, profile]).unwrap();
                // More than one chunk, over two generations.
                conn.execute(
                    "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?2)
                     INSERT INTO iptv_vod_index (source_id, gen, kind, item_id, name, norm, ext) SELECT ?1, i % 2, 'movie', i, 'Film', 'film', 'mp4' FROM n",
                    params![id, DELETE_CHUNK as i64 + 10],
                )
                .unwrap();
            }
        }
        // One source, and only if it's the profile's own.
        assert!(drop_vod_indexes(&db, "q", Some("a")).unwrap().is_empty());
        assert_eq!(drop_vod_indexes(&db, "p", Some("a")).unwrap(), ["a"]);
        assert_eq!((count(&db, "a"), count(&db, "b"), count(&db, "c")), (0, DELETE_CHUNK as i64 + 11, DELETE_CHUNK as i64 + 11));
        // Marked unbuilt, so a source whose delete then fails rebuilds rather than looking built and empty.
        let built = |id: &str| -> Option<i64> { db.lock().unwrap().query_row("SELECT vod_at FROM iptv_sources WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
        assert_eq!((built("a"), built("b")), (None, Some(1)));
        // A whole profile; doing it again changes nothing.
        let mut cleared = drop_vod_indexes(&db, "p", None).unwrap();
        cleared.sort();
        assert_eq!(cleared, ["a", "b"]);
        assert_eq!(drop_vod_indexes(&db, "p", None).unwrap().len(), 2);
        assert_eq!((count(&db, "b"), count(&db, "c")), (0, DELETE_CHUNK as i64 + 11));
        drop(db);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn favourites_keep_the_order_they_are_given() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        for key in ["a", "b", "c", "d"] {
            add_favourite(&conn, "p1", "s", key).unwrap();
        }
        add_favourite(&conn, "p2", "s", "z").unwrap();
        // Adding twice changes nothing; new ones go last.
        add_favourite(&conn, "p1", "s", "a").unwrap();
        assert_eq!(favourites(&conn, "p1"), ["a", "b", "c", "d"]);

        let pair = |k: &str| ("s".to_string(), k.to_string());
        order_favourites(&mut conn, "p1", &[pair("c"), pair("a"), pair("nope")]).unwrap();
        // Left out (b, d) follow in their old order; other profiles are untouched.
        assert_eq!(favourites(&conn, "p1"), ["c", "a", "b", "d"]);
        assert_eq!(favourites(&conn, "p2"), ["z"]);
        add_favourite(&conn, "p1", "s", "e").unwrap();
        assert_eq!(favourites(&conn, "p1"), ["c", "a", "b", "d", "e"]);
    }
}
