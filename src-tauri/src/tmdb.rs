//! TMDB (themoviedb.org), with the user's own API Read Access Token.
//!
//! The token is a small secret, so it lives in the OS keychain (see docs/DEVELOPMENT.md)
//! and is only ever read here. It's sent as a bearer token in a header: TMDB's
//! shorter "API key" would have to go in the URL, which Orbit never does with
//! secrets.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use reqwest::Url;
use rusqlite::{OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::addons::{AddonError, net};
use crate::db::Db;
use crate::keychain;
use crate::library::now_ms;
use crate::skip::check_imdb_id;

pub(crate) const KEY_ENTRY: &str = "tmdb-token";
const API: &str = "https://api.themoviedb.org/3/";
const LIMIT: usize = 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
/// A 429 is tried once more after its Retry-After (1 s without one), if that's no longer than this.
const MAX_RETRY_AFTER_SECS: u64 = 5;
/// Text the page reads as "busy" (lib/user-error.ts), like other services' rate limits.
const RATE_LIMITED: &str = "err.tmdb.busy";
const IMAGES: &str = "https://image.tmdb.org/t/p/";
/// Recommendations per title.
const MAX_RESULTS: usize = 20;

/// (is TV, TMDB id) → IMDb id, or `None` when TMDB has none.
type ImdbIds = HashMap<(bool, u64), Option<String>>;
/// IMDb ids already looked up, remembered for the session.
static IMDB_IDS: LazyLock<Mutex<ImdbIds>> = LazyLock::new(Default::default);
/// Ids are small, and every poster row looks some up: a long session's worth fits.
const MAX_IMDB_IDS: usize = 20_000;

/// The token as last read from or written to the keychain (outer `None`:
/// not read yet). Nearly every TMDB command needs it, and a keychain read is
/// a trip to the OS each time. It stays here in Rust like the keychain copy.
static TOKEN: Mutex<Option<Option<String>>> = Mutex::new(None);

/// The saved token, if any.
pub(crate) fn token() -> Result<Option<String>, String> {
    let mut slot = TOKEN.lock().map_err(|_| "TMDB token unavailable".to_string())?;
    if let Some(token) = slot.as_ref() {
        return Ok(token.clone());
    }
    // A failed read isn't remembered, so a locked keychain is asked again next time.
    let token = keychain::get(KEY_ENTRY)?;
    *slot = Some(token.clone());
    Ok(token)
}

/// Saves (or, with `None`, deletes) the token in the keychain and in `TOKEN`.
fn store_token(token: Option<&str>) -> Result<(), String> {
    let mut slot = TOKEN.lock().map_err(|_| "TMDB token unavailable".to_string())?;
    // Forgotten first: if the keychain write fails, the next read asks the keychain again.
    *slot = None;
    match token {
        Some(token) => keychain::set(KEY_ENTRY, token)?,
        None => keychain::delete(KEY_ENTRY)?,
    }
    *slot = Some(token.map(String::from));
    Ok(())
}

/// Read Access Tokens are JWTs: three base64url parts, starting "eyJ".
fn check_token(token: &str) -> Result<(), String> {
    if !token.starts_with("eyJ") {
        return Err("err.tmdb.api-key".into());
    }
    let ok = token.len() <= 2048 && token.split('.').count() == 3 && token.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    if ok { Ok(()) } else { Err("err.tmdb.token-format".into()) }
}

/// Saves the token once TMDB accepts it.
#[tauri::command]
pub async fn tmdb_set_token(token: String) -> Result<(), String> {
    let token = token.trim();
    check_token(token)?;
    let url = Url::parse(API).and_then(|u| u.join("authentication")).map_err(|e| e.to_string())?;
    match net::fetch_text_authorized(url, token, LIMIT, TIMEOUT).await {
        Ok(_) => store_token(Some(token)),
        Err(AddonError::Http { status: 401 }) => Err("err.tmdb.rejected".into()),
        Err(AddonError::RateLimited { .. }) => Err(RATE_LIMITED.into()),
        Err(AddonError::Timeout) => Err("err.tmdb.timeout".into()),
        Err(_) => Err("err.tmdb.unreachable".into()),
    }
}

#[tauri::command]
pub async fn tmdb_token_saved() -> Result<bool, String> {
    token().map(|t| t.is_some())
}

/// Removes the TMDB token. Without it every title counts as unrated, which
/// most content limits let through, so on a limited profile this needs a
/// parent, as restoring a backup does (see `profiles::check_restore`).
#[tauri::command]
pub async fn tmdb_clear_token(db: State<'_, Db>, active: State<'_, crate::profiles::ActiveProfile>, guardian_pin: Option<String>) -> Result<(), String> {
    clear_token_checked(&db, &active, guardian_pin.as_deref(), || store_token(None))
}

fn clear_token_checked(db: &Db, active: &crate::profiles::ActiveProfile, guardian_pin: Option<&str>, remove: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    crate::profiles::check_restore(db, active, guardian_pin)?;
    remove()
}

/// The streaming region (shared by every profile): whose catalogs, and whose
/// age ratings a content limit goes by.
pub const REGION_SETTING: &str = "streaming.region";

/// Sets the streaming region. A content limit reads ratings in that country's
/// terms, so a laxer country could loosen it: on a limited profile this needs
/// a parent, as removing the token does. (The page can't write the setting
/// itself, see `db::check_writable`.)
#[tauri::command]
pub async fn tmdb_set_region(db: State<'_, Db>, active: State<'_, crate::profiles::ActiveProfile>, region: String, guardian_pin: Option<String>) -> Result<(), String> {
    set_region_checked(&db, &active, &region, guardian_pin.as_deref())
}

fn set_region_checked(db: &Db, active: &crate::profiles::ActiveProfile, region: &str, guardian_pin: Option<&str>) -> Result<(), String> {
    check_region(region)?;
    crate::profiles::check_restore(db, active, guardian_pin)?;
    db.lock()?
        .execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![REGION_SETTING, serde_json::Value::from(region).to_string()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// A title from TMDB, ready to open by its IMDb id (Cinemeta has the details).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbTitle {
    imdb_id: String,
    /// "movie" or "series", as Stremio names them.
    kind: &'static str,
    name: String,
    poster: Option<String>,
    background: Option<String>,
    year: Option<String>,
    overview: Option<String>,
    /// "YYYY-MM-DD", when TMDB knows it (cards mark recent releases as new).
    released: Option<String>,
    /// TMDB's average out of 10; None with too few votes to mean much.
    rating: Option<f64>,
}

#[derive(Deserialize)]
struct Item {
    id: u64,
    title: Option<String>,
    name: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    overview: Option<String>,
    /// "movie", "tv" or "person", on mixed lists such as trending/all.
    media_type: Option<String>,
    #[serde(default)]
    vote_count: f64,
    vote_average: Option<f64>,
    #[serde(default)]
    genre_ids: Vec<u32>,
    /// TMDB's own adult-content flag.
    #[serde(default)]
    adult: bool,
}

#[derive(Deserialize)]
struct Find {
    #[serde(default)]
    movie_results: Vec<Item>,
    #[serde(default)]
    tv_results: Vec<Item>,
}

#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    results: Vec<Item>,
    #[serde(default)]
    total_pages: u32,
}

#[derive(Deserialize)]
struct ExternalIds {
    imdb_id: Option<String>,
}

/// The language TMDB answers in (Settings → General → Language), e.g. "fr-FR".
static LANGUAGE: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new("en-US".into()));

/// "fr-FR" and the like: two lower-case letters, a dash, two capitals.
fn valid_language(tag: &str) -> bool {
    let b = tag.as_bytes();
    b.len() == 5 && b[..2].iter().all(u8::is_ascii_lowercase) && b[2] == b'-' && b[3..].iter().all(u8::is_ascii_uppercase)
}

/// Titles, overviews and posters from TMDB come in this language where TMDB has them.
#[tauri::command]
pub async fn tmdb_set_language(tag: String) -> Result<(), String> {
    if !valid_language(&tag) {
        return Err("invalid language".into());
    }
    *LANGUAGE.lock().map_err(|_| "busy")? = tag;
    Ok(())
}

async fn get<T: DeserializeOwned>(token: &str, path: &str, query: &[(&str, &str)]) -> Result<T, String> {
    get_limited(token, path, query, LIMIT).await
}

/// `get`, for the few answers that can be larger than `LIMIT` (a long show's
/// season or story arcs list every episode).
async fn get_limited<T: DeserializeOwned>(token: &str, path: &str, query: &[(&str, &str)], limit: usize) -> Result<T, String> {
    let mut url = Url::parse(API).and_then(|u| u.join(path)).map_err(|e| e.to_string())?;
    let language = LANGUAGE.lock().map(|l| l.clone()).unwrap_or_else(|_| "en-US".into());
    url.query_pairs_mut().extend_pairs(query).append_pair("language", &language);
    let mut fetched = net::fetch_text_authorized(url.clone(), token, limit, TIMEOUT).await;
    // TMDB's limit is per second: a short wait, as asked, usually gets through.
    if let Err(AddonError::RateLimited { retry_after_secs }) = fetched {
        let wait = retry_after_secs.unwrap_or(1).max(1);
        if wait > MAX_RETRY_AFTER_SECS {
            return Err(RATE_LIMITED.into());
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
        fetched = net::fetch_text_authorized(url, token, limit, TIMEOUT).await;
    }
    let body = match fetched {
        Ok(body) => body,
        Err(AddonError::RateLimited { .. }) => return Err(RATE_LIMITED.into()),
        Err(AddonError::Http { status: 401 }) => return Err("err.tmdb.signed-out".into()),
        Err(AddonError::Timeout) => return Err("err.tmdb.timeout".into()),
        Err(_) => return Err("err.tmdb.unreachable".into()),
    };
    serde_json::from_str(&body).map_err(|_| "err.tmdb.invalid".into())
}

/// A TMDB image path ("/abc.jpg") as a full URL; anything else is dropped.
fn image(path: Option<&str>, size: &str) -> Option<String> {
    let path = path?.strip_prefix('/')?;
    let ok = !path.is_empty() && path.len() <= 100 && path.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    ok.then(|| format!("{IMAGES}{size}/{path}"))
}

async fn lookup_imdb_id(token: &str, tv: bool, id: u64) -> Option<String> {
    if let Some(known) = IMDB_IDS.lock().ok().and_then(|cache| cache.get(&(tv, id)).cloned()) {
        return known;
    }
    let path = format!("{}/{id}/external_ids", if tv { "tv" } else { "movie" });
    // A row of 20 posters is 20 lookups: they share TMDB's few slots with the ratings, so a page doesn't burst into a 429.
    let found = {
        let _slot = RATING_SLOTS.acquire().await.ok()?;
        get::<ExternalIds>(token, &path, &[]).await.ok()?.imdb_id.filter(|i| check_imdb_id(i).is_ok())
    };
    if let Ok(mut cache) = IMDB_IDS.lock() {
        // Bounded like the other session caches (they start over when full).
        if cache.len() >= MAX_IMDB_IDS {
            cache.clear();
        }
        cache.insert((tv, id), found.clone());
    }
    found
}

/// Gives each item its IMDb id (looked up in parallel) and keeps the ones
/// that have one; `tv` says which kind each item is.
async fn with_imdb_ids(token: &str, items: Vec<(bool, Item)>) -> Vec<TmdbTitle> {
    let lookups: Vec<_> = items
        .iter()
        .map(|(tv, item)| {
            let (token, tv, id) = (token.to_owned(), *tv, item.id);
            tauri::async_runtime::spawn(async move { lookup_imdb_id(&token, tv, id).await })
        })
        .collect();
    let mut found = Vec::with_capacity(items.len());
    for ((tv, item), lookup) in items.into_iter().zip(lookups) {
        let Some(imdb_id) = lookup.await.ok().flatten() else { continue };
        found.push(to_title(imdb_id, tv, item));
    }
    found.retain(|t| !t.name.is_empty());
    found
}

/// A plain "YYYY-MM-DD" date, or None.
fn release_date(date: Option<&str>) -> Option<String> {
    date.filter(|d| is_date(d)).map(str::to_owned)
}

fn to_title(imdb_id: String, tv: bool, item: Item) -> TmdbTitle {
    let date = if tv { item.first_air_date.as_deref() } else { item.release_date.as_deref() };
    TmdbTitle {
        imdb_id,
        kind: if tv { "series" } else { "movie" },
        name: item.title.or(item.name).unwrap_or_default(),
        poster: image(item.poster_path.as_deref(), "w342"),
        background: image(item.backdrop_path.as_deref(), "w1280"),
        year: date.and_then(|d| d.get(..4)).filter(|y| y.bytes().all(|b| b.is_ascii_digit())).map(str::to_owned),
        released: release_date(date),
        rating: item.vote_average.filter(|r| r.is_finite() && (0.0..=10.0).contains(r) && *r > 0.0 && item.vote_count >= MIN_VOTES as f64),
        overview: item.overview.filter(|o| !o.is_empty()),
    }
}

/// Titles found at TMDB by IMDb id, each looked up once (a few at a time), in
/// the order asked; ids TMDB doesn't know are left out. `None` without a token.
pub(crate) async fn titles_by_imdb_id(ids: Vec<String>) -> Result<Option<Vec<TmdbTitle>>, String> {
    let Some(token) = token()? else { return Ok(None) };
    let lookups: Vec<_> = ids
        .into_iter()
        .filter(|id| check_imdb_id(id).is_ok())
        .map(|imdb_id| {
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                let _slot = RATING_SLOTS.acquire().await.ok()?;
                let find: Find = get(&token, &format!("find/{imdb_id}"), &[("external_source", "imdb_id")]).await.ok()?;
                // An IMDb id names one title, which TMDB lists as a movie or as a show.
                let (tv, item) = find.movie_results.into_iter().next().map(|i| (false, i)).or_else(|| find.tv_results.into_iter().next().map(|i| (true, i)))?;
                Some(to_title(imdb_id, tv, item))
            })
        })
        .collect();
    let mut found = Vec::with_capacity(lookups.len());
    for lookup in lookups {
        if let Ok(Some(title)) = lookup.await
            && !title.name.is_empty()
        {
            found.push(title);
        }
    }
    Ok(Some(found))
}

/// The title an IMDb id names (Search's "tt0133093" or a pasted imdb.com
/// link), as a list of at most one. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_find_title(imdb_id: String) -> Result<Option<Vec<TmdbTitle>>, String> {
    check_imdb_id(&imdb_id)?;
    titles_by_imdb_id(vec![imdb_id]).await
}

/// The title a TMDB id names (Search's "tmdb:603" or a pasted themoviedb.org
/// link), as a list of at most one; with no `kind`, a movie first, then a show.
/// Only titles with an IMDb id count, since that's how Orbit opens them.
/// `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_title_by_id(id: u64, kind: Option<String>) -> Result<Option<Vec<TmdbTitle>>, String> {
    check_tmdb_id(id)?;
    let kinds = match kind.as_deref() {
        None => vec![false, true],
        Some(kind) => vec![kind_is_tv(kind)?],
    };
    let Some(token) = token()? else { return Ok(None) };
    for tv in kinds {
        let path = format!("{}/{id}", if tv { "tv" } else { "movie" });
        // Not found is TMDB's 404, which reads as any other failure: try the next kind.
        let Ok(item) = get::<Item>(&token, &path, &[]).await else { continue };
        if let Some(imdb_id) = lookup_imdb_id(&token, tv, id).await {
            let title = to_title(imdb_id, tv, item);
            if !title.name.is_empty() {
                return Ok(Some(vec![title]));
            }
        }
    }
    Ok(Some(Vec::new()))
}

/// TMDB's id for a title known by its IMDb id.
async fn tmdb_id(token: &str, imdb_id: &str, tv: bool) -> Result<Option<u64>, String> {
    let find: Find = get(token, &format!("find/{imdb_id}"), &[("external_source", "imdb_id")]).await?;
    Ok((if tv { find.tv_results } else { find.movie_results }).first().map(|i| i.id))
}

fn kind_is_tv(kind: &str) -> Result<bool, String> {
    match kind {
        "movie" => Ok(false),
        "series" => Ok(true),
        _ => Err("unknown kind".into()),
    }
}

