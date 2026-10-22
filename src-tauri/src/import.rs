//! Importing from a Letterboxd or Trakt data export (the .zip each site lets
//! members download): films and episodes watched become watch history, and
//! the watchlist goes into My Library. The file is read here, on this PC;
//! nothing is uploaded. Reading makes a plan the page shows as a summary;
//! nothing is saved until the person confirms it.
//!
//! The file is untrusted: only the few files Orbit needs are read, each with
//! a size cap, and every title id is checked before it's stored.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::Mutex;

use rusqlite::params;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, State};

use crate::db::Db;
use crate::iptv::xmltv::parse_time;
use crate::letterboxd::{Film, match_films};
use crate::profiles::ActiveProfile;

/// Exports with years of history are a few MB; this leaves plenty of room.
const MAX_ZIP: usize = 100 * 1024 * 1024;
const MAX_FILE: u64 = 64 * 1024 * 1024;
/// Files read; entries in all (a Letterboxd export has one per list, in `lists/`) may be more.
const MAX_FILES: usize = 400;
const MAX_ENTRIES: usize = 20_000;
/// All files together, once inflated: a small zip can't fill memory with many big entries.
const MAX_TOTAL: u64 = 128 * 1024 * 1024;
const MAX_ITEMS: usize = 50_000;
const MAX_TEXT: usize = 300;
/// Sent while Letterboxd films are matched: [done, to do].
const PROGRESS_EVENT: &str = "import://progress";

#[derive(Clone, Debug, PartialEq)]
struct Item {
    imdb: String,
    /// "movie" or "series", as Stremio names them.
    kind: &'static str,
    name: String,
    year: Option<String>,
    poster: Option<String>,
    /// When it was watched or added, ms since the epoch.
    at: i64,
}

#[derive(Clone, Debug, PartialEq)]
struct Episode {
    show: String,
    season: i64,
    episode: i64,
    at: i64,
}

#[derive(Default, Debug)]
pub struct Plan {
    source: &'static str,
    movies: Vec<Item>,
    /// Shows with any watched episode, and whether every aired episode is watched.
    shows: Vec<(Item, bool)>,
    episodes: Vec<Episode>,
    watchlist: Vec<Item>,
    unmatched: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    source: &'static str,
    movies: usize,
    shows: usize,
    episodes: usize,
    watchlist: usize,
    unmatched: usize,
    /// A few of the titles that couldn't be found, to show.
    unmatched_names: Vec<String>,
}

/// The plan waiting for the person to confirm it.
#[derive(Default)]
pub struct Pending(Mutex<Option<Plan>>);

fn clip(text: &str) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()
}

fn imdb(id: &str) -> Option<String> {
    crate::skip::check_imdb_id(id).ok().map(|()| id.to_string())
}

/// Cinemeta's poster for an IMDb id (what its catalogs use).
fn poster(imdb: &str) -> String {
    format!("https://images.metahub.space/poster/medium/{imdb}/img")
}

/// "2026-01-04" or "2024-01-03T21:34:56.000Z" as ms since the epoch (UTC).
fn date_ms(text: &str) -> Option<i64> {
    let mut digits: String = text.chars().filter(char::is_ascii_digit).take(14).collect();
    if digits.len() == 8 {
        digits.push_str("000000");
    }
    parse_time(&digits).map(|s| s * 1000)
}

/// The header carrying the page's `Date#getTimezoneOffset()` (minutes, UTC minus local).
const UTC_OFFSET_HEADER: &str = "x-utc-offset";
/// The furthest any time zone is from UTC (UTC+14, UTC-12), in minutes.
const MAX_OFFSET_MIN: i64 = 14 * 60;

/// A Letterboxd date. A day without a time ("2026-01-04") is noon on that day
/// in the person's time zone (`utc_offset_min` as `getTimezoneOffset` gives
/// it), not midnight UTC: midnight UTC is the evening before in the Americas,
/// and 1 am in Berlin, which Stats would count as the hour it was watched.
/// Noon stays on the right day everywhere, even when the offset is today's
/// rather than that day's (summer time moves it an hour).
fn day_ms(text: &str, utc_offset_min: i64) -> Option<i64> {
    let digits = text.chars().filter(char::is_ascii_digit).count();
    let at = date_ms(text)?;
    Some(if digits == 8 { at + (12 * 60 + utc_offset_min) * 60_000 } else { at })
}

