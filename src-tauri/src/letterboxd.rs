//! Letterboxd, from the person's public profile (Settings → Integrations):
//! their recent diary with star ratings (the profile's RSS feed) and their
//! watchlist (its public pages). No login and no API: Orbit reads what anyone
//! can see, straight from letterboxd.com, and can't change anything there.
//!
//! Letterboxd names films by its own slugs; each is matched to an IMDb id
//! once, by searching Cinemeta for the name and year (or, failing that, by
//! the IMDb link on the film's Letterboxd page), and the match is kept.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use quick_xml::Reader;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::Event;
use reqwest::Url;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::addons::{AddonError, net};
use crate::db::Db;
use crate::library::now_ms;

const SITE: &str = "https://letterboxd.com/";
const CINEMETA: &str = "https://v3-cinemeta.strem.io/";
const FEED_LIMIT: usize = 2 * 1024 * 1024;
const PAGE_LIMIT: usize = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);
/// The watchlist's first pages (28 films each), most recently added first.
const WATCHLIST_PAGES: u32 = 2;
const CACHE_FOR: Duration = Duration::from_secs(15 * 60);
/// Films not found are looked up again after this long.
const RETRY_UNMATCHED_MS: i64 = 7 * 86_400_000;
/// New films matched per request, several at a time, so a first load stays quick and polite.
const MAX_NEW_MATCHES: usize = 60;
const PARALLEL: usize = 8;
/// A Home row shows what's matched by then rather than skeletons for minutes
/// (each lookup can take up to three requests); the rest follow on later loads.
const ROW_DEADLINE: Duration = Duration::from_secs(25);
const MAX_TEXT: usize = 300;

/// A film as Letterboxd lists it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Film {
    /// Letterboxd's slug, or `boxd-{code}` for a boxd.it link (as in a data export).
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) year: Option<String>,
    /// From the diary: the person's stars (0.5–5) and whether they liked it.
    pub(crate) rating: Option<f32>,
    pub(crate) liked: bool,
}

/// A film ready for a poster row: opens by its IMDb id, like TMDB's titles.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LbTitle {
    pub(crate) imdb_id: String,
    pub(crate) name: String,
    pub(crate) poster: Option<String>,
    background: Option<String>,
    pub(crate) year: Option<String>,
    overview: Option<String>,
    #[serde(default)]
    rating: Option<f32>,
    #[serde(default)]
    liked: bool,
}

#[derive(Serialize)]
pub struct Profile {
    user: String,
    name: String,
}

/// Rows by "diary:{user}" or "watchlist:{user}", with when they were read (None: watchlist not public).
type Rows = HashMap<String, (Instant, Option<Vec<LbTitle>>)>;

static CACHE: LazyLock<Mutex<Rows>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn clip(text: &str) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()
}

fn valid_user(user: &str) -> bool {
    (1..=40).contains(&user.len()) && user.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn valid_slug(slug: &str) -> bool {
    (1..=200).contains(&slug.len()) && slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// A username from what was typed: `name`, `@name`, or a letterboxd.com link.
/// boxd.it short links are resolved by `profile` first.
fn parse_user(input: &str) -> Option<String> {
    let input = input.trim().trim_start_matches('@');
    let rest = input.split_once("letterboxd.com/").map_or(input, |(_, r)| r);
    let user = rest.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    (valid_user(&user) && !["film", "films", "list", "lists", "members", "search", "settings"].contains(&user.as_str())).then_some(user)
}

/// Where a `boxd.it/{code}` short link goes (a profile or a film), without following it elsewhere.
async fn short_link(input: &str) -> Option<String> {
    let code = input.trim().trim_start_matches("https://").trim_start_matches("http://").strip_prefix("boxd.it/")?.trim_end_matches('/');
    if code.is_empty() || code.len() > 16 || !code.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    static CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(TIMEOUT).build().ok());
    let response = CLIENT.as_ref()?.get(format!("https://boxd.it/{code}")).send().await.ok()?;
    let to = response.headers().get(reqwest::header::LOCATION)?.to_str().ok()?;
    to.starts_with(SITE).then(|| to.to_string())
}

/// `&amp;`-style escapes in Letterboxd's HTML attributes.
fn unescape(text: &str) -> String {
    text.replace("&#039;", "'").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").replace("&lrm;", "").replace("&amp;", "&")
}

/// "Title (2017)" as the title and year.
fn split_year(name: &str) -> (String, Option<String>) {
    if let Some(open) = name.rfind(" (")
        && let Some(year) = name[open + 2..].strip_suffix(')')
        && year.len() == 4
        && year.bytes().all(|b| b.is_ascii_digit())
    {
        return (name[..open].to_string(), Some(year.to_string()));
    }
    (name.to_string(), None)
}

/// The profile's display name and its diary entries (newest first), from its RSS feed.
fn parse_feed(xml: &str) -> (Option<String>, Vec<Film>) {
    let mut reader = Reader::from_str(xml);
    let mut name = None;
    let mut films = Vec::new();
    // Text arrives in pieces around entities like &amp;, so it's gathered until the element ends.
    let mut text = String::new();
    let mut item: Option<(Film, String)> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                text.clear();
                if e.name().as_ref() == b"item" {
                    item = Some((Film { slug: String::new(), name: String::new(), year: None, rating: None, liked: false }, String::new()));
                }
            }
            Ok(Event::Text(t)) if text.len() < MAX_TEXT * 4 => text.push_str(&t.decode().unwrap_or_default()),
            Ok(Event::CData(t)) if text.len() < MAX_TEXT * 4 => text.push_str(&t.decode().unwrap_or_default()),
            Ok(Event::GeneralRef(r)) => {
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    text.push(c);
                } else if let Some(s) = r.decode().ok().and_then(|n| resolve_predefined_entity(&n)) {
                    text.push_str(s);
                }
            }
            Ok(Event::End(e)) => {
                let tag = e.name();
                match (&mut item, tag.as_ref()) {
                    (None, b"title") if name.is_none() => name = Some(clip(text.trim().trim_start_matches("Letterboxd - "))),
                    (Some((film, _)), b"link") => {
                        // https://letterboxd.com/{user}/film/{slug}/[n/]
                        film.slug = text.split("/film/").nth(1).and_then(|s| s.split('/').next()).unwrap_or_default().to_string();
                    }
                    (Some((_, guid)), b"guid") => guid.clone_from(&text),
                    (Some((film, _)), b"letterboxd:filmTitle") => film.name = clip(&text),
                    (Some((film, _)), b"letterboxd:filmYear") => film.year = Some(clip(&text)).filter(|y| y.len() == 4),
                    (Some((film, _)), b"letterboxd:memberRating") => film.rating = text.trim().parse::<f32>().ok().filter(|r| (0.5..=5.0).contains(r)),
                    (Some((film, _)), b"letterboxd:memberLike") => film.liked = text.trim() == "Yes",
                    (Some(_), b"item") => {
                        if let Some((film, guid)) = item.take()
                            // Lists also appear in the feed; only watches (and reviews) are diary entries.
                            && (guid.starts_with("letterboxd-watch-") || guid.starts_with("letterboxd-review-"))
                            && valid_slug(&film.slug)
                            && !film.name.is_empty()
                        {
                            films.push(film);
                        }
                    }
                    _ => {}
                }
                text.clear();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    (name, films)
}

