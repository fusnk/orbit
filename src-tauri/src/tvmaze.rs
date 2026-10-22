//! Exact air times from TVmaze (api.tvmaze.com), a free TV guide: when each
//! episode of a show airs, to the minute, where addons and TMDB know only the
//! day. Release Radar says "Out today at 21:00", new-episode alerts wait for
//! the air time instead of the date, and autoplay won't offer an episode
//! before it has aired.
//!
//! Off unless Settings → General → Notifications → "Look up exact air times"
//! is on (checked here as well as in the page). Asked from Rust so the WebView
//! never talks to an outside host: the host is fixed, over https, redirects are
//! off, answers are size-capped, time-limited and schema-checked, and only the
//! show's IMDb or TheTVDB id is sent (TVmaze needs no key).
//!
//! TVmaze answers a lookup by id with a redirect to the show. Redirects stay
//! off: the show's number is read from that answer's address, which must be
//! TVmaze's own `/shows/{number}`, and its episodes are then asked for directly.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::{Client, Url, header, redirect};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db::Db;

const HOST: &str = "api.tvmaze.com";
/// Settings → "Look up exact air times" (src/catalog/air-times.ts); off unless it's `true`.
pub(crate) const SETTING: &str = "alerts.air-times";
/// A show's whole episode list; long-running shows stay well under this.
const LIMIT: usize = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
/// How long a show's times are kept: schedules move, but rarely by the hour.
const FRESH_FOR: Duration = Duration::from_secs(6 * 60 * 60);
/// A show TVmaze doesn't know is asked about again after a day.
const UNKNOWN_FOR: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_CACHED: usize = 500;
const MAX_EPISODES: usize = 5000;
/// TVmaze allows about 20 calls in 10 seconds from one address; asking one at a time, this far apart, stays well inside it.
const SPACING: Duration = Duration::from_millis(600);

/// When one episode airs: milliseconds since the Unix epoch, and its air date
/// where it airs ("YYYY-MM-DD"), which the page uses to match an episode an
/// addon numbers differently (see src/catalog/air-times.ts).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AirTime {
    season: u32,
    episode: u32,
    at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    day: Option<String>,
}

#[derive(Deserialize)]
struct RawEpisode {
    season: Option<i64>,
    number: Option<i64>,
    airdate: Option<String>,
    airstamp: Option<String>,
}

/// "YYYY-MM-DD" as is, or nothing.
fn air_date(text: Option<&str>) -> Option<String> {
    let text = text?;
    let b = text.as_bytes();
    let ok = b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    ok.then(|| text.to_string())
}

#[derive(Deserialize)]
struct RawShow {
    id: u32,
}

/// The lookup query for a title id: `tt…` (IMDb) or `tvdb:…` (TheTVDB).
fn lookup_query(id: &str) -> Result<(&'static str, String), String> {
    let number = |digits: &str| (1..=10).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit());
    if id.strip_prefix("tt").is_some_and(number) {
        return Ok(("imdb", id.to_string()));
    }
    match id.strip_prefix("tvdb:") {
        Some(digits) if number(digits) => Ok(("thetvdb", digits.to_string())),
        _ => Err("not an IMDb or TheTVDB id".into()),
    }
}

