//! Plex metadata as Orbit uses it. Everything here comes from the server, so
//! it's treated like addon data: each item is checked on its own (one that
//! doesn't fit is dropped, not the whole page), rating keys must be plain
//! numbers, image and file paths must have Plex's exact shape (so nothing the
//! server sends is put into an address as-is), and text is trimmed to size
//! with control characters removed.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::media_server::{clean, is_imdb, is_tmdb};

/// Items in one list Orbit asks for (a page of a library, a Home row).
pub const MAX_ITEMS: usize = 500;
/// Episodes of one show.
pub const MAX_EPISODES: usize = 3000;
/// Versions of one movie or episode.
const MAX_VERSIONS: usize = 20;

/// Plex ids ("rating keys") are numbers, sent as text.
pub fn is_rating_key(key: &str) -> bool {
    (1..=12).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_digit())
}

fn text(v: &Value, key: &str, max: usize) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(|s| clean(s, max)).filter(|s| !s.is_empty())
}

/// A number Plex may send as a number or as text.
pub fn number(v: &Value, key: &str) -> Option<i64> {
    match v.get(key)? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// A rating key Plex may send as text or as a number.
fn key_of(v: &Value, key: &str) -> Option<String> {
    let key = match v.get(key)? {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.as_u64()?.to_string(),
        _ => return None,
    };
    is_rating_key(&key).then_some(key)
}

/// The `MediaContainer` of an answer.
pub fn container(value: &Value) -> Option<&Map<String, Value>> {
    value.get("MediaContainer")?.as_object()
}

/// An image on the server: `/library/metadata/{key}/{kind}[/{version}]`.
#[derive(Debug, PartialEq, Clone)]
pub struct Art {
    pub key: String,
    pub kind: &'static str,
    pub version: Option<String>,
}

pub fn art_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "thumb" => Some("thumb"),
        "art" => Some("art"),
        "clearLogo" => Some("clearLogo"),
        _ => None,
    }
}

pub fn is_version(v: &str) -> bool {
    (1..=12).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_digit())
}

/// An image path from the server, if it has exactly Plex's shape.
pub fn parse_art(path: &str) -> Option<Art> {
    let mut parts = path.strip_prefix("/library/metadata/")?.split('/');
    let key = parts.next().filter(|k| is_rating_key(k))?;
    let kind = art_kind(parts.next()?)?;
    let version = match parts.next() {
        Some(v) if is_version(v) => Some(v.to_string()),
        Some(_) => return None,
        None => None,
    };
    if parts.next().is_some() {
        return None;
    }
    Some(Art { key: key.to_string(), kind, version })
}

impl Art {
    /// As the page asks the `plex-art` protocol for it: `{server}_{key}_{kind}[_{version}]`.
    pub fn page_key(&self, server: &str) -> String {
        match &self.version {
            Some(v) => format!("{server}_{}_{}_{v}", self.key, self.kind),
            None => format!("{server}_{}_{}", self.key, self.kind),
        }
    }

    /// The path on the server.
    pub fn path(&self) -> String {
        match &self.version {
            Some(v) => format!("/library/metadata/{}/{}/{v}", self.key, self.kind),
            None => format!("/library/metadata/{}/{}", self.key, self.kind),
        }
    }
}

/// The fields Orbit reads from a Plex `Metadata` entry.
#[derive(Debug, Default)]
pub struct Meta {
    pub rating_key: String,
    /// "movie", "series", "season" or "episode".
    pub kind: &'static str,
    pub title: Option<String>,
    pub year: Option<i64>,
    pub summary: Option<String>,
    pub genres: Vec<String>,
    pub rating: Option<f64>,
    /// The age rating the server has for it ("PG-13", "de/16"…).
    pub content_rating: Option<String>,
    pub duration_ms: Option<i64>,
    pub view_offset_ms: Option<i64>,
    /// When it was last viewed (Unix seconds).
    pub last_viewed: Option<i64>,
    /// When it was added to the library (Unix seconds).
    pub added_at: Option<i64>,
    pub thumb: Option<Art>,
    pub art: Option<Art>,
    pub logo: Option<Art>,
    pub parent: Option<String>,
    pub grandparent: Option<String>,
    pub season: Option<i64>,
    pub index: Option<i64>,
    pub released: Option<String>,
    pub imdb: Option<String>,
    pub tmdb: Option<String>,
    pub media: Vec<Value>,
}