/// The films on one watchlist page.
fn parse_watchlist(html: &str) -> Vec<Film> {
    let attr = |chunk: &str, name: &str| -> Option<String> {
        let start = chunk.find(&format!("{name}=\""))? + name.len() + 2;
        Some(unescape(&chunk[start..start + chunk[start..].find('"')?]))
    };
    html.split("data-component-class=\"LazyPoster\"")
        .skip(1)
        .filter_map(|chunk| {
            // Cut on a character boundary: slicing inside one panics (and release builds abort).
            let mut end = chunk.len().min(4000);
            while !chunk.is_char_boundary(end) {
                end -= 1;
            }
            let chunk = &chunk[..end];
            let slug = attr(chunk, "data-item-slug").filter(|s| valid_slug(s))?;
            let (name, year) = split_year(&clip(&attr(chunk, "data-item-name")?));
            Some(Film { slug, name, year, rating: None, liked: false })
        })
        .collect()
}

/// Letters and digits only, for comparing names.
fn fold(text: &str) -> String {
    text.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

#[derive(Deserialize)]
struct Meta {
    id: String,
    name: String,
    poster: Option<String>,
    background: Option<String>,
    #[serde(rename = "releaseInfo")]
    release_info: Option<serde_json::Value>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct Search {
    #[serde(default)]
    metas: Vec<Meta>,
}

#[derive(Deserialize)]
struct One {
    meta: Option<Meta>,
}

fn https(url: Option<String>) -> Option<String> {
    url.filter(|u| u.starts_with("https://") && u.len() <= 2048)
}

impl Meta {
    fn year(&self) -> Option<String> {
        match &self.release_info {
            Some(serde_json::Value::String(s)) => Some(s.chars().take(4).collect()),
            Some(serde_json::Value::Number(n)) => Some(n.to_string()),
            _ => None,
        }
    }

    fn into_title(self) -> Option<LbTitle> {
        let year = self.year();
        crate::skip::check_imdb_id(&self.id).ok()?;
        Some(LbTitle {
            imdb_id: self.id,
            name: clip(&self.name),
            poster: https(self.poster),
            background: https(self.background),
            year,
            overview: self.description.map(|d| d.chars().take(1000).collect()),
            rating: None,
            liked: false,
        })
    }
}

/// The search result that is this film: same name and year, else same name
/// within a year (release dates differ by country). Anything looser picks the
/// wrong film ("Normal" isn't "Next to Normal"), so it's left to the film page.
fn pick(metas: Vec<Meta>, film: &Film) -> Option<Meta> {
    let name = fold(&film.name);
    let year: Option<i32> = film.year.as_deref().and_then(|y| y.parse().ok());
    let year_of = |m: &Meta| m.year().and_then(|y| y.parse::<i32>().ok());
    let rank = |m: &Meta| {
        let same_name = fold(&m.name) == name;
        let diff = match (year, year_of(m)) {
            (Some(a), Some(b)) => (a - b).abs(),
            _ => 99,
        };
        match (same_name, diff) {
            (true, 0) => Some(0),
            (true, 1) => Some(1),
            _ => None,
        }
    };
    metas.into_iter().take(20).filter_map(|m| Some((rank(&m)?, m))).min_by_key(|(r, _)| *r).map(|(_, m)| m)
}

async fn get(url: Url, limit: usize) -> Result<String, AddonError> {
    net::fetch_text(url, limit, TIMEOUT).await
}

/// What looking a film up found.
enum Lookup {
    Found(LbTitle),
    /// Letterboxd has no such film, or no IMDb link for it.
    Missing,
    /// Nothing is known: Cinemeta or Letterboxd couldn't be reached.
    Unknown,
}

impl From<Option<LbTitle>> for Lookup {
    fn from(title: Option<LbTitle>) -> Self {
        title.map_or(Lookup::Missing, Lookup::Found)
    }
}

/// What `match_films` keeps for a lookup: the title (None for a film not
/// found), or nothing at all when nothing is known, so an import made offline
/// doesn't mark every film "not found" for a week.
fn kept(lookup: &Lookup) -> Option<Option<String>> {
    match lookup {
        Lookup::Found(title) => Some(serde_json::to_string(title).ok()),
        Lookup::Missing => Some(None),
        Lookup::Unknown => None,
    }
}

/// A film page's answer: the IMDb id it links to, None for a film Letterboxd
/// doesn't have (or one without a link), or Err when it couldn't be reached.
fn page_answer(page: Result<String, AddonError>) -> Result<Option<String>, ()> {
    match page {
        Ok(page) => Ok(page_imdb_id(&page)),
        Err(AddonError::Http { status: 404 }) => Ok(None),
        Err(_) => Err(()),
    }
}

/// Finds `film` on Cinemeta, or by the IMDb link on its Letterboxd page.
async fn find(film: Film) -> Lookup {
    let cinemeta = |segments: &[&str]| {
        let mut url = Url::parse(CINEMETA).ok()?;
        url.path_segments_mut().ok()?.extend(segments);
        Some(url)
    };
    let Some(search) = cinemeta(&["catalog", "movie", "top", &format!("search={}.json", film.name)]) else { return Lookup::Missing };
    if let Ok(body) = get(search, PAGE_LIMIT).await
        && let Ok(found) = serde_json::from_str::<Search>(&body)
        && let Some(meta) = pick(found.metas, &film)
    {
        return meta.into_title().into();
    }
    // A boxd.it link redirects to the film's page.
    let page_url = match film.slug.strip_prefix("boxd-") {
        Some(code) => format!("https://boxd.it/{code}"),
        None => format!("{SITE}film/{}/", film.slug),
    };
    let Ok(page_url) = Url::parse(&page_url) else { return Lookup::Missing };
    let imdb = match page_answer(get(page_url, PAGE_LIMIT).await) {
        Ok(Some(imdb)) => imdb,
        Ok(None) => return Lookup::Missing,
        Err(()) => return Lookup::Unknown,
    };
    let Some(url) = cinemeta(&["meta", "movie", &format!("{imdb}.json")]) else { return Lookup::Missing };
    let Ok(body) = get(url, PAGE_LIMIT).await else { return Lookup::Unknown };
    let Ok(One { meta }) = serde_json::from_str::<One>(&body) else { return Lookup::Missing };
    meta.and_then(Meta::into_title)
        .or(Some(LbTitle { imdb_id: imdb, name: film.name, poster: None, background: None, year: film.year, overview: None, rating: None, liked: false }))
        .into()
}

/// The IMDb id a film's Letterboxd page links to.
fn page_imdb_id(page: &str) -> Option<String> {
    let at = page.find("imdb.com/title/tt")? + "imdb.com/title/".len();
    let imdb: String = page[at..].chars().take_while(char::is_ascii_alphanumeric).collect();
    crate::skip::check_imdb_id(&imdb).ok()?;
    Some(imdb)
}

/// The IMDb id of a film by its Letterboxd slug (Search's pasted
/// letterboxd.com/film/… link), from the film's page on Letterboxd itself:
/// the slug is checked, so the address is always Letterboxd's. `None` for
/// films Letterboxd doesn't have or that have no IMDb link.
#[tauri::command]
pub async fn letterboxd_film_imdb(slug: String) -> Result<Option<String>, String> {
    if !valid_slug(&slug) {
        return Err("invalid film".into());
    }
    let url = Url::parse(&format!("{SITE}film/{slug}/")).map_err(|e| e.to_string())?;
    page_answer(get(url, PAGE_LIMIT).await).map_err(|()| "err.letterboxd.unreachable".into())
}

/// Each film's title (None if not found), by slug: kept matches where
/// possible, then up to `limit` new lookups, PARALLEL at a time. `progress`
/// hears (done, to do) as lookups finish. With a `deadline`, lookups still
/// running then are dropped and the films found so far returned.
pub(crate) async fn match_films(app: &AppHandle, films: &[Film], limit: usize, deadline: Option<Duration>, progress: impl Fn(usize, usize)) -> Result<HashMap<String, Option<LbTitle>>, String> {
    let now = now_ms();
    let db = app.state::<Db>();
    let mut known: HashMap<String, Option<LbTitle>> = HashMap::new();
    {
        let conn = db.lock()?;
        let mut stmt = conn.prepare("SELECT title, checked_at FROM letterboxd_films WHERE slug = ?1").map_err(|e| e.to_string())?;
        for film in films {
            let row: Option<(Option<String>, i64)> = stmt.query_row([&film.slug], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
            match row {
                Some((Some(json), _)) => {
                    known.insert(film.slug.clone(), serde_json::from_str(&json).ok());
                }
                Some((None, at)) if crate::library::fresh(at, now, RETRY_UNMATCHED_MS) => {
                    known.insert(film.slug.clone(), None);
                }
                _ => {}
            }
        }
    }
    let mut queued = std::collections::HashSet::new();
    let todo: Vec<Film> = films.iter().filter(|f| !known.contains_key(&f.slug) && queued.insert(f.slug.clone())).take(limit).cloned().collect();
    let total = todo.len();
    let mut queue = todo.into_iter();
    let mut set = tokio::task::JoinSet::new();
    let mut done = 0;
    let deadline = deadline.map(|d| tokio::time::Instant::now() + d);
    loop {
        while set.len() < PARALLEL
            && let Some(film) = queue.next()
        {
            set.spawn(async move { (film.slug.clone(), find(film).await) });
        }
        let next = match deadline {
            // Past the deadline the rest are left for next time (they aren't saved as checked).
            Some(at) => match tokio::time::timeout_at(at, set.join_next()).await {
                Ok(next) => next,
                Err(_) => break,
            },
            None => set.join_next().await,
        };
        let (slug, lookup) = match next {
            None => break,
            // A lookup that panicked is skipped, not the ones after it.
            Some(Err(_)) => continue,
            Some(Ok(found)) => found,
        };
        // Each match is kept as soon as it's found.
        if let Some(json) = kept(&lookup) {
            db.lock()?.execute("INSERT OR REPLACE INTO letterboxd_films (slug, title, checked_at) VALUES (?1, ?2, ?3)", params![slug, json, now]).map_err(|e| e.to_string())?;
        }
        match lookup {
            Lookup::Found(title) => {
                known.insert(slug, Some(title));
            }
            Lookup::Missing => {
                known.insert(slug, None);
            }
            Lookup::Unknown => {}
        }
        done += 1;
        progress(done, total);
    }
    Ok(known)
}

/// Films as titles for a row, in order, each once, and whether every film
/// was settled (found or known not to be). A row that isn't (lookups left for
/// later, or Cinemeta unreachable) isn't kept, so the next load finishes it.
async fn titles(app: &AppHandle, films: Vec<Film>) -> Result<(Vec<LbTitle>, bool), String> {
    let known = match_films(app, &films, MAX_NEW_MATCHES, Some(ROW_DEADLINE), |_, _| {}).await?;
    Ok(row(films, &known))
}

fn row(films: Vec<Film>, known: &HashMap<String, Option<LbTitle>>) -> (Vec<LbTitle>, bool) {
    let complete = films.iter().all(|film| known.contains_key(&film.slug));
    let mut seen = std::collections::HashSet::new();
    let found = films
        .into_iter()
        .filter_map(|film| {
            let mut title = known.get(&film.slug)?.clone()?;
            title.rating = film.rating;
            title.liked = film.liked;
            // A film watched twice shows once, at its latest watch.
            seen.insert(title.imdb_id.clone()).then_some(title)
        })
        .collect();
    (found, complete)
}

fn cached(key: &str) -> Option<Option<Vec<LbTitle>>> {
    let cache = CACHE.lock().ok()?;
    cache.get(key).filter(|(at, _)| at.elapsed() < CACHE_FOR).map(|(_, v)| v.clone())
}

fn remember(key: String, value: Option<Vec<LbTitle>>) {
    if let Ok(mut cache) = CACHE.lock() {
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_FOR);
        cache.insert(key, (Instant::now(), value));
    }
}

fn feed_url(user: &str) -> Result<Url, String> {
    Url::parse(&format!("{SITE}{user}/rss/")).map_err(|e| e.to_string())
}

/// What a film's Letterboxd page says: its slug (for its reviews) and members' average.
#[derive(Clone, Default)]
struct FilmPage {
    slug: Option<String>,
    rating: Option<f32>,
}

/// Film pages by IMDb id, for the session.
static PAGES: LazyLock<Mutex<HashMap<String, FilmPage>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// Every film page opened adds one, so past this many the cache starts over rather than growing all session.
const MAX_PAGES: usize = 2000;

fn remember_page(pages: &mut HashMap<String, FilmPage>, imdb_id: &str, page: FilmPage) {
    if pages.len() >= MAX_PAGES {
        pages.clear();
    }
    pages.insert(imdb_id.to_string(), page);
}

/// "4.60 out of 5" from a film page's `twitter:data2` tag.
fn page_rating(page: &str) -> Option<f32> {
    let at = page.find("twitter:data2\" content=\"")? + "twitter:data2\" content=\"".len();
    let value: f32 = page[at..].split(' ').next()?.parse().ok()?;
    (0.5..=5.0).contains(&value).then_some(value)
}

/// The film's slug from its page's `og:url` tag.
fn page_slug(page: &str) -> Option<String> {
    const TAG: &str = "og:url\" content=\"https://letterboxd.com/film/";
    let at = page.find(TAG)? + TAG.len();
    let slug: String = page[at..].chars().take_while(|c| *c != '/' && *c != '"').collect();
    valid_slug(&slug).then_some(slug)
}

/// A film's Letterboxd page, by IMDb id; empty for films Letterboxd doesn't have.
async fn film_page(imdb_id: &str) -> Result<FilmPage, String> {
    if let Some(known) = PAGES.lock().ok().and_then(|p| p.get(imdb_id).cloned()) {
        return Ok(known);
    }
    // letterboxd.com/imdb/{id}/ redirects to the film's page.
    let found = match get(Url::parse(&format!("{SITE}imdb/{imdb_id}/")).map_err(|e| e.to_string())?, PAGE_LIMIT).await {
        Ok(page) => FilmPage { slug: page_slug(&page), rating: page_rating(&page) },
        Err(AddonError::Http { status: 404 }) => FilmPage::default(),
        Err(_) => return Err("err.letterboxd.unreachable".into()),
    };
    if let Ok(mut known) = PAGES.lock() {
        remember_page(&mut known, imdb_id, found.clone());
    }
    Ok(found)
}

/// Letterboxd members' average for a film (out of 5), from its public page;
/// None for films Letterboxd doesn't have or hasn't enough ratings for.
#[tauri::command]
pub async fn letterboxd_rating(imdb_id: String) -> Result<Option<f32>, String> {
    crate::skip::check_imdb_id(&imdb_id)?;
    Ok(film_page(&imdb_id).await?.rating)
}

/// Reviews shown per film (Letterboxd's first page of popular reviews).
const MAX_REVIEWS: usize = 12;
/// Characters of a review's text; longer ones end in "…".
const MAX_REVIEW: usize = 1500;

/// A member's review, as plain text.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Review {
    author: String,
    /// Only Letterboxd's own image servers, over https.
    avatar: Option<String>,
    /// Stars, 0.5–5.
    rating: Option<f32>,
    liked: bool,
    /// Marked by its author as containing spoilers.
    spoilers: bool,
    text: String,
    /// The review on letterboxd.com.
    url: String,
}

#[derive(Serialize, Clone)]
pub struct Reviews {
    /// The film's reviews page on letterboxd.com.
    url: String,
    reviews: Vec<Review>,
}

/// Reviews by IMDb id, with when they were read (None: Letterboxd doesn't have the film).
type ReviewCache = HashMap<String, (Instant, Option<Reviews>)>;

static REVIEWS: LazyLock<Mutex<ReviewCache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Text with HTML's character references resolved: the common named ones and any numeric one.
fn decode_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let entity = rest.bytes().skip(1).take(11).position(|b| b == b';').map(|end| &rest[1..=end]);
        let decoded = entity.and_then(|name| match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "hellip" => Some('…'),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "lsquo" => Some('‘'),
            "rsquo" => Some('’'),
            "ldquo" => Some('“'),
            "rdquo" => Some('”'),
            "lrm" => Some('\u{200E}'),
            "rlm" => Some('\u{200F}'),
            _ => {
                let number = name.strip_prefix('#')?;
                let code = match number.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                    None => number.parse().ok()?,
                };
                char::from_u32(code)
            }
        });
        match (entity, decoded) {
            (Some(name), Some(c)) => {
                out.push(c);
                rest = &rest[name.len() + 2..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// A review's HTML as plain text: paragraphs kept, tags dropped, at most `MAX_REVIEW` characters.
fn review_text(html: &str) -> String {
    let marked = html.replace("</p>", "\n\n").replace("<br", "\n<br");
    let mut bare = String::with_capacity(marked.len());
    let mut in_tag = false;
    for c in marked.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => bare.push(c),
            _ => {}
        }
    }
    let decoded = decode_html(&bare);
    let mut text = String::new();
    for paragraph in decoded.split("\n\n") {
        let lines: Vec<String> = paragraph.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|l| !l.is_empty()).collect();
        if lines.is_empty() {
            continue;
        }
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(&lines.join("\n"));
    }
    let text: String = text.chars().filter(|c| *c == '\n' || !c.is_control()).collect();
    if text.chars().count() <= MAX_REVIEW {
        return text;
    }
    let cut: String = text.chars().take(MAX_REVIEW - 1).collect();
    format!("{}…", cut.trim_end())
}