/// The show's number from the lookup's redirect, only if it points at TVmaze's own `/shows/{number}`.
fn show_from_location(location: &str) -> Option<u32> {
    let base = Url::parse(&format!("https://{HOST}/")).ok()?;
    let url = base.join(location).ok()?;
    if url.scheme() != "https" || url.host_str() != Some(HOST) || url.port().is_some() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() {
        return None;
    }
    let digits = url.path().strip_prefix("/shows/")?;
    if digits.is_empty() || digits.len() > 9 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Days from 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "2024-03-07T02:00:00+00:00" (or with "Z", or fractional seconds) as milliseconds since the epoch.
fn parse_airstamp(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() < 20 || b.len() > 40 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| -> Option<i64> { text.get(range).filter(|s| s.bytes().all(|c| c.is_ascii_digit())).and_then(|s| s.parse().ok()) };
    let (year, month, day, hour, minute, second) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1900..=2200).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &text[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 9 {
            return None;
        }
        rest = &fraction[digits..];
    }
    let offset = match rest {
        "Z" => 0,
        _ => {
            let r = rest.as_bytes();
            if r.len() != 6 || !(r[0] == b'+' || r[0] == b'-') || r[3] != b':' {
                return None;
            }
            let (h, m) = (rest[1..3].parse::<i64>().ok()?, rest[4..6].parse::<i64>().ok()?);
            if h > 14 || m > 59 || !rest[1..3].bytes().chain(rest[4..6].bytes()).all(|c| c.is_ascii_digit()) {
                return None;
            }
            (h * 60 + m) * if r[0] == b'-' { -1 } else { 1 }
        }
    };
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offset * 60;
    Some(seconds * 1000)
}

/// Keeps episodes with a season, a number and a well-formed air time, at most `MAX_EPISODES`.
fn air_times(raw: Vec<RawEpisode>) -> Vec<AirTime> {
    raw.into_iter()
        .filter_map(|e| {
            let season = u32::try_from(e.season?).ok().filter(|s| *s <= 1000)?;
            let episode = u32::try_from(e.number?).ok().filter(|n| (1..=100_000).contains(n))?;
            Some(AirTime { season, episode, at: parse_airstamp(e.airstamp.as_deref()?)?, day: air_date(e.airdate.as_deref()) })
        })
        .take(MAX_EPISODES)
        .collect()
}

fn client() -> Result<Client, String> {
    static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
        Client::builder()
            .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
            .https_only(true)
            .redirect(redirect::Policy::none())
            .referer(false)
            .timeout(TIMEOUT)
            .build()
            .ok()
    });
    CLIENT.clone().ok_or_else(|| "network".into())
}