/// TMDB's recommendations for a title (falling back to its "similar"
/// titles), each with an IMDb id. `None` when no TMDB token is saved.
#[tauri::command]
pub async fn tmdb_recommendations(imdb_id: String, kind: String) -> Result<Option<Vec<TmdbTitle>>, String> {
    check_imdb_id(&imdb_id)?;
    let tv = match kind.as_str() {
        "movie" => false,
        "series" => true,
        _ => return Err("unknown kind".into()),
    };
    let Some(token) = token()? else { return Ok(None) };

    let Some(id) = tmdb_id(&token, &imdb_id, tv).await? else { return Ok(Some(Vec::new())) };
    let base = format!("{}/{id}", if tv { "tv" } else { "movie" });
    let mut items = get::<Page>(&token, &format!("{base}/recommendations"), &[]).await?.results;
    if items.is_empty() {
        items = get::<Page>(&token, &format!("{base}/similar"), &[]).await?.results;
    }
    items.truncate(MAX_RESULTS);
    let mut found = with_imdb_ids(&token, items.into_iter().map(|i| (tv, i)).collect()).await;
    found.retain(|t| t.imdb_id != imdb_id);
    Ok(Some(found))
}

/// One of TMDB's lists, by name (the WebView never passes a TMDB path):
/// "movies-today" and "series-today" (trending today), "trending-week"
/// (movies and shows). `None` when no TMDB token is saved.
#[tauri::command]
pub async fn tmdb_list(list: String) -> Result<Option<Vec<TmdbTitle>>, String> {
    let (path, kind) = match list.as_str() {
        "movies-today" => ("trending/movie/day", Some(false)),
        "series-today" => ("trending/tv/day", Some(true)),
        "trending-week" => ("trending/all/week", None),
        _ => return Err("unknown list".into()),
    };
    let Some(token) = token()? else { return Ok(None) };
    let mut items = get::<Page>(&token, path, &[]).await?.results;
    items.truncate(MAX_RESULTS);
    // Mixed lists say what each item is; people aren't titles.
    let typed = items
        .into_iter()
        .filter_map(|item| match (kind, item.media_type.as_deref()) {
            (Some(tv), _) => Some((tv, item)),
            (None, Some("movie")) => Some((false, item)),
            (None, Some("tv")) => Some((true, item)),
            _ => None,
        })
        .collect();
    Ok(Some(with_imdb_ids(&token, typed).await))
}

/// Streaming services Orbit can show catalogs for: key, name and TMDB's
/// provider ids (some services are listed under several).
const SERVICES: &[(&str, &str, &[u32])] = &[
    ("netflix", "Netflix", &[8]),
    ("disney", "Disney+", &[337]),
    ("prime", "Prime Video", &[9, 119]),
    ("max", "Max", &[1899, 384]),
    ("apple", "Apple TV+", &[350]),
    ("hulu", "Hulu", &[15]),
    ("paramount", "Paramount+", &[531, 582]),
    ("peacock", "Peacock", &[386, 387]),
    ("crunchyroll", "Crunchyroll", &[283]),
];

/// Two-letter country code (TMDB's watch regions are ISO 3166-1).
pub(crate) fn check_region(region: &str) -> Result<(), String> {
    if region.len() == 2 && region.bytes().all(|b| b.is_ascii_uppercase()) { Ok(()) } else { Err("invalid region".into()) }
}

#[derive(Serialize)]
pub struct Service {
    key: &'static str,
    name: &'static str,
    logo: Option<String>,
}

#[derive(Deserialize)]
struct Providers {
    #[serde(default)]
    results: Vec<Provider>,
}

#[derive(Deserialize)]
struct Provider {
    provider_id: u32,
    logo_path: Option<String>,
    /// TMDB's own order per country (lower first).
    #[serde(default)]
    display_priorities: HashMap<String, u32>,
    display_priority: Option<u32>,
}

/// The streaming services, with TMDB's logos. `None` when no TMDB token is
/// saved; logos are left out if TMDB can't be reached. With a `region`, only
/// the services TMDB lists there, in its order for that country (Home's
/// "Only on…" row); without one, all of them in Orbit's order.
#[tauri::command]
pub async fn tmdb_services(region: Option<String>) -> Result<Option<Vec<Service>>, String> {
    if let Some(region) = &region {
        check_region(region)?;
    }
    let Some(token) = token()? else { return Ok(None) };
    let query: Vec<(&str, &str)> = region.as_deref().map(|r| vec![("watch_region", r)]).unwrap_or_default();
    let providers = match get::<Providers>(&token, "watch/providers/movie", &query).await {
        Ok(p) => p.results,
        // Without TMDB's regional list there's nothing to filter by.
        Err(err) if region.is_some() => return Err(err),
        Err(_) => Vec::new(),
    };
    Ok(Some(services_from(&providers, region.as_deref())))
}

/// Orbit's services with their logos; for a region, only those listed there, in that country's order.
fn services_from(providers: &[Provider], region: Option<&str>) -> Vec<Service> {
    let found = |ids: &[u32]| providers.iter().find(|p| ids.contains(&p.provider_id));
    let mut services: Vec<(u32, Service)> = SERVICES
        .iter()
        .filter_map(|(key, name, ids)| {
            let provider = found(ids);
            let rank = match region {
                // A provider with per-country priorities but none for this one isn't offered there.
                Some(region) => {
                    let provider = provider?;
                    match provider.display_priorities.get(region) {
                        Some(rank) => *rank,
                        None if provider.display_priorities.is_empty() => provider.display_priority.unwrap_or(u32::MAX),
                        None => return None,
                    }
                }
                None => 0,
            };
            let logo = providers.iter().find(|p| p.provider_id == ids[0]).or(provider).and_then(|p| image(p.logo_path.as_deref(), "w154"));
            Some((rank, Service { key, name, logo }))
        })
        .collect();
    // Stable, so equal ranks keep Orbit's order.
    services.sort_by_key(|(rank, _)| *rank);
    services.into_iter().map(|(_, service)| service).collect()
}

/// Popular titles on a streaming service's subscription in `region`,
/// movies and shows alternating. `None` when no TMDB token is saved.
#[tauri::command]
pub async fn tmdb_streaming(service: String, region: String) -> Result<Option<Vec<TmdbTitle>>, String> {
    let providers = service_providers(&service)?;
    check_region(&region)?;
    let Some(token) = token()? else { return Ok(None) };
    let query = discover_query(&providers, &region);
    let movies = get::<Page>(&token, "discover/movie", &query).await?.results;
    let shows = get::<Page>(&token, "discover/tv", &query).await?.results;
    let (mut movies, mut shows) = (movies.into_iter(), shows.into_iter());
    let mut items = Vec::new();
    loop {
        let (movie, show) = (movies.next(), shows.next());
        if movie.is_none() && show.is_none() {
            break;
        }
        items.extend(movie.map(|m| (false, m)).into_iter().chain(show.map(|t| (true, t))));
    }
    items.truncate(MAX_RESULTS);
    Ok(Some(with_imdb_ids(&token, items).await))
}

/// A service's TMDB provider ids, joined as TMDB's "any of" filter.
fn service_providers(service: &str) -> Result<String, String> {
    let (_, _, ids) = SERVICES.iter().find(|(key, ..)| *key == service).ok_or("unknown service")?;
    Ok(ids.iter().map(u32::to_string).collect::<Vec<_>>().join("|"))
}

/// Popular titles on a service's subscription in a region.
fn discover_query<'a>(providers: &'a str, region: &'a str) -> Vec<(&'a str, &'a str)> {
    vec![
        ("with_watch_providers", providers),
        ("watch_region", region),
        ("with_watch_monetization_types", "flatrate"),
        ("sort_by", "popularity.desc"),
        // Leaves out obscure titles that only top the list by being new.
        ("vote_count.gte", "100"),
    ]
}

/// Genre filters on a service's page: key, then TMDB's genre id for movies
/// and for shows (TMDB numbers them separately; `None` where a kind lacks it).
const GENRES: &[(&str, Option<u32>, Option<u32>)] = &[
    ("action", Some(28), Some(10759)),
    ("comedy", Some(35), Some(35)),
    ("drama", Some(18), Some(18)),
    ("crime", Some(80), Some(80)),
    ("scifi", Some(878), Some(10765)),
    ("horror", Some(27), None),
    ("thriller", Some(53), None),
    ("romance", Some(10749), None),
    ("mystery", Some(9648), Some(9648)),
    ("animation", Some(16), Some(16)),
    ("documentary", Some(99), Some(99)),
    ("family", Some(10751), Some(10762)),
    ("reality", None, Some(10764)),
];
/// TMDB serves at most 500 pages; Orbit stops well before.
const MAX_PAGE: u32 = 25;

#[derive(Serialize)]
pub struct ServicePage {
    pub(crate) titles: Vec<TmdbTitle>,
    /// No pages after this one.
    pub(crate) done: bool,
}

/// One page (20) of a service's movies or shows, most popular first,
/// optionally in one genre. `None` when no TMDB token is saved.
#[tauri::command]
pub async fn tmdb_service_page(service: String, region: String, kind: String, genre: Option<String>, page: u32) -> Result<Option<ServicePage>, String> {
    let providers = service_providers(&service)?;
    check_region(&region)?;
    let tv = match kind.as_str() {
        "movie" => false,
        "series" => true,
        _ => return Err("unknown kind".into()),
    };
    if !(1..=MAX_PAGE).contains(&page) {
        return Err("page out of range".into());
    }
    let genre_id = match genre.as_deref() {
        None => None,
        Some(key) => {
            let (_, movie, show) = GENRES.iter().find(|(k, ..)| *k == key).ok_or("unknown genre")?;
            Some((if tv { show } else { movie }).ok_or("no such genre for this kind")?.to_string())
        }
    };
    let Some(token) = token()? else { return Ok(None) };
    let page_text = page.to_string();
    let mut query = discover_query(&providers, &region);
    query.push(("page", &page_text));
    if let Some(id) = &genre_id {
        query.push(("with_genres", id));
    }
    let result = get::<Page>(&token, if tv { "discover/tv" } else { "discover/movie" }, &query).await?;
    let done = page >= result.total_pages.min(MAX_PAGE) || result.results.is_empty();
    let titles = with_imdb_ids(&token, result.results.into_iter().map(|i| (tv, i)).collect()).await;
    Ok(Some(ServicePage { titles, done }))
}

/// Backdrops per genre tile on Discover, and the most genres asked for at once.
const GENRE_ART: usize = 3;
const MAX_GENRE_TILES: usize = 30;
/// Backdrops by TMDB movie genre id, kept for the session.
static GENRE_ARTWORK: LazyLock<Mutex<HashMap<u32, Vec<String>>>> = LazyLock::new(Default::default);

/// A few backdrops of each genre's most popular films, for Discover's genre
/// tiles: one discover request per genre and no IMDb lookups. Genres TMDB
/// couldn't answer for are left out. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_genre_art(genres: Vec<u32>) -> Result<Option<HashMap<u32, Vec<String>>>, String> {
    if genres.len() > MAX_GENRE_TILES || genres.iter().any(|g| !(1..=100_000).contains(g)) {
        return Err("invalid genres".into());
    }
    let Some(token) = token()? else { return Ok(None) };
    let mut found = HashMap::new();
    let mut set = tokio::task::JoinSet::new();
    for genre in genres {
        if let Some(known) = GENRE_ARTWORK.lock().ok().and_then(|art| art.get(&genre).cloned()) {
            found.insert(genre, known);
            continue;
        }
        let token = token.clone();
        set.spawn(async move {
            let id = genre.to_string();
            let query = [("with_genres", id.as_str()), ("sort_by", "popularity.desc"), ("vote_count.gte", "300")];
            let page = get::<Page>(&token, "discover/movie", &query).await.ok()?;
            Some((genre, page.results.iter().filter_map(|i| image(i.backdrop_path.as_deref(), "w300")).take(GENRE_ART).collect::<Vec<_>>()))
        });
    }
    while let Some(next) = set.join_next().await {
        if let Ok(Some((genre, art))) = next {
            if let Ok(mut known) = GENRE_ARTWORK.lock() {
                known.insert(genre, art.clone());
            }
            found.insert(genre, art);
        }
    }
    Ok(Some(found))
}

/// Films per franchise collection (the longest are a few dozen).
const MAX_PARTS: usize = 60;

/// A TMDB collection (a franchise: "The Lord of the Rings Collection").
#[derive(Serialize)]
pub struct Franchise {
    id: u64,
    name: String,
    overview: Option<String>,
    poster: Option<String>,
    backdrop: Option<String>,
    /// In release order; unreleased and undated films last.
    parts: Vec<TmdbTitle>,
}

#[derive(Deserialize)]
struct CollectionRef {
    id: u64,
}

#[derive(Deserialize)]
struct MovieDetails {
    belongs_to_collection: Option<CollectionRef>,
}

#[derive(Deserialize)]
struct CollectionDetails {
    id: u64,
    name: String,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    #[serde(default)]
    parts: Vec<Item>,
}

fn check_tmdb_id(id: u64) -> Result<(), String> {
    if (1..=1_000_000_000).contains(&id) { Ok(()) } else { Err("invalid TMDB id".into()) }
}

/// Films in release order: dated ones by date, then the rest in TMDB's order.
fn release_order(mut parts: Vec<Item>) -> Vec<Item> {
    let date = |i: &Item| i.release_date.clone().filter(|d| d.len() >= 4).unwrap_or_else(|| "9999".into());
    parts.sort_by_key(date);
    parts
}

async fn franchise(token: &str, id: u64) -> Result<Franchise, String> {
    let details: CollectionDetails = get(token, &format!("collection/{id}"), &[]).await?;
    let mut parts = release_order(details.parts);
    parts.truncate(MAX_PARTS);
    let text = |s: Option<String>| s.map(|s| s.trim().chars().take(2000).collect::<String>()).filter(|s| !s.is_empty());
    Ok(Franchise {
        id: details.id,
        name: details.name.chars().take(300).collect(),
        overview: text(details.overview),
        poster: image(details.poster_path.as_deref(), "w342"),
        backdrop: image(details.backdrop_path.as_deref(), "w1280"),
        parts: with_imdb_ids(token, parts.into_iter().map(|i| (false, i)).collect()).await,
    })
}

/// What TMDB says about a movie's franchise (`franchise` is `None` when it's in none).
#[derive(Serialize)]
pub struct TitleCollection {
    franchise: Option<Franchise>,
}

/// The franchise a movie belongs to, with its films. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_title_collection(imdb_id: String) -> Result<Option<TitleCollection>, String> {
    check_imdb_id(&imdb_id)?;
    let Some(token) = token()? else { return Ok(None) };
    let none = Ok(Some(TitleCollection { franchise: None }));
    let Some(id) = tmdb_id(&token, &imdb_id, false).await? else { return none };
    let details: MovieDetails = get(&token, &format!("movie/{id}"), &[]).await?;
    let Some(collection) = details.belongs_to_collection else { return none };
    check_tmdb_id(collection.id)?;
    Ok(Some(TitleCollection { franchise: Some(franchise(&token, collection.id).await?) }))
}

/// A TMDB collection by its id. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_collection(id: u64) -> Result<Option<Franchise>, String> {
    check_tmdb_id(id)?;
    let Some(token) = token()? else { return Ok(None) };
    Ok(Some(franchise(&token, id).await?))
}

/// A custom collection's TMDB source (a list, collection, company, network,
/// person, director or discover query), as collections files describe them.
/// Every field is checked here, and only known filters reach TMDB.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRequest {
    kind: String,
    id: Option<u64>,
    /// "movie" or "tv".
    media: String,
    sort: Option<String>,
    #[serde(default)]
    filters: HashMap<String, serde_json::Value>,
}

/// Where a source's titles come from at TMDB.
#[derive(Debug, PartialEq)]
enum SourcePlan {
    Collection(u64),
    List(u64),
    /// discover/movie or discover/tv, with its query.
    Discover { tv: bool, query: Vec<(String, String)> },
}

const SORTS: [&str; 10] = [
    "original",
    "popularity.desc",
    "vote_average.desc",
    "vote_count.desc",
    "primary_release_date.desc",
    "first_air_date.desc",
    "primary_release_date.asc",
    "first_air_date.asc",
    "title.asc",
    "name.asc",
];

/// A comma- or pipe-separated list of ids ("28,12" means all of, "28|12" any of).
fn id_list(value: &str) -> bool {
    !value.is_empty() && value.len() <= 300 && value.split([',', '|']).all(|part| !part.is_empty() && part.len() <= 12 && part.bytes().all(|b| b.is_ascii_digit()))
}

