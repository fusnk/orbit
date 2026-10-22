//! Bounded, credential-free Xtream metadata. Playback locators never leave Rust.
//!
//! A provider's film and series lists are kept as a local index
//! (`iptv_vod_index`, no credentials in it), built in the background and
//! rebuilt every 6 hours, so finding a title's IPTV copies is a database
//! lookup: it never waits on the provider's catalog (tens of megabytes).
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub year: Option<u16>,
    pub tmdb: Option<String>,
    pub imdb: Option<String>,
    pub ext: String,
}

#[derive(Deserialize)]
pub struct Request {
    pub id: String,
    pub name: String,
    pub year: Option<u16>,
    #[serde(skip)]
    pub tmdb: Option<String>,
    pub season: Option<u16>,
    pub episode: Option<u16>,
}

#[derive(Serialize)]
pub struct Found {
    pub provider: String,
    pub account: String,
    pub address: String,
    pub label: String,
    pub insecure: bool,
    /// What the provider says about the copy, as release-name words ("1080p · HEVC · 5.1") for the ranking.
    pub detail: Option<String>,
    /// Estimated from the provider's bitrate and running time.
    pub size: Option<u64>,
}

/// What a provider's media details say about one copy.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Quality {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<&'static str>,
    pub channels: Option<u32>,
    pub bytes: Option<u64>,
}

impl Quality {
    fn resolution(&self) -> Option<&'static str> {
        // Width first: a scope film is 1920×800, still 1080p.
        let (w, h) = (self.width.unwrap_or(0), self.height.unwrap_or(0));
        if w >= 3200 || h >= 1800 {
            Some("2160p")
        } else if w >= 1800 || h >= 1000 {
            Some("1080p")
        } else if w >= 1200 || h >= 700 {
            Some("720p")
        } else if w >= 640 || h >= 400 {
            Some("480p")
        } else {
            None
        }
    }
    pub fn detail(&self) -> Option<String> {
        let audio = match self.channels {
            Some(8) => Some("7.1"),
            Some(6) => Some("5.1"),
            Some(2) => Some("2.0"),
            _ => None,
        };
        let words: Vec<&str> = [self.resolution(), self.codec, audio].into_iter().flatten().collect();
        (!words.is_empty()).then(|| words.join(" · "))
    }
}

fn text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.chars().filter(|c| !c.is_control()).take(200).collect::<String>().trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
    .filter(|s| !s.is_empty())
}
fn digits(v: Option<&Value>) -> Option<String> {
    text(v).filter(|s| s.len() <= 16 && s.bytes().all(|b| b.is_ascii_digit()) && s != "0")
}
fn number(v: Option<&Value>) -> Option<u64> {
    digits(v).and_then(|s| s.parse().ok())
}
fn imdb(v: Option<&Value>) -> Option<String> {
    text(v).filter(|s| s.starts_with("tt") && s.len() <= 20 && s[2..].bytes().all(|b| b.is_ascii_digit()) && s.len() > 2)
}
fn year(v: Option<&Value>) -> Option<u16> {
    text(v).and_then(|s| s.get(..4)?.parse::<u16>().ok()).filter(|y| (1800..=2200).contains(y))
}
fn extension(v: Option<&Value>) -> Option<String> {
    text(v).filter(|s| matches!(s.as_str(), "mp4" | "mkv" | "avi" | "mov" | "ts" | "webm"))
}

/// Xtream's media details (`info.video`, `info.audio`, `info.bitrate` in kbps, `info.duration_secs`).
fn quality(info: Option<&Value>) -> Quality {
    let Some(info) = info else { return Quality::default() };
    let video = info.get("video");
    let small = |v: Option<&Value>| number(v).and_then(|n| u32::try_from(n).ok()).filter(|n| (1..=16_384).contains(n));
    let codec = text(video.and_then(|v| v.get("codec_name"))).and_then(|c| match c.to_ascii_lowercase().as_str() {
        "hevc" | "h265" => Some("HEVC"),
        "h264" | "avc" => Some("H.264"),
        "av1" => Some("AV1"),
        _ => None,
    });
    let kbps = number(info.get("bitrate")).filter(|k| (100..=200_000).contains(k));
    let secs = number(info.get("duration_secs")).filter(|s| (60..=36_000).contains(s));
    Quality {
        width: small(video.and_then(|v| v.get("width"))),
        height: small(video.and_then(|v| v.get("height"))),
        codec,
        channels: small(info.get("audio").and_then(|a| a.get("channels"))).filter(|c| *c <= 16),
        bytes: kbps.zip(secs).map(|(k, s)| k * 1000 / 8 * s),
    }
}

const TAGS: [&str; 15] = ["4k", "uhd", "fhd", "hd", "sd", "hdr", "2160p", "1080p", "720p", "480p", "hevc", "h265", "x265", "multi", "vostfr"];
fn is_tag(s: &str) -> bool {
    TAGS.contains(&s.trim().to_ascii_lowercase().as_str())
}
fn as_year(s: &str) -> Option<u16> {
    Some(s.trim()).filter(|s| s.len() == 4)?.parse::<u16>().ok().filter(|y| (1800..=2200).contains(y))
}