/// The body of a successful answer, refusing one larger than `LIMIT`.
async fn body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|n| n > LIMIT as u64) {
        return Err("invalid-data".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
        if out.len() + chunk.len() > LIMIT {
            return Err("invalid-data".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// One request at a time, `SPACING` apart (see TVmaze's rate limit).
static GATE: LazyLock<tokio::sync::Mutex<Option<Instant>>> = LazyLock::new(|| tokio::sync::Mutex::new(None));

/// After a 429, nothing is sent for TVmaze's rate-limit window.
const BUSY_PAUSE: Duration = Duration::from_secs(10);
/// After TVmaze couldn't be reached (or failed, or timed out), nothing is
/// sent for this long: shows are asked one at a time, so each one queued
/// behind (Release Radar, alerts, the calendar ask for many) would otherwise
/// wait out its own timeout in turn, and a title page opened meanwhile behind them all.
const DOWN_PAUSE: Duration = Duration::from_secs(60);

/// Until when TVmaze is left alone, and why.
#[derive(Default)]
struct Pause(Option<(Instant, &'static str)>);

impl Pause {
    fn check(&self, now: Instant) -> Result<(), String> {
        match self.0 {
            Some((until, why)) if now < until => Err(why.into()),
            _ => Ok(()),
        }
    }

    fn note(&mut self, now: Instant, outcome: &Result<(), String>) {
        self.0 = match outcome.as_ref().map_err(String::as_str) {
            Err("rate-limited") => Some((now + BUSY_PAUSE, "rate-limited")),
            Err("network") => Some((now + DOWN_PAUSE, "network")),
            _ => None,
        };
    }
}

static PAUSE: Mutex<Pause> = Mutex::new(Pause(None));

async fn get(last: &mut Option<Instant>, url: Url) -> Result<reqwest::Response, String> {
    if let Some(wait) = last.map(|at| SPACING.saturating_sub(at.elapsed())) {
        tokio::time::sleep(wait).await;
    }
    let sent = client()?.get(url).send().await;
    *last = Some(Instant::now());
    let response = sent.map_err(|_| "network")?;
    match response.status().as_u16() {
        429 => Err("rate-limited".into()),
        _ => Ok(response),
    }
}

/// The show's air times, or an empty list when TVmaze doesn't know it.
async fn fetch(last: &mut Option<Instant>, param: &str, value: &str) -> Result<Vec<AirTime>, String> {
    let mut lookup = Url::parse(&format!("https://{HOST}/lookup/shows")).map_err(|e| e.to_string())?;
    lookup.query_pairs_mut().append_pair(param, value);
    let response = get(last, lookup).await?;
    let show = match response.status().as_u16() {
        404 => return Ok(Vec::new()),
        301 | 302 | 303 | 307 | 308 => {
            let location = response.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("invalid-data")?;
            show_from_location(location).ok_or("invalid-data")?
        }
        200 => serde_json::from_slice::<RawShow>(&body(response).await?).map_err(|_| "invalid-data")?.id,
        _ => return Err("network".into()),
    };
    let episodes = Url::parse(&format!("https://{HOST}/shows/{show}/episodes")).map_err(|e| e.to_string())?;
    let response = get(last, episodes).await?;
    match response.status().as_u16() {
        404 => Ok(Vec::new()),
        200 => {
            let raw: Vec<RawEpisode> = serde_json::from_slice(&body(response).await?).map_err(|_| "invalid-data")?;
            Ok(air_times(raw))
        }
        _ => Err("network".into()),
    }
}

type Cache = HashMap<String, (Instant, Vec<AirTime>)>;
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn cached(id: &str) -> Option<Vec<AirTime>> {
    let cache = CACHE.lock().ok()?;
    let (at, times) = cache.get(id)?;
    let keep = if times.is_empty() { UNKNOWN_FOR } else { FRESH_FOR };
    (at.elapsed() < keep).then(|| times.clone())
}

fn remember(id: &str, times: &[AirTime]) {
    if let Ok(mut cache) = CACHE.lock() {
        if cache.len() >= MAX_CACHED {
            cache.retain(|_, (at, _)| at.elapsed() < FRESH_FOR);
            if cache.len() >= MAX_CACHED {
                cache.clear();
            }
        }
        cache.insert(id.to_string(), (Instant::now(), times.to_vec()));
    }
}

/// A show's episode air times, by its IMDb (`tt…`) or TheTVDB (`tvdb:…`) id.
/// `None` while the setting is off; an empty list when TVmaze doesn't know the show.
#[tauri::command]
pub async fn tvmaze_air_times(db: State<'_, Db>, id: String) -> Result<Option<Vec<AirTime>>, String> {
    if db.setting(SETTING) != Some(Value::Bool(true)) {
        return Ok(None);
    }
    let (param, value) = lookup_query(&id)?;
    if let Some(times) = cached(&id) {
        return Ok(Some(times));
    }
    let mut last = GATE.lock().await;
    // Another call may have fetched it while this one waited its turn.
    if let Some(times) = cached(&id) {
        return Ok(Some(times));
    }
    // Checked after waiting its turn, so the ones queued behind a failure don't each try again.
    PAUSE.lock().map_err(|_| "network")?.check(Instant::now())?;
    let fetched = fetch(&mut last, param, &value).await;
    if let Ok(mut pause) = PAUSE.lock() {
        pause.note(Instant::now(), &fetched.as_ref().map(drop).map_err(Clone::clone));
    }
    let times = fetched?;
    remember(&id, &times);
    Ok(Some(times))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_busy_or_unreachable_tvmaze_is_left_alone_for_a_while() {
        let now = Instant::now();
        let mut pause = Pause::default();
        assert_eq!(pause.check(now), Ok(()));
        // An answer, even "not found", is no reason to wait.
        pause.note(now, &Ok(()));
        assert_eq!(pause.check(now), Ok(()));
        // A 429: TVmaze's window is 10 seconds.
        pause.note(now, &Err("rate-limited".into()));
        assert_eq!(pause.check(now + Duration::from_secs(5)), Err("rate-limited".into()));
        assert_eq!(pause.check(now + BUSY_PAUSE), Ok(()));
        // Unreachable or too slow: every show queued behind would wait out its own timeout, so none are sent for a minute.
        pause.note(now, &Err("network".into()));
        assert_eq!(pause.check(now + Duration::from_secs(30)), Err("network".into()));
        assert_eq!(pause.check(now + DOWN_PAUSE), Ok(()));
        // An odd answer is that show's problem, not TVmaze's.
        pause.note(now, &Err("invalid-data".into()));
        assert_eq!(pause.check(now), Ok(()));
    }

    #[test]
    fn sends_only_well_formed_ids() {
        assert_eq!(lookup_query("tt0944947"), Ok(("imdb", "tt0944947".into())));
        assert_eq!(lookup_query("tvdb:121361"), Ok(("thetvdb", "121361".into())));
        for bad in ["tt", "tt12&x=1", "0944947", "tvdb:", "tvdb:12a", "kitsu:1", "tt12345678901"] {
            assert!(lookup_query(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_the_show_only_from_tvmaze_itself() {
        assert_eq!(show_from_location("https://api.tvmaze.com/shows/82"), Some(82));
        assert_eq!(show_from_location("/shows/82"), Some(82));
        for bad in [
            "https://api.tvmaze.com.evil.example/shows/82",
            "http://api.tvmaze.com/shows/82",
            "https://api.tvmaze.com:8443/shows/82",
            "https://user@api.tvmaze.com/shows/82",
            "https://api.tvmaze.com/shows/82?embed=cast",
            "https://api.tvmaze.com/shows/82/episodes",
            "https://api.tvmaze.com/people/82",
            "https://127.0.0.1/shows/82",
            "//evil.example/shows/82",
        ] {
            assert_eq!(show_from_location(bad), None, "{bad}");
        }
    }

    #[test]
    fn parses_air_stamps_in_any_offset() {
        assert_eq!(parse_airstamp("1970-01-01T00:00:00+00:00"), Some(0));
        assert_eq!(parse_airstamp("2024-03-07T02:00:00+00:00"), Some(1_709_776_800_000));
        assert_eq!(parse_airstamp("2024-03-06T21:00:00-05:00"), Some(1_709_776_800_000));
        assert_eq!(parse_airstamp("2024-03-07T02:00:00Z"), Some(1_709_776_800_000));
        assert_eq!(parse_airstamp("2024-03-07T02:00:00.000+00:00"), Some(1_709_776_800_000));
        for bad in ["2024-03-07", "2024-13-07T02:00:00+00:00", "2024-03-07T25:00:00+00:00", "2024-03-07T02:00:00+0000", "2024-03-07 02:00:00+00:00", "x024-03-07T02:00:00+00:00", "2024-03-07T02:00:00+1a:00"] {
            assert_eq!(parse_airstamp(bad), None, "{bad}");
        }
    }

    #[test]
    fn keeps_only_complete_episodes() {
        let raw: Vec<RawEpisode> = serde_json::from_str(
            r#"[{"id":1,"season":1,"number":1,"airdate":"2011-04-17","airstamp":"2011-04-18T01:00:00+00:00","name":"Winter Is Coming"},
                {"season":1,"number":null,"airstamp":"2011-04-25T01:00:00+00:00"},
                {"season":1,"number":2,"airstamp":null},
                {"season":-1,"number":3,"airstamp":"2011-04-25T01:00:00+00:00"},
                {"season":2,"number":1,"airstamp":"soon"},
                {"season":2,"number":2,"airdate":"2012-04-0x","airstamp":"2012-04-02T01:00:00+00:00"}]"#,
        )
        .unwrap();
        // The local air date comes along (to match episodes numbered differently by date), when it's well formed.
        assert_eq!(
            air_times(raw),
            [AirTime { season: 1, episode: 1, at: 1_303_088_400_000, day: Some("2011-04-17".into()) }, AirTime { season: 2, episode: 2, at: 1_333_328_400_000, day: None }]
        );
    }
}