/// The ids in a Plex guid: the new agents' `Guid` list (`imdb://tt…`,
/// `tmdb://…`, `tvdb://…`) or an old agent's `guid`
/// (`com.plexapp.agents.imdb://tt…?lang=en`, `…themoviedb://…`).
fn external_ids(v: &Value) -> (Option<String>, Option<String>) {
    let mut guids: Vec<&str> = v.get("Guid").and_then(Value::as_array).into_iter().flatten().take(20).filter_map(|g| g.get("id").and_then(Value::as_str)).collect();
    guids.extend(v.get("guid").and_then(Value::as_str));
    let (mut imdb, mut tmdb) = (None, None);
    for guid in guids {
        let Some((scheme, rest)) = guid.split_once("://") else { continue };
        let id = rest.split(['?', '/']).next().unwrap_or_default();
        match scheme {
            "imdb" | "com.plexapp.agents.imdb" if imdb.is_none() && is_imdb(id) => imdb = Some(id.to_string()),
            "tmdb" | "com.plexapp.agents.themoviedb" if tmdb.is_none() && is_tmdb(id) => tmdb = Some(id.to_string()),
            _ => {}
        }
    }
    (imdb, tmdb)
}

pub fn parse_meta(v: &Value) -> Option<Meta> {
    let rating_key = key_of(v, "ratingKey")?;
    let kind = match v.get("type")?.as_str()? {
        "movie" => "movie",
        "show" => "series",
        "season" => "season",
        "episode" => "episode",
        _ => return None,
    };
    let art_at = |key: &str| v.get(key).and_then(Value::as_str).and_then(parse_art);
    let logo = v.get("Image").and_then(Value::as_array).into_iter().flatten().find(|i| i.get("type").and_then(Value::as_str) == Some("clearLogo")).and_then(|i| i.get("url")?.as_str()).and_then(parse_art);
    let (imdb, tmdb) = external_ids(v);
    Some(Meta {
        rating_key,
        kind,
        title: text(v, "title", 200),
        year: number(v, "year").filter(|y| (1800..=3000).contains(y)),
        summary: text(v, "summary", 2000),
        genres: v.get("Genre").and_then(Value::as_array).into_iter().flatten().filter_map(|g| text(g, "tag", 50)).take(10).collect(),
        rating: ["audienceRating", "rating"].iter().find_map(|k| v.get(*k).and_then(Value::as_f64)).filter(|r| r.is_finite() && (0.0..=10.0).contains(r)),
        content_rating: v.get("contentRating").and_then(Value::as_str).and_then(crate::tmdb::clean_cert),
        duration_ms: number(v, "duration").filter(|d| *d > 0),
        view_offset_ms: number(v, "viewOffset").filter(|d| *d > 0),
        last_viewed: number(v, "lastViewedAt").filter(|s| *s > 0),
        added_at: number(v, "addedAt").filter(|s| *s > 0),
        thumb: art_at("thumb"),
        art: art_at("art"),
        logo,
        parent: key_of(v, "parentRatingKey"),
        grandparent: key_of(v, "grandparentRatingKey"),
        season: number(v, "parentIndex").filter(|n| (0..=10_000).contains(n)),
        index: number(v, "index").filter(|n| (0..=100_000).contains(n)),
        released: v.get("originallyAvailableAt").and_then(Value::as_str).filter(|d| d.len() <= 40 && d.bytes().all(|b| b.is_ascii_alphanumeric() || b"-:.+".contains(&b))).map(str::to_string),
        imdb,
        tmdb,
        media: v.get("Media").and_then(Value::as_array).map(|m| m.iter().take(MAX_VERSIONS).cloned().collect()).unwrap_or_default(),
    })
}

/// The `Metadata` entries of an answer that parse; the rest are dropped.
pub fn metadata_of(value: &Value, max: usize) -> Vec<Meta> {
    container(value).and_then(|c| c.get("Metadata")).and_then(Value::as_array).into_iter().flatten().filter_map(parse_meta).take(max).collect()
}

impl Meta {
    /// Seconds into it the person stopped last time, if anywhere.
    pub fn resume(&self) -> Option<f64> {
        self.view_offset_ms.map(|ms| ms as f64 / 1000.0)
    }

    /// When it was last viewed (ms), for a resume point: the page weighs it against Orbit's own history.
    pub fn resumed_at(&self) -> Option<i64> {
        self.resume()?;
        self.last_viewed?.checked_mul(1000)
    }