/// The text between `start` (after its first match) and the next `end`.
fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = text.find(start)? + start.len();
    Some(&text[from..from + text[from..].find(end)?])
}

/// An avatar from Letterboxd's image servers, or nothing.
fn avatar_url(src: &str) -> Option<String> {
    let src = unescape(src);
    let url = Url::parse(&src).ok()?;
    let ok = url.scheme() == "https" && matches!(url.host_str(), Some("a.ltrbxd.com" | "s.ltrbxd.com")) && src.len() <= 1024;
    ok.then_some(src)
}

/// "★★★½" as 3.5.
fn star_rating(label: &str) -> Option<f32> {
    let stars = label.chars().filter(|c| *c == '★').count() as f32 + if label.contains('½') { 0.5 } else { 0.0 };
    (0.5..=5.0).contains(&stars).then_some(stars)
}

/// The reviews on one of a film's reviews pages.
fn parse_reviews(html: &str) -> Vec<Review> {
    html.split("<article class=\"production-viewing")
        .skip(1)
        .filter_map(|chunk| {
            let chunk = chunk.split("</article>").next()?;
            let author = clip(&decode_html(between(chunk, "class=\"displayname\">", "</strong>")?));
            // The review's own page: /{member}/film/{slug}/[n/]
            let path = between(chunk, "class=\"attribution-detail\"> <a href=\"", "\"").or_else(|| between(chunk, "<a href=\"", "\" class=\"context\""))?;
            let path_ok = path.starts_with('/') && !path.contains("//") && path.len() <= 300 && path.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_/".contains(&b));
            let avatar = between(chunk, "class=\"avatar", "</a>").and_then(|a| between(a, "<img src=\"", "\"")).and_then(avatar_url);
            let rating = between(chunk, "class=\"glyph -rating\"", ">").and_then(|svg| between(svg, "aria-label=\"", "\"")).and_then(star_rating);
            let body = chunk.split("js-review-body").nth(1)?;
            let body = body.split_once('>')?.1;
            let text = review_text(body.split("<div class=\"viewing-actions\"").next()?);
            (path_ok && !author.is_empty() && !text.is_empty()).then(|| Review {
                author,
                avatar,
                rating,
                liked: chunk.contains("inline-liked"),
                spoilers: chunk.contains("js-spoiler-container"),
                text,
                url: format!("https://letterboxd.com{path}"),
            })
        })
        .take(MAX_REVIEWS)
        .collect()
}

