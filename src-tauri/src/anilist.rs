//! AniList tokens remain per profile in the OS keychain. Fixed HTTPS endpoints,
//! no redirects and bounded typed replies prevent token leakage and untrusted API data.
use crate::{db::Db, keychain, profiles::ActiveProfile};
use reqwest::{Client, Url};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tauri::State;

// Orbit's public AniList API client (anilist.co/settings/developer), redirect
// https://anilist.co/api/v2/oauth/pin. A client ID is public by design.
// Implicit PIN authorization deliberately needs no embedded client secret.
const CLIENT_ID: &str = "52905";
const API: &str = "https://graphql.anilist.co";
const MAPPINGS: &str = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";
const TTL: Duration = Duration::from_secs(24 * 60 * 60);
const LIMIT: usize = 16 * 1024 * 1024;
#[derive(Default)]
pub struct AniList {
    gate: tokio::sync::Mutex<()>,
    mappings: tokio::sync::Mutex<Option<(Instant, Vec<Mapping>)>>,
}
fn key(profile: &str) -> String {
    format!("anilist-auth.{profile}")
}
pub(crate) fn forget(profile: &str) -> Result<(), String> {
    keychain::delete(&key(profile))
}
/// One client for the session, so connections (and TLS sessions) are reused.
fn client() -> Result<Client, String> {
    static CLIENT: LazyLock<Option<Client>> =
        LazyLock::new(|| Client::builder().https_only(true).timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().ok());
    CLIENT.clone().ok_or_else(|| "network".into())
}
async fn bytes(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    match response.status().as_u16() {
        401 | 403 => return Err("denied".into()),
        429 => return Err("rate-limited".into()),
        200..=299 => (),
        _ => return Err("network".into()),
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("invalid-data".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
        if body.len() + chunk.len() > limit {
            return Err("invalid-data".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
#[derive(Deserialize)]
struct Reply<T> {
    data: Option<T>,
    errors: Option<Vec<Value>>,
}
async fn gql<T: DeserializeOwned>(token: &str, query: &str, variables: Value) -> Result<T, String> {
    post(Some(token), query, variables).await
}
/// A GraphQL request, signed in with `token` or (for public data) not.
async fn post<T: DeserializeOwned>(token: Option<&str>, query: &str, variables: Value) -> Result<T, String> {
    let mut request = client()?.post(API);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request.json(&json!({"query":query,"variables":variables})).send().await.map_err(|_| "network")?;
    parse_reply(&bytes(response, 1024 * 1024).await?)
}
fn parse_reply<T: DeserializeOwned>(body: &[u8]) -> Result<T, String> {
    let reply: Reply<T> = serde_json::from_slice(body).map_err(|_| "invalid-data")?;
    if reply.errors.is_some_and(|e| !e.is_empty()) {
        return Err("invalid-data".into());
    }
    reply.data.ok_or_else(|| "invalid-data".into())
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    id: u32,
    name: String,
    avatar: Option<String>,
}
#[derive(Deserialize)]
struct Avatar {
    large: Option<String>,
}
#[derive(Deserialize)]
struct Viewer {
    id: u32,
    name: String,
    avatar: Option<Avatar>,
}
#[derive(Deserialize)]
struct ViewerData {
    #[serde(rename = "Viewer")]
    viewer: Viewer,
}
async fn viewer(token: &str) -> Result<Account, String> {
    let data: ViewerData = gql(token, "query { Viewer { id name avatar { large } } }", json!({})).await?;
    if data.viewer.id == 0 || data.viewer.name.is_empty() || data.viewer.name.len() > 200 {
        return Err("invalid-data".into());
    }
    // Avatar remains absent unless fetched through the trusted fixed CDN; no CSP expansion.
    let avatar = if let Some(url) = data.viewer.avatar.and_then(|a| a.large) {
        avatar_data(&url).await.ok()
    } else {
        None
    };
    Ok(Account {
        id: data.viewer.id,
        name: data.viewer.name,
        avatar,
    })
}
fn valid_avatar(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str() == Some("s4.anilist.co")
            && u.port().is_none()
            && u.username().is_empty()
            && u.password().is_none()
            && u.path().starts_with("/file/anilistcdn/user/avatar/")
    })
}
async fn avatar_data(url: &str) -> Result<String, String> {
    use base64::Engine;
    if !valid_avatar(url) {
        return Err("invalid-data".into());
    }
    let response = client()?.get(url).send().await.map_err(|_| "network")?;
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_owned();
    if !matches!(kind.as_str(), "image/png" | "image/jpeg" | "image/webp") {
        return Err("invalid-data".into());
    }
    let body = bytes(response, 380 * 1024).await?;
    if body.len() > 380 * 1024 {
        return Err("invalid-data".into());
    }
    Ok(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(body)))
}
fn setting(db: &Db, prefix: &str, profile: &str) -> Result<bool, String> {
    Ok(db
        .lock()?
        .query_row("SELECT value FROM settings WHERE key=?1", [format!("{prefix}.{profile}")], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "invalid-data")?
        .as_deref()
        == Some("true"))
}
fn enabled(db: &Db, profile: &str, on: bool) -> Result<(), String> {
    db.lock()?
        .execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![format!("anilist.sync.{profile}"), if on { "true" } else { "false" }],
        )
        .map_err(|_| "invalid-data")?;
    Ok(())
}
#[derive(Serialize)]
pub struct Status {
    configured: bool,
    connected: bool,
    error: Option<String>,
    account: Option<Account>,
    enabled: bool,
}
#[tauri::command]
pub async fn anilist_status(active: State<'_, ActiveProfile>, db: State<'_, Db>) -> Result<Status, String> {
    let profile = active.id()?;
    let token = keychain::get(&key(&profile)).map_err(|_| "keychain")?;
    let connected = token.is_some();
    let (account, error) = match token {
        Some(token) => match viewer(&token).await {
            Ok(account) => (Some(account), None),
            Err(error) => (None, Some(error)),
        },
        None => (None, None),
    };
    if active.id()? != profile {
        return Err("signed-out".into());
    }
    Ok(Status {
        configured: !CLIENT_ID.is_empty(),
        connected,
        error,
        account,
        enabled: setting(&db, "anilist.sync", &profile)?,
    })
}
#[tauri::command]
pub async fn anilist_authorize() -> Result<(), String> {
    if CLIENT_ID.is_empty() {
        return Err("unconfigured".into());
    }
    let mut url = Url::parse("https://anilist.co/api/v2/oauth/authorize").map_err(|_| "invalid-data")?;
    url.query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        // Implicit grant: AniList takes only these two; a redirect_uri makes it treat the
        // request as a code grant and refuse it. The client's registered redirect (the PIN page) is used.
        .append_pair("response_type", "token");
    crate::browser::open_in_browser(&url).map_err(|_| "network".into())
}
#[tauri::command]
pub async fn anilist_connect(active: State<'_, ActiveProfile>, db: State<'_, Db>, state: State<'_, AniList>, token: String) -> Result<(), String> {
    let _guard = state.gate.lock().await;
    let profile = active.id()?;
    let token = token.trim();
    if !(16..=4096).contains(&token.len()) || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)) {
        return Err("denied".into());
    }
    viewer(token).await?;
    if active.id()? != profile {
        return Err("signed-out".into());
    }
    keychain::set(&key(&profile), token).map_err(|_| "keychain")?;
    enabled(&db, &profile, true)
}
#[tauri::command]
pub async fn anilist_disconnect(active: State<'_, ActiveProfile>, db: State<'_, Db>, state: State<'_, AniList>) -> Result<(), String> {
    let p = active.id()?;
    enabled(&db, &p, false)?;
    let _guard = state.gate.lock().await;
    enabled(&db, &p, false)?;
    forget(&p).map_err(|_| "keychain".into())
}
#[tauri::command]
pub async fn anilist_set_enabled(active: State<'_, ActiveProfile>, db: State<'_, Db>, on: bool) -> Result<(), String> {
    enabled(&db, &active.id()?, on)
}
#[derive(Deserialize, Clone, Debug)]
struct Mapping {
    anilist_id: Option<u32>,
    mal_id: Option<u32>,
    kitsu_id: Option<u32>,
    #[serde(default)]
    imdb_id: Vec<String>,
    season: Option<Season>,
    episode_offset: Option<Offset>,
    /// `{"tv": id}` or `{"movie": [ids]}`. Kept loose: an odd row must not
    /// fail the whole list, which sync and AniSkip read too.
    #[serde(default)]
    themoviedb_id: Option<Value>,
}
#[derive(Deserialize, Clone, Debug)]
struct Offset {
    tmdb: Option<i32>,
    tvdb: Option<i32>,
}
#[derive(Deserialize, Clone, Debug)]
struct Season {
    tmdb: Option<u32>,
    tvdb: Option<u32>,
}
/// The kept id list and until when it's used as is.
type KeptMappings = Option<(Instant, Vec<Mapping>)>;
/// After a failed refresh the last list is used this long before asking again.
const RETRY: Duration = Duration::from_secs(10 * 60);
impl AniList {
    async fn mappings(&self) -> Result<Vec<Mapping>, String> {
        let mut cache = self.mappings.lock().await;
        if let Some((until, rows)) = cache.as_ref()
            && Instant::now() < *until
        {
            return Ok(rows.clone());
        }
        let (kept, rows) = refreshed(cache.take(), fetch_mappings().await, Instant::now());
        *cache = kept;
        rows
    }
}
async fn fetch_mappings() -> Result<Vec<Mapping>, String> {
    let response = client()?.get(MAPPINGS).send().await.map_err(|_| "network")?;
    let rows: Vec<Mapping> = serde_json::from_slice(&bytes(response, LIMIT).await?).map_err(|_| "invalid-data")?;
    if rows.len() > 100_000 || rows.iter().any(|r| r.imdb_id.len() > 100 || r.imdb_id.iter().any(|s| s.len() > 32)) {
        return Err("invalid-data".into());
    }
    Ok(rows)
}
/// What's kept after asking for the id list, and the rows to use now. If
/// GitHub is down or rate-limited, the last list (a day old, and still right
/// for nearly every title) keeps sync, AniSkip and the avatar picker working,
/// and the list is asked for again after `RETRY` rather than on every call.
fn refreshed(old: KeptMappings, fetched: Result<Vec<Mapping>, String>, now: Instant) -> (KeptMappings, Result<Vec<Mapping>, String>) {
    match (fetched, old) {
        (Ok(rows), _) => (Some((now + TTL, rows.clone())), Ok(rows)),
        (Err(_), Some((_, rows))) => (Some((now + RETRY, rows.clone())), Ok(rows)),
        (Err(e), None) => (None, Err(e)),
    }
}
fn number(s: &str) -> Option<u32> {
    s.parse().ok().filter(|n| *n > 0)
}
fn mapped(rows: &[Mapping], id: &str, season: u32) -> Option<u32> {
    mapped_by(rows, id, season, |r| r.anilist_id)
}
/// The MyAnimeList id for `id` (an IMDb or Kitsu id) in `season`, by the same rules as `mapped`.
fn mapped_mal(rows: &[Mapping], id: &str, season: u32) -> Option<u32> {
    mapped_by(rows, id, season, |r| r.mal_id)
}
fn mapped_by(rows: &[Mapping], id: &str, season: u32, pick: impl Fn(&Mapping) -> Option<u32>) -> Option<u32> {
    // IMDb covers whole shows: offsets and disagreeing numbering sources need
    // explicit episode mappings, so do not guess even when one season matches.
    if id.starts_with("tt")
        && rows.iter().filter(|r| r.imdb_id.iter().any(|s| s == id)).any(|r| {
            r.episode_offset.as_ref().is_some_and(|o| o.tmdb.unwrap_or(0) != 0 || o.tvdb.unwrap_or(0) != 0)
                || r.season.as_ref().is_some_and(|s| matches!((s.tmdb, s.tvdb), (Some(a), Some(b)) if a != b))
        })
    {
        return None;
    }
    let mut matches = rows
        .iter()
        .filter(|r| {
            if let Some(kitsu) = id.strip_prefix("kitsu:").and_then(number) {
                return season <= 1 && r.kitsu_id == Some(kitsu);
            }
            id.starts_with("tt") && r.imdb_id.iter().any(|s| s == id) && r.season.as_ref().is_some_and(|s| s.tmdb.or(s.tvdb) == Some(season))
        })
        .filter_map(|r| pick(r).filter(|n| *n > 0));
    let first = matches.next()?;
    if matches.all(|n| n == first) { Some(first) } else { None }
}
/// The MyAnimeList id of the anime playing, for AniSkip (see skip.rs): a `mal:` id
/// as it is, an IMDb or Kitsu id through the same id list and rules as sync
/// (season 1 only for MAL and Kitsu, since they number each season apart).
/// None when there's no confident match.
pub(crate) async fn mal_id(state: &AniList, id: &str, season: u32) -> Result<Option<u32>, String> {
    if let Some(mal) = id.strip_prefix("mal:") {
        return Ok(number(mal).filter(|_| season <= 1));
    }
    if !id.starts_with("tt") && !id.starts_with("kitsu:") {
        return Ok(None);
    }
    Ok(mapped_mal(&state.mappings().await?, id, season))
}
/// The TMDB ids a row's `themoviedb_id` gives for TV or movies (one, or a list).
fn tmdb_ids(value: &Value, tv: bool) -> Vec<u64> {
    match value.get(if tv { "tv" } else { "movie" }) {
        Some(Value::Array(ids)) => ids.iter().filter_map(Value::as_u64).collect(),
        Some(id) => id.as_u64().into_iter().collect(),
        None => Vec::new(),
    }
}
/// The AniList id of the anime TMDB knows as `id`: for a show, its first
/// season's entry (later seasons, specials and spin-offs mostly share its
/// characters), and the lowest id when several qualify, so it's stable.
/// None when the id list doesn't name it, i.e. it isn't an anime.
fn mapped_tmdb(rows: &[Mapping], tv: bool, id: u64) -> Option<u32> {
    rows.iter()
        .filter(|r| r.themoviedb_id.as_ref().is_some_and(|t| tmdb_ids(t, tv).contains(&id)))
        .filter_map(|r| {
            // Season 0 is specials: anything else first.
            let season = r.season.as_ref().and_then(|s| s.tmdb).unwrap_or(1);
            Some((if season == 0 { u32::MAX } else { season }, r.anilist_id.filter(|n| *n > 0)?))
        })
        .min()
        .map(|(_, anilist)| anilist)
}
/// Characters shown per anime, main ones first.
const MAX_CHARACTERS: usize = 25;
const CHARACTERS_QUERY: &str = "query($id:Int!){ Media(id:$id,type:ANIME){ isAdult characters(sort:[ROLE,RELEVANCE,ID],perPage:25){ nodes { id name { full } image { large } } } } }";
/// One anime character, drawn: what the avatar picker offers (and, chosen, saves).
#[derive(Serialize, Debug, PartialEq)]
pub struct Character {
    id: u32,
    name: String,
    image: String,
}
#[derive(Deserialize)]
struct CharacterName {
    full: Option<String>,
}
#[derive(Deserialize)]
struct CharacterImage {
    large: Option<String>,
}
#[derive(Deserialize)]
struct CharacterNode {
    id: u32,
    name: Option<CharacterName>,
    image: Option<CharacterImage>,
}
#[derive(Deserialize)]
struct CharacterList {
    #[serde(default)]
    nodes: Vec<Option<CharacterNode>>,
}
#[derive(Deserialize)]
struct CharacterMedia {
    #[serde(rename = "isAdult")]
    is_adult: Option<bool>,
    characters: Option<CharacterList>,
}
#[derive(Deserialize)]
struct CharacterData {
    #[serde(rename = "Media")]
    media: Option<CharacterMedia>,
}
/// An AniList character picture: AniList's CDN over https, a plain path under
/// its character folder, and not the blank "default" picture. The URL must be
/// written as parsed (no dot segments or escapes), so what's checked is what's fetched.
pub(crate) fn valid_character_image(url: &str) -> bool {
    url.len() <= 300
        && Url::parse(url).is_ok_and(|u| {
            u.as_str() == url
                && u.scheme() == "https"
                && u.host_str() == Some("s4.anilist.co")
                && u.port().is_none()
                && u.username().is_empty()
                && u.password().is_none()
                && u.query().is_none()
                && u.fragment().is_none()
                && u.path().strip_prefix("/file/anilistcdn/character/").is_some_and(|rest| {
                    !rest.ends_with("/default.jpg") && rest.split('/').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) && part != "." && part != "..")
                })
        })
}
/// The characters worth offering: named, with a real picture; none for an adult title.
fn characters(data: CharacterData) -> Vec<Character> {
    let Some(media) = data.media else { return Vec::new() };
    if media.is_adult != Some(false) {
        return Vec::new();
    }
    media
        .characters
        .map(|list| list.nodes)
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter_map(|node| {
            let name = node.name?.full?.trim().to_owned();
            let image = node.image?.large?;
            (node.id > 0 && !name.is_empty() && name.chars().count() <= 200 && valid_character_image(&image)).then_some(Character { id: node.id, name, image })
        })
        .take(MAX_CHARACTERS)
        .collect()
}
/// An anime's characters as AniList draws them, for the avatar picker (TMDB
/// only has the voice actors' photos). The title is the one the picker found
/// on TMDB, mapped through the same public id list as sync; AniList's public
/// API is asked without a token and is sent only the AniList id. None when
/// the list doesn't know the title as anime (the picker then uses TMDB's cast).
#[tauri::command]
pub async fn anilist_characters(state: State<'_, AniList>, tmdb_id: u64, kind: String) -> Result<Option<Vec<Character>>, String> {
    let tv = match kind.as_str() {
        "series" => true,
        "movie" => false,
        _ => return Err("invalid-data".into()),
    };
    let Some(id) = mapped_tmdb(&state.mappings().await?, tv, tmdb_id) else { return Ok(None) };
    let data: CharacterData = post(None, CHARACTERS_QUERY, json!({ "id": id })).await?;
    Ok(Some(characters(data)))
}
#[derive(Deserialize)]
pub struct Scrobble {
    id: String,
    season: u32,
    episode: u32,
}
#[derive(Deserialize)]
struct Entry {
    progress: u32,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    repeat: Option<u32>,
}
/// How many times a title being rewatched (REPEATING on AniList) was watched through before; None when it isn't one.
fn repeat_count(entry: &Entry) -> Option<u32> {
    (entry.status.as_deref() == Some("REPEATING")).then(|| entry.repeat.unwrap_or(0))
}
#[derive(Deserialize)]
struct Media {
    id: u32,
    episodes: Option<u32>,
    #[serde(rename = "mediaListEntry")]
    entry: Option<Entry>,
}
#[derive(Deserialize)]
struct MediaData {
    #[serde(rename = "Media")]
    media: Option<Media>,
}
/// The progress and status to save for `episode`, and the new repeat count when it finishes a rewatch.
/// `rewatch`: the entry's repeat count when it's being rewatched (see `repeat_count`), so it stays a rewatch.
fn progress(previous: u32, rewatch: Option<u32>, episode: u32, total: Option<u32>) -> Option<(u32, &'static str, Option<u32>)> {
    if episode == 0 || episode <= previous || total.is_some_and(|n| n == 0 || episode > n) {
        return None;
    }
    if total == Some(episode) {
        return Some((episode, "COMPLETED", rewatch.map(|n| n.saturating_add(1))));
    }
    Some((episode, if rewatch.is_some() { "REPEATING" } else { "CURRENT" }, None))
}
fn permitted(active: &ActiveProfile, db: &Db, p: &str) -> Result<bool, String> {
    Ok(active.id()? == p && setting(db, "anilist.sync", p)? && !setting(db, "history.paused", p)?)
}
#[tauri::command]
pub async fn anilist_scrobble(active: State<'_, ActiveProfile>, db: State<'_, Db>, state: State<'_, AniList>, request: Scrobble) -> Result<(), String> {
    let _guard = state.gate.lock().await;
    let p = active.id()?;
    if !permitted(&active, &db, &p)? || request.id.len() > 64 || request.episode > 100_000 {
        return Ok(());
    }
    let Some(token) = keychain::get(&key(&p)).map_err(|_| "keychain")? else {
        return Ok(());
    };
    let (query, variables) = if let Some(mal) = request.id.strip_prefix("mal:").and_then(number) {
        if request.season > 1 {
            return Ok(());
        }
        (
            "query($id:Int!){ Media(idMal:$id,type:ANIME){ id episodes mediaListEntry { progress status repeat } } }",
            json!({"id":mal}),
        )
    } else {
        let Some(id) = mapped(&state.mappings().await?, &request.id, request.season) else {
            if cfg!(debug_assertions) {
                eprintln!("AniList: no confident anime mapping");
            }
            return Ok(());
        };
        (
            "query($id:Int!){ Media(id:$id,type:ANIME){ id episodes mediaListEntry { progress status repeat } } }",
            json!({"id":id}),
        )
    };
    if !permitted(&active, &db, &p)? {
        return Ok(());
    }
    let data: MediaData = gql(&token, query, variables).await?;
    let Some(media) = data.media.filter(|m| m.id > 0) else { return Ok(()) };
    let entry = media.entry.as_ref();
    let Some((count, status, repeat)) = progress(entry.map_or(0, |e| e.progress), entry.and_then(repeat_count), request.episode, media.episodes) else {
        return Ok(());
    };
    // The read and mutation are serialized, and choices/profile are checked again
    // after mapping/network waits so a pending completion cannot cross profiles.
    if !permitted(&active, &db, &p)? {
        return Ok(());
    }
    #[derive(Deserialize)]
    struct Saved {
        #[serde(rename = "SaveMediaListEntry")]
        entry: SavedEntry,
    }
    #[derive(Deserialize)]
    struct SavedEntry {
        id: u32,
        progress: u32,
    }
    // The repeat count is sent only when a rewatch finishes; otherwise AniList keeps its own.
    let saved: Saved = match repeat {
        Some(repeat) => gql(
            &token,
            "mutation($id:Int!,$progress:Int!,$status:MediaListStatus!,$repeat:Int!){ SaveMediaListEntry(mediaId:$id,progress:$progress,status:$status,repeat:$repeat){ id progress } }",
            json!({"id":media.id,"progress":count,"status":status,"repeat":repeat}),
        )
        .await?,
        None => gql(
            &token,
            "mutation($id:Int!,$progress:Int!,$status:MediaListStatus!){ SaveMediaListEntry(mediaId:$id,progress:$progress,status:$status){ id progress } }",
            json!({"id":media.id,"progress":count,"status":status}),
        )
        .await?,
    };
    if saved.entry.id == 0 || saved.entry.progress < count {
        return Err("invalid-data".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct Candidate {
    id: String,
    #[serde(rename = "type")]
    kind: &'static str,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<String>,
}
#[derive(Deserialize)]
struct Title {
    romaji: Option<String>,
    english: Option<String>,
}
#[derive(Deserialize)]
struct Date {
    year: Option<u32>,
}
#[derive(Deserialize)]
struct ImportMedia {
    id: u32,
    #[serde(rename = "idMal")]
    mal: Option<u32>,
    title: Title,
    #[serde(rename = "startDate")]
    date: Option<Date>,
    format: Option<String>,
}
#[derive(Deserialize)]
struct ImportEntry {
    status: String,
    /// AniList's schema allows none (a title since taken down, say): such an entry is skipped, not the whole import.
    media: Option<ImportMedia>,
}
#[derive(Deserialize)]
struct List {
    entries: Vec<ImportEntry>,
}
#[derive(Deserialize)]
struct Collection {
    lists: Vec<List>,
}
#[derive(Deserialize)]
struct ImportData {
    #[serde(rename = "MediaListCollection")]
    collection: Option<Collection>,
}
#[tauri::command]
pub async fn anilist_import_candidates(active: State<'_, ActiveProfile>, state: State<'_, AniList>) -> Result<Vec<Candidate>, String> {
    let p = active.id()?;
    let token = keychain::get(&key(&p)).map_err(|_| "keychain")?.ok_or("signed-out")?;
    let account = viewer(&token).await?;
    let data:ImportData=gql(&token,"query($user:Int!){ MediaListCollection(userId:$user,type:ANIME,status_in:[CURRENT,PLANNING]){ lists { entries { status media { id idMal format title { romaji english } startDate { year } } } } } }",json!({"user":account.id})).await?;
    let rows = state.mappings().await?;
    let result = import_candidates(data, &rows);
    if active.id()? != p {
        return Err("signed-out".into());
    }
    Ok(result)
}

/// The watching and planned entries of `data` that map to one Kitsu id, once each.
fn import_candidates(data: ImportData, rows: &[Mapping]) -> Vec<Candidate> {
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for e in data.collection.into_iter().flat_map(|c| c.lists).flat_map(|l| l.entries) {
        let Some(media) = e.media.filter(|_| matches!(e.status.as_str(), "CURRENT" | "PLANNING")) else {
            continue;
        };
        // Kitsu is the anime addon's supported namespace. Never invent a MAL addon.
        let matches: Vec<_> = rows
            .iter()
            .filter(|r| r.anilist_id == Some(media.id) && (media.mal.is_none() || r.mal_id == media.mal))
            .filter_map(|r| r.kitsu_id)
            .collect();
        let Some(kitsu) = matches.first().copied().filter(|id| *id > 0 && matches.iter().all(|n| n == id)) else {
            continue;
        };
        let Some(name) = media.title.english.or(media.title.romaji).filter(|s| !s.is_empty() && s.len() <= 500) else {
            continue;
        };
        let id = format!("kitsu:{kitsu}");
        if seen.insert(id.clone()) {
            result.push(Candidate {
                id,
                kind: if media.format.as_deref() == Some("MOVIE") { "movie" } else { "series" },
                name,
                year: media.date.and_then(|d| d.year).filter(|y| (1900..=2200).contains(y)).map(|y| y.to_string()),
            });
        }
    }
    result
}
#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = number(&text);
    let _ = valid_avatar(&text);
    if let Ok(rows) = serde_json::from_slice::<Vec<Mapping>>(data) {
        let _ = mapped(&rows, &text, 1);
    }
    if data.len() >= 12 {
        let n = |at| u32::from_le_bytes(data[at..at + 4].try_into().unwrap());
        if let Some((value, _, _)) = progress(n(0), None, n(4), Some(n(8))) {
            assert!(value >= n(0));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_entry_without_media_is_skipped_not_the_whole_import() {
        let data: ImportData = serde_json::from_str(
            r#"{"MediaListCollection":{"lists":[{"entries":[
                {"status":"CURRENT","media":null},
                {"status":"PLANNING","media":{"id":1,"idMal":5,"format":"TV","title":{"romaji":"Hoshi","english":null},"startDate":{"year":2020}}}
            ]}]}}"#,
        )
        .unwrap();
        let rows: Vec<Mapping> = serde_json::from_str(r#"[{"anilist_id":1,"mal_id":5,"kitsu_id":42}]"#).unwrap();
        let found = import_candidates(data, &rows);
        assert_eq!(found.iter().map(|c| (c.id.as_str(), c.name.as_str())).collect::<Vec<_>>(), [("kitsu:42", "Hoshi")]);
    }
    #[test]
    fn monotonic_completion() {
        assert_eq!(progress(4, None, 3, Some(12)), None);
        assert_eq!(progress(4, None, 4, Some(12)), None);
        assert_eq!(progress(4, None, 5, Some(12)), Some((5, "CURRENT", None)));
        assert_eq!(progress(11, None, 12, Some(12)), Some((12, "COMPLETED", None)));
        assert_eq!(progress(0, None, 13, Some(12)), None);
        assert_eq!(progress(0, None, 1, None), Some((1, "CURRENT", None)));
    }
    #[test]
    fn a_rewatch_stays_a_rewatch_and_counts_when_finished() {
        // Rewatching on AniList (REPEATING, watched through twice before): an episode doesn't turn it into a first watch.
        assert_eq!(progress(3, Some(2), 4, Some(12)), Some((4, "REPEATING", None)));
        assert_eq!(progress(0, Some(2), 1, None), Some((1, "REPEATING", None)));
        // The last episode finishes the rewatch, and it counts as one more time watched.
        assert_eq!(progress(11, Some(2), 12, Some(12)), Some((12, "COMPLETED", Some(3))));
        assert_eq!(progress(4, Some(2), 4, Some(12)), None);
        assert_eq!(repeat_count(&Entry { progress: 3, status: Some("REPEATING".into()), repeat: Some(2) }), Some(2));
        assert_eq!(repeat_count(&Entry { progress: 3, status: Some("REPEATING".into()), repeat: None }), Some(0));
        assert_eq!(repeat_count(&Entry { progress: 3, status: Some("CURRENT".into()), repeat: Some(2) }), None);
        let parsed: MediaData = serde_json::from_str(r#"{"Media":{"id":1,"episodes":12,"mediaListEntry":{"progress":3,"status":"REPEATING","repeat":1}}}"#).unwrap();
        assert_eq!(parsed.media.and_then(|m| m.entry).as_ref().and_then(repeat_count), Some(1));
    }
    #[test]
    fn season_and_ambiguity() {
        let rows: Vec<Mapping> = serde_json::from_str(
            r#"[{"anilist_id":1,"kitsu_id":4,"imdb_id":["tt123"],"season":{"tmdb":1}},{"anilist_id":2,"imdb_id":["tt123"],"season":{"tmdb":2}}]"#,
        )
        .unwrap();
        assert_eq!(mapped(&rows, "tt123", 2), Some(2));
        assert_eq!(mapped(&rows, "tt123", 3), None);
        assert_eq!(mapped(&rows, "kitsu:4", 1), Some(1));
        assert_eq!(mapped(&rows, "kitsu:4", 2), None);
        let mut ambiguous = rows.clone();
        ambiguous.push(Mapping {
            anilist_id: Some(9),
            ..rows[0].clone()
        });
        assert_eq!(mapped(&ambiguous, "tt123", 1), None);
    }
    #[test]
    fn the_last_id_list_stands_in_while_github_is_down() {
        let rows: Vec<Mapping> = serde_json::from_str(r#"[{"anilist_id":1,"imdb_id":["tt123"],"season":{"tmdb":1}}]"#).unwrap();
        let now = Instant::now();
        // A refresh that worked: kept for a day.
        let (kept, got) = refreshed(None, Ok(rows.clone()), now);
        assert_eq!(got.map(|r| r.len()), Ok(1));
        assert_eq!(kept.as_ref().map(|(until, _)| *until), Some(now + TTL));
        // One that failed: the old list answers, and the list is asked for again after a short while, not on every call.
        let (kept, got) = refreshed(kept, Err("network".into()), now);
        assert_eq!(got.map(|r| r.len()), Ok(1));
        assert_eq!(kept.as_ref().map(|(until, _)| *until), Some(now + RETRY));
        // Nothing to fall back on: the failure stands.
        let (kept, got) = refreshed(None, Err("network".into()), now);
        assert!(kept.is_none() && got.is_err());
    }

    #[test]
    fn mal_ids_follow_the_same_rules() {
        let rows: Vec<Mapping> = serde_json::from_str(
            r#"[{"anilist_id":1,"mal_id":11,"kitsu_id":4,"imdb_id":["tt123"],"season":{"tmdb":1}},{"anilist_id":2,"mal_id":22,"imdb_id":["tt123"],"season":{"tmdb":2}},{"anilist_id":3,"imdb_id":["tt9"],"season":{"tmdb":1}}]"#,
        )
        .unwrap();
        assert_eq!(mapped_mal(&rows, "tt123", 2), Some(22));
        assert_eq!(mapped_mal(&rows, "kitsu:4", 1), Some(11));
        assert_eq!(mapped_mal(&rows, "kitsu:4", 2), None);
        assert_eq!(mapped_mal(&rows, "tt9", 1), None);
    }
    #[test]
    fn strict_parsing() {
        assert!(serde_json::from_str::<MediaData>(r#"{"Media":{"id":"1","episodes":12}}"#).is_err());
        assert!(serde_json::from_str::<MediaData>(r#"{"Media":{"id":1,"mediaListEntry":{"progress":-1}}}"#).is_err());
        assert!(serde_json::from_str::<Vec<Mapping>>(r#"[{"anilist_id":"1"}]"#).is_err());
    }
    #[test]
    fn restricted_avatar() {
        assert!(valid_avatar("https://s4.anilist.co/file/anilistcdn/user/avatar/large/a1.png"));
        assert!(!valid_avatar("http://s4.anilist.co/file/anilistcdn/user/avatar/a.png"));
        assert!(!valid_avatar("https://evil.test/file/anilistcdn/user/avatar/a.png"));
        assert!(!valid_avatar("https://s4.anilist.co@127.0.0.1/file/anilistcdn/user/avatar/a.png"));
    }
    #[test]
    fn tmdb_ids_map_to_the_first_season() {
        let rows: Vec<Mapping> = serde_json::from_str(
            r#"[{"anilist_id":30,"themoviedb_id":{"tv":100},"season":{"tmdb":2}},
                {"anilist_id":20,"themoviedb_id":{"tv":100},"season":{"tmdb":0}},
                {"anilist_id":10,"themoviedb_id":{"tv":100},"season":{"tmdb":1}},
                {"anilist_id":5,"themoviedb_id":{"movie":[100,101]}},
                {"anilist_id":6,"themoviedb_id":{"movie":102}},
                {"anilist_id":7,"themoviedb_id":"odd"},
                {"anilist_id":0,"themoviedb_id":{"tv":200}}]"#,
        )
        .unwrap();
        assert_eq!(mapped_tmdb(&rows, true, 100), Some(10));
        // TV and movie ids are separate namespaces.
        assert_eq!(mapped_tmdb(&rows, false, 100), Some(5));
        assert_eq!(mapped_tmdb(&rows, false, 101), Some(5));
        assert_eq!(mapped_tmdb(&rows, false, 102), Some(6));
        assert_eq!(mapped_tmdb(&rows, true, 200), None);
        assert_eq!(mapped_tmdb(&rows, true, 999), None);
        // Only specials: they still count.
        let specials: Vec<Mapping> = serde_json::from_str(r#"[{"anilist_id":3,"themoviedb_id":{"tv":1},"season":{"tmdb":0}}]"#).unwrap();
        assert_eq!(mapped_tmdb(&specials, true, 1), Some(3));
    }
    #[test]
    fn character_replies_are_checked() {
        let body = br#"{"data":{"Media":{"isAdult":false,"characters":{"nodes":[
            {"id":1,"name":{"full":" Lead Hero "},"image":{"large":"https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png"}},
            {"id":2,"name":{"full":"No Picture"},"image":{"large":"https://s4.anilist.co/file/anilistcdn/character/large/default.jpg"}},
            {"id":3,"name":{"full":"Elsewhere"},"image":{"large":"https://evil.test/file/anilistcdn/character/large/x.png"}},
            {"id":4,"name":{"full":""},"image":{"large":"https://s4.anilist.co/file/anilistcdn/character/large/b4.png"}},
            {"id":5,"name":null,"image":null},
            null
        ]}}}}"#;
        let found = characters(parse_reply(body).unwrap());
        assert_eq!(
            found,
            vec![Character { id: 1, name: "Lead Hero".into(), image: "https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png".into() }]
        );
        // An adult title, or one AniList doesn't say isn't, offers nothing.
        let adult = br#"{"data":{"Media":{"isAdult":true,"characters":{"nodes":[{"id":1,"name":{"full":"A"},"image":{"large":"https://s4.anilist.co/file/anilistcdn/character/large/a.png"}}]}}}}"#;
        assert!(characters(parse_reply(adult).unwrap()).is_empty());
        assert!(characters(parse_reply(br#"{"data":{"Media":null}}"#).unwrap()).is_empty());
        // GraphQL errors and wrong shapes are refused.
        assert!(parse_reply::<CharacterData>(br#"{"data":null,"errors":[{"message":"Not Found."}]}"#).is_err());
        assert!(parse_reply::<CharacterData>(br#"{"data":{"Media":{"characters":{"nodes":[{"id":"1"}]}}}}"#).is_err());
    }
    #[test]
    fn character_pictures_come_from_anilist_only() {
        assert!(valid_character_image("https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png"));
        assert!(!valid_character_image("https://s4.anilist.co/file/anilistcdn/character/large/../../user/a.png"));
        assert!(!valid_character_image("https://s4.anilist.co/file/anilistcdn/character/large/%2e%2e/a.png"));
        assert!(!valid_character_image("https://s4.anilist.co/file/anilistcdn/character/large/a.png?x=1"));
        assert!(!valid_character_image("https://s4.anilist.co/file/anilistcdn/user/avatar/large/a.png"));
        assert!(!valid_character_image("http://s4.anilist.co/file/anilistcdn/character/large/a.png"));
        assert!(!valid_character_image("https://s4.anilist.co:8443/file/anilistcdn/character/large/a.png"));
        assert!(!valid_character_image("https://s4.anilist.co.evil.test/file/anilistcdn/character/large/a.png"));
    }
    #[test]
    fn native_preferences_are_profile_scoped_and_pause_is_read_fresh() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        assert!(!setting(&db, "anilist.sync", "main").unwrap());
        enabled(&db, "main", true).unwrap();
        assert!(setting(&db, "anilist.sync", "main").unwrap());
        assert!(!setting(&db, "anilist.sync", "other").unwrap());
        assert!(!setting(&db, "history.paused", "main").unwrap());
        db.lock()
            .unwrap()
            .execute("INSERT INTO settings VALUES ('history.paused.main', 'true')", [])
            .unwrap();
        assert!(setting(&db, "history.paused", "main").unwrap());
        assert!(!setting(&db, "history.paused", "other").unwrap());
        enabled(&db, "main", false).unwrap();
        assert!(!setting(&db, "anilist.sync", "main").unwrap());
    }
    #[test]
    fn imdb_offsets_and_conflicting_seasons_are_not_guessed() {
        let offset: Vec<Mapping> =
            serde_json::from_str(r#"[{"anilist_id":1,"kitsu_id":4,"imdb_id":["tt123"],"season":{"tmdb":1,"tvdb":1},"episode_offset":{"tmdb":12}}]"#).unwrap();
        assert_eq!(mapped(&offset, "tt123", 1), None);
        assert_eq!(mapped(&offset, "kitsu:4", 1), Some(1));
        let conflicting: Vec<Mapping> = serde_json::from_str(r#"[{"anilist_id":1,"imdb_id":["tt123"],"season":{"tmdb":1,"tvdb":2}}]"#).unwrap();
        assert_eq!(mapped(&conflicting, "tt123", 1), None);
        assert_eq!(mapped(&conflicting, "tt123", 2), None);
        let zero: Vec<Mapping> =
            serde_json::from_str(r#"[{"anilist_id":1,"imdb_id":["tt123"],"season":{"tmdb":1,"tvdb":1},"episode_offset":{"tmdb":0,"tvdb":0}}]"#).unwrap();
        assert_eq!(mapped(&zero, "tt123", 1), Some(1));
    }
}