    /// The show a season or episode belongs to.
    pub fn show(&self) -> Option<&str> {
        match self.kind {
            "episode" => self.grandparent.as_deref(),
            "season" => self.parent.as_deref(),
            _ => None,
        }
    }
}

/// Orbit's id for a Plex item: its IMDb id when it has one, so it's the same
/// title as in Cinemeta, TMDB, watch history and Stremio sync; otherwise
/// `plex:{server}:{rating key}`.
pub fn title_id(server: &str, meta: &Meta) -> String {
    meta.imdb.clone().unwrap_or_else(|| local_id(server, &meta.rating_key))
}

pub fn local_id(server: &str, key: &str) -> String {
    format!("plex:{server}:{key}")
}

/// The item behind a `plex:{server}:{rating key}` id, if it's on `server`.
pub fn parse_local_id<'a>(server: &str, id: &'a str) -> Option<&'a str> {
    let (on, key) = id.strip_prefix("plex:")?.split_once(':')?;
    (on == server && is_rating_key(key)).then_some(key)
}

/// A movie or show, as the page shows it (see library/plex.ts).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub title_id: String,
    /// "movie" or "series".
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub name: String,
    pub year: Option<String>,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub rating: Option<String>,
    /// The server's age rating, for a content limit on a title TMDB can't rate (catalog/ratings.ts).
    pub certification: Option<String>,
    pub runtime: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
}

/// A movie or show as an `Item`; None for anything else (seasons and episodes are shown as their show).
pub fn to_item(server: &str, meta: &Meta) -> Option<Item> {
    if !matches!(meta.kind, "movie" | "series") {
        return None;
    }
    let minutes = meta.duration_ms.map(|ms| (ms as f64 / 60_000.0).round() as i64).filter(|m| *m > 0);
    Some(Item {
        title_id: title_id(server, meta),
        kind: meta.kind,
        name: meta.title.clone()?,
        year: meta.year.map(|y| y.to_string()),
        description: meta.summary.clone(),
        genres: meta.genres.clone(),
        rating: meta.rating.map(|r| format!("{r:.1}")),
        certification: meta.content_rating.clone(),
        runtime: minutes.map(|m| format!("{m} min")),
        poster: meta.thumb.as_ref().map(|a| a.page_key(server)),
        background: meta.art.as_ref().map(|a| a.page_key(server)),
        logo: meta.logo.as_ref().map(|a| a.page_key(server)),
    })
}

/// An episode of a show that's only on Plex (no IMDb id), for its detail page.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeInfo {
    pub id: String,
    pub season: i64,
    pub episode: i64,
    pub title: Option<String>,
    pub overview: Option<String>,
    pub thumbnail: Option<String>,
    pub released: Option<String>,
}

pub fn to_episode(server: &str, meta: &Meta) -> Option<EpisodeInfo> {
    if meta.kind != "episode" {
        return None;
    }
    Some(EpisodeInfo {
        id: local_id(server, &meta.rating_key),
        season: meta.season.unwrap_or(1),
        episode: meta.index?,
        title: meta.title.clone(),
        overview: meta.summary.clone(),
        thumbnail: meta.thumb.as_ref().map(|a| a.page_key(server)),
        released: meta.released.clone(),
    })
}

/// How a title is looked up in a server's library: `imdb:tt…` or `tmdb:{type}:{id}`
/// (the same keys as `media_server::key_for`).
pub fn lookup_keys(meta: &Meta) -> Vec<String> {
    if !matches!(meta.kind, "movie" | "series") {
        return Vec::new();
    }
    let mut keys = Vec::new();
    if let Some(imdb) = &meta.imdb {
        keys.push(format!("imdb:{imdb}"));
    }
    if let Some(tmdb) = &meta.tmdb {
        keys.push(format!("tmdb:{}:{tmdb}", meta.kind));
    }
    keys
}

/// A part's file on the server: `/library/parts/{id}[/{version}]/{file name}`,
/// where the name is plain (Plex uses e.g. `file.mkv`).
pub fn is_part_key(key: &str, part: &str) -> bool {
    let Some(rest) = key.strip_prefix("/library/parts/") else { return false };
    let segments: Vec<&str> = rest.split('/').collect();
    let file = |f: &str| (1..=100).contains(&f.len()) && !f.starts_with('.') && f.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    match segments.as_slice() {
        [id, name] => *id == part && file(name),
        [id, version, name] => *id == part && is_version(version) && file(name),
        _ => false,
    }
}