/// A provider's name for a title without its decorations: a leading
/// language or quality tag ("EN - ", "|EN|", "[4K]") and trailing tags and
/// year ("(2001)", "[FHD]", " 4K"). Returns the bare name and the year in it.
/// Anything else in brackets ("(Director's Cut)") is kept: it's part of the name.
fn strip(name: &str) -> (&str, Option<u16>) {
    let mut s = name.trim();
    let mut found = None;
    let short_upper = |t: &str| (2..=3).contains(&t.trim().len()) && t.trim().bytes().all(|b| b.is_ascii_uppercase());
    for _ in 0..6 {
        let before = s;
        if let Some((tag, rest)) = s.strip_prefix('[').and_then(|r| r.split_once(']'))
            && tag.len() <= 12
            && !rest.trim().is_empty()
        {
            s = rest.trim_start();
        } else if let Some((tag, rest)) = s.strip_prefix('|').and_then(|r| r.split_once('|'))
            && tag.len() <= 12
            && !rest.trim().is_empty()
        {
            s = rest.trim_start();
        } else if let Some((tag, rest)) = s.split_once(" - ").or_else(|| s.split_once('|'))
            && (short_upper(tag) || is_tag(tag))
            && !rest.trim().is_empty()
        {
            s = rest.trim_start();
        } else if let Some(inner) = s.strip_suffix(')').or_else(|| s.strip_suffix(']'))
            && let Some(at) = inner.rfind(['(', '['])
            && !inner[..at].trim().is_empty()
        {
            let tag = &inner[at + 1..];
            if let Some(y) = as_year(tag) {
                found = found.or(Some(y));
                s = inner[..at].trim_end();
            } else if tag.split([' ', ',', '/']).filter(|w| !w.is_empty()).all(is_tag) {
                s = inner[..at].trim_end();
            }
        } else if let Some((rest, last)) = s.rsplit_once(' ')
            && is_tag(last)
            && !rest.trim().is_empty()
        {
            s = rest.trim_end();
        }
        if s == before {
            break;
        }
    }
    (s, found)
}
pub fn normalized(name: &str) -> String {
    strip(name).0.to_lowercase().replace('&', " and ").chars().filter(|c| c.is_alphanumeric()).collect()
}

fn wanted_tmdb(request: &Request) -> Option<&str> {
    request.id.strip_prefix("tmdb:").or(request.tmdb.as_deref())
}
fn wanted_imdb(request: &Request) -> Option<&str> {
    request.id.starts_with("tt").then_some(request.id.as_str())
}

/// IDs take precedence. A conflicting supplied ID cannot be rescued by a title match.
fn identity(item: &Item, request: &Request) -> Option<bool> {
    let mut identified = false;
    if let (Some(wanted), Some(actual)) = (wanted_tmdb(request), item.tmdb.as_deref()) {
        if wanted != actual {
            return Some(false);
        }
        identified = true;
    }
    if let (Some(wanted), Some(actual)) = (wanted_imdb(request), item.imdb.as_deref()) {
        if wanted != actual {
            return Some(false);
        }
        identified = true;
    }
    identified.then_some(true)
}

/// Without an ID: the same name once decorations are gone, and a release
/// year both sides know, a year apart at most (release dates differ by
/// country). Never on the name alone.
pub fn matches(item: &Item, request: &Request) -> bool {
    if let Some(matched) = identity(item, request) {
        return matched;
    }
    let name = normalized(&request.name);
    !name.is_empty() && normalized(&item.name) == name && matches!((item.year, request.year), (Some(a), Some(b)) if a.abs_diff(b) <= 1)
}

/// Of several matches by name, those of the exact year win: a remake or a
/// namesake a year apart doesn't come along with the film.
fn best_of<T>(matched: Vec<T>, request: &Request, item: impl Fn(&T) -> &Item) -> Vec<T> {
    let by_name = |i: &Item| identity(i, request).is_none();
    let exact = matched.iter().any(|m| by_name(item(m)) && item(m).year == request.year);
    matched.into_iter().filter(|m| !exact || !by_name(item(m)) || item(m).year == request.year).collect()
}

pub fn catalog(body: &str, series: bool) -> Result<Vec<Item>, String> {
    let rows: Vec<Value> = serde_json::from_str(body).map_err(|_| "err.iptv.vod-unreadable")?;
    Ok(rows
        .into_iter()
        .take(100_000)
        .filter_map(|v| {
            let name = text(v.get("name"))?;
            let y = year(v.get("year"))
                .or_else(|| year(v.get("releaseDate")))
                .or_else(|| year(v.get("release_date")))
                .or_else(|| strip(&name).1);
            Some(Item {
                id: digits(v.get(if series { "series_id" } else { "stream_id" }))?,
                name,
                year: y,
                tmdb: digits(v.get("tmdb_id")).or_else(|| digits(v.get("tmdb"))),
                imdb: imdb(v.get("imdb_id")).or_else(|| imdb(v.get("imdb"))),
                ext: if series { String::new() } else { extension(v.get("container_extension"))? },
            })
        })
        .collect())
}

#[derive(Clone)]
pub struct Episode {
    pub id: String,
    pub season: u16,
    pub number: u16,
    pub ext: String,
    pub quality: Quality,
}
pub fn episodes(body: &str) -> Result<Vec<Episode>, String> {
    let root: Value = serde_json::from_str(body).map_err(|_| "err.iptv.vod-unreadable")?;
    let groups = root.get("episodes").and_then(Value::as_object).ok_or("err.iptv.vod-unreadable")?;
    Ok(groups
        .iter()
        .flat_map(|(season, list)| {
            list.as_array().into_iter().flatten().filter_map(move |v| {
                Some(Episode {
                    id: digits(v.get("id"))?,
                    season: text(v.get("season")).or_else(|| Some(season.clone()))?.parse().ok()?,
                    number: text(v.get("episode_num"))?.parse().ok()?,
                    ext: extension(v.get("container_extension"))?,
                    quality: quality(v.get("info")),
                })
            })
        })
        .take(10_000)
        .collect())
}

