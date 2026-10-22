//! Skip times (intro, recap, credits) from TheIntroDB (theintrodb.org), a
//! free, community-run database. It's asked from here rather than the WebView
//! so the same HTTPS-only, size-capped, time-limited client applies, and the
//! answer is checked before the player trusts it.
//!
//! Only the title's IMDb id and the season and episode numbers are sent, and
//! only while Settings → Playback allows it (checked here and in the page).
//!
//! For anime there's a second source, AniSkip (api.aniskip.com), the
//! community database anime players use for openings and endings. It's off
//! unless the person turns it on, because it's one more outside service. It
//! gets only a MyAnimeList id and an episode number (found from the title's
//! id through AniList's id list, see anilist.rs), from a fixed https host with
//! redirects off, so nothing else about what's playing reaches it and a
//! redirect can't send the request anywhere else.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::addons::{AddonError, net};
use crate::anilist::{self, AniList};
use crate::db::Db;

/// Settings → Playback → "Look up intro times online" (src/rooms/player/next-up.ts): on unless `false`.
const INTRO_DB_SETTING: &str = "playback.skip-lookup";
/// Settings → Playback → AniSkip (src/rooms/player/skip-tuning.ts): off unless `true`.
const ANISKIP_SETTING: &str = "playback.aniskip";

/// Both are read here as well as in the page, so with one off no request goes
/// out, whatever the page asks (like TVmaze's setting, see tvmaze.rs).
fn intro_db_on(db: &Db) -> bool {
    db.setting(INTRO_DB_SETTING) != Some(serde_json::Value::Bool(false))
}

fn aniskip_on(db: &Db) -> bool {
    db.setting(ANISKIP_SETTING) == Some(serde_json::Value::Bool(true))
}

// v4: v2 and v3 stop answering on 18 Jan 2027. It still takes an IMDb id and answers the same fields (keyed by TVDB id, which Orbit doesn't read).
const API: &str = "https://api.theintrodb.org/v4/media";
const LIMIT: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(8);
/// More than this many of one kind is not a real answer.
const MAX_PER_KIND: usize = 8;

/// One stretch to skip, in seconds. `None` start means the beginning; `None`
/// end means the end of the video (its length isn't known here).
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Segment {
    kind: &'static str,
    start: Option<f64>,
    end: Option<f64>,
    /// How long the video the times were taken from was (AniSkip says), so the
    /// page can drop times taken from a cut of another length.
    #[serde(skip_serializing_if = "Option::is_none")]
    length: Option<f64>,
}

#[derive(Deserialize)]
struct Range {
    start_ms: Option<f64>,
    end_ms: Option<f64>,
}

#[derive(Deserialize)]
struct Media {
    #[serde(default)]
    intro: Vec<Range>,
    #[serde(default)]
    recap: Vec<Range>,
    #[serde(default)]
    credits: Vec<Range>,
    /// "Next time on…" after the credits.
    #[serde(default)]
    preview: Vec<Range>,
}

pub(crate) fn check_imdb_id(id: &str) -> Result<(), String> {
    let digits = id.strip_prefix("tt").unwrap_or_default();
    if (1..=10).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()) { Ok(()) } else { Err("not an IMDb id".into()) }
}

/// Keeps well-formed ranges: finite, not negative, and ending after they start.
fn segments(media: Media) -> Vec<Segment> {
    let valid = |ms: Option<f64>| ms.is_none_or(|v| v.is_finite() && v >= 0.0);
    [("intro", media.intro), ("recap", media.recap), ("credits", media.credits), ("preview", media.preview)]
        .into_iter()
        .flat_map(|(kind, ranges)| ranges.into_iter().take(MAX_PER_KIND).map(move |r| (kind, r)))
        .filter(|(_, r)| valid(r.start_ms) && valid(r.end_ms) && !r.start_ms.zip(r.end_ms).is_some_and(|(s, e)| e <= s))
        .map(|(kind, r)| Segment { kind, start: r.start_ms.map(|v| v / 1000.0), end: r.end_ms.map(|v| v / 1000.0), length: None })
        .collect()
}

