//! Award winners for Discover's "Browse by award" (Best Picture at the
//! Oscars, the Palme d'Or…), from Wikidata's public SPARQL endpoint.
//!
//! Wikidata only gives IMDb ids and years; TMDB fills in names and artwork
//! (see `tmdb::titles_by_imdb_id`), a page at a time. The query is fixed and
//! picks only from the award items below, so nothing the page sends reaches
//! Wikidata. Winners change once a year, so a list is kept for a day.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::Deserialize;

use crate::addons::{AddonError, net};
use crate::skip::check_imdb_id;
use crate::tmdb::{self, ServicePage};

const SPARQL: &str = "https://query.wikidata.org/sparql";
/// Wikidata asks every client to say what it is in its User-Agent.
const AGENT: &str = concat!("Orbit/", env!("CARGO_PKG_VERSION"), " (desktop media client; award winners for its Discover page)");
const LIMIT: usize = 2 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_FOR: Duration = Duration::from_secs(24 * 60 * 60);
const PAGE_SIZE: usize = 20;
/// Far more than any award has given (Best Picture: under a hundred).
const MAX_WINNERS: usize = 400;
const MAX_PAGE: u32 = MAX_WINNERS.div_ceil(PAGE_SIZE) as u32;

/// Awards by the key the page uses, with their Wikidata items (checked
/// against Wikidata's labels). The Golden Globes have two best-film awards.
/// SAG and Critics' Choice are left out: Wikidata records almost none of
/// their winners.
const AWARDS: &[(&str, &[&str])] = &[
    // Academy Award for Best Picture.
    ("oscars", &["Q102427"]),
    // Golden Globe for Best Motion Picture – Drama, and – Musical or Comedy.
    ("golden-globes", &["Q1011509", "Q670282"]),
    // BAFTA Award for Best Film.
    ("bafta", &["Q139184"]),
    // Primetime Emmy for Outstanding Drama Series.
    ("emmys", &["Q989438"]),
    // Palme d'Or, Golden Lion, Golden Bear.
    ("cannes", &["Q179808"]),
    ("venice", &["Q209459"]),
    ("berlinale", &["Q154590"]),
];

/// IMDb ids of winners by award key, newest first, with when they were read.
type Winners = HashMap<&'static str, (Instant, Vec<String>)>;
static CACHE: LazyLock<Mutex<Winners>> = LazyLock::new(Default::default);

/// Films (and shows) that received one of `items`, with the year they won
/// (the award statement's "point in time", else the earliest release date).
/// People who received the award are left out: only IMDb title ids pass.
fn query(items: &[&str]) -> String {
    let values = items.iter().map(|q| format!("wd:{q}")).collect::<Vec<_>>().join(" ");
    format!(
        "SELECT ?imdb (MIN(?when) AS ?won) (MIN(?pub) AS ?released) WHERE {{ \
         VALUES ?award {{ {values} }} \
         ?work p:P166 ?statement . ?statement ps:P166 ?award . \
         OPTIONAL {{ ?statement pq:P585 ?when }} \
         ?work wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, \"tt\")) \
         OPTIONAL {{ ?work wdt:P577 ?pub }} \
         }} GROUP BY ?imdb"
    )
}

#[derive(Deserialize)]
struct Answer {
    results: Bindings,
}

#[derive(Deserialize)]
struct Bindings {
    #[serde(default)]
    bindings: Vec<Row>,
}

#[derive(Deserialize)]
struct Row {
    imdb: Value,
    won: Option<Value>,
    released: Option<Value>,
}

#[derive(Deserialize)]
struct Value {
    value: String,
}

/// "1995-03-27T00:00:00Z" as 1995.
fn year(value: Option<&Value>) -> Option<u16> {
    let text = value?.value.get(..4)?;
    text.bytes().all(|b| b.is_ascii_digit()).then(|| text.parse().ok()).flatten()
}

/// Winners' IMDb ids, newest first (undated ones last), each once.
fn parse_winners(json: &str) -> Result<Vec<String>, String> {
    let answer: Answer = serde_json::from_str(json).map_err(|_| "err.wikidata.invalid")?;
    let mut rows: Vec<(u16, String)> = answer
        .results
        .bindings
        .into_iter()
        .filter(|row| check_imdb_id(&row.imdb.value).is_ok())
        .map(|row| (year(row.won.as_ref()).or_else(|| year(row.released.as_ref())).unwrap_or(0), row.imdb.value))
        .collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let mut seen = HashSet::new();
    Ok(rows.into_iter().filter(|(_, id)| seen.insert(id.clone())).map(|(_, id)| id).take(MAX_WINNERS).collect())
}