/// The text files of a zip Orbit might read, by lower-case name. Only those at
/// the top: what Orbit reads is there, and folders hold what it doesn't (each
/// Letterboxd list, deleted and orphaned entries, a Mac's `__MACOSX` metadata,
/// which isn't text and would fail the whole import).
fn read_zip(bytes: &[u8]) -> Result<HashMap<String, String>, String> {
    read_zip_capped(bytes, MAX_TOTAL)
}

fn read_zip_capped(bytes: &[u8], max_total: u64) -> Result<HashMap<String, String>, String> {
    let too_large = || "err.import.too-large".to_string();
    let mut total = 0u64;
    let bad = || "err.import.not-export".to_string();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| bad())?;
    if archive.len() > MAX_ENTRIES {
        return Err(bad());
    }
    let mut files = HashMap::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|_| bad())?;
        let name = file.name().map_err(|_| bad())?.to_ascii_lowercase();
        let wanted = (name.ends_with(".csv") || name.ends_with(".json")) && !name.contains(['/', '\\']);
        if !wanted || !file.is_file() {
            continue;
        }
        if files.len() == MAX_FILES {
            return Err(bad());
        }
        let mut text = String::new();
        // `take` caps what's inflated, whatever the entry claims its size is.
        let cap = MAX_FILE.min(max_total - total);
        (&mut file).take(cap + 1).read_to_string(&mut text).map_err(|_| bad())?;
        if text.len() as u64 > cap {
            return Err(too_large());
        }
        total += text.len() as u64;
        files.insert(name, text);
    }
    Ok(files)
}