/// One version of a movie or episode that Orbit can play: a Plex "Media" and its (first) file.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub part: String,
    pub key: String,
    /// Words the source picker reads quality from, e.g. "1080p HEVC HDR10 5.1".
    pub label: String,
    /// The file's name, when there are several versions to tell apart.
    pub name: Option<String>,
    pub size: Option<u64>,
}

fn first_part(media: &Value) -> Option<(String, String, &Value)> {
    let part = media.get("Part")?.as_array()?.first()?;
    let id = key_of(part, "id")?;
    let key = part.get("key")?.as_str().filter(|k| is_part_key(k, &id))?;
    Some((id, key.to_string(), part))
}

fn streams(part: &Value) -> impl Iterator<Item = &Value> {
    part.get("Stream").and_then(Value::as_array).into_iter().flatten().take(200)
}

/// The versions of an item, each with the quality words the picker reads.
pub fn versions(meta: &Meta) -> Vec<Version> {
    let several = meta.media.len() > 1;
    meta.media
        .iter()
        .filter_map(|media| {
            let (part_id, key, part) = first_part(media)?;
            let video = streams(part).find(|s| number(s, "streamType") == Some(1));
            let resolution = match media.get("videoResolution").and_then(Value::as_str).map(str::to_ascii_lowercase).as_deref() {
                Some("4k" | "2160") => Some("2160p"),
                Some("1080") => Some("1080p"),
                Some("720") => Some("720p"),
                Some("480" | "576" | "sd") => Some("480p"),
                _ => match (number(media, "width").unwrap_or(0), number(media, "height").unwrap_or(0)) {
                    (w, h) if w >= 3200 || h >= 1800 => Some("2160p"),
                    (w, h) if w >= 1800 || h >= 1000 => Some("1080p"),
                    (w, h) if w >= 1200 || h >= 700 => Some("720p"),
                    (w, h) if w > 0 || h > 0 => Some("480p"),
                    _ => None,
                },
            };
            let codec = match media.get("videoCodec").and_then(Value::as_str).map(str::to_ascii_lowercase).as_deref() {
                Some("hevc" | "h265") => Some("HEVC"),
                Some("h264" | "avc") => Some("H.264"),
                Some("av1") => Some("AV1"),
                _ => None,
            };
            let range = match video {
                Some(v) if v.get("DOVIPresent").and_then(Value::as_bool) == Some(true) => Some("DV"),
                Some(v) => match v.get("colorTrc").and_then(Value::as_str) {
                    Some("smpte2084") => Some("HDR10"),
                    Some("arib-std-b67") => Some("HLG"),
                    _ => None,
                },
                None => None,
            };
            let channels = match number(media, "audioChannels") {
                Some(8) => Some("7.1"),
                Some(6) => Some("5.1"),
                Some(2) => Some("2.0"),
                _ => None,
            };
            let label = [resolution, codec, range, channels].into_iter().flatten().collect::<Vec<_>>().join(" ");
            // The file's own name (without its folders), only to tell versions apart.
            let name = several.then(|| part.get("file").and_then(Value::as_str).map(|f| clean(f.rsplit(['/', '\\']).next().unwrap_or_default(), 120)).filter(|f| !f.is_empty())).flatten();
            Some(Version { part: part_id, key, label, name, size: part.get("size").and_then(Value::as_u64).filter(|s| *s > 0) })
        })
        .collect()
}

/// The part `wanted` of an item, with its file's path on the server.
pub fn find_part<'a>(meta: &'a Meta, wanted: &str) -> Option<(String, &'a Value)> {
    meta.media.iter().filter_map(first_part).find(|(id, _, _)| id == wanted).map(|(_, key, part)| (key, part))
}