fn is_date(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// A filter as TMDB's parameter and value. Unknown filters are ignored; a
/// known one with a bad value is an error (the page validated it already).
fn filter_param(key: &str, value: &serde_json::Value, tv: bool) -> Result<Option<(&'static str, String)>, String> {
    let text = match value {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Null => return Ok(None),
        _ => return Err("invalid filter".into()),
    };
    if text.is_empty() {
        return Ok(None);
    }
    let number = |min: f64, max: f64| text.parse::<f64>().is_ok_and(|n| n.is_finite() && (min..=max).contains(&n));
    let (param, ok) = match key {
        "withGenres" => ("with_genres", id_list(&text)),
        "withoutGenres" => ("without_genres", id_list(&text)),
        "withKeywords" => ("with_keywords", id_list(&text)),
        "withoutKeywords" => ("without_keywords", id_list(&text)),
        "withCompanies" => ("with_companies", id_list(&text)),
        "withoutCompanies" => ("without_companies", id_list(&text)),
        "withNetworks" => ("with_networks", id_list(&text)),
        "withWatchProviders" => ("with_watch_providers", id_list(&text)),
        "withoutWatchProviders" => ("without_watch_providers", id_list(&text)),
        "releaseDateGte" => (if tv { "first_air_date.gte" } else { "primary_release_date.gte" }, is_date(&text)),
        "releaseDateLte" => (if tv { "first_air_date.lte" } else { "primary_release_date.lte" }, is_date(&text)),
        // When a show has an episode out (Anime's "Airing now"); films have no episodes.
        "airDateGte" | "airDateLte" if !tv => return Ok(None),
        "airDateGte" => ("air_date.gte", is_date(&text)),
        "airDateLte" => ("air_date.lte", is_date(&text)),
        "voteAverageGte" => ("vote_average.gte", number(0.0, 10.0)),
        "voteAverageLte" => ("vote_average.lte", number(0.0, 10.0)),
        "voteCountGte" => ("vote_count.gte", number(0.0, 10_000_000.0) && text.bytes().all(|b| b.is_ascii_digit())),
        "voteCountLte" => ("vote_count.lte", number(0.0, 10_000_000.0) && text.bytes().all(|b| b.is_ascii_digit())),
        // Minutes (Home's "Under 90 min" chip).
        "runtimeGte" => ("with_runtime.gte", number(0.0, 1000.0) && text.bytes().all(|b| b.is_ascii_digit())),
        "runtimeLte" => ("with_runtime.lte", number(0.0, 1000.0) && text.bytes().all(|b| b.is_ascii_digit())),
        "year" => (if tv { "first_air_date_year" } else { "primary_release_year" }, number(1870.0, 2100.0) && text.len() == 4),
        "withOriginalLanguage" => ("with_original_language", text.len() == 2 && text.bytes().all(|b| b.is_ascii_lowercase())),
        "withOriginCountry" => ("with_origin_country", check_region(&text).is_ok()),
        // An age certification and the country whose ratings it's from (Discover's
        // filters). TMDB's TV discover has no certifications, so shows ignore them.
        "certificationLte" | "certificationCountry" if tv => return Ok(None),
        "certificationLte" => ("certification.lte", clean_cert(&text).is_some_and(|c| c == text)),
        "certificationCountry" => ("certification_country", check_region(&text).is_ok()),
        "watchRegion" => ("watch_region", check_region(&text).is_ok()),
        // A film's release in one country, by kind (Discover's "In cinemas now", "New to
        // stream", "Upcoming"): TMDB's types 1 premiere … 6 TV, "2|3" any of them. Shows have none.
        "withReleaseType" | "region" | "regionReleaseDateGte" | "regionReleaseDateLte" if tv => return Ok(None),
        "withReleaseType" => ("with_release_type", text.len() <= 11 && text.split('|').all(|t| matches!(t, "1" | "2" | "3" | "4" | "5" | "6"))),
        "region" => ("region", check_region(&text).is_ok()),
        "regionReleaseDateGte" => ("release_date.gte", is_date(&text)),
        "regionReleaseDateLte" => ("release_date.lte", is_date(&text)),
        // People (Discover's cast and director filters): TMDB's TV discover has neither.
        "withCast" | "withCrew" if tv => return Ok(None),
        "withCast" => ("with_cast", id_list(&text)),
        "withCrew" => ("with_crew", id_list(&text)),
        _ => return Ok(None),
    };
    if ok { Ok(Some((param, text))) } else { Err("invalid filter".into()) }
}

fn plan_source(req: &SourceRequest) -> Result<SourcePlan, String> {
    let tv = match req.media.as_str() {
        "movie" => false,
        "tv" => true,
        _ => return Err("unknown media type".into()),
    };
    let sort = req.sort.as_deref().unwrap_or("original");
    if !SORTS.contains(&sort) {
        return Err("unknown sort".into());
    }
    let tmdb_id = || {
        let id = req.id.ok_or("this source needs a TMDB id")?;
        check_tmdb_id(id)?;
        Ok::<_, String>(id)
    };
    let id = || tmdb_id().map(|id| id.to_string());
    let mut query: Vec<(String, String)> = Vec::new();
    let tv = match req.kind.as_str() {
        "collection" => return Ok(SourcePlan::Collection(tmdb_id()?)),
        "list" => return Ok(SourcePlan::List(tmdb_id()?)),
        "company" => {
            query.push(("with_companies".into(), id()?));
            tv
        }
        // Networks are TV's.
        "network" => {
            query.push(("with_networks".into(), id()?));
            true
        }
        // TMDB's discover finds people's films, not their shows.
        "person" | "director" if tv => return Err("not supported for shows".into()),
        "person" => {
            query.push(("with_cast".into(), id()?));
            false
        }
        "director" => {
            query.push(("with_crew".into(), id()?));
            false
        }
        "discover" => tv,
        _ => return Err("unknown source".into()),
    };
    for (key, value) in &req.filters {
        if let Some((param, value)) = filter_param(key, value, tv)? {
            // The source's own id wins over a filter repeating it.
            if !query.iter().any(|(p, _)| p == param) {
                query.push((param.into(), value));
            }
        }
    }
    // A release-date sort names the kind's own date field.
    let sort = match (sort, tv) {
        ("original", _) => "popularity.desc",
        ("primary_release_date.desc", true) => "first_air_date.desc",
        ("first_air_date.desc", false) => "primary_release_date.desc",
        ("primary_release_date.asc", true) => "first_air_date.asc",
        ("first_air_date.asc", false) => "primary_release_date.asc",
        // Movies have titles, shows names.
        ("title.asc", true) => "name.asc",
        ("name.asc", false) => "title.asc",
        (sort, _) => sort,
    };
    query.push(("sort_by".into(), sort.into()));
    query.sort();
    Ok(SourcePlan::Discover { tv, query })
}

#[derive(Deserialize)]
struct ListPage {
    #[serde(default)]
    items: Vec<Item>,
    #[serde(default)]
    total_pages: u32,
}

/// One page (about 20) of a custom collection's TMDB source. Collections
/// have one page. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_source_page(source: SourceRequest, page: u32) -> Result<Option<ServicePage>, String> {
    let plan = plan_source(&source)?;
    if !(1..=MAX_PAGE).contains(&page) {
        return Err("page out of range".into());
    }
    let Some(token) = token()? else { return Ok(None) };
    let page_text = page.to_string();
    let (items, done) = match plan {
        SourcePlan::Collection(id) => {
            if page > 1 {
                return Ok(Some(ServicePage { titles: Vec::new(), done: true }));
            }
            let details: CollectionDetails = get(&token, &format!("collection/{id}"), &[]).await?;
            let mut parts = release_order(details.parts);
            parts.truncate(MAX_PARTS);
            (parts.into_iter().map(|i| (false, i)).collect::<Vec<_>>(), true)
        }
        SourcePlan::List(id) => {
            let list: ListPage = get(&token, &format!("list/{id}"), &[("page", &page_text)]).await?;
            let done = page >= list.total_pages.min(MAX_PAGE) || list.items.is_empty();
            let fallback = source.media == "tv";
            // Lists mix movies and shows, and say which each is.
            let typed = list
                .items
                .into_iter()
                .filter_map(|item| match item.media_type.as_deref() {
                    Some("movie") => Some((false, item)),
                    Some("tv") => Some((true, item)),
                    None => Some((fallback, item)),
                    _ => None,
                })
                .collect();
            (typed, done)
        }
        SourcePlan::Discover { tv, query } => {
            let mut pairs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            pairs.push(("page", &page_text));
            let result = get::<Page>(&token, if tv { "discover/tv" } else { "discover/movie" }, &pairs).await?;
            let done = page >= result.total_pages.min(MAX_PAGE) || result.results.is_empty();
            (result.results.into_iter().map(|i| (tv, i)).collect(), done)
        }
    };
    Ok(Some(ServicePage { titles: with_imdb_ids(&token, items).await, done }))
}

/// Cast members shown on a title page.
const MAX_CAST: usize = 20;
/// Titles on a person's page.
const MAX_KNOWN_FOR: usize = 24;
/// TMDB genres for talk shows and news, where a credit is usually an appearance as themselves.
const APPEARANCE_GENRES: [u32; 2] = [10767, 10763];

#[derive(Serialize)]
pub struct CastMember {
    /// TMDB's person id, for the person's page.
    id: u64,
    name: String,
    character: Option<String>,
    photo: Option<String>,
    /// The avatar picker's only: a still or backdrop of this title TMDB tagged
    /// with this person, i.e. them in the role (a headshot shows the actor).
    #[serde(skip_serializing_if = "Option::is_none")]
    still: Option<String>,
}

#[derive(Deserialize)]
struct Credits {
    #[serde(default)]
    cast: Vec<Credit>,
}

#[derive(Deserialize)]
struct Credit {
    id: u64,
    name: String,
    character: Option<String>,
    profile_path: Option<String>,
    /// A series' aggregate credits list each role instead of one character.
    #[serde(default)]
    roles: Vec<Role>,
}

#[derive(Deserialize)]
struct Role {
    character: Option<String>,
}

/// A title's cast, with photos and characters. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_cast(imdb_id: String, kind: String) -> Result<Option<Vec<CastMember>>, String> {
    check_imdb_id(&imdb_id)?;
    let tv = kind_is_tv(&kind)?;
    let Some(token) = token()? else { return Ok(None) };
    let Some(id) = tmdb_id(&token, &imdb_id, tv).await? else { return Ok(Some(Vec::new())) };
    Ok(Some(cast_of(&token, tv, id).await?))
}

/// The cast of the title TMDB knows as `id`, for the profile avatar picker
/// (which searches TMDB directly, so it has no IMDb id), each with a still of
/// them in this title when TMDB has one tagged. `None` without a token.
#[tauri::command]
pub async fn tmdb_cast_by_id(id: u64, kind: String) -> Result<Option<Vec<CastMember>>, String> {
    let tv = kind_is_tv(&kind)?;
    let Some(token) = token()? else { return Ok(None) };
    let mut cast = cast_of(&token, tv, id).await?;
    let lookups: Vec<_> = cast
        .iter()
        .map(|member| {
            let (token, person) = (token.clone(), member.id);
            tauri::async_runtime::spawn(async move { still_of(&token, person, tv, id).await })
        })
        .collect();
    for (member, lookup) in cast.iter_mut().zip(lookups) {
        member.still = lookup.await.ok().flatten();
    }
    Ok(Some(cast))
}

/// (person, is TV, title) → their tagged still in that title, if any.
type Stills = HashMap<(u64, bool, u64), Option<String>>;
/// Stills already looked up this session: a picker reopened on the same show asks TMDB nothing.
static STILLS: LazyLock<Mutex<Stills>> = LazyLock::new(Default::default);
const MAX_STILLS: usize = 2_000;

#[derive(Deserialize)]
struct Tagged {
    #[serde(default)]
    results: Vec<TaggedImage>,
}

#[derive(Deserialize)]
struct TaggedImage {
    file_path: Option<String>,
    image_type: Option<String>,
    media_type: Option<String>,
    media: Option<TaggedMedia>,
}

#[derive(Deserialize)]
struct TaggedMedia {
    id: Option<u64>,
    /// An episode's show.
    show_id: Option<u64>,
}

/// The first still or backdrop of the title (`tv`, `id`) among a person's
/// tagged images. Posters are skipped: they show the title, not the role.
fn tagged_still(images: &[TaggedImage], tv: bool, id: u64) -> Option<String> {
    images
        .iter()
        .filter(|i| matches!(i.image_type.as_deref(), Some("still" | "backdrop")))
        .filter(|i| {
            let media = i.media.as_ref();
            match (tv, i.media_type.as_deref()) {
                (false, Some("movie")) | (true, Some("tv")) => media.and_then(|m| m.id) == Some(id),
                (true, Some("episode" | "tv_episode")) => media.and_then(|m| m.show_id) == Some(id),
                _ => false,
            }
        })
        .find_map(|i| image(i.file_path.as_deref(), "w300"))
}

/// `person`'s tagged still in the title, looked up once per session. A failed
/// lookup isn't kept, and just leaves the headshot.
async fn still_of(token: &str, person: u64, tv: bool, id: u64) -> Option<String> {
    let key = (person, tv, id);
    if let Some(known) = STILLS.lock().ok().and_then(|cache| cache.get(&key).cloned()) {
        return known;
    }
    let tagged = {
        let _slot = RATING_SLOTS.acquire().await.ok()?;
        get::<Tagged>(token, &format!("person/{person}/tagged_images"), &[("page", "1")]).await.ok()?
    };
    let found = tagged_still(&tagged.results, tv, id);
    if let Ok(mut cache) = STILLS.lock() {
        if cache.len() >= MAX_STILLS {
            cache.clear();
        }
        cache.insert(key, found.clone());
    }
    found
}

async fn cast_of(token: &str, tv: bool, id: u64) -> Result<Vec<CastMember>, String> {
    let path = if tv { format!("tv/{id}/aggregate_credits") } else { format!("movie/{id}/credits") };
    let credits: Credits = get(token, &path, &[]).await?;
    Ok(credits
        .cast
        .into_iter()
        .take(MAX_CAST)
        .map(|c| CastMember {
            photo: image(c.profile_path.as_deref(), "w185"),
            character: c.character.or_else(|| c.roles.into_iter().find_map(|r| r.character)).filter(|ch| !ch.trim().is_empty()),
            id: c.id,
            name: c.name,
            still: None,
        })
        .collect())
}

/// Titles a search finds, for the avatar picker.
const MAX_TITLE_HITS: usize = 12;

/// A movie or show found by name, named by TMDB's own id (enough to list its cast).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleHit {
    id: u64,
    /// "movie" or "series".
    kind: &'static str,
    name: String,
    year: Option<String>,
    poster: Option<String>,
    /// For content limits, which rate titles by IMDb id (see `with_hit_imdb_ids`).
    imdb_id: Option<String>,
    /// In TMDB's Animation genre: the picker looks anime up on AniList, and
    /// never offers a voice actor's headshot as a cartoon character.
    animated: bool,
}

/// TMDB's Animation genre id (the same for movies and TV).
const ANIMATION_GENRE: u32 = 16;

/// A search or trending result as a `TitleHit`: `tv` says which kind it is
/// (`None` reads TMDB's `media_type`, so people are skipped). Adult and
/// nameless titles are left out.
fn title_hit(i: Item, tv: Option<bool>) -> Option<TitleHit> {
    if i.adult {
        return None;
    }
    let tv = match (tv, i.media_type.as_deref()) {
        (Some(tv), _) => tv,
        (None, Some("movie")) => false,
        (None, Some("tv")) => true,
        _ => return None,
    };
    let name = i.title.or(i.name).filter(|n| !n.trim().is_empty())?;
    let date = if tv { i.first_air_date.as_deref() } else { i.release_date.as_deref() };
    Some(TitleHit {
        id: i.id,
        kind: if tv { "series" } else { "movie" },
        name,
        year: date.and_then(|d| d.get(..4)).filter(|y| y.bytes().all(|b| b.is_ascii_digit())).map(str::to_owned),
        poster: image(i.poster_path.as_deref(), "w185"),
        imdb_id: None,
        animated: i.genre_ids.contains(&ANIMATION_GENRE),
    })
}