/// Rows of a CSV file (quoted fields may hold commas, quotes and line breaks).
fn csv(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(c) = chars.next() {
        match (quoted, c) {
            (true, '"') if chars.peek() == Some(&'"') => {
                chars.next();
                field.push('"');
            }
            (true, '"') => quoted = false,
            (true, c) => field.push(c),
            (false, '"') => quoted = true,
            (false, ',') => row.push(std::mem::take(&mut field)),
            (false, '\n') => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            (false, '\r') => {}
            (false, c) => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// A CSV file as records keyed by its header.
fn records(text: &str) -> Vec<HashMap<String, String>> {
    let mut rows = csv(text).into_iter();
    let Some(header) = rows.next() else { return Vec::new() };
    rows.take(MAX_ITEMS).map(|row| header.iter().cloned().zip(row).collect()).collect()
}

/// "https://boxd.it/2auI" as a match key.
fn boxd_key(uri: &str) -> Option<String> {
    let code = uri.trim().strip_prefix("https://boxd.it/")?.trim_end_matches('/');
    (!code.is_empty() && code.len() <= 16 && code.bytes().all(|b| b.is_ascii_alphanumeric())).then(|| format!("boxd-{code}"))
}

/// A Letterboxd row's year, when it's one (four digits).
fn letterboxd_year(r: &HashMap<String, String>) -> Option<String> {
    r.get("Year").map(|y| clip(y)).filter(|y| y.len() == 4)
}

/// The diary knows when films were actually watched; watched.csv only when
/// they were logged. The latest diary date by name and year (keyed as
/// watched.csv's films are, so a film without a year still finds its date).
fn diary_dates(text: &str, utc_offset_min: i64) -> HashMap<(String, Option<String>), i64> {
    let mut watched_on: HashMap<(String, Option<String>), i64> = HashMap::new();
    for r in records(text) {
        if let (Some(name), Some(at)) = (r.get("Name"), r.get("Watched Date").and_then(|d| day_ms(d, utc_offset_min))) {
            let slot = watched_on.entry((clip(name), letterboxd_year(&r))).or_insert(at);
            *slot = (*slot).max(at);
        }
    }
    watched_on
}

/// A Letterboxd export: watched.csv (with dates from diary.csv when known) and watchlist.csv.
async fn letterboxd_plan(app: &AppHandle, files: &HashMap<String, String>, utc_offset_min: i64) -> Result<Plan, String> {
    let film = |r: &HashMap<String, String>| -> Option<(Film, i64)> {
        let name = clip(r.get("Name")?);
        let at = r.get("Date").and_then(|d| day_ms(d, utc_offset_min)).unwrap_or(0);
        Some((Film { slug: boxd_key(r.get("Letterboxd URI")?)?, name, year: letterboxd_year(r), rating: None, liked: false }, at)).filter(|(f, _)| !f.name.is_empty())
    };
    let watched_on = diary_dates(files.get("diary.csv").map_or("", String::as_str), utc_offset_min);
    let watched: Vec<(Film, i64)> = records(files.get("watched.csv").map_or("", String::as_str))
        .iter()
        .filter_map(film)
        .map(|(f, at)| {
            let at = watched_on.get(&(f.name.clone(), f.year.clone())).copied().unwrap_or(at);
            (f, at)
        })
        .collect();
    let watchlist: Vec<(Film, i64)> = records(files.get("watchlist.csv").map_or("", String::as_str)).iter().filter_map(film).collect();

    let all: Vec<Film> = watched.iter().chain(&watchlist).map(|(f, _)| f.clone()).collect();
    let matches = match_films(app, &all, MAX_ITEMS, None, |done, total| {
        let _ = app.emit(PROGRESS_EVENT, (done, total));
    })
    .await?;
    let mut plan = Plan { source: "letterboxd", ..Default::default() };
    let mut to_items = |list: Vec<(Film, i64)>| -> Vec<Item> {
        list.into_iter()
            .filter_map(|(film, at)| match matches.get(&film.slug).cloned().flatten() {
                Some(t) => Some(Item { poster: t.poster.clone().or_else(|| Some(poster(&t.imdb_id))), imdb: t.imdb_id, kind: "movie", name: t.name, year: t.year, at }),
                None => {
                    plan.unmatched.push(match &film.year {
                        Some(y) => format!("{} ({y})", film.name),
                        None => film.name,
                    });
                    None
                }
            })
            .collect()
    };
    let movies = to_items(watched);
    let list = to_items(watchlist);
    plan.movies = movies;
    plan.watchlist = list;
    Ok(plan)
}

/// A movie or show object from Trakt: `{ ids: { imdb }, title, year }`.
fn trakt_item(value: &Value, kind: &'static str, at: i64) -> Result<Item, String> {
    let name = clip(value.get("title").and_then(Value::as_str).unwrap_or_default());
    let year = value.get("year").and_then(Value::as_i64).map(|y| y.to_string());
    match value.pointer("/ids/imdb").and_then(Value::as_str).and_then(imdb) {
        Some(id) => Ok(Item { poster: Some(poster(&id)), imdb: id, kind, name, year, at }),
        None => Err(match year {
            Some(y) => format!("{name} ({y})"),
            None => name,
        }),
    }
}

fn json_list(files: &HashMap<String, String>, name: &str) -> Vec<Value> {
    files.get(name).and_then(|text| serde_json::from_str::<Vec<Value>>(text).ok()).unwrap_or_default().into_iter().take(MAX_ITEMS).collect()
}

/// A Trakt export: watched movies, the episode history (watched-history-N.json), and the watchlist.
fn trakt_plan(files: &HashMap<String, String>) -> Plan {
    let mut plan = Plan { source: "trakt", ..Default::default() };
    let at = |v: &Value, field: &str| v.get(field).and_then(Value::as_str).and_then(date_ms).unwrap_or(0);
    for entry in json_list(files, "watched-movies.json") {
        match entry.get("movie").map(|m| trakt_item(m, "movie", at(&entry, "last_watched_at"))) {
            Some(Ok(item)) => plan.movies.push(item),
            Some(Err(name)) => plan.unmatched.push(name),
            None => {}
        }
    }

    // Each episode once, at its latest watch; shows from the episodes they have.
    let mut episodes: HashMap<(String, i64, i64), i64> = HashMap::new();
    let mut shows: HashMap<String, Item> = HashMap::new();
    let mut history: Vec<&String> = files.keys().filter(|k| k.starts_with("watched-history")).collect();
    history.sort();
    for name in history {
        for entry in json_list(files, name) {
            if entry.get("type").and_then(Value::as_str) != Some("episode") {
                continue;
            }
            let when = at(&entry, "watched_at");
            let (Some(show), Some(season), Some(number)) =
                (entry.get("show"), entry.pointer("/episode/season").and_then(Value::as_i64), entry.pointer("/episode/number").and_then(Value::as_i64))
            else {
                continue;
            };
            let Ok(item) = trakt_item(show, "series", when) else { continue };
            if !(0..=10_000).contains(&season) || !(0..=100_000).contains(&number) {
                continue;
            }
            let slot = episodes.entry((item.imdb.clone(), season, number)).or_insert(when);
            *slot = (*slot).max(when);
            shows.entry(item.imdb.clone()).and_modify(|s| s.at = s.at.max(when)).or_insert(item);
        }
    }
    // A show is finished when every aired episode (specials aside) is watched.
    let aired: HashMap<String, i64> = json_list(files, "watched-shows.json")
        .iter()
        .filter_map(|e| Some((e.pointer("/show/ids/imdb")?.as_str()?.to_string(), e.pointer("/show/aired_episodes")?.as_i64()?)))
        .collect();
    let mut seen_count: HashMap<&str, i64> = HashMap::new();
    for (show, season, _) in episodes.keys() {
        if *season > 0 {
            *seen_count.entry(show.as_str()).or_default() += 1;
        }
    }
    let mut show_list: Vec<(Item, bool)> = shows
        .into_values()
        .map(|item| {
            let done = aired.get(&item.imdb).is_some_and(|&n| n > 0 && seen_count.get(item.imdb.as_str()).copied().unwrap_or(0) >= n);
            (item, done)
        })
        .collect();
    show_list.sort_by_key(|s| std::cmp::Reverse(s.0.at));
    plan.shows = show_list;
    let mut episode_list: Vec<Episode> = episodes.into_iter().map(|((show, season, episode), at)| Episode { show, season, episode, at }).collect();
    episode_list.sort_by(|a, b| (&a.show, a.season, a.episode).cmp(&(&b.show, b.season, b.episode)));
    plan.episodes = episode_list;

    for entry in json_list(files, "lists-watchlist.json") {
        let when = at(&entry, "listed_at");
        let item = match entry.get("type").and_then(Value::as_str) {
            Some("movie") => entry.get("movie").map(|m| trakt_item(m, "movie", when)),
            Some("show") => entry.get("show").map(|s| trakt_item(s, "series", when)),
            _ => None,
        };
        match item {
            Some(Ok(item)) => plan.watchlist.push(item),
            Some(Err(name)) => plan.unmatched.push(name),
            None => {}
        }
    }
    plan
}

/// The display snapshot My Library and watch history keep (see src/library/snapshot.ts).
fn snapshot(item: &Item) -> String {
    let mut meta = json!({ "id": item.imdb, "type": item.kind, "name": item.name });
    if let Some(p) = item.poster.as_ref().filter(|p| p.starts_with("https://")) {
        meta["poster"] = json!(p);
    }
    if let Some(y) = &item.year {
        meta["releaseInfo"] = json!(y);
    }
    json!({ "meta": meta, "origins": [] }).to_string()
}

/// Reads an export (sent as the request's raw bytes) and keeps a plan for `import_apply`.
#[tauri::command]
pub async fn import_read(app: AppHandle, pending: State<'_, Pending>, request: Request<'_>) -> Result<Summary, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("err.import.choose".into()) };
    if bytes.len() > MAX_ZIP {
        return Err("err.import.too-large".into());
    }
    // Letterboxd's dates are days: the page says where it is, so they land on the right one.
    let utc_offset_min = request.headers().get(UTC_OFFSET_HEADER).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok()).filter(|m| m.abs() <= MAX_OFFSET_MIN).unwrap_or(0);
    let files = read_zip(bytes)?;
    let plan = if files.contains_key("watched.csv") && files.contains_key("profile.csv") {
        letterboxd_plan(&app, &files, utc_offset_min).await?
    } else if files.contains_key("watched-movies.json") || files.keys().any(|k| k.starts_with("watched-history")) {
        trakt_plan(&files)
    } else {
        return Err("err.import.not-export".into());
    };
    let summary = Summary {
        source: plan.source,
        movies: plan.movies.len(),
        shows: plan.shows.len(),
        episodes: plan.episodes.len(),
        watchlist: plan.watchlist.len(),
        unmatched: plan.unmatched.len(),
        unmatched_names: plan.unmatched.iter().take(12).cloned().collect(),
    };
    *pending.0.lock().map_err(|_| "busy")? = Some(plan);
    Ok(summary)
}