/// A film's popular reviews from its public reviews page; None for films
/// Letterboxd doesn't have.
#[tauri::command]
pub async fn letterboxd_reviews(imdb_id: String) -> Result<Option<Reviews>, String> {
    crate::skip::check_imdb_id(&imdb_id)?;
    if let Some(hit) = REVIEWS.lock().ok().and_then(|r| r.get(&imdb_id).filter(|(at, _)| at.elapsed() < CACHE_FOR).map(|(_, v)| v.clone())) {
        return Ok(hit);
    }
    let found = match film_page(&imdb_id).await?.slug {
        None => None,
        Some(slug) => {
            let url = format!("{SITE}film/{slug}/reviews/by/activity/");
            let html = get(Url::parse(&url).map_err(|e| e.to_string())?, PAGE_LIMIT).await.map_err(|_| "err.letterboxd.unreachable")?;
            Some(Reviews { reviews: parse_reviews(&html), url })
        }
    };
    if let Ok(mut cache) = REVIEWS.lock() {
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_FOR);
        cache.insert(imdb_id, (Instant::now(), found.clone()));
    }
    Ok(found)
}

/// Checks a username (or profile or boxd.it link) and returns the member's name.
#[tauri::command]
pub async fn letterboxd_profile(input: String) -> Result<Profile, String> {
    let resolved = short_link(&input).await;
    let user = parse_user(resolved.as_deref().unwrap_or(&input)).ok_or("err.letterboxd.user")?;
    match get(feed_url(&user)?, FEED_LIMIT).await {
        Ok(xml) => {
            let (name, _) = parse_feed(&xml);
            Ok(Profile { name: name.unwrap_or_else(|| user.clone()), user })
        }
        Err(AddonError::Http { status: 404 }) => Err("err.letterboxd.no-member".into()),
        Err(_) => Err("err.letterboxd.unreachable".into()),
    }
}