/// Gives each hit its IMDb id (looked up in parallel, cached), so a profile's
/// content limit can rate it like any other title; hits without one stay, unrated.
async fn with_hit_imdb_ids(token: &str, hits: Vec<TitleHit>) -> Vec<TitleHit> {
    let lookups: Vec<_> = hits
        .iter()
        .map(|hit| {
            let (token, tv, id) = (token.to_owned(), hit.kind == "series", hit.id);
            tauri::async_runtime::spawn(async move { lookup_imdb_id(&token, tv, id).await })
        })
        .collect();
    let mut found = Vec::with_capacity(hits.len());
    for (mut hit, lookup) in hits.into_iter().zip(lookups) {
        hit.imdb_id = lookup.await.ok().flatten();
        found.push(hit);
    }
    found
}

/// Movies and shows whose name matches `query`, most popular first; adult
/// titles are left out. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_search_titles(query: String) -> Result<Option<Vec<TitleHit>>, String> {
    let Some(query) = clean_query(&query) else { return Err("invalid search".into()) };
    let Some(token) = token()? else { return Ok(None) };
    let page: Page = get(&token, "search/multi", &[("query", &query), ("include_adult", "false"), ("page", "1")]).await?;
    let hits = page.results.into_iter().filter_map(|i| title_hit(i, None)).take(MAX_TITLE_HITS).collect();
    Ok(Some(with_hit_imdb_ids(&token, hits).await))
}

/// This week's most popular shows, for the avatar picker's quick picks (their
/// casts are the characters people look for). `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_trending_shows() -> Result<Option<Vec<TitleHit>>, String> {
    let Some(token) = token()? else { return Ok(None) };
    let page: Page = get(&token, "trending/tv/week", &[]).await?;
    let hits = page.results.into_iter().filter_map(|i| title_hit(i, Some(true))).take(MAX_TITLE_HITS).collect();
    Ok(Some(with_hit_imdb_ids(&token, hits).await))
}

#[derive(Deserialize)]
struct Company {
    name: String,
    logo_path: Option<String>,
}

#[derive(Deserialize)]
struct Genre {
    name: String,
}

#[derive(Deserialize, Default)]
struct Videos {
    #[serde(default)]
    results: Vec<Video>,
}

#[derive(Deserialize)]
struct Video {
    key: String,
    site: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize, Default)]
struct Images {
    #[serde(default)]
    backdrops: Vec<ImageFile>,
    #[serde(default)]
    posters: Vec<ImageFile>,
    #[serde(default)]
    logos: Vec<ImageFile>,
}

#[derive(Deserialize)]
struct ImageFile {
    file_path: Option<String>,
}

#[derive(Deserialize)]
struct TitleDetails {
    title: Option<String>,
    name: Option<String>,
    overview: Option<String>,
    vote_average: Option<f64>,
    #[serde(default)]
    vote_count: u64,
    #[serde(default)]
    networks: Vec<Company>,
    #[serde(default)]
    production_companies: Vec<Company>,
    status: Option<String>,
    original_language: Option<String>,
    #[serde(default)]
    genres: Vec<Genre>,
    #[serde(default)]
    budget: u64,
    #[serde(default)]
    revenue: u64,
    #[serde(default)]
    videos: Videos,
    #[serde(default)]
    images: Images,
}

#[derive(Serialize)]
pub struct Logo {
    name: String,
    logo: String,
}

/// A YouTube video about the title (trailer, teaser, clip…).
#[derive(Serialize)]
pub struct MediaVideo {
    /// The 11-character YouTube id, the only thing the trailer player accepts.
    key: String,
    name: String,
    /// TMDB's type, as a key the page translates; None for types Orbit doesn't name.
    kind: Option<&'static str>,
}

/// An image at two sizes: one for the row, one for the full-size viewer.
#[derive(Serialize)]
pub struct MediaImage {
    thumb: String,
    full: String,
}

#[derive(Serialize, Default)]
pub struct MediaImages {
    backdrops: Vec<MediaImage>,
    posters: Vec<MediaImage>,
    logos: Vec<MediaImage>,
}

/// TMDB's score for a title, the logos of who made or airs it, the facts
/// for its Details list, and its videos and images for the Media row.
#[derive(Serialize, Default)]
pub struct Extras {
    /// TMDB's own id for the title, for the title page's "Open on TMDB" and "Open on Letterboxd" links.
    tmdb_id: Option<u64>,
    /// Out of 10; None with too few votes to mean much.
    rating: Option<f64>,
    votes: u64,
    logos: Vec<Logo>,
    /// The title's name and overview in Orbit's language, when TMDB has a translation.
    name: Option<String>,
    overview: Option<String>,
    /// TMDB's status, as a key the page translates.
    status: Option<&'static str>,
    /// Studios (movies) or networks (shows), by name.
    companies: Vec<String>,
    /// The original language's ISO 639-1 code; the page names it in Orbit's language.
    language: Option<String>,
    genres: Vec<String>,
    /// Movies only, in US dollars; None when TMDB doesn't know (it says 0).
    budget: Option<u64>,
    revenue: Option<u64>,
    videos: Vec<MediaVideo>,
    images: MediaImages,
}

/// Fewer votes than this and TMDB's average isn't shown.
const MIN_VOTES: u64 = 25;
/// Videos and images of each kind on a title page.
const MAX_VIDEOS: usize = 30;
const MAX_IMAGES: usize = 40;

fn status_key(status: &str) -> Option<&'static str> {
    Some(match status {
        "Released" => "released",
        "Returning Series" => "returning",
        "Ended" => "ended",
        "Canceled" | "Cancelled" => "canceled",
        "In Production" => "in-production",
        "Post Production" => "post-production",
        "Planned" => "planned",
        "Rumored" => "rumored",
        "Pilot" => "pilot",
        _ => return None,
    })
}

fn video_kind(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "Trailer" => "trailer",
        "Teaser" => "teaser",
        "Clip" => "clip",
        "Featurette" => "featurette",
        "Behind the Scenes" => "behind-the-scenes",
        "Bloopers" => "bloopers",
        "Opening Credits" => "opening-credits",
        "Recap" => "recap",
        _ => return None,
    })
}

/// YouTube videos only (the trailer player finds them with yt-dlp), trailers and teasers first.
fn media_videos(videos: Vec<Video>) -> Vec<MediaVideo> {
    let rank = |kind: Option<&str>| match kind {
        Some("trailer") => 0,
        Some("teaser") => 1,
        _ => 2,
    };
    let mut found: Vec<MediaVideo> = videos
        .into_iter()
        .filter(|v| v.site == "YouTube" && crate::trailer::valid_id(&v.key))
        .map(|v| MediaVideo { kind: video_kind(&v.kind), name: v.name.trim().chars().filter(|c| !c.is_control()).take(200).collect(), key: v.key })
        .collect();
    // Stable, so TMDB's order holds within each kind.
    found.sort_by_key(|v| rank(v.kind));
    found.truncate(MAX_VIDEOS);
    found
}

fn media_images(files: Vec<ImageFile>, thumb: &str, full: &str) -> Vec<MediaImage> {
    files
        .into_iter()
        .filter_map(|f| Some(MediaImage { thumb: image(f.file_path.as_deref(), thumb)?, full: image(f.file_path.as_deref(), full)? }))
        .take(MAX_IMAGES)
        .collect()
}