/// Saves the plan `import_read` made, in one transaction. Anything watched
/// more recently in Orbit than in the export is left as it is.
#[tauri::command]
pub async fn import_apply(db: State<'_, Db>, active: State<'_, ActiveProfile>, pending: State<'_, Pending>) -> Result<(), String> {
    let plan = pending.0.lock().map_err(|_| "busy")?.take().ok_or("err.import.choose-again")?;
    let profile = active.id()?;
    let mut conn = db.lock()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut progress = tx
            .prepare(
                "INSERT INTO watch_progress (profile_id, video_id, title_id, season, episode, position, duration, watched, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 1, ?6)
                 ON CONFLICT(profile_id, video_id) DO UPDATE SET watched = 1, updated_at = excluded.updated_at
                 WHERE excluded.updated_at >= watch_progress.updated_at",
            )
            .map_err(|e| e.to_string())?;
        let mut title = tx
            .prepare(
                "INSERT INTO watch_titles (profile_id, title_id, title, next, completed, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5)
                 ON CONFLICT(profile_id, title_id) DO UPDATE SET
                   completed = CASE WHEN excluded.updated_at >= watch_titles.updated_at THEN max(watch_titles.completed, excluded.completed) ELSE watch_titles.completed END,
                   updated_at = max(watch_titles.updated_at, excluded.updated_at)",
            )
            .map_err(|e| e.to_string())?;
        let mut library = tx.prepare("INSERT OR IGNORE INTO library (profile_id, id, added_at, title) VALUES (?1, ?2, ?3, ?4)").map_err(|e| e.to_string())?;

        let mut seen = HashSet::new();
        for movie in plan.movies.iter().filter(|m| seen.insert(m.imdb.clone())) {
            progress.execute(params![profile, movie.imdb, movie.imdb, None::<i64>, None::<i64>, movie.at]).map_err(|e| e.to_string())?;
            title.execute(params![profile, movie.imdb, snapshot(movie), true, movie.at]).map_err(|e| e.to_string())?;
        }
        for (show, done) in &plan.shows {
            title.execute(params![profile, show.imdb, snapshot(show), done, show.at]).map_err(|e| e.to_string())?;
        }
        for ep in &plan.episodes {
            progress.execute(params![profile, format!("{}:{}:{}", ep.show, ep.season, ep.episode), ep.show, ep.season, ep.episode, ep.at]).map_err(|e| e.to_string())?;
        }
        let mut seen = HashSet::new();
        for item in plan.watchlist.iter().filter(|i| seen.insert(i.imdb.clone())) {
            library.execute(params![profile, item.imdb, item.at, snapshot(item)]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Forgets a plan the person didn't confirm.
#[tauri::command]
pub async fn import_cancel(pending: State<'_, Pending>) -> Result<(), String> {
    *pending.0.lock().map_err(|_| "busy")? = None;
    Ok(())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = csv(&text);
    let _ = records(&text);
    let _ = date_ms(&text);
    let _ = read_zip_capped(data, 262144);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A zip of `files` (name, size in bytes of the letter "a"), deflated.
    fn zip_of(files: &[(&str, usize)]) -> Vec<u8> {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, size) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(&vec![b'a'; *size]).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn caps_the_total_inflated_size() {
        let bytes = zip_of(&[("a.csv", 600), ("b.csv", 600)]);
        assert_eq!(read_zip_capped(&bytes, 2000).unwrap().len(), 2);
        // Each file is fine on its own; together they're over.
        assert_eq!(read_zip_capped(&bytes, 1000).unwrap_err(), "err.import.too-large");
    }

    #[test]
    fn reads_an_export_with_many_lists_or_mac_metadata() {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        for (name, body) in [("watched.csv", &b"Date,Name\n"[..]), ("profile.csv", b"Username\n"), ("__MACOSX/._watched.csv", b"\x00\x05\x16\x07\xff\xfe")] {
            zip.start_file(name, options).unwrap();
            zip.write_all(body).unwrap();
        }
        // A member with hundreds of lists: Letterboxd puts each in lists/.
        for i in 0..MAX_FILES {
            zip.start_file(format!("lists/list-{i}.csv"), options).unwrap();
            zip.write_all(b"Date,Name\n").unwrap();
        }
        let files = read_zip(&zip.finish().unwrap().into_inner()).unwrap();
        let mut names: Vec<&String> = files.keys().collect();
        names.sort();
        assert_eq!(names, ["profile.csv", "watched.csv"]);
    }

    #[test]
    fn reads_csv_with_quotes() {
        let rows = csv("\u{feff}Date,Name,Year\r\n2026-01-04,\"Synecdoche, New York\",2008\n2026-01-05,\"Say \"\"hi\"\"\",1999\n");
        assert_eq!(rows[1], vec!["2026-01-04", "Synecdoche, New York", "2008"]);
        assert_eq!(rows[2][1], "Say \"hi\"");
        let recs = records("Date,Name,Year,Letterboxd URI\n2026-01-04,12 Angry Men,1957,https://boxd.it/2auI\n");
        assert_eq!(recs[0]["Name"], "12 Angry Men");
        assert_eq!(boxd_key(&recs[0]["Letterboxd URI"]).as_deref(), Some("boxd-2auI"));
        assert_eq!(boxd_key("https://evil.example/x"), None);
    }

    #[test]
    fn reads_dates() {
        assert_eq!(date_ms("2026-01-04"), Some(1_767_484_800_000));
        assert_eq!(date_ms("2024-01-03T21:34:56.000Z"), Some(1_704_317_696_000));
        assert_eq!(date_ms("soon"), None);
    }

    #[test]
    fn letterboxd_diary_dates_match_films_without_a_year() {
        let diary = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-03-01,Some Film,,https://boxd.it/a,,,,2024-02-10
";
        let dates = diary_dates(diary, 0);
        // watched.csv's film without a year is keyed (name, None), as the diary's must be.
        assert_eq!(dates.get(&("Some Film".to_string(), None)), day_ms("2024-02-10", 0).as_ref());
    }

    #[test]
    fn letterboxd_days_are_local_noon() {
        // Berlin in winter (UTC+1, offset -60): noon there is 11:00 UTC, the same day.
        assert_eq!(day_ms("2026-03-01", -60), date_ms("2026-03-01T11:00:00Z"));
        // New York (UTC-5, offset 300): 1 January stays in 2026, at noon, not 31 December at 7 pm.
        assert_eq!(day_ms("2026-01-01", 300), date_ms("2026-01-01T17:00:00Z"));
        // Today's offset in summer (UTC-4) for a winter day: 11 am, still the right day.
        assert_eq!(day_ms("2026-01-01", 240), date_ms("2026-01-01T16:00:00Z"));
        // A full timestamp is left as it is.
        assert_eq!(day_ms("2024-01-03T21:34:56.000Z", -60), date_ms("2024-01-03T21:34:56.000Z"));
        assert_eq!(day_ms("soon", 0), None);
    }

    #[test]
    fn plans_a_trakt_export() {
        let mut files = HashMap::new();
        files.insert(
            "watched-movies.json".into(),
            r#"[{"last_watched_at":"2024-01-03T21:34:56.000Z","movie":{"ids":{"imdb":"tt0111161"},"title":"The Shawshank Redemption","year":1994}},
                {"last_watched_at":"2024-01-03T00:00:00.000Z","movie":{"ids":{"imdb":null},"title":"No Id","year":2001}}]"#
                .into(),
        );
        let ep = |s: i64, e: i64, at: &str| format!(r#"{{"watched_at":"{at}","type":"episode","episode":{{"season":{s},"number":{e}}},"show":{{"ids":{{"imdb":"tt0903747"}},"title":"Breaking Bad","year":2008}}}}"#);
        files.insert("watched-history-1.json".into(), format!("[{},{},{}]", ep(1, 1, "2024-02-01T00:00:00Z"), ep(1, 2, "2024-02-02T00:00:00Z"), ep(1, 1, "2024-03-01T00:00:00Z")));
        files.insert("watched-shows.json".into(), r#"[{"show":{"ids":{"imdb":"tt0903747"},"aired_episodes":2}}]"#.into());
        files.insert(
            "lists-watchlist.json".into(),
            r#"[{"type":"show","listed_at":"2025-05-05T00:00:00Z","show":{"ids":{"imdb":"tt0386676"},"title":"The Office","year":2005}},{"type":"person","person":{}}]"#.into(),
        );
        let plan = trakt_plan(&files);
        assert_eq!(plan.movies.len(), 1);
        assert_eq!(plan.movies[0].poster.as_deref(), Some("https://images.metahub.space/poster/medium/tt0111161/img"));
        assert_eq!(plan.unmatched, vec!["No Id (2001)"]);
        assert_eq!(plan.episodes.len(), 2, "a rewatched episode counts once");
        assert_eq!(plan.episodes[0].at, date_ms("2024-03-01T00:00:00Z").unwrap(), "at its latest watch");
        assert_eq!(plan.shows.len(), 1);
        assert!(plan.shows[0].1, "both aired episodes watched");
        assert_eq!((plan.watchlist[0].imdb.as_str(), plan.watchlist[0].kind), ("tt0386676", "series"));
    }

    #[test]
    fn snapshots_match_the_library_format() {
        let item = Item { imdb: "tt1".into(), kind: "movie", name: "X".into(), year: Some("2001".into()), poster: Some("http://insecure".into()), at: 0 };
        let v: Value = serde_json::from_str(&snapshot(&item)).unwrap();
        assert_eq!(v["meta"]["releaseInfo"], "2001");
        assert!(v["meta"].get("poster").is_none());
        assert_eq!(v["origins"], json!([]));
    }
}