/// The member's recently logged films with their stars, newest first.
#[tauri::command]
pub async fn letterboxd_diary(app: AppHandle, user: String) -> Result<Vec<LbTitle>, String> {
    if !valid_user(&user) {
        return Err("invalid username".into());
    }
    let key = format!("diary:{user}");
    if let Some(hit) = cached(&key) {
        return Ok(hit.unwrap_or_default());
    }
    let xml = get(feed_url(&user)?, FEED_LIMIT).await.map_err(|_| "err.letterboxd.unreachable")?;
    let (found, complete) = titles(&app, parse_feed(&xml).1).await?;
    if complete {
        remember(key, Some(found.clone()));
    }
    Ok(found)
}

/// The member's watchlist, most recently added first; None if Letterboxd doesn't show it publicly.
#[tauri::command]
pub async fn letterboxd_watchlist(app: AppHandle, user: String) -> Result<Option<Vec<LbTitle>>, String> {
    if !valid_user(&user) {
        return Err("invalid username".into());
    }
    let key = format!("watchlist:{user}");
    if let Some(hit) = cached(&key) {
        return Ok(hit);
    }
    let mut films = Vec::new();
    let mut every_page = true;
    for page in 1..=WATCHLIST_PAGES {
        let url = Url::parse(&format!("{SITE}{user}/watchlist/page/{page}/")).map_err(|e| e.to_string())?;
        match get(url, PAGE_LIMIT).await {
            Ok(html) => {
                let found = parse_watchlist(&html);
                let full = found.len() >= 28;
                films.extend(found);
                if !full {
                    break;
                }
            }
            Err(AddonError::Http { status: 403 | 404 }) if page == 1 => {
                remember(key, None);
                return Ok(None);
            }
            Err(_) if page > 1 => {
                every_page = false;
                break;
            }
            Err(_) => return Err("err.letterboxd.unreachable".into()),
        }
    }
    let (found, complete) = titles(&app, films).await?;
    if complete && every_page {
        remember(key, Some(found.clone()));
    }
    Ok(Some(found))
}