/// A film's media details (`get_vod_info`).
pub fn film_quality(body: &str) -> Result<Quality, String> {
    let root: Value = serde_json::from_str(body).map_err(|_| "Invalid film metadata")?;
    Ok(quality(root.get("info")))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = catalog(&text, false);
    let _ = catalog(&text, true);
    let _ = episodes(&text);
    let _ = film_quality(&text);
    let _ = normalized(&text);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ask(id: &str, name: &str, year: Option<u16>) -> Request {
        Request {
            id: id.into(),
            name: name.into(),
            year,
            tmdb: None,
            season: None,
            episode: None,
        }
    }
    fn film(name: &str, year: Option<u16>) -> Item {
        Item {
            id: "1".into(),
            name: name.into(),
            year,
            tmdb: None,
            imdb: None,
            ext: "mp4".into(),
        }
    }
    #[test]
    fn ids_override_titles_and_conflicts_do_not_fall_back() {
        let items = catalog(
            r#"[{"stream_id":1,"name":"Wrong name","tmdb_id":"42","imdb_id":"tt123","container_extension":"mkv","year":2000}]"#,
            false,
        )
        .unwrap();
        assert!(matches(&items[0], &ask("tmdb:42", "Other", None)));
        assert!(matches(&items[0], &ask("tt123", "Other", None)));
        assert!(!matches(&items[0], &ask("tmdb:99", "Wrong name", Some(2000))));
        assert!(!matches(&items[0], &ask("tt999", "Wrong name", Some(2000))));
        // A TMDB id found for an IMDb title is checked too.
        let mut request = ask("tt123", "Wrong name", Some(2000));
        request.tmdb = Some("7".into());
        assert!(!matches(&items[0], &request));
    }
    #[test]
    fn fallback_requires_normalized_title_and_a_close_known_year() {
        let item = catalog(r#"[{"stream_id":"1","name":"A Film! (2001)","container_extension":"mp4"}]"#, false)
            .unwrap()
            .remove(0);
        assert!(matches(&item, &ask("custom", "a film", Some(2001))));
        assert!(matches(&item, &ask("custom", "A Film", Some(2002))));
        assert!(matches(&item, &ask("custom", "A Film", Some(2000))));
        assert!(!matches(&item, &ask("custom", "a film", Some(2003))));
        assert!(!matches(&item, &ask("custom", "a film", Some(2020))));
        assert!(!matches(&item, &ask("custom", "a film", None)));
        // The provider not knowing the year is no match either.
        assert!(!matches(&film("A Film", None), &ask("custom", "A Film", Some(2001))));
    }
    #[test]
    fn provider_decorations_are_not_part_of_the_name() {
        for name in ["EN - The Matrix", "|EN| The Matrix", "[4K] The Matrix", "The Matrix (1999) [FHD]", "4K - The Matrix", "The Matrix 4K", "EN| The Matrix (1999)", "The Matrix (HD)"] {
            assert_eq!(normalized(name), "thematrix", "{name}");
        }
        assert_eq!(strip("The Matrix (1999) [FHD]").1, Some(1999));
        assert_eq!(normalized("Fast & Furious"), normalized("Fast and Furious"));
        // Part of the name: kept.
        assert_eq!(normalized("Blade Runner 2049"), "bladerunner2049");
        assert_eq!(normalized("(500) Days of Summer"), "500daysofsummer");
        assert_eq!(normalized("CSI: Miami"), "csimiami");
        assert_eq!(normalized("Alien (Director's Cut)"), "aliendirectorscut");
        assert_eq!(normalized("[4K]"), "4k");
    }
    #[test]
    fn guards_against_namesakes_and_sequels() {
        assert!(!matches(&film("The Matrix Reloaded (2003)", Some(2003)), &ask("custom", "The Matrix", Some(2003))));
        assert!(!matches(&film("Dune", Some(1984)), &ask("custom", "Dune", Some(2021))));
        assert!(!matches(&film("", Some(2021)), &ask("custom", "", Some(2021))));
        // Two by name, one of the exact year: only that one.
        let request = ask("custom", "Halloween", Some(2018));
        let kept = best_of(vec![film("Halloween", Some(2018)), film("Halloween", Some(2019))], &request, |i| i);
        assert_eq!(kept.iter().map(|i| i.year).collect::<Vec<_>>(), vec![Some(2018)]);
        // Only a year off: still offered.
        let kept = best_of(vec![film("Halloween", Some(2019))], &request, |i| i);
        assert_eq!(kept.len(), 1);
    }
    #[test]
    fn validates_locators_and_exact_episode_coordinates() {
        assert!(catalog("{}", false).is_err());
        assert!(
            catalog(
                r#"[{"stream_id":"../x","name":"A","container_extension":"mp4"},{"stream_id":2,"name":"B","container_extension":"mkv?password=x"}]"#,
                false
            )
            .unwrap()
            .is_empty()
        );
        let e = episodes(r#"{"episodes":{"0":[{"id":8,"episode_num":3,"container_extension":"mp4"},{"id":"../secret","episode_num":4,"container_extension":"mp4"}],"2":[{"id":"9","season":"2","episode_num":"3","container_extension":"mkv","info":{"video":{"width":1920,"height":1080,"codec_name":"hevc"}}}]}}"#).unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!((e[0].season, e[0].number, e[1].season, e[1].number), (0, 3, 2, 3));
        assert_eq!(e[1].quality.detail().as_deref(), Some("1080p · HEVC"));
    }
    #[test]
    fn media_details_become_ranking_words() {
        let q = film_quality(r#"{"info":{"video":{"codec_name":"h264","width":"1920","height":"800"},"audio":{"channels":6},"bitrate":"8000","duration_secs":"7200"}}"#).unwrap();
        assert_eq!(q.detail().as_deref(), Some("1080p · H.264 · 5.1"));
        assert_eq!(q.bytes, Some(7_200_000_000));
        let q = film_quality(r#"{"info":{"video":{"codec_name":"vp9","height":2160},"bitrate":0,"duration_secs":7200}}"#).unwrap();
        assert_eq!((q.detail().as_deref(), q.bytes), (Some("2160p"), None));
        assert_eq!(film_quality(r#"{"info":[]}"#).unwrap().detail(), None);
        assert!(film_quality("nope").is_err());
    }
}

use crate::{db::Db, library::now_ms, profiles::ActiveProfile};
use rusqlite::{Connection, params};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// How old the index may get before it's built again (in the background).
const REFRESH_MS: i64 = 6 * 3600 * 1000;
const REFRESH: Duration = Duration::from_secs(6 * 3600);
/// After a failed build or details request, how long before trying again.
const RETRY: Duration = Duration::from_secs(5 * 60);
/// A source lookup waits this long at most for a series' episode list it hasn't got yet.
const SERIES_WAIT: Duration = Duration::from_secs(4);
/// Index rows written per database lock.
const INSERT_CHUNK: usize = 5000;

/// What's kept in memory: builds under way, failures, and per-title details.
#[derive(Default)]
struct Memory {
    building: HashSet<String>,
    failed: HashMap<String, Instant>,
    /// (account, series id) → when, the series with its details' ids and year, its episodes.
    series: HashMap<(String, String), (Instant, Item, Vec<Episode>)>,
    /// (account, film id) → when it was asked for, and what came back (None while asking or when it failed).
    films: HashMap<(String, String), (Instant, Option<Quality>)>,
}
static MEMORY: LazyLock<Mutex<Memory>> = LazyLock::new(Default::default);
fn memory() -> Result<MutexGuard<'static, Memory>, String> {
    MEMORY.lock().map_err(|_| "VOD cache unavailable".to_string())
}

/// Forgets an account's details (it was removed, or switched off).
pub fn invalidate(id: &str) {
    if let Ok(mut m) = MEMORY.lock() {
        m.failed.remove(id);
        m.series.retain(|(account, _), _| account != id);
        m.films.retain(|(account, _), _| account != id);
    }
}

struct Account {
    id: String,
    name: String,
    insecure: bool,
    built_at: Option<i64>,
}
fn accounts(conn: &Connection, profile: &str) -> Result<Vec<Account>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, insecure, vod_at FROM iptv_sources WHERE profile_id = ?1 AND kind = 'xtream' AND use_vod = 1 ORDER BY added_at LIMIT 32")
        .map_err(|e| e.to_string())?;
    stmt.query_map([profile], |r| Ok(Account { id: r.get(0)?, name: r.get(1)?, insecure: r.get(2)?, built_at: r.get(3)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())
}

async fn fetch(login: &super::xtream::Login, action: &str, param: Option<(&str, &str)>, wait: Duration, limit: usize) -> Result<String, String> {
    let mut url = login.api(Some(action))?;
    if let Some((key, value)) = param {
        url.query_pairs_mut().append_pair(key, value);
    }
    tokio::time::timeout(wait, super::net::fetch_text(url, true, limit))
        .await
        .map_err(|_| "err.iptv.timeout")?
}
fn login(app: &AppHandle, profile: &str, id: &str) -> Result<super::xtream::Login, String> {
    let db = app.state::<Db>();
    let conn = db.lock()?;
    super::secret_of(&conn, profile, id)?.1.login().ok_or_else(|| "err.iptv.login-incomplete".to_string())
}

/// Starts building the account's index in the background when it's missing
/// or old, unless a build is under way or one failed lately. Never waits.
fn ensure(app: &AppHandle, profile: &str, account: &Account) {
    if account.built_at.is_some_and(|at| now_ms() - at < REFRESH_MS) {
        return;
    }
    let Ok(mut m) = memory() else { return };
    if m.building.contains(&account.id) || m.failed.get(&account.id).is_some_and(|at| at.elapsed() < RETRY) {
        return;
    }
    m.building.insert(account.id.clone());
    drop(m);
    let (app, profile, id) = (app.clone(), profile.to_string(), account.id.clone());
    tauri::async_runtime::spawn(async move {
        let result = build(&app, &profile, &id).await;
        if let Ok(mut m) = memory() {
            m.building.remove(&id);
            if result.is_err() {
                if m.failed.len() >= 32 {
                    m.failed.clear();
                }
                m.failed.insert(id, Instant::now());
            } else {
                m.failed.remove(&id);
            }
        }
    });
}

/// Downloads both catalogs, then writes them as the account's next index
/// generation (see `store_index`). If either fails, the old index stays.
async fn build(app: &AppHandle, profile: &str, id: &str) -> Result<(), String> {
    let login = login(app, profile, id)?;
    let wait = Duration::from_secs(90);
    let (movies, series) = tokio::join!(
        fetch(&login, "get_vod_streams", None, wait, 32 * 1024 * 1024),
        fetch(&login, "get_series", None, wait, 32 * 1024 * 1024)
    );
    let (movies, series, id) = (movies?, series?, id.to_string());
    super::with_db(app, move |db| {
        let (movies, series) = (catalog(&movies, false)?, catalog(&series, true)?);
        store_index(db, &id, &movies, &series).map(drop)
    })
    .await
}

/// Writes the index as the account's next generation, a chunk per lock (a
/// catalog can be 100,000 titles, and every other command waits while the
/// lock is held), then switches to it and clears the old one out. A lookup
/// only ever sees a whole generation. Returns false when the account was
/// switched off (or removed) meanwhile: nothing is kept then.
fn store_index(db: &Db, id: &str, movies: &[Item], series: &[Item]) -> Result<bool, String> {
    let live: i64 = db.lock()?.query_row("SELECT vod_gen FROM iptv_sources WHERE id = ?1", [id], |r| r.get(0)).map_err(|_| "err.iptv.source-gone")?;
    // Whatever an interrupted build left goes first.
    super::drop_generations(db, "iptv_vod_index", id, live + 1..=i64::MAX)?;
    let next = live + 1;
    let rows: Vec<(&str, &Item)> = movies.iter().map(|i| ("movie", i)).chain(series.iter().map(|i| ("series", i))).collect();
    for chunk in rows.chunks(INSERT_CHUNK) {
        {
            let mut conn = db.lock()?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            {
                let mut stmt = tx
                    .prepare_cached("INSERT INTO iptv_vod_index (source_id, gen, kind, item_id, name, norm, year, tmdb, imdb, ext) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
                    .map_err(|e| e.to_string())?;
                for (kind, item) in chunk {
                    let norm = normalized(&item.name);
                    if !norm.is_empty() {
                        stmt.execute(params![id, next, kind, item.id, item.name, norm, item.year, item.tmdb, item.imdb, item.ext]).map_err(|e| e.to_string())?;
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
        // A std mutex isn't fair: without a pause this thread could take the lock straight back.
        std::thread::sleep(Duration::from_millis(1));
    }
    let published = db
        .lock()?
        .execute("UPDATE iptv_sources SET vod_gen = ?2, vod_at = ?3 WHERE id = ?1 AND use_vod = 1", params![id, next, now_ms()])
        .map_err(|e| e.to_string())?
        > 0;
    if published {
        super::drop_generations(db, "iptv_vod_index", id, i64::MIN..=live)?;
    } else {
        super::drop_generations(db, "iptv_vod_index", id, next..=next)?;
    }
    Ok(published)
}

/// The index's titles that could be `request`'s: same name, or the same ID.
fn candidates(conn: &Connection, source: &str, kind: &str, request: &Request) -> Result<Vec<Item>, String> {
    let norm = Some(normalized(&request.name)).filter(|n| !n.is_empty());
    let mut stmt = conn
        .prepare_cached(
            "SELECT i.item_id, i.name, i.year, i.tmdb, i.imdb, i.ext FROM iptv_vod_index i JOIN iptv_sources s ON s.id = i.source_id AND i.gen = s.vod_gen
             WHERE i.source_id = ?1 AND i.kind = ?2 AND (i.norm = ?3 OR i.tmdb = ?4 OR i.imdb = ?5) LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![source, kind, norm, wanted_tmdb(request), wanted_imdb(request)], |r| {
        Ok(Item { id: r.get(0)?, name: r.get(1)?, year: r.get(2)?, tmdb: r.get(3)?, imdb: r.get(4)?, ext: r.get(5)? })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<_, _>>()
    .map_err(|e| e.to_string())
}

/// A series is checked against its details (IDs and year are often only
/// there), so the catalog's name is enough to ask for them, an ID that
/// disagrees is not.
fn series_candidates(items: Vec<Item>, request: &Request) -> Vec<Item> {
    let name = normalized(&request.name);
    items
        .into_iter()
        .filter(|i| match identity(i, request) {
            Some(matched) => matched,
            None => !name.is_empty() && normalized(&i.name) == name,
        })
        .take(5)
        .collect()
}

fn known_series(account: &str, series: &str) -> Option<(Item, Vec<Episode>)> {
    let m = memory().ok()?;
    m.series.get(&(account.into(), series.into())).filter(|(at, _, _)| at.elapsed() < REFRESH).map(|(_, item, list)| (item.clone(), list.clone()))
}
async fn fetch_series(login: &super::xtream::Login, account: &str, item: &Item, wait: Duration) -> Option<(Item, Vec<Episode>)> {
    let fetched = fetch(login, "get_series_info", Some(("series_id", &item.id)), wait, 8 * 1024 * 1024)
        .await
        .ok()
        .and_then(|body| series_info(item, &body).ok());
    if let Ok(mut m) = memory() {
        remember_series(&mut m, (account.into(), item.id.clone()), Instant::now(), fetched.clone());
    }
    fetched
}

/// A film's media details, if known; with `ask`, asks for them in the
/// background if not (they're for ranking, so a lookup never waits on them).
fn film_details(app: &AppHandle, profile: &str, account: &str, film: &str, ask: bool) -> Option<Quality> {
    let key = (account.to_string(), film.to_string());
    let mut m = memory().ok()?;
    if let Some((at, known)) = m.films.get(&key)
        && at.elapsed() < if known.is_some() { REFRESH } else { RETRY }
    {
        return known.clone();
    }
    if !ask {
        return None;
    }
    if m.films.len() >= 512 {
        m.films.clear();
    }
    // Marked as asked, so a second lookup meanwhile doesn't ask again.
    m.films.insert(key.clone(), (Instant::now(), None));
    drop(m);
    let (app, profile) = (app.clone(), profile.to_string());
    tauri::async_runtime::spawn(async move {
        let Ok(login) = login(&app, &profile, &key.0) else { return };
        let quality = fetch(&login, "get_vod_info", Some(("vod_id", &key.1)), Duration::from_secs(10), 2 * 1024 * 1024)
            .await
            .ok()
            .and_then(|body| film_quality(&body).ok());
        if let (Some(quality), Ok(mut m)) = (quality, memory()) {
            m.films.insert(key, (Instant::now(), Some(quality)));
        }
    });
    None
}

/// Checks a request from the page.
fn check(request: &Request) -> Result<(), String> {
    if request.id.len() > 200 || request.name.len() > 400 || request.season.is_some() != request.episode.is_some() {
        return Err("invalid VOD request".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn iptv_vod_enable(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, on: bool) -> Result<(), String> {
    let profile = active.id()?;
    {
        let conn = db.lock()?;
        let changed = conn
            .execute(
                "UPDATE iptv_sources SET use_vod = ?3, vod_at = NULL WHERE id = ?1 AND profile_id = ?2 AND kind = 'xtream'",
                params![id, profile, on],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("err.iptv.source-gone".into());
        }
        conn.execute("DELETE FROM iptv_vod_locators WHERE source_id = ?1", [&id]).map_err(|e| e.to_string())?;
    }
    invalidate(&id);
    // Nothing of a switched-off account's catalog is kept; switched on, it's built again when first needed.
    super::with_db(&app, move |db| super::drop_generations(db, "iptv_vod_index", &id, i64::MIN..=i64::MAX)).await
}

/// Opening a title's page: builds a missing or old index in the background
/// and, once there is one, fetches the matching titles' details (a series'
/// episodes, a film's quality) so its sources are ready by the time the
/// person asks. Returns at once.
#[tauri::command]
pub async fn iptv_vod_prepare(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, mut request: Request, series: bool) -> Result<(), String> {
    check(&request)?;
    let profile = active.id()?;
    let accounts = accounts(&*db.lock()?, &profile)?;
    for account in &accounts {
        ensure(&app, &profile, account);
    }
    if accounts.iter().all(|a| a.built_at.is_none()) {
        return Ok(());
    }
    tauri::async_runtime::spawn(async move {
        request.tmdb = crate::tmdb::vod_identity(&request.id, series).await.map(|id| id.to_string());
        for account in accounts.iter().filter(|a| a.built_at.is_some()) {
            let kind = if series { "series" } else { "movie" };
            let Ok(items) = app.state::<Db>().lock().and_then(|conn| candidates(&conn, &account.id, kind, &request)) else { continue };
            if series {
                let Ok(login) = login(&app, &profile, &account.id) else { continue };
                for item in series_candidates(items, &request).into_iter().take(3) {
                    if known_series(&account.id, &item.id).is_none() {
                        fetch_series(&login, &account.id, &item, Duration::from_secs(12)).await;
                    }
                }
            } else {
                let matched = best_of(items.into_iter().filter(|i| matches(i, &request)).collect(), &request, |i| i);
                for item in matched.iter().take(3) {
                    film_details(&app, &profile, &account.id, &item.id, true);
                }
            }
        }
    });
    Ok(())
}

/// The title's copies in the profile's IPTV accounts, from their indexes.
/// Waits only for a matching series' episode list it hasn't got (a few
/// seconds at most); an account without an index yet starts building one
/// and offers nothing this time.
#[tauri::command]
pub async fn iptv_vod_sources(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, mut request: Request) -> Result<Vec<Found>, String> {
    check(&request)?;
    let profile = active.id()?;
    let accounts = accounts(&*db.lock()?, &profile)?;
    for account in &accounts {
        ensure(&app, &profile, account);
    }
    let accounts: Vec<Account> = accounts.into_iter().filter(|a| a.built_at.is_some()).collect();
    if accounts.is_empty() {
        return Ok(Vec::new());
    }
    request.tmdb = crate::tmdb::vod_identity(&request.id, request.season.is_some()).await.map(|id| id.to_string());
    let request = std::sync::Arc::new(request);
    let mut tasks = tokio::task::JoinSet::new();
    for account in accounts {
        let (app, profile, request) = (app.clone(), profile.clone(), request.clone());
        tasks.spawn(async move {
            tokio::time::timeout(Duration::from_secs(6), lookup(&app, &profile, &account, &request))
                .await
                .map_err(|_| "IPTV source lookup timed out".to_string())?
        });
    }
    let mut found = Vec::new();
    while let Some(result) = tasks.join_next().await {
        if let Ok(Ok(items)) = result {
            found.extend(items);
        }
    }
    Ok(found)
}

/// (stream id, extension, kind, label, details) of one copy.
type Locator = (String, String, &'static str, String, Quality);

async fn lookup(app: &AppHandle, profile: &str, account: &Account, request: &Request) -> Result<Vec<Found>, String> {
    let kind = if request.season.is_some() { "series" } else { "movie" };
    let items = candidates(&*app.state::<Db>().lock()?, &account.id, kind, request)?;
    let mut locators: Vec<Locator> = Vec::new();
    if let (Some(season), Some(number)) = (request.season, request.episode) {
        let mut matched = Vec::new();
        let mut signed_in = None;
        for item in series_candidates(items, request) {
            let info = match known_series(&account.id, &item.id) {
                Some(info) => Some(info),
                None => {
                    if signed_in.is_none() {
                        signed_in = Some(login(app, profile, &account.id)?);
                    }
                    fetch_series(signed_in.as_ref().ok_or("Incomplete IPTV login")?, &account.id, &item, SERIES_WAIT).await
                }
            };
            if let Some((detail, list)) = info.filter(|(detail, _)| matches(detail, request)) {
                matched.push((detail, list));
            }
        }
        for (detail, list) in best_of(matched, request, |(detail, _)| detail) {
            for e in list.iter().filter(|e| e.season == season && e.number == number).take(20) {
                locators.push((e.id.clone(), e.ext.clone(), "series", detail.name.clone(), e.quality.clone()));
            }
        }
    } else {
        let matched = best_of(items.into_iter().filter(|i| matches(i, request)).collect(), request, |i| i);
        // Details are asked for the first few only: a film listed 20 times shouldn't mean 20 requests at once.
        for (n, item) in matched.into_iter().take(20).enumerate() {
            let quality = film_details(app, profile, &account.id, &item.id, n < 3).unwrap_or_default();
            locators.push((item.id, item.ext, "movie", item.name, quality));
        }
    }
    let db = app.state::<Db>();
    let mut conn = db.lock()?;
    store_locators(&mut conn, profile, account, locators)
}

/// Keeps the copies' locators (stream id, extension) for the relay, which
/// alone turns them into the provider's address. One transaction: a match
/// can be many locators, each otherwise its own disk sync.
fn store_locators(conn: &mut Connection, profile: &str, account: &Account, locators: Vec<Locator>) -> Result<Vec<Found>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // Disable/delete/profile changes during the lookup cannot resurrect sources.
    let enabled: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM iptv_sources WHERE id=?1 AND profile_id=?2 AND use_vod=1)",
            params![account.id, profile],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !enabled {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for (stream, ext, kind, label, quality) in locators {
        let key = format!("{kind}-{stream}-{ext}");
        tx.execute(
            "INSERT OR REPLACE INTO iptv_vod_locators(source_id, key, stream_id, ext, kind) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![account.id, key, stream, ext, kind],
        )
        .map_err(|e| e.to_string())?;
        found.push(Found {
            provider: account.name.clone(),
            account: account.id.clone(),
            address: format!("{}{}/vod/{}", super::SCHEME, account.id, key),
            label,
            insecure: account.insecure,
            detail: quality.detail(),
            size: quality.bytes,
        });
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(found)
}

pub fn resolve(conn: &rusqlite::Connection, profile: &str, source: &str, key: &str) -> Result<(String, Option<String>, Option<String>), String> {
    let (stream, ext, kind): (String, String, String) = conn.query_row(
        "SELECT v.stream_id, v.ext, v.kind FROM iptv_vod_locators v JOIN iptv_sources s ON s.id=v.source_id WHERE s.id=?1 AND s.profile_id=?2 AND s.kind='xtream' AND s.use_vod=1 AND v.key=?3",
        params![source, profile, key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| "err.iptv.vod-off")?;
    let login = super::secret_of(conn, profile, source)?.1.login().ok_or("Incomplete IPTV login")?;
    Ok((login.vod(&kind, &stream, &ext)?.into(), None, None))
}

fn series_info(item: &Item, body: &str) -> Result<(Item, Vec<Episode>), String> {
    let root: Value = serde_json::from_str(body).map_err(|_| "Invalid series metadata")?;
    let info = root.get("info");
    let mut detail = item.clone();
    if let Some(info) = info {
        detail.tmdb = digits(info.get("tmdb_id")).or_else(|| digits(info.get("tmdb"))).or(detail.tmdb);
        detail.imdb = imdb(info.get("imdb_id")).or_else(|| imdb(info.get("imdb"))).or(detail.imdb);
        detail.year = year(info.get("year"))
            .or_else(|| year(info.get("releaseDate")))
            .or_else(|| year(info.get("release_date")))
            .or(detail.year);
    }
    Ok((detail, episodes(body)?))
}

/// Keeps a series' fetched details; a failed fetch keeps what was there.
fn remember_series(m: &mut Memory, key: (String, String), now: Instant, fetched: Option<(Item, Vec<Episode>)>) {
    if let Some((detail, list)) = fetched {
        if m.series.len() >= 64 && !m.series.contains_key(&key) {
            m.series.clear();
        }
        m.series.insert(key, (now, detail, list));
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    fn db() -> Db {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at, use_vod) VALUES ('s','p','TV','xtream','panel',1,x'00',0,0,1)",
                [],
            )
            .unwrap();
        db
    }
    fn ask(id: &str, name: &str, year: Option<u16>) -> Request {
        Request { id: id.into(), name: name.into(), year, tmdb: None, season: None, episode: None }
    }
    #[test]
    fn series_info_supplies_identifiers_and_release_year() {
        let item = catalog(r#"[{"series_id":4,"name":"A Show"}]"#, true).unwrap().remove(0);
        let (detail, list) = series_info(
            &item,
            r#"{"info":{"tmdb":"42","releaseDate":"2005-01-01"},"episodes":{"1":[{"id":8,"episode_num":2,"container_extension":"mp4"}]}}"#,
        )
        .unwrap();
        let mut request = Request {
            id: "tmdb:42".into(),
            name: "Another title".into(),
            year: None,
            tmdb: None,
            season: Some(1),
            episode: Some(2),
        };
        assert!(matches(&detail, &request));
        request.id = "custom".into();
        request.name = "a show".into();
        request.year = Some(2005);
        assert!(matches(&detail, &request));
        assert_eq!((list[0].season, list[0].number), (1, 2));
        request.id = "tt123".into();
        request.tmdb = Some("99".into());
        assert!(!matches(&detail, &request));
    }
    #[test]
    fn locators_require_owner_and_enabled_account() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s','p','TV','xtream','panel',1,x'00',0,0)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO iptv_vod_locators VALUES ('s','movie-1-mp4','1','mp4','movie')", []).unwrap();
        assert_eq!(resolve(&conn, "p", "s", "movie-1-mp4").unwrap_err(), "err.iptv.vod-off");
        conn.execute("UPDATE iptv_sources SET use_vod=1 WHERE id='s'", []).unwrap();
        assert_eq!(resolve(&conn, "other", "s", "movie-1-mp4").unwrap_err(), "err.iptv.vod-off");
        conn.execute("DELETE FROM iptv_sources WHERE id='s'", []).unwrap();
        assert_eq!(resolve(&conn, "p", "s", "movie-1-mp4").unwrap_err(), "err.iptv.vod-off");
    }
    #[test]
    fn catalogs_skip_hls_and_do_not_return_provider_urls() {
        let items = catalog(r#"[{"stream_id":1,"name":"A","container_extension":"m3u8","direct_source":"http://secret/x"},{"stream_id":2,"name":"B","container_extension":"mp4","direct_source":"http://secret/x"}]"#, false).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2");
        let db = db();
        let account = Account { id: "s".into(), name: "TV".into(), insecure: true, built_at: Some(0) };
        let found = store_locators(&mut db.lock().unwrap(), "p", &account, vec![(items[0].id.clone(), items[0].ext.clone(), "movie", items[0].name.clone(), Quality::default())]).unwrap();
        assert_eq!(found[0].address, "orbit-tv://s/vod/movie-2-mp4");
        let json = serde_json::to_string(&found).unwrap();
        assert!(!json.contains("http:") && !json.contains("secret"));
        // Another profile's lookup can't add locators to this account.
        assert!(store_locators(&mut db.lock().unwrap(), "other", &account, vec![("3".into(), "mp4".into(), "movie", "C".into(), Quality::default())]).unwrap().is_empty());
    }
    #[test]
    fn index_is_stored_as_one_generation_and_looked_up_by_id_or_name() {
        let db = db();
        let movies = catalog(
            r#"[{"stream_id":1,"name":"EN - The Matrix (1999)","container_extension":"mkv"},{"stream_id":2,"name":"Other","tmdb":"603","container_extension":"mp4"},{"stream_id":3,"name":"[4K]","container_extension":"mp4"}]"#,
            false,
        )
        .unwrap();
        let series = catalog(r#"[{"series_id":9,"name":"The Matrix"}]"#, true).unwrap();
        assert!(store_index(&db, "s", &movies, &series).unwrap());
        let conn = db.lock().unwrap();
        let by_name = candidates(&conn, "s", "movie", &ask("custom", "The Matrix", Some(1999))).unwrap();
        assert_eq!(by_name.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["1"]);
        let by_id = candidates(&conn, "s", "movie", &ask("tmdb:603", "Nothing alike", None)).unwrap();
        assert_eq!(by_id.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["2"]);
        assert_eq!(candidates(&conn, "s", "series", &ask("custom", "The Matrix", None)).unwrap().len(), 1);
        // A name-less request finds nothing by name.
        assert!(candidates(&conn, "s", "movie", &ask("custom", "", None)).unwrap().is_empty());
        let built: Option<i64> = conn.query_row("SELECT vod_at FROM iptv_sources WHERE id='s'", [], |r| r.get(0)).unwrap();
        assert!(built.is_some());
        drop(conn);
        // A rebuild replaces the old generation entirely.
        assert!(store_index(&db, "s", &movies[1..2], &[]).unwrap());
        let conn = db.lock().unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM iptv_vod_index WHERE source_id='s'", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
        assert!(candidates(&conn, "s", "movie", &ask("custom", "The Matrix", Some(1999))).unwrap().is_empty());
    }
    #[test]
    fn index_of_an_account_switched_off_meanwhile_is_dropped() {
        let db = db();
        db.lock().unwrap().execute("UPDATE iptv_sources SET use_vod = 0", []).unwrap();
        let movies = catalog(r#"[{"stream_id":1,"name":"A","container_extension":"mkv"}]"#, false).unwrap();
        assert!(!store_index(&db, "s", &movies, &[]).unwrap());
        let rows: i64 = db.lock().unwrap().query_row("SELECT COUNT(*) FROM iptv_vod_index", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        // Removing the account takes its index with it.
        db.lock().unwrap().execute("UPDATE iptv_sources SET use_vod = 1", []).unwrap();
        assert!(store_index(&db, "s", &movies, &[]).unwrap());
        db.lock().unwrap().execute("DELETE FROM iptv_sources WHERE id = 's'", []).unwrap();
        let rows: i64 = db.lock().unwrap().query_row("SELECT COUNT(*) FROM iptv_vod_index", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }
    #[test]
    fn new_xtream_accounts_offer_their_films_by_default() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        // The column's own default stays off: accounts from before keep their choice (see `iptv_add`).
        conn.execute(
            "INSERT INTO iptv_sources (id, profile_id, name, kind, host, insecure, secret, channel_count, added_at) VALUES ('s','p','TV','xtream','panel',1,x'00',0,0)",
            [],
        )
        .unwrap();
        let on: bool = conn.query_row("SELECT use_vod FROM iptv_sources WHERE id='s'", [], |r| r.get(0)).unwrap();
        assert!(!on);
        assert!(super::super::offers_vod("xtream") && !super::super::offers_vod("m3u"));
    }
}

#[cfg(test)]
mod failure_tests {
    use super::*;
    #[test]
    fn failed_duplicate_or_refresh_keeps_successful_series_matches() {
        let mut m = Memory::default();
        let item = catalog(r#"[{"series_id":1,"name":"A Show","tmdb":42}]"#, true).unwrap().remove(0);
        let list = vec![Episode {
            id: "8".into(),
            season: 1,
            number: 2,
            ext: "mp4".into(),
            quality: Quality::default(),
        }];
        let key = |s: &str| ("a".to_string(), s.to_string());
        remember_series(&mut m, key("1"), Instant::now(), Some((item, list)));
        remember_series(&mut m, key("broken-duplicate"), Instant::now(), None);
        remember_series(&mut m, key("1"), Instant::now(), None);
        let (_, item, list) = m.series.get(&key("1")).unwrap();
        assert!(matches(
            item,
            &Request {
                id: "tmdb:42".into(),
                name: "different name".into(),
                year: None,
                tmdb: None,
                season: Some(1),
                episode: Some(2)
            }
        ));
        assert_eq!((list[0].season, list[0].number), (1, 2));
        assert!(!m.series.contains_key(&key("broken-duplicate")));
    }
    #[test]
    fn series_need_a_name_or_id_match_before_their_details_are_asked_for() {
        let items = catalog(r#"[{"series_id":1,"name":"EN - A Show"},{"series_id":2,"name":"A Show","tmdb":"7"},{"series_id":3,"name":"Other","tmdb":"42"},{"series_id":4,"name":"Unrelated"}]"#, true).unwrap();
        let request = Request { id: "tmdb:42".into(), name: "A Show".into(), year: None, tmdb: None, season: Some(1), episode: Some(1) };
        let ids: Vec<String> = series_candidates(items, &request).into_iter().map(|i| i.id).collect();
        assert_eq!(ids, vec!["1", "3"]);
    }
}