/// A part's external subtitle files: `/library/streams/{id}`, in formats mpv reads.
pub fn subtitle_paths(part: &Value) -> Vec<String> {
    streams(part)
        .filter(|s| number(s, "streamType") == Some(3))
        .filter(|s| matches!(s.get("codec").and_then(Value::as_str).map(str::to_ascii_lowercase).as_deref(), Some("srt" | "subrip" | "ass" | "ssa" | "vtt" | "webvtt")))
        .filter_map(|s| s.get("key")?.as_str())
        .filter(|k| k.strip_prefix("/library/streams/").is_some_and(is_rating_key))
        .map(str::to_string)
        .take(30)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SERVER: &str = "0a1b2c3d";

    fn movie(extra: Value) -> Value {
        let mut base = json!({
            "ratingKey": "101", "key": "/library/metadata/101", "type": "movie", "title": "Night of the Living Dead", "year": 1968,
            "summary": "Ghouls.\u{0007}", "Genre": [{ "tag": "Horror" }, { "tag": 3 }], "audienceRating": 7.4, "duration": 5_760_000,
            "viewOffset": 600_000, "guid": "plex://movie/5d776826880197001ec90f5f",
            "Guid": [{ "id": "imdb://tt0063350" }, { "id": "tmdb://10331" }, { "id": "tvdb://1" }],
            "thumb": "/library/metadata/101/thumb/1700000000", "art": "/library/metadata/101/art/1700000001",
            "Image": [{ "type": "clearLogo", "url": "/library/metadata/101/clearLogo/1700000002" }]
        });
        if let (Some(b), Value::Object(e)) = (base.as_object_mut(), extra) {
            b.extend(e);
        }
        base
    }

    fn page(items: Vec<Value>) -> Value {
        json!({ "MediaContainer": { "size": items.len(), "Metadata": items } })
    }

    #[test]
    fn says_when_its_resume_point_was_set() {
        let at = |extra: Value| metadata_of(&page(vec![movie(extra)]), 1).remove(0).resumed_at();
        assert_eq!(at(json!({ "lastViewedAt": 1_792_090_800 })), Some(1_792_090_800_000));
        // No resume point, or no time: nothing to say.
        assert_eq!(at(json!({ "lastViewedAt": 1_792_090_800, "viewOffset": 0 })), None);
        assert_eq!(at(json!({})), None);
        assert_eq!(at(json!({ "lastViewedAt": -5 })), None);
    }

    #[test]
    fn carries_the_servers_age_rating_for_content_limits() {
        // The server's own rating, for titles TMDB can't rate (no IMDb id).
        let item = |rating: Value| to_item(SERVER, &metadata_of(&page(vec![movie(json!({ "contentRating": rating }))]), 1)[0]).unwrap();
        assert_eq!(item(json!("de/16")).certification.as_deref(), Some("de/16"));
        assert_eq!(item(json!("PG-13")).certification.as_deref(), Some("PG-13"));
        for odd in [json!(null), json!(""), json!("<b>R</b>"), json!("a much too long rating"), json!(16)] {
            assert_eq!(item(odd.clone()).certification, None, "{odd}");
        }
    }

    #[test]
    fn maps_a_movie_to_an_item() {
        let list = metadata_of(&page(vec![movie(json!({})), json!({ "ratingKey": "../1", "type": "movie", "title": "x" }), json!(5)]), 10);
        assert_eq!(list.len(), 1);
        let meta = &list[0];
        assert_eq!(meta.resume(), Some(600.0));
        let item = to_item(SERVER, meta).unwrap();
        assert_eq!(item.title_id, "tt0063350");
        assert_eq!(item.kind, "movie");
        assert_eq!(item.year.as_deref(), Some("1968"));
        assert_eq!(item.description.as_deref(), Some("Ghouls."));
        assert_eq!(item.genres, ["Horror"]);
        assert_eq!(item.rating.as_deref(), Some("7.4"));
        assert_eq!(item.runtime.as_deref(), Some("96 min"));
        assert_eq!(item.poster.as_deref(), Some("0a1b2c3d_101_thumb_1700000000"));
        assert_eq!(item.background.as_deref(), Some("0a1b2c3d_101_art_1700000001"));
        assert_eq!(item.logo.as_deref(), Some("0a1b2c3d_101_clearLogo_1700000002"));
        assert_eq!(lookup_keys(meta), ["imdb:tt0063350", "tmdb:movie:10331"]);
    }

    #[test]
    fn old_agents_guids_and_plex_own_ids() {
        let old = parse_meta(&movie(json!({ "Guid": null, "guid": "com.plexapp.agents.imdb://tt0063350?lang=en" }))).unwrap();
        assert_eq!(old.imdb.as_deref(), Some("tt0063350"));
        let tmdb = parse_meta(&movie(json!({ "type": "show", "Guid": null, "guid": "com.plexapp.agents.themoviedb://1399?lang=en" }))).unwrap();
        assert_eq!((tmdb.imdb.as_deref(), tmdb.tmdb.as_deref()), (None, Some("1399")));
        assert_eq!(lookup_keys(&tmdb), ["tmdb:series:1399"]);
        // No IMDb id: the title is Plex's own.
        let own = parse_meta(&movie(json!({ "Guid": [{ "id": "imdb://nm123" }], "guid": "plex://movie/x" }))).unwrap();
        let id = title_id(SERVER, &own);
        assert_eq!(id, "plex:0a1b2c3d:101");
        assert_eq!(parse_local_id(SERVER, &id), Some("101"));
        assert_eq!(parse_local_id("ffffffff", &id), None);
        assert_eq!(parse_local_id(SERVER, "plex:0a1b2c3d:1/../2"), None);
        assert!(lookup_keys(&own).is_empty());
    }

    #[test]
    fn image_paths_must_be_plexs_own() {
        assert_eq!(parse_art("/library/metadata/5/thumb/17"), Some(Art { key: "5".into(), kind: "thumb", version: Some("17".into()) }));
        assert_eq!(parse_art("/library/metadata/5/art").map(|a| a.path()).as_deref(), Some("/library/metadata/5/art"));
        for bad in ["https://metadata-static.plex.tv/a.jpg", "/library/metadata/5/thumb/17/x", "/library/metadata/../thumb/1", "/library/metadata/5/file/1", "/:/resources/x.png", "/library/metadata/5/thumb/1?X-Plex-Token=x"] {
            assert_eq!(parse_art(bad), None, "{bad}");
        }
        // An image that isn't Plex's shape is left out, not passed on.
        let meta = parse_meta(&movie(json!({ "thumb": "http://evil.example/x.jpg" }))).unwrap();
        assert_eq!(to_item(SERVER, &meta).unwrap().poster, None);
    }

    #[test]
    fn seasons_and_episodes_stand_for_their_show() {
        let ep = parse_meta(&json!({ "ratingKey": 7, "type": "episode", "title": "Pilot", "grandparentRatingKey": "5", "parentRatingKey": "6", "parentIndex": 2, "index": 3, "originallyAvailableAt": "2020-01-01", "thumb": "/library/metadata/7/thumb/1" })).unwrap();
        assert_eq!(ep.show(), Some("5"));
        assert!(to_item(SERVER, &ep).is_none());
        let info = to_episode(SERVER, &ep).unwrap();
        assert_eq!((info.season, info.episode, info.id.as_str()), (2, 3, "plex:0a1b2c3d:7"));
        assert_eq!(info.thumbnail.as_deref(), Some("0a1b2c3d_7_thumb_1"));
        let season = parse_meta(&json!({ "ratingKey": "6", "type": "season", "parentRatingKey": "5" })).unwrap();
        assert_eq!(season.show(), Some("5"));
        assert!(parse_meta(&json!({ "ratingKey": "8", "type": "artist", "title": "x" })).is_none());
    }

    #[test]
    fn versions_carry_quality_words_and_checked_files() {
        let meta = parse_meta(&movie(json!({ "Media": [
            { "videoResolution": "4k", "videoCodec": "hevc", "audioChannels": 6, "Part": [{ "id": 11, "key": "/library/parts/11/1700000000/file.mkv", "size": 4_000_000_000_u64, "file": "D:\\Movies\\Night (1968)\\Night - 4K.mkv",
                "Stream": [{ "streamType": 1, "DOVIPresent": true }, { "streamType": 3, "codec": "srt", "key": "/library/streams/90" }, { "streamType": 3, "codec": "pgs", "key": "/library/streams/91" }, { "streamType": 3, "codec": "srt" }, { "streamType": 3, "codec": "srt", "key": "http://evil/x.srt" }] }] },
            { "width": 1280, "height": 720, "videoCodec": "h264", "Part": [{ "id": "12", "key": "/library/parts/12/file.mp4", "file": "/m/Night.mp4" }] },
            { "Part": [{ "id": 13, "key": "/library/parts/13/../../x" }] },
            { "Part": [{ "id": 14, "key": "/library/parts/15/file.mkv" }] }
        ] }))).unwrap();
        let found = versions(&meta);
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].part.as_str(), found[0].label.as_str(), found[0].size), ("11", "2160p HEVC DV 5.1", Some(4_000_000_000)));
        assert_eq!(found[0].name.as_deref(), Some("Night - 4K.mkv"));
        assert_eq!((found[1].label.as_str(), found[1].name.as_deref()), ("720p H.264", Some("Night.mp4")));
        let (key, part) = find_part(&meta, "11").unwrap();
        assert_eq!(key, "/library/parts/11/1700000000/file.mkv");
        assert_eq!(subtitle_paths(part), ["/library/streams/90"]);
        assert!(find_part(&meta, "13").is_none());
    }
}