/// Pages of a public list Orbit reads (100 films each).
const MAX_LIST_PAGES: u32 = 5;

/// A public list's owner and slug from its address. Only
/// `https://letterboxd.com/{user}/list/{slug}/` is accepted (the trailing
/// slash optional): no other host, path, query or fragment.
fn parse_list_url(input: &str) -> Option<(String, String)> {
    let rest = input.trim().strip_prefix(SITE)?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let mut parts = rest.split('/');
    let (user, list, slug) = (parts.next()?, parts.next()?, parts.next()?);
    let user = user.to_ascii_lowercase();
    (parts.next().is_none() && list == "list" && valid_user(&user) && valid_slug(slug)).then(|| (user, slug.to_string()))
}

fn list_url(owner: &str, slug: &str, page: u32) -> Result<Url, String> {
    if !valid_user(owner) || !valid_slug(slug) || !(1..=MAX_LIST_PAGES).contains(&page) {
        return Err("invalid list".into());
    }
    let path = if page == 1 { format!("{SITE}{owner}/list/{slug}/") } else { format!("{SITE}{owner}/list/{slug}/page/{page}/") };
    Url::parse(&path).map_err(|e| e.to_string())
}

/// A list page's name, from its `og:title` tag.
fn list_name(html: &str) -> Option<String> {
    const TAG: &str = "<meta property=\"og:title\" content=\"";
    let at = html.find(TAG)? + TAG.len();
    let name = clip(&decode_html(&html[at..at + html[at..].find('"')?]));
    (!name.is_empty()).then_some(name)
}

/// A public list, as Discover's Customize adds it.
#[derive(Serialize)]
pub struct ListInfo {
    owner: String,
    slug: String,
    name: String,
}

/// Checks a pasted list address with Letterboxd and returns the list's name.
#[tauri::command]
pub async fn letterboxd_list_info(url: String) -> Result<ListInfo, String> {
    let (owner, slug) = parse_list_url(&url).ok_or("err.letterboxd.list-address")?;
    let html = match get(list_url(&owner, &slug, 1)?, PAGE_LIMIT).await {
        Ok(html) => html,
        Err(AddonError::Http { status: 404 }) => return Err("err.letterboxd.no-list".into()),
        Err(_) => return Err("err.letterboxd.unreachable".into()),
    };
    if parse_watchlist(&html).is_empty() {
        return Err("err.letterboxd.empty-list".into());
    }
    let name = list_name(&html).unwrap_or_else(|| slug.replace('-', " "));
    Ok(ListInfo { owner, slug, name })
}

/// One page of a public list's films, in the list's order.
#[tauri::command]
pub async fn letterboxd_list(app: AppHandle, owner: String, slug: String, page: u32) -> Result<Vec<LbTitle>, String> {
    let url = list_url(&owner, &slug, page)?;
    let key = format!("list:{owner}/{slug}/{page}");
    if let Some(hit) = cached(&key) {
        return Ok(hit.unwrap_or_default());
    }
    let films = match get(url, PAGE_LIMIT).await {
        Ok(html) => parse_watchlist(&html),
        // Past the last page Letterboxd answers 404.
        Err(AddonError::Http { status: 404 }) if page > 1 => Vec::new(),
        Err(AddonError::Http { status: 404 }) => return Err("err.letterboxd.list-gone".into()),
        Err(_) => return Err("err.letterboxd.unreachable".into()),
    };
    let (found, complete) = titles(&app, films).await?;
    if complete {
        remember(key, Some(found.clone()));
    }
    Ok(found)
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = parse_user(&text);
    let _ = parse_feed(&text);
    let _ = parse_watchlist(&text);
    let _ = parse_reviews(&text);
    let _ = parse_list_url(&text);
}

#[cfg(test)]
mod list_tests {
    use super::*;

    #[test]
    fn accepts_only_list_addresses() {
        let ok = |s: &str| parse_list_url(s);
        assert_eq!(ok("https://letterboxd.com/official/list/letterboxds-top-500-films/"), Some(("official".into(), "letterboxds-top-500-films".into())));
        assert_eq!(ok(" https://letterboxd.com/Dave/list/imdb-top-250 "), Some(("dave".into(), "imdb-top-250".into())));
        for bad in [
            "http://letterboxd.com/dave/list/x/",
            "https://letterboxd.com.evil.example/dave/list/x/",
            "https://evil.example/https://letterboxd.com/dave/list/x/",
            "https://letterboxd.com/dave/list/x/page/2/",
            "https://letterboxd.com/dave/list/x/?sort=a",
            "https://letterboxd.com/dave/list/x/#top",
            "https://letterboxd.com/dave/watchlist/",
            "https://letterboxd.com/dave/list/",
            "https://letterboxd.com/da ve/list/x/",
            "https://letterboxd.com/dave/list/x_y/",
            "letterboxd.com/dave/list/x/",
        ] {
            assert_eq!(ok(bad), None, "{bad}");
        }
        assert!(list_url("dave", "x", 0).is_err() && list_url("dave", "x", MAX_LIST_PAGES + 1).is_err());
        assert_eq!(list_url("dave", "x", 2).unwrap().as_str(), "https://letterboxd.com/dave/list/x/page/2/");
    }