async fn winners(key: &'static str, items: &[&str]) -> Result<Vec<String>, String> {
    if let Some((_, ids)) = CACHE.lock().ok().and_then(|cache| cache.get(key).filter(|(at, _)| at.elapsed() < CACHE_FOR).cloned()) {
        return Ok(ids);
    }
    let mut url = Url::parse(SPARQL).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("query", &query(items)).append_pair("format", "json");
    let body = match net::fetch_text_as(url, AGENT, LIMIT, TIMEOUT).await {
        Ok(body) => body,
        Err(AddonError::Timeout) => return Err("err.wikidata.timeout".into()),
        Err(_) => return Err("err.wikidata.unreachable".into()),
    };
    let ids = parse_winners(&body)?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(key, (Instant::now(), ids.clone()));
    }
    Ok(ids)
}

/// One page (20) of an award's winners, newest first, with TMDB's artwork.
/// `None` without a TMDB token.
#[tauri::command]
pub async fn explore_award(award: String, page: u32) -> Result<Option<ServicePage>, String> {
    let (key, items) = AWARDS.iter().find(|(k, _)| *k == award).ok_or("unknown award")?;
    if !(1..=MAX_PAGE).contains(&page) {
        return Err("page out of range".into());
    }
    // Without TMDB there'd be nothing to show, so Wikidata isn't asked either.
    if tmdb::token()?.is_none() {
        return Ok(None);
    }
    let ids = winners(key, items).await?;
    let start = (page as usize - 1) * PAGE_SIZE;
    let slice: Vec<String> = ids.iter().skip(start).take(PAGE_SIZE).cloned().collect();
    let done = start + PAGE_SIZE >= ids.len();
    let Some(titles) = tmdb::titles_by_imdb_id(slice).await? else { return Ok(None) };
    Ok(Some(ServicePage { titles, done }))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let _ = parse_winners(&String::from_utf8_lossy(data));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_only_for_known_award_items() {
        let q = query(&["Q1011509", "Q670282"]);
        assert!(q.contains("VALUES ?award { wd:Q1011509 wd:Q670282 }"));
        assert!(q.contains("pq:P585") && q.contains("wdt:P345") && q.contains("wdt:P577"));
        for (key, items) in AWARDS {
            assert!(key.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'));
            assert!(items.iter().all(|q| q.starts_with('Q') && q[1..].bytes().all(|b| b.is_ascii_digit())));
        }
    }

    #[test]
    fn reads_winners_newest_first() {
        let json = r#"{"head":{"vars":["imdb","won","released"]},"results":{"bindings":[
            {"imdb":{"type":"literal","value":"tt0111161"},"released":{"datatype":"http://www.w3.org/2001/XMLSchema#dateTime","type":"literal","value":"1994-09-10T00:00:00Z"}},
            {"imdb":{"type":"literal","value":"tt0109830"},"won":{"datatype":"http://www.w3.org/2001/XMLSchema#dateTime","type":"literal","value":"1995-01-01T00:00:00Z"},"released":{"type":"literal","value":"1994-06-23T00:00:00Z"}},
            {"imdb":{"type":"literal","value":"tt30144839"},"won":{"type":"literal","value":"2026-01-01T00:00:00Z"}},
            {"imdb":{"type":"literal","value":"nm0000158"},"won":{"type":"literal","value":"2000-01-01T00:00:00Z"}},
            {"imdb":{"type":"literal","value":"tt0109830"},"won":{"type":"literal","value":"1995-01-01T00:00:00Z"}},
            {"imdb":{"type":"literal","value":"tt0000001"}},
            {"imdb":{"type":"literal","value":"tt12&x=1"}}
        ]}}"#;
        // People and junk are dropped; the award's year wins over the release date; undated last.
        assert_eq!(parse_winners(json).unwrap(), ["tt30144839", "tt0109830", "tt0111161", "tt0000001"]);
        assert!(parse_winners("<html>").is_err());
    }

    #[test]
    fn pages_cover_every_winner() {
        assert_eq!(MAX_PAGE, 20);
        assert_eq!(year(Some(&Value { value: "19x5-01-01".into() })), None);
    }
}