/// A title's TMDB score, its networks (shows) or studios (movies) that have
/// logos, its facts, videos and images, all in one request. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_extras(imdb_id: String, kind: String) -> Result<Option<Extras>, String> {
    check_imdb_id(&imdb_id)?;
    let tv = kind_is_tv(&kind)?;
    let Some(token) = token()? else { return Ok(None) };
    let Some(id) = tmdb_id(&token, &imdb_id, tv).await? else { return Ok(Some(Extras::default())) };
    // Images and videos in Orbit's language, English, and none (most backdrops have no text).
    let lang = LANGUAGE.lock().map(|l| l.get(..2).unwrap_or("en").to_string()).unwrap_or_else(|_| "en".into());
    let languages = if lang == "en" { "en,null".to_string() } else { format!("{lang},en,null") };
    let query = [("append_to_response", "videos,images"), ("include_image_language", languages.as_str()), ("include_video_language", languages.as_str())];
    let details: TitleDetails = get(&token, &format!("{}/{id}", if tv { "tv" } else { "movie" }), &query).await?;
    let text = |s: Option<String>, max: usize| s.map(|s| s.trim().chars().filter(|c| !c.is_control()).take(max).collect::<String>()).filter(|s| !s.is_empty());
    // A show is known by its network; a movie by its studios.
    let (companies, max) = if tv && !details.networks.is_empty() { (details.networks, 2) } else { (details.production_companies, 3) };
    let names = companies.iter().filter_map(|c| text(Some(c.name.clone()), 80)).take(3).collect();
    let logos = companies
        .into_iter()
        .filter_map(|c| Some(Logo { logo: image(c.logo_path.as_deref(), "w154")?, name: c.name.chars().take(80).collect() }))
        .take(max)
        .collect();
    let rating = details.vote_average.filter(|r| r.is_finite() && *r > 0.0 && details.vote_count >= MIN_VOTES);
    let images = details.images;
    // TMDB answers "" where there's no translation; then the addon's own text stays.
    Ok(Some(Extras {
        tmdb_id: Some(id),
        rating,
        votes: details.vote_count,
        logos,
        name: text(details.title.or(details.name), 300),
        overview: text(details.overview, 2000),
        status: details.status.as_deref().and_then(status_key),
        companies: names,
        // "xx" is TMDB's "no language".
        language: details.original_language.filter(|l| (2..=3).contains(&l.len()) && l.bytes().all(|b| b.is_ascii_lowercase()) && l != "xx"),
        genres: details.genres.into_iter().filter_map(|g| text(Some(g.name), 40)).take(6).collect(),
        budget: Some(details.budget).filter(|b| !tv && *b > 0),
        revenue: Some(details.revenue).filter(|r| !tv && *r > 0),
        videos: media_videos(details.videos.results),
        images: MediaImages {
            backdrops: media_images(images.backdrops, "w300", "w1280"),
            posters: media_images(images.posters, "w185", "w780"),
            logos: media_images(images.logos, "w300", "w500"),
        },
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    name: String,
    biography: Option<String>,
    birthday: Option<String>,
    deathday: Option<String>,
    place_of_birth: Option<String>,
    photo: Option<String>,
    known_for: Vec<TmdbTitle>,
}

#[derive(Deserialize)]
struct PersonDetails {
    name: String,
    biography: Option<String>,
    birthday: Option<String>,
    deathday: Option<String>,
    place_of_birth: Option<String>,
    profile_path: Option<String>,
}

/// TMDB's `combined_credits` keeps its acting credits in `cast`, which `Page` doesn't read.
#[derive(Deserialize)]
struct CombinedCredits {
    #[serde(default)]
    cast: Vec<Item>,
}

/// A person's page: details, and the titles they're best known for (by how
/// many people rated them), each with an IMDb id. `None` without a token.
#[tauri::command]
pub async fn tmdb_person(id: u64) -> Result<Option<Person>, String> {
    if id == 0 || id > 100_000_000 {
        return Err("invalid person".into());
    }
    let Some(token) = token()? else { return Ok(None) };
    let details: PersonDetails = get(&token, &format!("person/{id}"), &[]).await?;
    let credits: CombinedCredits = get(&token, &format!("person/{id}/combined_credits"), &[]).await?;
    let mut seen = std::collections::HashSet::new();
    let mut titles: Vec<(bool, Item)> = credits
        .cast
        .into_iter()
        .filter(|i| !i.genre_ids.iter().any(|g| APPEARANCE_GENRES.contains(g)))
        .filter_map(|i| match i.media_type.as_deref() {
            Some("movie") => Some((false, i)),
            Some("tv") => Some((true, i)),
            _ => None,
        })
        .filter(|(tv, i)| seen.insert((*tv, i.id)))
        .collect();
    titles.sort_by(|a, b| b.1.vote_count.total_cmp(&a.1.vote_count));
    titles.truncate(MAX_KNOWN_FOR);
    let text = |t: Option<String>| t.filter(|v| !v.trim().is_empty());
    Ok(Some(Person {
        known_for: with_imdb_ids(&token, titles).await,
        photo: image(details.profile_path.as_deref(), "h632"),
        name: details.name,
        biography: text(details.biography),
        birthday: text(details.birthday),
        deathday: text(details.deathday),
        place_of_birth: text(details.place_of_birth),
    }))
}

/// People in a search's answer.
const MAX_PEOPLE: usize = 12;
/// Titles named under each person found.
const MAX_PERSON_TITLES: usize = 3;
/// The longest search sent to TMDB (anything longer isn't a name).
const MAX_QUERY_CHARS: usize = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonHit {
    /// TMDB's person id, for the person's page.
    id: u64,
    name: String,
    photo: Option<String>,
    /// A few titles they're known for, by name.
    known_for: Vec<String>,
}

#[derive(Deserialize)]
struct PersonResult {
    id: u64,
    #[serde(default)]
    name: String,
    profile_path: Option<String>,
    /// TMDB's own adult-content flag.
    #[serde(default)]
    adult: bool,
    #[serde(default)]
    known_for: Vec<Item>,
}

#[derive(Deserialize)]
struct PeoplePage {
    #[serde(default)]
    results: Vec<PersonResult>,
}

/// A search as TMDB gets it: trimmed, one line, not too long; `None` when there's nothing to search.
fn clean_query(query: &str) -> Option<String> {
    let query = query.trim();
    (!query.is_empty() && query.chars().count() <= MAX_QUERY_CHARS && !query.chars().any(char::is_control)).then(|| query.to_owned())
}

/// The people a search finds, most popular first: adult performers are left
/// out, and so is anyone TMDB knows no titles for.
fn people_hits(page: PeoplePage) -> Vec<PersonHit> {
    page.results
        .into_iter()
        .filter(|p| !p.adult && !p.name.trim().is_empty() && !p.known_for.is_empty())
        .take(MAX_PEOPLE)
        .map(|p| PersonHit {
            photo: image(p.profile_path.as_deref(), "w185"),
            known_for: p.known_for.into_iter().filter(|i| !i.adult).filter_map(|i| i.title.or(i.name)).filter(|n| !n.trim().is_empty()).take(MAX_PERSON_TITLES).collect(),
            id: p.id,
            name: p.name,
        })
        .collect()
}

/// People whose name matches `query` (Search's People row). `None` without a token.
#[tauri::command]
pub async fn tmdb_search_people(query: String) -> Result<Option<Vec<PersonHit>>, String> {
    let Some(query) = clean_query(&query) else { return Err("invalid search".into()) };
    let Some(token) = token()? else { return Ok(None) };
    let page: PeoplePage = get(&token, "search/person", &[("query", &query), ("include_adult", "false"), ("page", "1")]).await?;
    Ok(Some(people_hits(page)))
}

/// Titles per `tmdb_certifications` call.
const MAX_RATED: usize = 50;
/// Titles looked up at TMDB at once, across calls (a rating is two requests; IMDb ids, release dates and finds share them).
static RATING_SLOTS: LazyLock<tokio::sync::Semaphore> = LazyLock::new(|| tokio::sync::Semaphore::new(6));
/// How long certifications are kept: found ones rarely change; a title
/// without any may get one, so it's asked about again sooner.
const RATED_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const UNRATED_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const MAX_COUNTRIES: usize = 120;

#[derive(Deserialize)]
pub struct RatingRequest {
    id: String,
    /// "movie" or "series".
    kind: String,
}

#[derive(Serialize)]
pub struct Rating {
    id: String,
    /// Certifications for the region asked for and the US, by country code.
    /// Empty when TMDB doesn't know the title or has no certification.
    certs: HashMap<String, String>,
    adult: bool,
}

#[derive(Deserialize)]
struct ReleaseDates {
    #[serde(default)]
    results: Vec<CountryReleases>,
}

#[derive(Deserialize)]
struct CountryReleases {
    iso_3166_1: String,
    #[serde(default)]
    release_dates: Vec<Release>,
}

#[derive(Deserialize)]
struct Release {
    #[serde(default)]
    certification: String,
    #[serde(rename = "type", default)]
    kind: u8,
    /// "2025-03-14T00:00:00.000Z" (read by the Calendar's film releases).
    #[serde(default)]
    release_date: String,
}

#[derive(Deserialize)]
struct ContentRatings {
    #[serde(default)]
    results: Vec<CountryRating>,
}

#[derive(Deserialize)]
struct CountryRating {
    iso_3166_1: String,
    #[serde(default)]
    rating: String,
}

/// A certification as TMDB lists it ("PG-13", "MA15+", "U/A 13+", "M/12"),
/// kept only if it looks like one: it's shown and matched in the page.
pub(crate) fn clean_cert(text: &str) -> Option<String> {
    let text = text.trim();
    let ok = (1..=12).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_alphanumeric() || b" +-/".contains(&b));
    ok.then(|| text.to_owned())
}

/// Release types in the order their certification is read: theatrical,
/// digital, limited, physical, TV, premiere.
const RELEASE_ORDER: [u8; 6] = [3, 4, 2, 5, 6, 1];

/// A movie's certification per country.
fn movie_certs(dates: ReleaseDates) -> HashMap<String, String> {
    dates
        .results
        .into_iter()
        .filter(|country| check_region(&country.iso_3166_1).is_ok())
        .filter_map(|country| {
            let rank = |kind: u8| RELEASE_ORDER.iter().position(|k| *k == kind).unwrap_or(RELEASE_ORDER.len());
            let best = country.release_dates.iter().filter_map(|r| Some((rank(r.kind), clean_cert(&r.certification)?))).min_by_key(|(rank, _)| *rank);
            best.map(|(_, cert)| (country.iso_3166_1, cert))
        })
        .take(MAX_COUNTRIES)
        .collect()
}

/// A show's rating per country.
fn tv_certs(ratings: ContentRatings) -> HashMap<String, String> {
    ratings
        .results
        .into_iter()
        .filter(|country| check_region(&country.iso_3166_1).is_ok())
        .filter_map(|country| Some((country.iso_3166_1, clean_cert(&country.rating)?)))
        .take(MAX_COUNTRIES)
        .collect()
}

/// A title's certifications in every country TMDB lists, and its adult flag.
async fn fetch_rating(token: &str, imdb_id: &str, tv: bool) -> Result<(HashMap<String, String>, bool), String> {
    let _slot = RATING_SLOTS.acquire().await.map_err(|_| "busy")?;
    let find: Find = get(token, &format!("find/{imdb_id}"), &[("external_source", "imdb_id")]).await?;
    let Some((item, tv)) = found_title(find, tv) else { return Ok((HashMap::new(), false)) };
    let certs = if tv { tv_certs(get(token, &format!("tv/{}/content_ratings", item.id), &[]).await?) } else { movie_certs(get(token, &format!("movie/{}/release_dates", item.id), &[]).await?) };
    Ok((certs, item.adult))
}

/// The title an IMDb id names, and whether it's a series: of the kind asked
/// for, else of the other. The kind comes from an addon (untrusted), and the
/// answer is cached by IMDb id alone: a series an addon lists as a movie must
/// still be rated as the series it is, not stored as unrated for everyone.
fn found_title(find: Find, tv: bool) -> Option<(Item, bool)> {
    let (wanted, other) = if tv { (find.tv_results, find.movie_results) } else { (find.movie_results, find.tv_results) };
    match wanted.into_iter().next() {
        Some(item) => Some((item, tv)),
        None => other.into_iter().next().map(|item| (item, !tv)),
    }
}

/// A cached row's certifications, unless they've expired.
fn fresh_certs(json: &str, fetched_at: i64, now: i64) -> Option<HashMap<String, String>> {
    let certs: HashMap<String, String> = serde_json::from_str(json).ok()?;
    let ttl = if certs.is_empty() { UNRATED_TTL_MS } else { RATED_TTL_MS };
    crate::library::fresh(fetched_at, now, ttl).then_some(certs)
}

/// Certifications for titles (by IMDb id) in every country TMDB lists (the
/// page reads `region`'s first), from the cache or TMDB, for content limits on profiles. Titles whose lookup failed
/// are left out (and asked about again next time). `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_certifications(db: State<'_, Db>, titles: Vec<RatingRequest>, region: String) -> Result<Option<Vec<Rating>>, String> {
    check_region(&region)?;
    if titles.len() > MAX_RATED {
        return Err("too many titles".into());
    }
    let wanted = titles
        .into_iter()
        .map(|t| {
            check_imdb_id(&t.id)?;
            Ok((t.id, kind_is_tv(&t.kind)?))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let Some(token) = token()? else { return Ok(None) };
    let now = now_ms();
    // Every country's: the page reads `region` first, then the US, and failing both the strictest
    // other country's, so a title rated only abroad isn't taken for unrated (catalog/ratings.ts).
    let pick = |id: String, certs: &HashMap<String, String>, adult: bool| Rating { id, certs: certs.clone(), adult };

    let mut found = Vec::with_capacity(wanted.len());
    let mut missing = Vec::new();
    {
        let conn = db.lock()?;
        let mut stmt = conn.prepare("SELECT certs, adult, fetched_at FROM title_ratings WHERE imdb_id = ?1").map_err(|e| e.to_string())?;
        for (id, tv) in wanted {
            let row: Option<(String, bool, i64)> = stmt.query_row([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().map_err(|e| e.to_string())?;
            match row.and_then(|(json, adult, at)| Some((fresh_certs(&json, at, now)?, adult))) {
                Some((certs, adult)) => found.push(pick(id, &certs, adult)),
                None => missing.push((id, tv)),
            }
        }
    }

    let lookups: Vec<_> = missing
        .into_iter()
        .map(|(id, tv)| {
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                let result = fetch_rating(&token, &id, tv).await;
                (id, result)
            })
        })
        .collect();
    let mut fetched = Vec::new();
    for lookup in lookups {
        if let Ok((id, Ok(rating))) = lookup.await {
            fetched.push((id, rating));
        }
    }
    if !fetched.is_empty() {
        let mut conn = db.lock()?;
        // One transaction: one disk sync for the batch, not one per title.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        // Rows nobody asked about for a while go, so the cache stays small.
        tx.execute("DELETE FROM title_ratings WHERE fetched_at < ?1", [now - RATED_TTL_MS]).map_err(|e| e.to_string())?;
        for (id, (certs, adult)) in &fetched {
            tx.execute(
                "INSERT INTO title_ratings (imdb_id, certs, adult, fetched_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(imdb_id) DO UPDATE SET certs = excluded.certs, adult = excluded.adult, fetched_at = excluded.fetched_at",
                params![id, serde_json::to_string(certs).map_err(|e| e.to_string())?, adult, now],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    found.extend(fetched.into_iter().map(|(id, (certs, adult))| pick(id, &certs, adult)));
    Ok(Some(found))
}

// ── Episodes: ratings per season and story arcs ──────────────────────────

/// A season or a story-arc listing can hold every episode of a long show
/// (with guest stars and overviews), well beyond `LIMIT`.
const EPISODES_LIMIT: usize = 8 * 1024 * 1024;
/// With fewer votes than this an episode's average says little (one vote of 10 is "10.0").
const MIN_EPISODE_VOTES: u64 = 5;
/// The highest season number asked about (One Piece and the like stay well under).
const MAX_SEASON: u32 = 500;
const MAX_SEASON_EPISODES: usize = 2000;
/// TMDB's episode group type for story arcs (1 air date, 2 absolute, 3 DVD,
/// 4 digital, 5 story arc, 6 production, 7 TV).
const STORY_ARC_GROUP: u8 = 5;
const MAX_ARCS: usize = 400;
const MAX_ARC_EPISODES: usize = 5000;
/// Session caches stop growing past this many entries (then start over).
const MAX_CACHED: usize = 500;

/// A show's TMDB id by IMDb id (`None`: TMDB doesn't know it), for the session.
static TV_IDS: LazyLock<Mutex<HashMap<String, Option<u64>>>> = LazyLock::new(Default::default);
/// (TMDB show id, season) → its episodes' ratings.
type SeasonRatings = HashMap<(u64, u32), Vec<EpisodeRating>>;
/// Episode ratings by show and season, for the session.
static SEASON_RATINGS: LazyLock<Mutex<SeasonRatings>> = LazyLock::new(Default::default);
/// Story arcs by IMDb id (empty: the show has none), for the session.
static STORY_ARCS: LazyLock<Mutex<HashMap<String, Vec<StoryArc>>>> = LazyLock::new(Default::default);

fn remember<K: std::hash::Hash + Eq, V>(cache: &Mutex<HashMap<K, V>>, key: K, value: V) {
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= MAX_CACHED {
            cache.clear();
        }
        cache.insert(key, value);
    }
}

async fn tv_id(token: &str, imdb_id: &str) -> Result<Option<u64>, String> {
    if let Some(known) = TV_IDS.lock().ok().and_then(|cache| cache.get(imdb_id).copied()) {
        return Ok(known);
    }
    let id = tmdb_id(token, imdb_id, true).await?;
    remember(&TV_IDS, imdb_id.to_owned(), id);
    Ok(id)
}

#[derive(Deserialize)]
struct SeasonDetails {
    #[serde(default)]
    episodes: Vec<SeasonEpisode>,
}

#[derive(Deserialize)]
struct SeasonEpisode {
    episode_number: Option<u32>,
    vote_average: Option<f64>,
    #[serde(default)]
    vote_count: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct EpisodeRating {
    episode: u32,
    /// TMDB's average out of 10.
    rating: f64,
    votes: u64,
}

/// The season's episodes with enough votes for their average to mean something.
fn episode_ratings(season: SeasonDetails) -> Vec<EpisodeRating> {
    season
        .episodes
        .into_iter()
        .filter_map(|e| {
            let rating = e.vote_average.filter(|r| r.is_finite() && *r > 0.0 && *r <= 10.0)?;
            (e.vote_count >= MIN_EPISODE_VOTES).then_some(EpisodeRating { episode: e.episode_number?, rating, votes: e.vote_count })
        })
        .take(MAX_SEASON_EPISODES)
        .collect()
}

/// TMDB's ratings for a season's episodes (by episode number), from the
/// session cache or `/tv/{id}/season/{n}`. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_season_ratings(imdb_id: String, season: u32) -> Result<Option<Vec<EpisodeRating>>, String> {
    check_imdb_id(&imdb_id)?;
    if season > MAX_SEASON {
        return Err("season out of range".into());
    }
    let Some(token) = token()? else { return Ok(None) };
    let Some(id) = tv_id(&token, &imdb_id).await? else { return Ok(Some(Vec::new())) };
    if let Some(known) = SEASON_RATINGS.lock().ok().and_then(|cache| cache.get(&(id, season)).cloned()) {
        return Ok(Some(known));
    }
    let ratings = episode_ratings(get_limited(&token, &format!("tv/{id}/season/{season}"), &[], EPISODES_LIMIT).await?);
    remember(&SEASON_RATINGS, (id, season), ratings.clone());
    Ok(Some(ratings))
}

#[derive(Deserialize)]
struct EpisodeGroups {
    #[serde(default)]
    results: Vec<EpisodeGroupRef>,
}

#[derive(Deserialize)]
struct EpisodeGroupRef {
    id: String,
    #[serde(rename = "type", default)]
    kind: u8,
    #[serde(default)]
    episode_count: u32,
    #[serde(default)]
    group_count: u32,
}

#[derive(Deserialize)]
struct EpisodeGroupDetails {
    #[serde(default)]
    groups: Vec<ArcGroup>,
}

#[derive(Deserialize)]
struct ArcGroup {
    #[serde(default)]
    name: String,
    #[serde(default)]
    order: u32,
    #[serde(default)]
    episodes: Vec<ArcEpisode>,
}

#[derive(Deserialize)]
struct ArcEpisode {
    season_number: Option<u32>,
    episode_number: Option<u32>,
    #[serde(default)]
    order: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ArcEpisodeRef {
    season: u32,
    episode: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StoryArc {
    /// As TMDB's contributors named it ("East Blue", "Chunin Exams"); may be empty.
    name: String,
    /// Episodes by their real season and number, in the arc's order.
    episodes: Vec<ArcEpisodeRef>,
}

/// TMDB's group ids are short hex strings; only those go into a path.
fn valid_group_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// The story-arc grouping to use: of those covering (nearly) the most
/// episodes, the finest (One Piece has sagas and, within them, arcs).
fn story_arc_group(groups: &[EpisodeGroupRef]) -> Option<&str> {
    let arcs: Vec<_> = groups.iter().filter(|g| g.kind == STORY_ARC_GROUP && g.group_count >= 2 && valid_group_id(&g.id)).collect();
    let most = arcs.iter().map(|g| g.episode_count).max()?;
    arcs.into_iter().filter(|g| u64::from(g.episode_count) * 10 >= u64::from(most) * 9).max_by_key(|g| g.group_count).map(|g| g.id.as_str())
}

/// The arcs in order, each with its episodes in order; empty arcs are dropped.
fn story_arcs(details: EpisodeGroupDetails) -> Vec<StoryArc> {
    let mut groups = details.groups;
    groups.sort_by_key(|g| g.order);
    let mut total = 0;
    let mut arcs = Vec::new();
    for group in groups.into_iter().take(MAX_ARCS) {
        let mut episodes = group.episodes;
        episodes.sort_by_key(|e| e.order);
        let episodes: Vec<_> = episodes
            .into_iter()
            .filter_map(|e| Some(ArcEpisodeRef { season: e.season_number.filter(|s| *s <= MAX_SEASON)?, episode: e.episode_number? }))
            .take(MAX_ARC_EPISODES.saturating_sub(total))
            .collect();
        if episodes.is_empty() {
            continue;
        }
        total += episodes.len();
        let name = group.name.trim().chars().filter(|c| !c.is_control()).take(120).collect();
        arcs.push(StoryArc { name, episodes });
    }
    arcs
}

/// A show's story arcs (TMDB's "story arc" episode group), or an empty list
/// when it has none. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_story_arcs(imdb_id: String) -> Result<Option<Vec<StoryArc>>, String> {
    check_imdb_id(&imdb_id)?;
    let Some(token) = token()? else { return Ok(None) };
    if let Some(known) = STORY_ARCS.lock().ok().and_then(|cache| cache.get(&imdb_id).cloned()) {
        return Ok(Some(known));
    }
    let arcs = match tv_id(&token, &imdb_id).await? {
        None => Vec::new(),
        Some(id) => {
            let groups: EpisodeGroups = get(&token, &format!("tv/{id}/episode_groups"), &[]).await?;
            match story_arc_group(&groups.results) {
                None => Vec::new(),
                Some(group) => story_arcs(get_limited(&token, &format!("tv/episode_group/{group}"), &[], EPISODES_LIMIT).await?),
            }
        }
    };
    remember(&STORY_ARCS, imdb_id, arcs.clone());
    Ok(Some(arcs))
}

// ── Discover filters: age certifications ─────────────────────────────────

#[derive(Deserialize)]
struct CertificationList {
    #[serde(default)]
    certifications: HashMap<String, Vec<CertificationEntry>>,
}

#[derive(Deserialize)]
struct CertificationEntry {
    #[serde(default)]
    certification: String,
    #[serde(default)]
    order: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Certifications {
    /// The country they're from: the one asked for, or the US when TMDB has none for it.
    country: String,
    /// Mildest first, as TMDB orders them (Discover filters "up to" one).
    certifications: Vec<String>,
}

/// Country → its movie certifications, mildest first.
type CertificationsByCountry = HashMap<String, Vec<String>>;
/// Movie certifications by country, for the session.
static MOVIE_CERTIFICATIONS: LazyLock<Mutex<Option<CertificationsByCountry>>> = LazyLock::new(Default::default);

fn certifications_by_country(list: CertificationList) -> CertificationsByCountry {
    list.certifications
        .into_iter()
        .filter(|(country, _)| check_region(country).is_ok())
        .take(MAX_COUNTRIES)
        .map(|(country, mut entries)| {
            entries.sort_by_key(|e| e.order);
            let mut certs: Vec<String> = Vec::new();
            for cert in entries.iter().filter_map(|e| clean_cert(&e.certification)) {
                if !certs.contains(&cert) {
                    certs.push(cert);
                }
            }
            certs.truncate(30);
            (country, certs)
        })
        .filter(|(_, certs)| !certs.is_empty())
        .collect()
}

fn certifications_for(all: &CertificationsByCountry, region: &str) -> Option<Certifications> {
    let (country, certs) = all.get_key_value(region).or_else(|| all.get_key_value("US"))?;
    Some(Certifications { country: country.clone(), certifications: certs.clone() })
}

/// The movie certifications Discover can filter by in `region` (or the US's).
/// `None` without a TMDB token or when TMDB lists none.
#[tauri::command]
pub async fn tmdb_movie_certifications(region: String) -> Result<Option<Certifications>, String> {
    check_region(&region)?;
    let Some(token) = token()? else { return Ok(None) };
    let known = MOVIE_CERTIFICATIONS.lock().ok().and_then(|cache| cache.clone());
    let all = match known {
        Some(all) => all,
        None => {
            let all = certifications_by_country(get(&token, "certification/movie/list", &[]).await?);
            if let Ok(mut cache) = MOVIE_CERTIFICATIONS.lock() {
                *cache = Some(all.clone());
            }
            all
        }
    };
    Ok(certifications_for(&all, &region))
}

// ── My Library → Calendar: film release dates ─────────────────────────────

/// Films per `tmdb_release_dates` call (the calendar asks about recent library films only).
const MAX_RELEASE_TITLES: usize = 60;

/// One way a film comes out in a country, on a calendar day.
#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct ReleaseDate {
    /// "cinema", "digital" or "physical".
    kind: &'static str,
    /// "YYYY-MM-DD".
    date: String,
}

#[derive(Serialize)]
pub struct TitleReleases {
    id: String,
    releases: Vec<ReleaseDate>,
}

/// Release dates by "{region}:{IMDb id}" (empty: none, or TMDB doesn't know the film), for the session.
static RELEASE_DATES: LazyLock<Mutex<HashMap<String, Vec<ReleaseDate>>>> = LazyLock::new(Default::default);

/// TMDB's release types the calendar shows: 2 limited and 3 theatrical are
/// both "cinema"; 1 (premiere) and 6 (TV) aren't releases people can go to.
fn release_kind(kind: u8) -> Option<&'static str> {
    match kind {
        2 | 3 => Some("cinema"),
        4 => Some("digital"),
        5 => Some("physical"),
        _ => None,
    }
}

/// The earliest date of each kind in one country.
fn country_releases(country: &CountryReleases) -> Vec<ReleaseDate> {
    let mut found: Vec<ReleaseDate> = Vec::new();
    for release in &country.release_dates {
        // TMDB sends "2025-03-14T00:00:00.000Z"; the day is the release's local day.
        let (Some(kind), Some(date)) = (release_kind(release.kind), release.release_date.get(..10).filter(|d| is_date(d))) else { continue };
        match found.iter_mut().find(|r| r.kind == kind) {
            Some(known) if known.date.as_str() > date => known.date = date.to_owned(),
            Some(_) => {}
            None => found.push(ReleaseDate { kind, date: date.to_owned() }),
        }
    }
    found.sort_by(|a, b| a.date.cmp(&b.date));
    found
}

/// A film's releases in `region`, or the US's when TMDB lists none there.
fn region_releases(dates: &ReleaseDates, region: &str) -> Vec<ReleaseDate> {
    let of = |code: &str| dates.results.iter().find(|c| c.iso_3166_1 == code).map(country_releases).unwrap_or_default();
    let own = of(region);
    if own.is_empty() && region != "US" { of("US") } else { own }
}

async fn fetch_release_dates(token: &str, imdb_id: &str, region: &str) -> Result<Vec<ReleaseDate>, String> {
    let _slot = RATING_SLOTS.acquire().await.map_err(|_| "busy")?;
    let Some(id) = tmdb_id(token, imdb_id, false).await? else { return Ok(Vec::new()) };
    Ok(region_releases(&get(token, &format!("movie/{id}/release_dates"), &[]).await?, region))
}

/// Cinema, digital and physical release dates of films (by IMDb id) in
/// `region` (falling back to the US), from the session cache or TMDB, a few
/// at a time. Films whose lookup failed are left out (and asked about again
/// next time). `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_release_dates(imdb_ids: Vec<String>, region: String) -> Result<Option<Vec<TitleReleases>>, String> {
    check_region(&region)?;
    if imdb_ids.len() > MAX_RELEASE_TITLES {
        return Err("too many titles".into());
    }
    for id in &imdb_ids {
        check_imdb_id(id)?;
    }
    let Some(token) = token()? else { return Ok(None) };
    let lookups: Vec<_> = imdb_ids
        .into_iter()
        .map(|id| {
            let (token, region) = (token.clone(), region.clone());
            tauri::async_runtime::spawn(async move {
                let key = format!("{region}:{id}");
                if let Some(known) = RELEASE_DATES.lock().ok().and_then(|cache| cache.get(&key).cloned()) {
                    return Some(TitleReleases { id, releases: known });
                }
                let releases = fetch_release_dates(&token, &id, &region).await.ok()?;
                remember(&RELEASE_DATES, key, releases.clone());
                Some(TitleReleases { id, releases })
            })
        })
        .collect();
    let mut found = Vec::with_capacity(lookups.len());
    for lookup in lookups {
        if let Ok(Some(title)) = lookup.await {
            found.push(title);
        }
    }
    Ok(Some(found))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = image(Some(&text), "w500");
    let _ = release_date(Some(&text));
    let _ = plain_line(&text, 200);
    let _ = clean_cert(&text);
    if let Ok(item) = serde_json::from_slice::<Item>(data) {
        let _ = title_hit(item, None);
    }
    if let Ok(req) = serde_json::from_slice::<SourceRequest>(data) {
        let _ = plan_source(&req);
    }
    if let Ok(dates) = serde_json::from_slice::<ReleaseDates>(data) {
        let _ = region_releases(&dates, "US");
    }
}

#[cfg(test)]
mod release_date_tests {
    use super::*;

    fn sample() -> ReleaseDates {
        serde_json::from_str(
            r#"{"id":693134,"results":[
                {"iso_3166_1":"US","release_dates":[
                    {"certification":"PG-13","descriptors":[],"iso_639_1":"","note":"Los Angeles","release_date":"2024-02-15T00:00:00.000Z","type":1},
                    {"certification":"PG-13","descriptors":[],"iso_639_1":"","note":"","release_date":"2024-03-01T00:00:00.000Z","type":3},
                    {"certification":"PG-13","descriptors":[],"iso_639_1":"","note":"IMAX early access","release_date":"2024-02-29T00:00:00.000Z","type":2},
                    {"certification":"PG-13","descriptors":[],"iso_639_1":"","note":"","release_date":"2024-04-16T00:00:00.000Z","type":4},
                    {"certification":"PG-13","descriptors":[],"iso_639_1":"","note":"4K","release_date":"2024-05-14T00:00:00.000Z","type":5},
                    {"certification":"PG-13","descriptors":[],"iso_639_1":"","note":"","release_date":"2024-05-21T00:00:00.000Z","type":4},
                    {"certification":"","descriptors":[],"iso_639_1":"","note":"Max","release_date":"2024-08-23T00:00:00.000Z","type":6}
                ]},
                {"iso_3166_1":"GB","release_dates":[
                    {"certification":"12A","descriptors":[],"iso_639_1":"","note":"","release_date":"2024-03-01T00:00:00.000Z","type":3},
                    {"certification":"12","descriptors":[],"iso_639_1":"","note":"","release_date":"not a date","type":5}
                ]},
                {"iso_3166_1":"JP","release_dates":[
                    {"certification":"","descriptors":[],"iso_639_1":"","note":"Premiere","release_date":"2024-02-20T00:00:00.000Z","type":1}
                ]}
            ]}"#,
        )
        .unwrap()
    }

    #[test]
    fn reads_earliest_date_of_each_kind() {
        let found = region_releases(&sample(), "US");
        assert_eq!(
            found,
            vec![
                ReleaseDate { kind: "cinema", date: "2024-02-29".into() },
                ReleaseDate { kind: "digital", date: "2024-04-16".into() },
                ReleaseDate { kind: "physical", date: "2024-05-14".into() },
            ]
        );
    }

    #[test]
    fn keeps_the_regions_own_dates_and_drops_bad_ones() {
        assert_eq!(region_releases(&sample(), "GB"), vec![ReleaseDate { kind: "cinema", date: "2024-03-01".into() }]);
    }

    #[test]
    fn falls_back_to_the_us() {
        // Japan lists only a premiere; a country TMDB doesn't list at all falls back too.
        assert_eq!(region_releases(&sample(), "JP"), region_releases(&sample(), "US"));
        assert_eq!(region_releases(&sample(), "FR"), region_releases(&sample(), "US"));
        let empty: ReleaseDates = serde_json::from_str(r#"{"id":1,"results":[]}"#).unwrap();
        assert!(region_releases(&empty, "US").is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_asked_for_as_the_wrong_kind_is_still_found() {
        let find = |json: &str| serde_json::from_str::<Find>(json).unwrap();
        let series = r#"{"movie_results":[],"tv_results":[{"id":1396,"name":"Breaking Bad"}]}"#;
        // An addon listing a series as a movie: rated as the series.
        assert!(matches!(found_title(find(series), false), Some((Item { id: 1396, .. }, true))));
        assert!(matches!(found_title(find(series), true), Some((Item { id: 1396, .. }, true))));
        let film = r#"{"movie_results":[{"id":603,"title":"The Matrix"}],"tv_results":[]}"#;
        assert!(matches!(found_title(find(film), true), Some((Item { id: 603, .. }, false))));
        // Both kinds: the one asked for.
        let both = r#"{"movie_results":[{"id":1,"title":"A"}],"tv_results":[{"id":2,"name":"A"}]}"#;
        assert!(matches!(found_title(find(both), true), Some((Item { id: 2, .. }, true))));
        assert!(found_title(find(r#"{}"#), false).is_none());
    }

    /// Without TMDB every title is unrated, which a teen's limit lets through:
    /// removing the token goes through the same parent check as a restore.
    #[test]
    fn the_region_is_set_only_past_the_parent_check() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let saved = || db.setting(REGION_SETTING);
        // No active profile: the check fails, and nothing is saved.
        assert!(set_region_checked(&db, &crate::profiles::ActiveProfile::default(), "GB", None).is_err());
        assert_eq!(saved(), None);
        let active = crate::profiles::ActiveProfile::default();
        crate::profiles::select_for_test(&active, "main");
        assert!(set_region_checked(&db, &active, "gb", None).is_err());
        set_region_checked(&db, &active, "GB", None).unwrap();
        assert_eq!(saved(), Some(serde_json::json!("GB")));
    }

    #[test]
    fn removing_the_token_is_checked_like_a_restore() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let removed = std::cell::Cell::new(false);
        let remove = || {
            removed.set(true);
            Ok(())
        };
        // No active profile: the check fails, and nothing is removed.
        assert!(clear_token_checked(&db, &crate::profiles::ActiveProfile::default(), None, remove).is_err());
        assert!(!removed.get());
    }

    #[test]
    fn title_hits_skip_people_adult_and_nameless() {
        let page: Page = serde_json::from_str(
            r#"{"results":[
                {"id":1,"name":"Show","first_air_date":"2024-05-01","media_type":"tv","poster_path":"/a.jpg"},
                {"id":2,"title":"Film","release_date":"19xx","media_type":"movie"},
                {"id":3,"name":"Someone","media_type":"person"},
                {"id":4,"name":"Adult","media_type":"tv","adult":true},
                {"id":5,"name":"  ","media_type":"tv"}
            ]}"#,
        )
        .unwrap();
        let hits: Vec<TitleHit> = page.results.into_iter().filter_map(|i| title_hit(i, None)).collect();
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].id, hits[0].kind, hits[0].year.as_deref()), (1, "series", Some("2024")));
        assert_eq!(hits[0].poster.as_deref(), Some("https://image.tmdb.org/t/p/w185/a.jpg"));
        assert_eq!((hits[1].kind, hits[1].year.as_deref()), ("movie", None));
        // Trending TV has no media_type to read: the caller says it's TV.
        let item: Item = serde_json::from_str(r#"{"id":9,"name":"Trending"}"#).unwrap();
        assert_eq!(title_hit(item, Some(true)).map(|h| h.kind), Some("series"));
        assert!(!hits[0].animated);
        let cartoon: Item = serde_json::from_str(r#"{"id":10,"name":"Cartoon","genre_ids":[35,16]}"#).unwrap();
        assert!(title_hit(cartoon, Some(true)).is_some_and(|h| h.animated));
    }

    /// A person's tagged images cover all their work: only a still or backdrop
    /// of this very title counts, and posters never do.
    #[test]
    fn tagged_stills_are_from_this_title_only() {
        let tagged: Tagged = serde_json::from_str(
            r#"{"results":[
                {"file_path":"/poster.jpg","image_type":"poster","media_type":"movie","media":{"id":7}},
                {"file_path":"/other.jpg","image_type":"still","media_type":"movie","media":{"id":8}},
                {"file_path":"/../evil","image_type":"backdrop","media_type":"movie","media":{"id":7}},
                {"file_path":"/film.jpg","image_type":"backdrop","media_type":"movie","media":{"id":7}},
                {"file_path":"/episode.jpg","image_type":"still","media_type":"episode","media":{"id":555,"show_id":7}},
                {"file_path":"/nomedia.jpg","image_type":"still","media_type":"movie"}
            ]}"#,
        )
        .unwrap();
        assert_eq!(tagged_still(&tagged.results, false, 7).as_deref(), Some("https://image.tmdb.org/t/p/w300/film.jpg"));
        // A show's stills are its episodes', named by show.
        assert_eq!(tagged_still(&tagged.results, true, 7).as_deref(), Some("https://image.tmdb.org/t/p/w300/episode.jpg"));
        assert_eq!(tagged_still(&tagged.results, true, 555), None);
        assert_eq!(tagged_still(&tagged.results, false, 9), None);
        // An answer without results is no still, not an error.
        assert!(serde_json::from_str::<Tagged>("{}").unwrap().results.is_empty());
    }

    #[test]
    fn reads_certifications_per_country() {
        let dates: ReleaseDates = serde_json::from_str(
            r#"{"results":[
                {"iso_3166_1":"US","release_dates":[{"certification":"","type":1},{"certification":"PG-13","type":3},{"certification":"R","type":1}]},
                {"iso_3166_1":"GB","release_dates":[{"certification":"12A","type":4}]},
                {"iso_3166_1":"DE","release_dates":[{"certification":"","type":3}]},
                {"iso_3166_1":"FR","release_dates":[{"certification":"<script>","type":3}]},
                {"iso_3166_1":"usa","release_dates":[{"certification":"G","type":3}]}
            ]}"#,
        )
        .unwrap();
        let certs = movie_certs(dates);
        // The theatrical release's certification wins over a premiere's; blanks and junk are dropped.
        assert_eq!(certs.get("US").map(String::as_str), Some("PG-13"));
        assert_eq!(certs.get("GB").map(String::as_str), Some("12A"));
        assert_eq!(certs.len(), 2);

        let ratings: ContentRatings = serde_json::from_str(r#"{"results":[{"iso_3166_1":"US","rating":"TV-14"},{"iso_3166_1":"AU","rating":"MA15+"},{"iso_3166_1":"BR","rating":""}]}"#).unwrap();
        let certs = tv_certs(ratings);
        assert_eq!((certs.get("US").map(String::as_str), certs.get("AU").map(String::as_str), certs.len()), (Some("TV-14"), Some("MA15+"), 2));
        assert_eq!(clean_cert(" U/A 13+ ").as_deref(), Some("U/A 13+"));
        assert!(clean_cert("").is_none() && clean_cert("averyveryverylongrating").is_none());
    }

    #[test]
    fn finds_people_without_adult_or_unknown_ones() {
        let page: PeoplePage = serde_json::from_str(
            r#"{"results":[
                {"id":31,"name":"Tom Hanks","profile_path":"/th.jpg","known_for_department":"Acting","adult":false,"known_for":[{"id":13,"title":"Forrest Gump"},{"id":862,"title":"Toy Story"},{"id":1,"name":"Band of Brothers"},{"id":2,"title":"Big"}]},
                {"id":7,"name":"Someone","profile_path":"/../x.jpg","adult":false,"known_for":[{"id":3,"title":"A Film"}]},
                {"id":8,"name":"Nobody","adult":false,"known_for":[]},
                {"id":9,"name":"Adult","adult":true,"known_for":[{"id":4,"title":"X"}]}
            ]}"#,
        )
        .unwrap();
        let hits = people_hits(page);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].known_for, ["Forrest Gump", "Toy Story", "Band of Brothers"]);
        assert_eq!(hits[0].photo.as_deref(), Some("https://image.tmdb.org/t/p/w185/th.jpg"));
        // A path that isn't a plain file name is dropped.
        assert_eq!(hits[1].photo, None);
        assert_eq!(clean_query("  tom hanks "), Some("tom hanks".into()));
        assert!(clean_query(" ").is_none() && clean_query("a\nb").is_none() && clean_query(&"x".repeat(101)).is_none());
    }

    fn request(kind: &str, id: Option<u64>, media: &str, sort: Option<&str>, filters: serde_json::Value) -> SourceRequest {
        serde_json::from_value(serde_json::json!({ "kind": kind, "id": id, "media": media, "sort": sort, "filters": filters })).unwrap()
    }

    #[test]
    fn plans_collection_sources() {
        assert_eq!(plan_source(&request("collection", Some(10), "movie", None, serde_json::json!({}))), Ok(SourcePlan::Collection(10)));
        assert_eq!(plan_source(&request("list", Some(8_687_275), "movie", Some("vote_average.desc"), serde_json::json!({}))), Ok(SourcePlan::List(8_687_275)));
        assert!(plan_source(&request("list", None, "movie", None, serde_json::json!({}))).is_err());
        assert!(plan_source(&request("list", Some(0), "movie", None, serde_json::json!({}))).is_err());
        let discover = |kind, id, media, sort, filters| match plan_source(&request(kind, id, media, sort, filters)) {
            Ok(SourcePlan::Discover { tv, query }) => (tv, query.into_iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")),
            other => panic!("{other:?}"),
        };
        assert_eq!(discover("company", Some(41077), "movie", Some("primary_release_date.desc"), serde_json::json!({})), (false, "sort_by=primary_release_date.desc&with_companies=41077".into()));
        // A movie sort on a TV source names TV's date; networks are always TV.
        assert_eq!(discover("network", Some(213), "movie", Some("primary_release_date.desc"), serde_json::json!({})), (true, "sort_by=first_air_date.desc&with_networks=213".into()));
        assert_eq!(
            discover("discover", None, "tv", None, serde_json::json!({ "withGenres": "16|10759", "withOriginalLanguage": "ja", "voteCountGte": 10, "releaseDateGte": "2020-01-01", "vote_count.gte": 10, "watchRegion": "" })),
            (true, "first_air_date.gte=2020-01-01&sort_by=popularity.desc&vote_count.gte=10&with_genres=16|10759&with_original_language=ja".into())
        );
        // Episode air dates are TV's; a film ignores them.
        assert_eq!(
            discover("discover", None, "tv", None, serde_json::json!({ "withGenres": "16", "withKeywords": "210024", "airDateGte": "2026-10-07", "airDateLte": "2026-10-14" })),
            (true, "air_date.gte=2026-10-07&air_date.lte=2026-10-14&sort_by=popularity.desc&with_genres=16&with_keywords=210024".into())
        );
        assert_eq!(discover("discover", None, "movie", None, serde_json::json!({ "airDateGte": "2026-10-07" })), (false, "sort_by=popularity.desc".into()));
        // Bad values never reach TMDB.
        assert!(plan_source(&request("discover", None, "tv", None, serde_json::json!({ "airDateGte": "next week" }))).is_err());
        for bad in [serde_json::json!({ "withGenres": "28&api_key=x" }), serde_json::json!({ "releaseDateGte": "2020" }), serde_json::json!({ "withOriginCountry": "usa" }), serde_json::json!({ "voteAverageGte": 11 }), serde_json::json!({ "withKeywords": ["1"] })] {
            assert!(plan_source(&request("discover", None, "movie", None, bad)).is_err());
        }
        assert!(plan_source(&request("discover", None, "movie", Some("revenue.desc"), serde_json::json!({}))).is_err());
        assert!(plan_source(&request("discover", None, "anime", None, serde_json::json!({}))).is_err());
        assert!(plan_source(&request("person", Some(287), "tv", None, serde_json::json!({}))).is_err());
        assert_eq!(discover("director", Some(137_427), "movie", None, serde_json::json!({})), (false, "sort_by=popularity.desc&with_crew=137427".into()));
        assert!(plan_source(&request("keyword", Some(1), "movie", None, serde_json::json!({}))).is_err());
        // Discover's cast, director and runtime filters: films only for people; ids only.
        assert_eq!(
            discover("discover", None, "movie", None, serde_json::json!({ "withCast": "31", "withCrew": "488", "runtimeGte": 90, "runtimeLte": 120 })),
            (false, "sort_by=popularity.desc&with_cast=31&with_crew=488&with_runtime.gte=90&with_runtime.lte=120".into())
        );
        assert_eq!(discover("discover", None, "tv", None, serde_json::json!({ "withCast": "31", "withCrew": "488" })), (true, "sort_by=popularity.desc".into()));
        // A person source keeps its own person over the filter.
        assert_eq!(discover("person", Some(287), "movie", None, serde_json::json!({ "withCast": "31" })), (false, "sort_by=popularity.desc&with_cast=287".into()));
        for bad in [serde_json::json!({ "withCast": "Tom Hanks" }), serde_json::json!({ "withCrew": "1&api_key=x" })] {
            assert!(plan_source(&request("discover", None, "movie", None, bad)).is_err());
        }
        // A film's release in one country, by kind (Discover's "In cinemas now"); shows have no release types.
        assert_eq!(
            discover("discover", None, "movie", None, serde_json::json!({ "withReleaseType": "2|3", "region": "GB", "regionReleaseDateGte": "2026-09-01", "regionReleaseDateLte": "2026-10-14" })),
            (false, "region=GB&release_date.gte=2026-09-01&release_date.lte=2026-10-14&sort_by=popularity.desc&with_release_type=2|3".into())
        );
        assert_eq!(discover("discover", None, "tv", None, serde_json::json!({ "withReleaseType": "4", "region": "GB" })), (true, "sort_by=popularity.desc".into()));
        for bad in [serde_json::json!({ "withReleaseType": "7" }), serde_json::json!({ "withReleaseType": "2,3" }), serde_json::json!({ "region": "gb" }), serde_json::json!({ "regionReleaseDateGte": "soon" })] {
            assert!(plan_source(&request("discover", None, "movie", None, bad)).is_err());
        }
    }

    #[test]
    fn franchise_films_in_release_order() {
        let item = |id: u64, date: Option<&str>| serde_json::from_value::<Item>(serde_json::json!({ "id": id, "release_date": date })).unwrap();
        let order: Vec<u64> = release_order(vec![item(3, Some("2003-12-17")), item(9, None), item(1, Some("2001-12-18")), item(8, Some("")), item(2, Some("2002-12-18"))]).iter().map(|i| i.id).collect();
        assert_eq!(order, [1, 2, 3, 9, 8]);
    }

    #[test]
    fn cached_certifications_expire() {
        let day = 24 * 60 * 60 * 1000;
        assert!(fresh_certs(r#"{"US":"PG"}"#, 0, 29 * day).is_some());
        assert!(fresh_certs(r#"{"US":"PG"}"#, 0, 31 * day).is_none());
        // Without a certification, TMDB is asked again after a week.
        assert!(fresh_certs("{}", 0, 6 * day).is_some());
        assert!(fresh_certs("{}", 0, 8 * day).is_none());
        assert!(fresh_certs("not json", 0, 0).is_none());
        // Saved "in the future" (the clock was set back since): asked again.
        assert!(fresh_certs(r#"{"US":"PG"}"#, 2 * day, day).is_none());
    }

    #[test]
    fn languages_are_plain_tags() {
        assert!(valid_language("fr-FR") && valid_language("pt-BR"));
        assert!(!valid_language("fr") && !valid_language("fr-fr") && !valid_language("fr-FR&x=1") && !valid_language(""));
    }

    #[test]
    fn accepts_only_read_access_tokens() {
        assert!(check_token("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.abc_DEF-123").is_ok());
        // The 32-character v3 API key is refused with a pointer to the right one.
        assert_eq!(check_token("0123456789abcdef0123456789abcdef").unwrap_err(), "err.tmdb.api-key");
        assert!(check_token("eyJ.a").is_err() && check_token("eyJa.b.c d").is_err());
    }

    #[test]
    fn builds_only_plain_image_urls() {
        assert_eq!(image(Some("/abc_1.jpg"), "w342").as_deref(), Some("https://image.tmdb.org/t/p/w342/abc_1.jpg"));
        assert!(check_region("US").is_ok() && check_region("us").is_err() && check_region("USA").is_err());
        assert!(image(Some("abc.jpg"), "w342").is_none() && image(Some("/../x"), "w342").is_none() && image(None, "w342").is_none());
    }

    #[test]
    fn reads_title_media() {
        let details: TitleDetails = serde_json::from_value(serde_json::json!({
            "status": "Returning Series",
            "videos": { "results": [
                { "key": "abcdefghijk", "site": "YouTube", "name": "Clip", "type": "Clip" },
                { "key": "12345678901", "site": "Vimeo", "name": "Elsewhere", "type": "Trailer" },
                { "key": "--x?list=1", "site": "YouTube", "name": "Bad id", "type": "Trailer" },
                { "key": "ZYXWVUTSRQP", "site": "YouTube", "name": "Official Trailer", "type": "Trailer" },
                { "key": "a_b-c_d-e_f", "site": "YouTube", "name": "Odd", "type": "Vlog" }
            ] },
            "images": { "backdrops": [{ "file_path": "/b.jpg" }, { "file_path": "/../x" }], "logos": [{ "file_path": "/l.svg" }] }
        }))
        .unwrap();
        assert_eq!(status_key(details.status.as_deref().unwrap()), Some("returning"));
        let videos = media_videos(details.videos.results);
        // YouTube ids only, trailers first.
        assert_eq!(videos.iter().map(|v| (v.key.as_str(), v.kind)).collect::<Vec<_>>(), [("ZYXWVUTSRQP", Some("trailer")), ("abcdefghijk", Some("clip")), ("a_b-c_d-e_f", None)]);
        let backdrops = media_images(details.images.backdrops, "w300", "w1280");
        assert_eq!(backdrops.len(), 1);
        assert_eq!((backdrops[0].thumb.as_str(), backdrops[0].full.as_str()), ("https://image.tmdb.org/t/p/w300/b.jpg", "https://image.tmdb.org/t/p/w1280/b.jpg"));
        assert!(details.images.posters.is_empty());
    }
}

#[cfg(test)]
mod explore_tests {
    use super::*;

    #[test]
    fn titles_carry_release_date_and_rating() {
        let page: Page = serde_json::from_str(
            r#"{"page":1,"total_pages":3,"results":[
                {"adult":false,"backdrop_path":"/bd.jpg","genre_ids":[18,53],"id":550,"original_language":"en","overview":"An insomniac office worker…","popularity":61.4,"poster_path":"/p.jpg","release_date":"1999-10-15","title":"Fight Club","vote_average":8.4,"vote_count":30000},
                {"id":1399,"name":"Game of Thrones","first_air_date":"2011-04-17","vote_average":8.5,"vote_count":12},
                {"id":7,"title":"Odd","release_date":"soon","vote_average":42.0,"vote_count":900}
            ]}"#,
        )
        .unwrap();
        assert_eq!(page.total_pages, 3);
        let mut items = page.results.into_iter();
        let film = to_title("tt0137523".into(), false, items.next().unwrap());
        assert_eq!((film.released.as_deref(), film.rating, film.year.as_deref()), (Some("1999-10-15"), Some(8.4), Some("1999")));
        assert_eq!(film.poster.as_deref(), Some("https://image.tmdb.org/t/p/w342/p.jpg"));
        // Too few votes for the average to mean much; a show's date is its first air date.
        let show = to_title("tt0944947".into(), true, items.next().unwrap());
        assert_eq!((show.kind, show.released.as_deref(), show.rating), ("series", Some("2011-04-17"), None));
        // Junk dates and scores are dropped.
        let odd = to_title("tt7".into(), false, items.next().unwrap());
        assert_eq!((odd.released, odd.rating), (None, None));
    }

    #[test]
    fn hidden_gems_filter_on_vote_count() {
        let req: SourceRequest = serde_json::from_value(serde_json::json!({ "kind": "discover", "media": "movie", "sort": "vote_average.desc", "filters": { "voteCountGte": 50, "voteCountLte": 600, "voteAverageGte": 7.5 } })).unwrap();
        match plan_source(&req) {
            Ok(SourcePlan::Discover { query, .. }) => assert!(query.contains(&("vote_count.lte".into(), "600".into()))),
            other => panic!("{other:?}"),
        }
        let bad: SourceRequest = serde_json::from_value(serde_json::json!({ "kind": "discover", "media": "movie", "filters": { "voteCountLte": "6.5" } })).unwrap();
        assert!(plan_source(&bad).is_err());
    }
}

#[cfg(test)]
mod episode_tests {
    use super::*;

    #[test]
    fn episode_ratings_need_enough_votes() {
        let season: SeasonDetails = serde_json::from_str(
            r#"{"_id":"52","air_date":"2008-01-20","name":"Season 1","season_number":1,"episodes":[
                {"air_date":"2008-01-20","episode_number":1,"id":62085,"name":"Pilot","overview":"…","season_number":1,"vote_average":8.2,"vote_count":171,"crew":[],"guest_stars":[{"name":"Someone"}]},
                {"episode_number":2,"name":"Cat's in the Bag...","vote_average":10.0,"vote_count":1},
                {"episode_number":3,"vote_average":0.0,"vote_count":40},
                {"episode_number":4,"vote_average":null,"vote_count":0},
                {"name":"No number","vote_average":7.0,"vote_count":90},
                {"episode_number":6,"vote_average":7.65,"vote_count":5}
            ]}"#,
        )
        .unwrap();
        assert_eq!(
            episode_ratings(season),
            [EpisodeRating { episode: 1, rating: 8.2, votes: 171 }, EpisodeRating { episode: 6, rating: 7.65, votes: 5 }]
        );
    }

    #[test]
    fn picks_the_story_arc_group() {
        let groups: EpisodeGroups = serde_json::from_str(
            r#"{"id":37854,"results":[
                {"description":"","episode_count":1100,"group_count":30,"id":"5b11ba820e0a265847002c6e","name":"Seasons (Production)","network":null,"type":6},
                {"description":"","episode_count":1090,"group_count":36,"id":"5ec1fd4ec4f5520022b7b2f0","name":"Story Arcs","network":null,"type":5},
                {"description":"","episode_count":61,"group_count":4,"id":"5aa1e20ec3a3683b8b00a8c1","name":"Arcs (part)","network":null,"type":5},
                {"description":"","episode_count":1095,"group_count":12,"id":"5aa1e20ec3a3683b8b00a8c3","name":"Sagas","network":null,"type":5},
                {"description":"","episode_count":9999,"group_count":1,"id":"5aa1e20ec3a3683b8b00a8c2","name":"One big arc","type":5},
                {"episode_count":5000,"group_count":9,"id":"../x","type":5}
            ]}"#,
        )
        .unwrap();
        assert_eq!(story_arc_group(&groups.results), Some("5ec1fd4ec4f5520022b7b2f0"));
        assert_eq!(story_arc_group(&[]), None);
    }

    #[test]
    fn reads_story_arcs_in_order() {
        let details: EpisodeGroupDetails = serde_json::from_str(
            r#"{"description":"","episode_count":5,"group_count":3,"id":"5ec1fd4ec4f5520022b7b2f0","name":"Story Arcs","type":5,"groups":[
                {"id":"g2","name":"Orange Town","order":1,"locked":true,"episodes":[
                    {"air_date":"1999-12-08","episode_number":9,"id":2,"name":"x","order":1,"season_number":1,"show_id":37854,"still_path":"/a.jpg","vote_average":7.1,"vote_count":3},
                    {"episode_number":8,"order":0,"season_number":1}
                ]},
                {"id":"g1","name":"  Romance Dawn\n","order":0,"episodes":[{"episode_number":1,"order":0,"season_number":1}]},
                {"id":"g3","name":"Empty","order":2,"episodes":[]},
                {"id":"g4","name":"","order":3,"episodes":[{"episode_number":5,"order":0,"season_number":null},{"episode_number":1,"order":1,"season_number":0}]}
            ]}"#,
        )
        .unwrap();
        let arcs = story_arcs(details);
        let ep = |season, episode| ArcEpisodeRef { season, episode };
        assert_eq!(
            arcs,
            [
                StoryArc { name: "Romance Dawn".into(), episodes: vec![ep(1, 1)] },
                StoryArc { name: "Orange Town".into(), episodes: vec![ep(1, 8), ep(1, 9)] },
                StoryArc { name: String::new(), episodes: vec![ep(0, 1)] },
            ]
        );
        assert!(valid_group_id("5ec1fd4ec4f5520022b7b2f0") && !valid_group_id("") && !valid_group_id("a/b") && !valid_group_id(&"a".repeat(41)));
    }

    #[test]
    fn movie_certifications_in_order() {
        let list: CertificationList = serde_json::from_str(
            r#"{"certifications":{
                "US":[{"certification":"R","meaning":"Restricted","order":4},{"certification":"G","meaning":"All ages","order":1},{"certification":"NC-17","order":5},{"certification":"PG-13","order":3},{"certification":"PG","order":2},{"certification":"NR","order":0}],
                "GB":[{"certification":"U","order":1},{"certification":"12A","order":3},{"certification":"PG","order":2},{"certification":"<b>","order":4}],
                "XX1":[{"certification":"A","order":1}],
                "DE":[]
            }}"#,
        )
        .unwrap();
        let all = certifications_by_country(list);
        assert_eq!(all.len(), 2);
        assert_eq!(certifications_for(&all, "GB"), Some(Certifications { country: "GB".into(), certifications: vec!["U".into(), "PG".into(), "12A".into()] }));
        // A country TMDB has none for gets the US's.
        assert_eq!(certifications_for(&all, "DE").map(|c| (c.country, c.certifications.join(","))), Some(("US".into(), "NR,G,PG,PG-13,R,NC-17".into())));
        assert_eq!(certifications_for(&HashMap::new(), "DE"), None);
    }

    fn discover(media: &str, sort: &str, filters: serde_json::Value) -> Result<String, String> {
        let req: SourceRequest = serde_json::from_value(serde_json::json!({ "kind": "discover", "media": media, "sort": sort, "filters": filters })).unwrap();
        match plan_source(&req)? {
            SourcePlan::Discover { query, .. } => Ok(query.into_iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn discover_filters_certifications_and_sorts() {
        let filters = serde_json::json!({ "certificationLte": "PG-13", "certificationCountry": "US", "withGenres": "28|12", "year": 1999 });
        assert_eq!(discover("movie", "title.asc", filters.clone()), Ok("certification.lte=PG-13&certification_country=US&primary_release_year=1999&sort_by=title.asc&with_genres=28|12".into()));
        // Shows have no certifications at TMDB, and names rather than titles.
        assert_eq!(discover("tv", "title.asc", filters), Ok("first_air_date_year=1999&sort_by=name.asc&with_genres=28|12".into()));
        assert_eq!(discover("tv", "primary_release_date.asc", serde_json::json!({})), Ok("sort_by=first_air_date.asc".into()));
        assert_eq!(discover("movie", "first_air_date.asc", serde_json::json!({})), Ok("sort_by=primary_release_date.asc".into()));
        assert_eq!(discover("movie", "original", serde_json::json!({ "certificationLte": "U/A 13+" })), Ok("certification.lte=U/A 13+&sort_by=popularity.desc".into()));
        for bad in [serde_json::json!({ "certificationLte": "PG&x=1" }), serde_json::json!({ "certificationCountry": "usa" }), serde_json::json!({ "certificationLte": "averyveryverylongrating" })] {
            assert!(discover("movie", "original", bad).is_err());
        }
        assert!(discover("movie", "title.desc", serde_json::json!({})).is_err());
    }

    #[test]
    fn regional_services_follow_the_countrys_order() {
        let providers: Providers = serde_json::from_str(
            r#"{"results":[
                {"provider_id":337,"logo_path":"/disney.jpg","display_priorities":{"FR":2,"US":4}},
                {"provider_id":8,"logo_path":"/netflix.jpg","display_priorities":{"FR":5,"US":1}},
                {"provider_id":119,"logo_path":"/prime.jpg","display_priorities":{"FR":1}},
                {"provider_id":1899,"logo_path":"../evil.jpg","display_priorities":{"FR":3}}
            ]}"#,
        )
        .unwrap();
        let keys = |list: Vec<Service>| list.into_iter().map(|s| s.key).collect::<Vec<_>>();
        assert_eq!(keys(services_from(&providers.results, Some("FR"))), vec!["prime", "disney", "max", "netflix"]);
        assert_eq!(keys(services_from(&providers.results, Some("US"))), vec!["netflix", "disney"]);
        // Without a region: every service, in Orbit's order.
        assert_eq!(services_from(&providers.results, None).len(), SERVICES.len());
        let fr = services_from(&providers.results, Some("FR"));
        assert_eq!(fr[0].logo.as_deref(), Some("https://image.tmdb.org/t/p/w154/prime.jpg"));
        // A logo path that isn't a plain file name is left out.
        assert_eq!(fr[2].logo, None);
    }

    #[test]
    fn discover_filters_runtime_in_minutes() {
        assert_eq!(discover("movie", "original", serde_json::json!({ "runtimeGte": 60, "runtimeLte": "90" })), Ok("sort_by=popularity.desc&with_runtime.gte=60&with_runtime.lte=90".into()));
        for bad in [serde_json::json!({ "runtimeLte": "90&x=1" }), serde_json::json!({ "runtimeLte": 1.5 }), serde_json::json!({ "runtimeGte": 5000 })] {
            assert!(discover("movie", "original", bad).is_err());
        }
    }
}