    #[test]
    fn reads_list_pages() {
        let html = r#"<meta property="og:title" content="Letterboxd&#039;s Top 500 Films" />
            <div class="react-component" data-component-class="LazyPoster" data-image-width="125" data-item-name="Harakiri (1962)" data-item-slug="harakiri" data-item-link="/film/harakiri/"></div>
            <div class="react-component" data-component-class="LazyPoster" data-item-name="The Human Condition III: A Soldier&#039;s Prayer (1961)" data-item-slug="the-human-condition-iii-a-soldiers-prayer"></div>"#;
        assert_eq!(list_name(html).as_deref(), Some("Letterboxd's Top 500 Films"));
        let films = parse_watchlist(html);
        assert_eq!(films.iter().map(|f| (f.slug.as_str(), f.name.as_str(), f.year.as_deref())).collect::<Vec<_>>(), [("harakiri", "Harakiri", Some("1962")), ("the-human-condition-iii-a-soldiers-prayer", "The Human Condition III: A Soldier's Prayer", Some("1961"))]);
        assert_eq!(list_name("<html></html>"), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_row_is_kept_only_once_every_film_is_settled() {
        let film = |slug: &str| Film { slug: slug.into(), name: slug.into(), year: None, rating: None, liked: false };
        let title = LbTitle { imdb_id: "tt1".into(), name: "A".into(), poster: None, background: None, year: None, overview: None, rating: None, liked: false };
        let films = [film("a"), film("b")];
        let mut known = HashMap::from([("a".to_string(), Some(title))]);
        // "b" wasn't looked up yet (past the row's deadline or its quota, or Cinemeta was down): the row isn't final.
        let (found, complete) = row(films.to_vec(), &known);
        assert_eq!((found.len(), complete), (1, false));
        // Not found is settled too.
        known.insert("b".into(), None);
        let (found, complete) = row(films.to_vec(), &known);
        assert_eq!((found.len(), complete), (1, true));
    }

    #[test]
    fn film_page_cache_stays_bounded() {
        let mut pages = HashMap::new();
        for n in 0..MAX_PAGES * 3 {
            remember_page(&mut pages, &format!("tt{n}"), FilmPage::default());
            assert!(pages.len() <= MAX_PAGES);
        }
        assert!(pages.contains_key(&format!("tt{}", MAX_PAGES * 3 - 1)));
    }

    #[test]
    fn reads_usernames_and_links() {
        assert_eq!(parse_user(" @ReelFan42 ").as_deref(), Some("reelfan42"));
        assert_eq!(parse_user("https://letterboxd.com/dave/watchlist/").as_deref(), Some("dave"));
        assert_eq!(parse_user("letterboxd.com/some_one").as_deref(), Some("some_one"));
        assert_eq!(parse_user("https://letterboxd.com/film/x2/"), None);
        assert_eq!(parse_user("../etc"), None);
        assert_eq!(parse_user(""), None);
    }

    #[test]
    fn reads_the_diary_feed() {
        let xml = r#"<rss><channel><title>Letterboxd - fusn</title>
            <item><title>X2, 2003 - ★★★½</title><link>https://letterboxd.com/u/film/x2/2/</link><guid isPermaLink="false">letterboxd-watch-1</guid>
              <letterboxd:filmTitle>X2 &amp; Co</letterboxd:filmTitle><letterboxd:filmYear>2003</letterboxd:filmYear><letterboxd:memberRating>3.5</letterboxd:memberRating><letterboxd:memberLike>Yes</letterboxd:memberLike></item>
            <item><title>A list</title><link>https://letterboxd.com/u/list/faves/</link><guid isPermaLink="false">letterboxd-list-2</guid></item>
            <item><title>Kill Bill: Vol. 2, 2004</title><link>https://letterboxd.com/u/film/kill-bill-vol-2/</link><guid isPermaLink="false">letterboxd-review-3</guid>
              <letterboxd:filmTitle>Kill Bill: Vol. 2</letterboxd:filmTitle><letterboxd:filmYear>2004</letterboxd:filmYear></item>
            </channel></rss>"#;
        let (name, films) = parse_feed(xml);
        assert_eq!(name.as_deref(), Some("fusn"));
        assert_eq!(films.len(), 2);
        assert_eq!(films[0], Film { slug: "x2".into(), name: "X2 & Co".into(), year: Some("2003".into()), rating: Some(3.5), liked: true });
        assert_eq!((films[1].slug.as_str(), films[1].rating), ("kill-bill-vol-2", None));
    }

    #[test]
    fn reads_watchlist_pages() {
        let html = r#"<div class="react-component" data-component-class="LazyPoster" data-item-name="A Ghost Story (2017)" data-item-slug="a-ghost-story-2017" data-x="1"></div>
            <div data-component-class="LazyPoster" data-item-name="Tom &amp; Jerry&#039;s (Film) (1992)" data-item-slug="tom-jerry"></div>
            <div data-component-class="LazyPoster" data-item-name="Bad" data-item-slug="../x"></div>"#;
        let films = parse_watchlist(html);
        assert_eq!(films.len(), 2);
        assert_eq!((films[0].name.as_str(), films[0].year.as_deref()), ("A Ghost Story", Some("2017")));
        assert_eq!((films[1].name.as_str(), films[1].year.as_deref()), ("Tom & Jerry's (Film)", Some("1992")));
    }

    #[test]
    fn a_poster_cut_inside_a_character_does_not_panic() {
        // Byte 4000 after the marker falls inside "é" (2 bytes).
        let attrs = r#" data-item-name="A (2017)" data-item-slug="a-2017""#;
        let html = format!(r#"<div data-component-class="LazyPoster"{attrs}{}é</div>"#, " ".repeat(3999 - attrs.len()));
        let films = parse_watchlist(&html);
        assert_eq!(films.len(), 1);
    }

    #[test]
    fn only_a_definite_miss_is_kept_as_not_found() {
        let page = |r: Result<&str, AddonError>| page_answer(r.map(String::from));
        assert_eq!(page(Ok(r#"<a href="https://www.imdb.com/title/tt0133093/">IMDb</a>"#)), Ok(Some("tt0133093".into())));
        assert_eq!(page(Ok("<html></html>")), Ok(None));
        assert_eq!(page(Err(AddonError::Http { status: 404 })), Ok(None));
        // Offline, or Letterboxd down: nothing is known, so nothing is kept (it's tried again next time).
        assert_eq!(page(Err(AddonError::Timeout)), Err(()));
        assert_eq!(page(Err(AddonError::Http { status: 503 })), Err(()));
        assert_eq!(kept(&Lookup::Missing), Some(None));
        assert_eq!(kept(&Lookup::Unknown), None);
    }

    #[test]
    fn reads_the_average_rating() {
        assert_eq!(page_rating(r#"<meta name="twitter:data2" content="4.60 out of 5" />"#), Some(4.6));
        assert_eq!(page_rating(r#"<meta name="twitter:data2" content="9 out of 5" />"#), None);
        assert_eq!(page_rating("<html></html>"), None);
    }

    #[test]
    fn reads_the_film_slug() {
        assert_eq!(page_slug(r#"<meta property="og:url" content="https://letterboxd.com/film/parasite-2019/" />"#).as_deref(), Some("parasite-2019"));
        assert_eq!(page_slug(r#"<meta property="og:url" content="https://letterboxd.com/film/a?b/" />"#), None);
        assert_eq!(page_slug("<html></html>"), None);
    }

    #[test]
    fn reads_the_imdb_link() {
        assert_eq!(page_imdb_id(r#"<a href="http://www.imdb.com/title/tt6751668/maindetails" data-track-action="IMDb">IMDb</a>"#).as_deref(), Some("tt6751668"));
        assert_eq!(page_imdb_id(r#"<a href="http://www.imdb.com/title/ttx/">"#), None);
        assert_eq!(page_imdb_id("<html></html>"), None);
    }

    #[test]
    fn reads_reviews() {
        let html = r#"<div class="viewing-list">
            <article class="production-viewing -viewing"> <a class="avatar -a40" href="/phil/"> <img src="https://a.ltrbxd.com/resized/avatar/1-80.jpg?v=db" alt="Phil" /> </a>
              <div class="body"> <span class="inline-symbol inline-rating"><svg class="glyph -rating" width="64" aria-label="★★★½"> <title>★★★½</title></svg></span>
              <span class="inline-symbol"><svg class="glyph inline-liked -like" aria-label="Liked"></svg></span>
              <span class="attribution-detail"> <a href="/phil/film/parasite-2019/" class="context"> Watched by <span class="owner"><strong class="displayname">Phil &amp; Co</strong></span> </a> </span>
              <div class="js-review "> <p class="body-text -prose js-spoiler-container"><em>This review may contain spoilers.</em></p>
              <div class="body-text -prose -reset js-review-body js-collapsible-text" hidden data-x="1"> <div class="collapsed-text"> <p>There is a house <a href="https://youtu.be/x" rel="nofollow">on a hill</a>.<br />It&#039;s nice.</p>
              <p>  Second   &lt;b&gt;part&#x2026;</p> <script>alert(1)</script></div> </div> <div class="viewing-actions"> nope </div></div></div> </article>
            <article class="production-viewing -viewing"> <a class="avatar -a40" href="/x/"> <img src="https://evil.example/a.jpg" alt="X" /> </a>
              <span class="attribution-detail"> <a href="/x/film/parasite-2019/1/" class="context"> <strong class="displayname">X</strong> </a> </span>
              <div class="js-review"> <div class="body-text js-review-body"> <p>Short.</p> </div> <div class="viewing-actions"></div></div> </article>
            <article class="production-viewing -viewing"> <span class="attribution-detail"> <a href="//evil/" class="context"> <strong class="displayname">Y</strong> </a> </span>
              <div class="js-review-body"><p>Bad link.</p></div> </article>
            </div>"#;
        let reviews = parse_reviews(html);
        assert_eq!(reviews.len(), 2);
        assert_eq!(
            reviews[0],
            Review {
                author: "Phil & Co".into(),
                avatar: Some("https://a.ltrbxd.com/resized/avatar/1-80.jpg?v=db".into()),
                rating: Some(3.5),
                liked: true,
                spoilers: true,
                // Tags (and what scripts say) never reach the page as markup: it's all text.
                text: "There is a house on a hill.\nIt's nice.\n\nSecond <b>part…\n\nalert(1)".into(),
                url: "https://letterboxd.com/phil/film/parasite-2019/".into(),
            }
        );
        assert_eq!((reviews[1].avatar.as_deref(), reviews[1].rating, reviews[1].liked, reviews[1].spoilers), (None, None, false, false));
        assert_eq!(reviews[1].url, "https://letterboxd.com/x/film/parasite-2019/1/");
    }

    #[test]
    fn caps_review_text() {
        let long = format!("<p>{}</p>", "word ".repeat(1000));
        let text = review_text(&long);
        assert_eq!(text.chars().count(), MAX_REVIEW);
        assert!(text.ends_with('…'));
        assert_eq!(decode_html("a &amp b &unknown; &#65;&#x42; &"), "a &amp b &unknown; AB &");
    }

    #[test]
    fn picks_the_right_search_result() {
        let meta = |id: &str, name: &str, year: &str| Meta { id: id.into(), name: name.into(), poster: None, background: None, release_info: Some(serde_json::Value::String(year.into())), description: None };
        let film = Film { slug: "spider-man-2".into(), name: "Spider-Man 2".into(), year: Some("2004".into()), rating: None, liked: false };
        let metas = vec![meta("tt1872181", "The Amazing Spider-Man 2", "2014"), meta("tt0316654", "Spider-Man 2", "2004")];
        assert_eq!(pick(metas, &film).map(|m| m.id).as_deref(), Some("tt0316654"));
        let shifted = vec![meta("tt1", "Amélie", "2001")];
        let amelie = Film { slug: "amelie".into(), name: "Amélie".into(), year: Some("2002".into()), rating: None, liked: false };
        assert_eq!(pick(shifted, &amelie).map(|m| m.id).as_deref(), Some("tt1"));
        assert!(pick(vec![meta("tt2", "Something Else", "1990")], &film).is_none());
        let normal = Film { slug: "normal-2025".into(), name: "Normal".into(), year: Some("2025".into()), rating: None, liked: false };
        assert!(pick(vec![meta("tt37835599", "Next to Normal", "2025")], &normal).is_none());
    }
}