/// Skip times for a movie (no season/episode) or an episode. No data is an
/// empty list, not an error.
#[tauri::command]
pub async fn skip_segments(db: State<'_, Db>, imdb_id: String, season: Option<u32>, episode: Option<u32>) -> Result<Vec<Segment>, String> {
    check_imdb_id(&imdb_id)?;
    if !intro_db_on(&db) {
        return Ok(Vec::new());
    }
    let mut url = Url::parse(API).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("imdb_id", &imdb_id);
        if let (Some(season), Some(episode)) = (season, episode) {
            query.append_pair("season", &season.to_string()).append_pair("episode", &episode.to_string());
        }
    }
    let body = match net::fetch_text(url, LIMIT, TIMEOUT).await {
        Ok(body) => body,
        Err(AddonError::Http { status: 404 }) => return Ok(Vec::new()),
        Err(AddonError::Timeout) => return Err("TheIntroDB took too long to answer".into()),
        Err(_) => return Err("couldn't reach TheIntroDB".into()),
    };
    let media: Media = serde_json::from_str(&body).map_err(|_| "TheIntroDB sent data Orbit couldn't read")?;
    Ok(segments(media))
}

const ANISKIP: &str = "https://api.aniskip.com/v2/skip-times";
/// Openings and endings, plain or mixed (over the story), and recaps.
const ANISKIP_TYPES: [&str; 5] = ["op", "ed", "mixed-op", "mixed-ed", "recap"];
/// Answers are kept this long per anime episode, so reopening one doesn't ask again.
const ANISKIP_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const ANISKIP_CACHED: usize = 256;
/// Longer than a day is not a real time.
const MAX_SECONDS: f64 = 24.0 * 60.0 * 60.0;
const UNREADABLE: &str = "AniSkip sent data Orbit couldn't read";
const UNREACHABLE: &str = "couldn't reach AniSkip";

/// Its own client: https only and no redirects, so a redirect can't move the
/// request to another host (or into the LAN).
fn aniskip_client() -> Result<Client, String> {
    static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| Client::builder().https_only(true).timeout(TIMEOUT).redirect(reqwest::redirect::Policy::none()).build().ok());
    CLIENT.clone().ok_or_else(|| UNREACHABLE.into())
}

/// One answer from AniSkip, and when it came.
type Answer = (Instant, Vec<Segment>);

/// AniSkip's answers by (MyAnimeList id, episode).
#[derive(Default)]
pub struct AniSkipCache(Mutex<HashMap<(u32, u32), Answer>>);

#[derive(Deserialize)]
struct Interval {
    #[serde(rename = "startTime")]
    start: f64,
    #[serde(rename = "endTime")]
    end: f64,
}

#[derive(Deserialize)]
struct SkipTime {
    interval: Interval,
    #[serde(rename = "skipType")]
    kind: String,
    #[serde(rename = "episodeLength")]
    length: Option<f64>,
}

#[derive(Deserialize)]
struct SkipTimes {
    #[serde(default)]
    found: bool,
    #[serde(default)]
    results: Vec<SkipTime>,
}

/// AniSkip's times as segments: openings are intros, endings credits. Only
/// well-formed times, and no more than `MAX_PER_KIND` of each kind.
fn aniskip_segments_from(answer: SkipTimes) -> Vec<Segment> {
    if !answer.found {
        return Vec::new();
    }
    let fine = |v: f64| v.is_finite() && (0.0..=MAX_SECONDS).contains(&v);
    let mut counts: HashMap<&str, usize> = HashMap::new();
    answer
        .results
        .into_iter()
        .filter_map(|r| {
            let kind = match r.kind.as_str() {
                "op" | "mixed-op" => "intro",
                "ed" | "mixed-ed" => "credits",
                "recap" => "recap",
                _ => return None,
            };
            let Interval { start, end } = r.interval;
            if !fine(start) || !fine(end) || end <= start {
                return None;
            }
            let count = counts.entry(kind).or_default();
            *count += 1;
            if *count > MAX_PER_KIND {
                return None;
            }
            Some(Segment { kind, start: Some(start), end: Some(end), length: r.length.filter(|v| fine(*v) && *v > 0.0) })
        })
        .collect()
}