// ── Title page (Showcase): topics and where to watch ──────────────────────

/// Keywords ("topics") shown per title.
const MAX_KEYWORDS: usize = 24;
/// Providers shown per group (stream, rent, buy).
const MAX_PROVIDERS: usize = 12;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Keyword {
    id: u64,
    name: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct WatchProvider {
    id: u64,
    name: String,
    /// A small logo on image.tmdb.org.
    logo: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct WatchProviders {
    /// With a subscription, free, or free with ads.
    stream: Vec<WatchProvider>,
    rent: Vec<WatchProvider>,
    buy: Vec<WatchProvider>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct TitleTopics {
    keywords: Vec<Keyword>,
    providers: WatchProviders,
}

#[derive(Deserialize)]
struct KeywordItem {
    id: u64,
    #[serde(default)]
    name: String,
}

/// Movies list their keywords under `keywords`, shows under `results`.
#[derive(Deserialize)]
struct KeywordList {
    #[serde(default)]
    keywords: Vec<KeywordItem>,
    #[serde(default)]
    results: Vec<KeywordItem>,
}

#[derive(Deserialize)]
struct ProviderItem {
    provider_id: u64,
    #[serde(default)]
    provider_name: String,
    logo_path: Option<String>,
    #[serde(default)]
    display_priority: u32,
}

#[derive(Deserialize, Default)]
struct CountryProviders {
    #[serde(default)]
    flatrate: Vec<ProviderItem>,
    #[serde(default)]
    free: Vec<ProviderItem>,
    #[serde(default)]
    ads: Vec<ProviderItem>,
    #[serde(default)]
    rent: Vec<ProviderItem>,
    #[serde(default)]
    buy: Vec<ProviderItem>,
}

#[derive(Deserialize)]
struct ProvidersByCountry {
    #[serde(default)]
    results: HashMap<String, CountryProviders>,
}

/// Topics and providers by "{kind}:{region}:{IMDb id}", for the session.
static TITLE_TOPICS: LazyLock<Mutex<HashMap<String, TitleTopics>>> = LazyLock::new(Default::default);

/// Text from TMDB as one plain line: control characters out, trimmed, at most `max` characters.
fn plain_line(text: &str, max: usize) -> Option<String> {
    let line: String = text.chars().filter(|c| !c.is_control()).take(max).collect();
    let line = line.trim();
    (!line.is_empty()).then(|| line.to_owned())
}

/// The title's keywords with a valid id and a name, each once.
fn title_keywords(list: KeywordList) -> Vec<Keyword> {
    let mut found: Vec<Keyword> = Vec::new();
    for item in list.keywords.into_iter().chain(list.results) {
        if check_tmdb_id(item.id).is_err() || found.iter().any(|k| k.id == item.id) {
            continue;
        }
        let Some(name) = plain_line(&item.name, 60) else { continue };
        found.push(Keyword { id: item.id, name });
        if found.len() == MAX_KEYWORDS {
            break;
        }
    }
    found
}

/// One group's providers in TMDB's display order, each once, only those with a logo.
fn provider_group(groups: Vec<Vec<ProviderItem>>) -> Vec<WatchProvider> {
    // Group order is meaningful: subscription before free before ad-supported.
    // Stable within each group, so equal priorities keep TMDB's display order.
    let items = groups.into_iter().flat_map(|mut group| {
        group.sort_by_key(|p| p.display_priority);
        group
    });
    let mut found: Vec<WatchProvider> = Vec::new();
    for item in items {
        if check_tmdb_id(item.provider_id).is_err() || found.iter().any(|p| p.id == item.provider_id) {
            continue;
        }
        let (Some(name), Some(logo)) = (plain_line(&item.provider_name, 80), image(item.logo_path.as_deref(), "w92")) else { continue };
        found.push(WatchProvider { id: item.provider_id, name, logo });
        if found.len() == MAX_PROVIDERS {
            break;
        }
    }
    found
}

/// Where to watch in `region` only: another country's services wouldn't be available here.
fn region_providers(mut all: ProvidersByCountry, region: &str) -> WatchProviders {
    let country = all.results.remove(region).unwrap_or_default();
    WatchProviders { stream: provider_group(vec![country.flatrate, country.free, country.ads]), rent: provider_group(vec![country.rent]), buy: provider_group(vec![country.buy]) }
}

/// A title's TMDB keywords and where it streams, rents or sells in `region`
/// (TMDB's data from JustWatch), cached for the session. `None` without a TMDB token.
#[tauri::command]
pub async fn tmdb_title_topics(imdb_id: String, kind: String, region: String) -> Result<Option<TitleTopics>, String> {
    check_imdb_id(&imdb_id)?;
    let tv = kind_is_tv(&kind)?;
    check_region(&region)?;
    let Some(token) = token()? else { return Ok(None) };
    let key = format!("{kind}:{region}:{imdb_id}");
    if let Some(known) = TITLE_TOPICS.lock().ok().and_then(|cache| cache.get(&key).cloned()) {
        return Ok(Some(known));
    }
    let id = if tv { tv_id(&token, &imdb_id).await? } else { tmdb_id(&token, &imdb_id, false).await? };
    let Some(id) = id else { return Ok(Some(TitleTopics::default())) };
    let base = format!("{}/{id}", if tv { "tv" } else { "movie" });
    // Both asked at once.
    let providers = {
        let (token, path) = (token.clone(), format!("{base}/watch/providers"));
        tauri::async_runtime::spawn(async move { get::<ProvidersByCountry>(&token, &path, &[]).await })
    };
    let keywords = get::<KeywordList>(&token, &format!("{base}/keywords"), &[]).await?;
    let providers = providers.await.map_err(|_| "err.tmdb.unreachable".to_string())??;
    let found = TitleTopics { keywords: title_keywords(keywords), providers: region_providers(providers, &region) };
    remember(&TITLE_TOPICS, key, found.clone());
    Ok(Some(found))
}

#[cfg(test)]
mod title_topics_tests {
    use super::*;

    #[test]
    fn reads_movie_and_show_keywords() {
        let movie: KeywordList = serde_json::from_str(
            r#"{"id":603,"keywords":[{"id":310,"name":"artificial intelligence (a.i.)"},{"id":4565,"name":"dystopia"},{"id":4565,"name":"dystopia"},{"id":0,"name":"bad id"},{"id":9,"name":"  "},{"id":12,"name":"line\nbreak"}]}"#,
        )
        .unwrap();
        let found = title_keywords(movie);
        assert_eq!(found.iter().map(|k| (k.id, k.name.as_str())).collect::<Vec<_>>(), vec![(310, "artificial intelligence (a.i.)"), (4565, "dystopia"), (12, "linebreak")]);

        let show: KeywordList = serde_json::from_str(r#"{"id":1396,"results":[{"id":2231,"name":"drug dealer"},{"id":15483,"name":"high school teacher"}]}"#).unwrap();
        assert_eq!(title_keywords(show).len(), 2);

        let many = KeywordList { keywords: (1..=40).map(|id| KeywordItem { id, name: format!("k{id}") }).collect(), results: Vec::new() };
        assert_eq!(title_keywords(many).len(), MAX_KEYWORDS);
    }

    #[test]
    fn subscriptions_precede_free_and_ads_even_with_lower_display_priority() {
        let all: ProvidersByCountry = serde_json::from_str(r#"{"results":{"US":{"flatrate":[{"provider_id":8,"provider_name":"Netflix","logo_path":"/netflix.jpg","display_priority":99}],"free":[{"provider_id":9,"provider_name":"Free service","logo_path":"/free.jpg","display_priority":0}],"ads":[{"provider_id":8,"provider_name":"Netflix duplicate","logo_path":"/netflix.jpg","display_priority":0}]}}}"#).unwrap();
        let providers = region_providers(all, "US");
        assert_eq!(providers.stream.iter().map(|p| p.id).collect::<Vec<_>>(), vec![8, 9]);
        assert_eq!(providers.stream[0].name, "Netflix");
    }

    #[test]
    fn reads_the_regions_providers_only() {
        let all: ProvidersByCountry = serde_json::from_str(
            r#"{"id":603,"results":{
                "US":{"link":"https://www.themoviedb.org/movie/603-the-matrix/watch?locale=US",
                    "flatrate":[{"logo_path":"/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg","provider_id":8,"provider_name":"Netflix","display_priority":5},{"logo_path":"/97yvRBw1GzX7fXprcF80er19ot.jpg","provider_id":337,"provider_name":"Disney Plus","display_priority":1}],
                    "ads":[{"logo_path":"/w2TDH9TRI7pltf5LjN3vXzs7QbN.jpg","provider_id":73,"provider_name":"Tubi TV","display_priority":20},{"logo_path":"/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg","provider_id":8,"provider_name":"Netflix","display_priority":5}],
                    "rent":[{"logo_path":"/9ghgSC0MA082EL6HLCW3GalykFD.jpg","provider_id":2,"provider_name":"Apple TV","display_priority":4},{"logo_path":"../evil.png","provider_id":3,"provider_name":"Bad logo","display_priority":2},{"logo_path":null,"provider_id":10,"provider_name":"No logo","display_priority":1}],
                    "buy":[{"logo_path":"/seGSXajazLMCKGB5hnRCidtjay1.jpg","provider_id":10,"provider_name":"Amazon Video","display_priority":3}]},
                "DE":{"flatrate":[{"logo_path":"/x.jpg","provider_id":30,"provider_name":"WOW","display_priority":1}]}
            }}"#,
        )
        .unwrap();
        let us = region_providers(all, "US");
        assert_eq!(us.stream.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["Disney Plus", "Netflix", "Tubi TV"]);
        assert_eq!(us.stream[0].logo, "https://image.tmdb.org/t/p/w92/97yvRBw1GzX7fXprcF80er19ot.jpg");
        assert_eq!(us.rent.iter().map(|p| p.id).collect::<Vec<_>>(), vec![2]);
        assert_eq!(us.buy.len(), 1);

        let none: ProvidersByCountry = serde_json::from_str(r#"{"id":1,"results":{"US":{"flatrate":[]}}}"#).unwrap();
        assert_eq!(region_providers(none, "FR"), WatchProviders::default());
    }
}

/// Optional IMDb→TMDB identity for matching the person's IPTV catalog.
/// Uses their existing token; absence/failure must never prevent title/year matching.
pub(crate) async fn vod_identity(imdb: &str, tv: bool) -> Option<u64> {
    type IdentityCache = HashMap<(String, bool), Option<u64>>;
    static IDS: LazyLock<tokio::sync::Mutex<IdentityCache>> = LazyLock::new(Default::default);
    check_imdb_id(imdb).ok()?;
    tokio::time::timeout(Duration::from_secs(3), async {
        let mut ids = IDS.lock().await;
        let key = (imdb.to_string(), tv);
        if let Some(id) = ids.get(&key) { return *id; }
        let token = token().ok().flatten()?;
        let id = tmdb_id(&token, imdb, tv).await.ok()?;
        if ids.len() >= 500 { ids.clear(); }
        ids.insert(key, id);
        id
    }).await.ok().flatten()
}