/// AniSkip's address for one episode. `episodeLength=0` asks for the times
/// from every cut: the page drops those from a cut of a different length.
fn aniskip_url(mal: u32, episode: u32) -> Result<Url, String> {
    let mut url = Url::parse(&format!("{ANISKIP}/{mal}/{episode}")).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        for kind in ANISKIP_TYPES {
            query.append_pair("types[]", kind);
        }
        query.append_pair("episodeLength", "0");
    }
    Ok(url)
}

/// The answer's text, or None for AniSkip's "no times for this episode" (404).
async fn fetch_aniskip(url: Url) -> Result<Option<String>, String> {
    let mut response = aniskip_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "AniSkip took too long to answer" } else { UNREACHABLE })?;
    match response.status().as_u16() {
        404 => return Ok(None),
        200..=299 => (),
        _ => return Err(UNREACHABLE.into()),
    }
    if response.content_length().is_some_and(|n| n > LIMIT as u64) {
        return Err(UNREADABLE.into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| UNREACHABLE)? {
        if body.len() + chunk.len() > LIMIT {
            return Err(UNREADABLE.into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map(Some).map_err(|_| UNREADABLE.into())
}

/// AniSkip's times for an anime episode: `id` is the title's id (IMDb, Kitsu
/// or `mal:`), `season` and `episode` the episode's numbers. Only the
/// MyAnimeList id and the episode number are sent. A title that isn't a known
/// anime, or no data, is an empty list, not an error.
#[tauri::command]
pub async fn aniskip_segments(db: State<'_, Db>, anime: State<'_, AniList>, cache: State<'_, AniSkipCache>, id: String, season: Option<u32>, episode: u32) -> Result<Vec<Segment>, String> {
    if !aniskip_on(&db) || id.len() > 64 || episode == 0 || episode > 10_000 {
        return Ok(Vec::new());
    }
    let Some(mal) = anilist::mal_id(&anime, &id, season.unwrap_or(1)).await.map_err(|_| "couldn't look up this anime's MyAnimeList id")? else {
        return Ok(Vec::new());
    };
    let key = (mal, episode);
    if let Some((at, found)) = cache.0.lock().map_err(|_| "skip cache unavailable")?.get(&key)
        && at.elapsed() < ANISKIP_TTL
    {
        return Ok(found.clone());
    }
    let found = match fetch_aniskip(aniskip_url(mal, episode)?).await? {
        Some(body) => aniskip_segments_from(serde_json::from_str(&body).map_err(|_| UNREADABLE)?),
        None => Vec::new(),
    };
    let mut cached = cache.0.lock().map_err(|_| "skip cache unavailable")?;
    cached.retain(|_, (at, _)| at.elapsed() < ANISKIP_TTL);
    if cached.len() >= ANISKIP_CACHED {
        cached.clear();
    }
    cached.insert(key, (Instant::now(), found.clone()));
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_settings_are_read_here_too() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let set = |key: &str, value: &str| {
            db.lock().unwrap().execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]).unwrap();
        };
        // TheIntroDB is on unless turned off; AniSkip off unless turned on (as the page reads them).
        assert!(intro_db_on(&db) && !aniskip_on(&db));
        set(INTRO_DB_SETTING, "false");
        set(ANISKIP_SETTING, "true");
        assert!(!intro_db_on(&db) && aniskip_on(&db));
        set(ANISKIP_SETTING, "\"yes\"");
        assert!(!aniskip_on(&db));
    }

    #[test]
    fn checks_imdb_ids() {
        assert!(check_imdb_id("tt0903747").is_ok());
        assert!(check_imdb_id("tt").is_err() && check_imdb_id("0903747").is_err() && check_imdb_id("tt09&x=1").is_err());
    }

    #[test]
    fn keeps_only_well_formed_ranges() {
        let media: Media = serde_json::from_str(
            r#"{"tmdb_id":1396,"intro":[{"start_ms":314360,"end_ms":330461},{"start_ms":5000,"end_ms":4000}],
                "credits":[{"start_ms":2839000,"end_ms":null}],"preview":[{"start_ms":-1,"end_ms":10}],
                "recap":[{"start_ms":null,"end_ms":60000}]}"#,
        )
        .unwrap();
        assert_eq!(
            segments(media),
            [
                Segment { kind: "intro", start: Some(314.36), end: Some(330.461), length: None },
                Segment { kind: "recap", start: None, end: Some(60.0), length: None },
                Segment { kind: "credits", start: Some(2839.0), end: None, length: None },
            ]
        );
    }

    #[test]
    fn reads_a_v4_answer() {
        // Breaking Bad S1E1 as /v4/media answered it (2026-10-17): keyed by tvdb_id now.
        let media: Media = serde_json::from_str(
            r#"{"tvdb_id":81189,"type":"tv","season":1,"episode":1,"intro":[{"start_ms":228664,"end_ms":246143}],"credits":[{"start_ms":3431000,"end_ms":null}]}"#,
        )
        .unwrap();
        assert_eq!(
            segments(media),
            [Segment { kind: "intro", start: Some(228.664), end: Some(246.143), length: None }, Segment { kind: "credits", start: Some(3431.0), end: None, length: None }]
        );
    }

    #[test]
    fn previews_are_their_own_kind() {
        let media: Media = serde_json::from_str(r#"{"preview":[{"start_ms":2900000,"end_ms":null}]}"#).unwrap();
        assert_eq!(segments(media), [Segment { kind: "preview", start: Some(2900.0), end: None, length: None }]);
    }

    #[test]
    fn aniskip_openings_and_endings() {
        let answer: SkipTimes = serde_json::from_str(
            r#"{"found":true,"results":[
                {"interval":{"startTime":88.5,"endTime":178.5},"skipType":"op","skipId":"a","episodeLength":1420.1},
                {"interval":{"startTime":1300,"endTime":1390},"skipType":"mixed-ed","skipId":"b","episodeLength":0},
                {"interval":{"startTime":0,"endTime":40},"skipType":"recap","skipId":"c"},
                {"interval":{"startTime":50,"endTime":40},"skipType":"op","skipId":"d"},
                {"interval":{"startTime":-5,"endTime":40},"skipType":"op","skipId":"e"},
                {"interval":{"startTime":5,"endTime":40},"skipType":"commercial","skipId":"f"}
            ],"message":"ok","statusCode":200}"#,
        )
        .unwrap();
        assert_eq!(
            aniskip_segments_from(answer),
            [
                Segment { kind: "intro", start: Some(88.5), end: Some(178.5), length: Some(1420.1) },
                Segment { kind: "credits", start: Some(1300.0), end: Some(1390.0), length: None },
                Segment { kind: "recap", start: Some(0.0), end: Some(40.0), length: None },
            ]
        );
    }

    #[test]
    fn aniskip_rejects_what_it_cannot_trust() {
        assert!(aniskip_segments_from(serde_json::from_str(r#"{"found":false,"results":[]}"#).unwrap()).is_empty());
        assert!(serde_json::from_str::<SkipTimes>(r#"{"found":true,"results":[{"interval":{"startTime":"1","endTime":2},"skipType":"op"}]}"#).is_err());
        let one = r#"{"interval":{"startTime":1,"endTime":2},"skipType":"op"}"#;
        let many = format!(r#"{{"found":true,"results":[{}]}}"#, vec![one; 20].join(","));
        assert_eq!(aniskip_segments_from(serde_json::from_str(&many).unwrap()).len(), MAX_PER_KIND);
    }

    #[test]
    fn aniskip_is_sent_only_the_id_and_episode() {
        let url = aniskip_url(21, 1071).unwrap();
        assert_eq!((url.scheme(), url.host_str(), url.path()), ("https", Some("api.aniskip.com"), "/v2/skip-times/21/1071"));
        assert!(url.query_pairs().all(|(k, v)| (k == "types[]" && ANISKIP_TYPES.contains(&v.as_ref())) || (k == "episodeLength" && v == "0")));
    }
}
