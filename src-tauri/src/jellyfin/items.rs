//! Jellyfin items as Orbit uses them. Everything here comes from the server,
//! so it's treated like addon data: each item is checked on its own (one that
//! doesn't fit is dropped, not the whole page), ids must look like Jellyfin's,
//! and text is trimmed to size with control characters removed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use crate::media_server::{clean, is_imdb, key_for};

/// Items in one list Orbit asks for (a page of a library, a Home row).
pub const MAX_ITEMS: usize = 500;
/// Episodes of one series.
pub const MAX_EPISODES: usize = 3000;
/// Ticks are 100 ns.
pub const TICKS_PER_SECOND: f64 = 10_000_000.0;

/// Jellyfin ids are GUIDs written as 32 hex digits.
pub fn is_item_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn text(value: Option<&Value>, max: usize) -> Option<String> {
    value.and_then(Value::as_str).map(|s| clean(s, max)).filter(|s| !s.is_empty())
}

/// A tag, as used in image addresses: short and plain.
fn tag(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).filter(|t| (1..=64).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_alphanumeric())).map(str::to_string)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase", default)]
pub struct UserData {
    pub playback_position_ticks: Option<i64>,
    pub played: Option<bool>,
    pub last_played_date: Option<String>,
}

/// The fields Orbit reads from a Jellyfin `BaseItemDto`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase", default)]
pub struct RawItem {
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "Type")]
    pub kind: Option<String>,
    pub collection_type: Option<String>,
    pub production_year: Option<i64>,
    pub overview: Option<String>,
    pub genres: Option<Vec<Value>>,
    pub community_rating: Option<f64>,
    /// The age rating the server has for it ("PG-13", "FSK-16"…), any type: checked in `to_item`.
    pub official_rating: Option<Value>,
    pub run_time_ticks: Option<i64>,
    pub premiere_date: Option<String>,
    pub provider_ids: Option<HashMap<String, Value>>,
    pub image_tags: Option<HashMap<String, Value>>,
    pub backdrop_image_tags: Option<Vec<Value>>,
    pub series_id: Option<String>,
    pub parent_index_number: Option<i64>,
    pub index_number: Option<i64>,
    /// The last episode a multi-episode file holds (S01E01-E02 has 1 and 2).
    pub index_number_end: Option<i64>,
    pub user_data: Option<UserData>,
    pub media_sources: Option<Vec<Value>>,
}

impl RawItem {
    fn provider(&self, name: &str) -> Option<&str> {
        self.provider_ids.as_ref()?.iter().find(|(k, _)| k.eq_ignore_ascii_case(name))?.1.as_str().map(str::trim)
    }

    pub fn imdb(&self) -> Option<&str> {
        self.provider("Imdb").filter(|id| is_imdb(id))
    }

    pub fn tmdb(&self) -> Option<&str> {
        self.provider("Tmdb").filter(|id| (1..=12).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()))
    }

    pub fn kind(&self) -> Option<&'static str> {
        match self.kind.as_deref()? {
            "Movie" => Some("movie"),
            "Series" => Some("series"),
            "Episode" => Some("episode"),
            _ => None,
        }
    }

    /// Whether this episode is episode `number` of `season`: Jellyfin keeps a
    /// file holding several episodes as one item, numbered by its first, so
    /// the later ones are found through `IndexNumberEnd`. Without a season
    /// number, it's taken to be the season asked about.
    pub fn covers(&self, season: i64, number: i64) -> bool {
        let Some(first) = self.index_number else { return false };
        let last = self.index_number_end.filter(|end| *end >= first).unwrap_or(first);
        (first..=last).contains(&number) && self.parent_index_number.unwrap_or(season) == season
    }

    /// Seconds into it the person stopped last time, if anywhere.
    pub fn resume(&self) -> Option<f64> {
        let ticks = self.user_data.as_ref()?.playback_position_ticks?;
        (ticks > 0).then(|| ticks as f64 / TICKS_PER_SECOND)
    }

    /// When it was last played (ms), for a resume point: the page weighs it against Orbit's own history.
    pub fn resumed_at(&self) -> Option<i64> {
        self.resume()?;
        crate::debrid::iso_ms(self.user_data.as_ref()?.last_played_date.as_deref()?).filter(|ms| *ms > 0)
    }
}

/// Each array entry that parses as an item with a Jellyfin id; the rest are dropped.
pub fn parse_items(list: &[Value], max: usize) -> Vec<RawItem> {
    list.iter()
        .filter_map(|v| serde_json::from_value::<RawItem>(v.clone()).ok())
        .filter(|item| is_item_id(&item.id))
        .map(|mut item| {
            item.id.make_ascii_lowercase();
            if let Some(series) = item.series_id.as_mut() {
                series.make_ascii_lowercase();
            }
            item
        })
        .take(max)
        .collect()
}

/// The `Items` of a `{ "Items": [...] }` answer, or the answer itself when it's an array.
pub fn items_of(value: &Value, max: usize) -> Vec<RawItem> {
    match value {
        Value::Array(list) => parse_items(list, max),
        Value::Object(map) => map.get("Items").and_then(Value::as_array).map(|list| parse_items(list, max)).unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Orbit's id for a Jellyfin item: its IMDb id when it has one, so it's the
/// same title as in Cinemeta, TMDB, watch history and Stremio sync;
/// otherwise `jellyfin:{server}:{item}`.
pub fn title_id(server: &str, item: &RawItem) -> String {
    item.imdb().map_or_else(|| local_id(server, &item.id), str::to_string)
}

pub fn local_id(server: &str, item: &str) -> String {
    format!("jellyfin:{server}:{item}")
}

/// The item behind a `jellyfin:{server}:{item}` id, if it's on `server`.
pub fn parse_local_id<'a>(server: &str, id: &'a str) -> Option<&'a str> {
    let (on, item) = id.strip_prefix("jellyfin:")?.split_once(':')?;
    (on == server && is_item_id(item)).then_some(item)
}

/// An image, as the page asks the `jellyfin-art` protocol for it:
/// `{server}_{item}_{kind}[_{tag}]`.
pub fn art(server: &str, item: &str, kind: &str, tag: Option<String>) -> String {
    match tag {
        Some(tag) => format!("{server}_{item}_{kind}_{tag}"),
        None => format!("{server}_{item}_{kind}"),
    }
}

/// A movie or show, as the page shows it (see library/jellyfin.ts).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub title_id: String,
    pub jellyfin_id: String,
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

/// A movie or series as an `Item`; None for anything else (an episode is shown as its series).
pub fn to_item(server: &str, raw: &RawItem) -> Option<Item> {
    let kind = raw.kind().filter(|k| *k != "episode")?;
    let name = raw.name.as_deref().map(|n| clean(n, 200)).filter(|n| !n.is_empty())?;
    let images = raw.image_tags.as_ref();
    let image = |kind: &str| images.and_then(|tags| tags.get(kind)).and_then(|t| tag(Some(t))).map(|t| art(server, &raw.id, kind, Some(t)));
    let backdrop = raw.backdrop_image_tags.as_ref().and_then(|tags| tag(tags.first())).map(|t| art(server, &raw.id, "Backdrop", Some(t)));
    let minutes = raw.run_time_ticks.filter(|t| *t > 0).map(|t| (t as f64 / TICKS_PER_SECOND / 60.0).round() as i64).filter(|m| *m > 0);
    Some(Item {
        title_id: title_id(server, raw),
        jellyfin_id: raw.id.clone(),
        kind,
        name,
        year: raw.production_year.filter(|y| (1800..=3000).contains(y)).map(|y| y.to_string()),
        description: raw.overview.as_deref().map(|o| clean(o, 2000)).filter(|o| !o.is_empty()),
        genres: raw.genres.iter().flatten().filter_map(|g| text(Some(g), 50)).take(10).collect(),
        rating: raw.community_rating.filter(|r| r.is_finite() && (0.0..=10.0).contains(r)).map(|r| format!("{r:.1}")),
        certification: raw.official_rating.as_ref().and_then(Value::as_str).and_then(crate::tmdb::clean_cert),
        runtime: minutes.map(|m| format!("{m} min")),
        poster: image("Primary"),
        background: backdrop,
        logo: image("Logo"),
    })
}

/// An episode of a series that's only on Jellyfin (no IMDb id), for its detail page.
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

pub fn to_episode(server: &str, raw: &RawItem) -> Option<EpisodeInfo> {
    if raw.kind() != Some("episode") {
        return None;
    }
    let episode = raw.index_number.filter(|n| (0..=100_000).contains(n))?;
    let thumb = raw.image_tags.as_ref().and_then(|tags| tag(tags.get("Primary"))).map(|t| art(server, &raw.id, "Primary", Some(t)));
    Some(EpisodeInfo {
        id: local_id(server, &raw.id),
        season: raw.parent_index_number.filter(|n| (0..=10_000).contains(n)).unwrap_or(1),
        episode,
        title: raw.name.as_deref().map(|n| clean(n, 200)).filter(|n| !n.is_empty()),
        overview: raw.overview.as_deref().map(|o| clean(o, 2000)).filter(|o| !o.is_empty()),
        thumbnail: thumb,
        released: raw.premiere_date.as_deref().filter(|d| d.len() <= 40 && d.bytes().all(|b| b.is_ascii_alphanumeric() || b"-:.+".contains(&b))).map(str::to_string),
    })
}

/// How a title is looked up in a server's library: `imdb:tt…` or `tmdb:{type}:{id}`.
pub fn lookup_keys(raw: &RawItem) -> Vec<String> {
    let Some(kind) = raw.kind().filter(|k| *k != "episode") else { return Vec::new() };
    let mut keys = Vec::new();
    if let Some(imdb) = raw.imdb() {
        keys.push(format!("imdb:{imdb}"));
    }
    if let Some(tmdb) = raw.tmdb() {
        keys.push(format!("tmdb:{kind}:{tmdb}"));
    }
    keys
}

/// One version of a movie or episode that Orbit can play.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub media_source: String,
    /// Words the source picker reads quality from, e.g. "1080p HEVC HDR10 5.1".
    pub label: String,
    /// The version's own name on the server (e.g. "Director's Cut"), if it has several.
    pub name: Option<String>,
    pub size: Option<u64>,
}

/// The versions of an item: its media sources from a file on the server or
/// a web address (.strm). Discs and other kinds are left out.
pub fn versions(raw: &RawItem) -> Vec<Version> {
    let several = raw.media_sources.as_ref().is_some_and(|s| s.len() > 1);
    raw.media_sources
        .iter()
        .flatten()
        .take(20)
        .filter_map(|source| {
            let id = source.get("Id")?.as_str()?.to_ascii_lowercase();
            if !is_item_id(&id) || !matches!(source.get("Protocol").and_then(Value::as_str), Some("File" | "Http")) {
                return None;
            }
            let streams = source.get("MediaStreams").and_then(Value::as_array);
            let video = streams.into_iter().flatten().find(|s| s.get("Type").and_then(Value::as_str) == Some("Video"));
            let audio = streams.into_iter().flatten().find(|s| s.get("Type").and_then(Value::as_str) == Some("Audio"));
            let height = video.and_then(|v| v.get("Height")).and_then(Value::as_i64).unwrap_or(0);
            let width = video.and_then(|v| v.get("Width")).and_then(Value::as_i64).unwrap_or(0);
            let resolution = match (width, height) {
                (w, h) if w >= 3200 || h >= 1800 => Some("2160p"),
                (w, h) if w >= 1800 || h >= 1000 => Some("1080p"),
                (w, h) if w >= 1200 || h >= 700 => Some("720p"),
                (w, h) if w > 0 || h > 0 => Some("480p"),
                _ => None,
            };
            let codec = match video.and_then(|v| v.get("Codec")).and_then(Value::as_str).map(str::to_ascii_lowercase).as_deref() {
                Some("hevc" | "h265") => Some("HEVC"),
                Some("h264" | "avc") => Some("H.264"),
                Some("av1") => Some("AV1"),
                _ => None,
            };
            let range = match video.and_then(|v| v.get("VideoRangeType")).and_then(Value::as_str) {
                Some(r) if r.starts_with("DOVI") => Some("DV"),
                Some("HDR10Plus") => Some("HDR10+"),
                Some("HDR10") => Some("HDR10"),
                Some("HLG") => Some("HLG"),
                _ => None,
            };
            let channels = match audio.and_then(|a| a.get("Channels")).and_then(Value::as_i64) {
                Some(8) => Some("7.1"),
                Some(6) => Some("5.1"),
                Some(2) => Some("2.0"),
                _ => None,
            };
            let label = [resolution, codec, range, channels].into_iter().flatten().collect::<Vec<_>>().join(" ");
            Some(Version {
                media_source: id,
                label,
                name: several.then(|| text(source.get("Name"), 120)).flatten(),
                size: source.get("Size").and_then(Value::as_u64).filter(|s| *s > 0),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "f27caa37e5142225cceded48f6553502";
    const SERVER: &str = "0a1b2c3d";

    fn movie(extra: Value) -> Value {
        let mut base = json!({
            "Id": ID.to_uppercase(), "Name": "Night of the Living Dead", "Type": "Movie", "ProductionYear": 1968,
            "Overview": "Ghouls.\u{0007}", "Genres": ["Horror", 3], "CommunityRating": 7.4, "RunTimeTicks": 57_600_000_000_i64,
            "ProviderIds": { "Imdb": "tt0063350", "Tmdb": "10331" },
            "ImageTags": { "Primary": "abc123", "Logo": "../evil" }, "BackdropImageTags": ["def456"],
            "UserData": { "PlaybackPositionTicks": 6_000_000_000_i64, "Played": false }
        });
        if let (Some(b), Value::Object(e)) = (base.as_object_mut(), extra) {
            b.extend(e);
        }
        base
    }

    #[test]
    fn says_when_its_resume_point_was_set() {
        let at = |user_data: Value| items_of(&json!([movie(json!({ "UserData": user_data }))]), 1).remove(0).resumed_at();
        assert_eq!(at(json!({ "PlaybackPositionTicks": 6_000_000_000_i64, "LastPlayedDate": "2026-10-15T19:00:00.0000000Z" })), Some(1_792_090_800_000));
        // No resume point, or no date it can read: nothing to say.
        assert_eq!(at(json!({ "PlaybackPositionTicks": 0, "LastPlayedDate": "2026-10-15T19:00:00Z" })), None);
        assert_eq!(at(json!({ "PlaybackPositionTicks": 6_000_000_000_i64, "LastPlayedDate": "yesterday" })), None);
        assert_eq!(at(json!({ "PlaybackPositionTicks": 6_000_000_000_i64 })), None);
    }

    #[test]
    fn carries_the_servers_age_rating_for_content_limits() {
        // The server's own rating, for titles TMDB can't rate (no IMDb id).
        let item = |rating: Value| to_item(SERVER, &items_of(&json!({ "Items": [movie(json!({ "OfficialRating": rating }))] }), 1)[0]).unwrap();
        assert_eq!(item(json!("TV-MA")).certification.as_deref(), Some("TV-MA"));
        assert_eq!(item(json!(" FSK-16 ")).certification.as_deref(), Some("FSK-16"));
        // Nothing, or something that isn't a rating, is none.
        for odd in [json!(null), json!(""), json!("<b>R</b>"), json!("a much too long rating"), json!(16)] {
            assert_eq!(item(odd.clone()).certification, None, "{odd}");
        }
    }

    #[test]
    fn maps_a_movie_to_an_item() {
        let raw = &items_of(&json!({ "Items": [movie(json!({})), { "Id": "not-an-id", "Name": "x", "Type": "Movie" }, 5] }), 10)[0];
        assert_eq!(raw.resume(), Some(600.0));
        let item = to_item(SERVER, raw).unwrap();
        assert_eq!(item.title_id, "tt0063350");
        assert_eq!(item.jellyfin_id, ID);
        assert_eq!(item.kind, "movie");
        assert_eq!(item.year.as_deref(), Some("1968"));
        assert_eq!(item.description.as_deref(), Some("Ghouls."));
        assert_eq!(item.genres, ["Horror"]);
        assert_eq!(item.rating.as_deref(), Some("7.4"));
        assert_eq!(item.runtime.as_deref(), Some("96 min"));
        assert_eq!(item.poster.as_deref(), Some(&*format!("{SERVER}_{ID}_Primary_abc123")));
        assert_eq!(item.background.as_deref(), Some(&*format!("{SERVER}_{ID}_Backdrop_def456")));
        // A tag that isn't plain is left out rather than put in an address.
        assert_eq!(item.logo, None);
    }

    #[test]
    fn invalid_items_are_dropped_one_by_one() {
        let list = items_of(&json!([movie(json!({})), movie(json!({ "Name": 5 })), movie(json!({ "Id": "12" }))]), 10);
        assert_eq!(list.len(), 1);
        assert!(items_of(&json!("nope"), 10).is_empty());
        assert_eq!(items_of(&json!([movie(json!({})), movie(json!({}))]), 1).len(), 1);
        // Seasons, folders and the like aren't titles.
        assert!(to_item(SERVER, &items_of(&json!([movie(json!({ "Type": "Season" }))]), 1)[0]).is_none());
    }

    #[test]
    fn ids_without_imdb_are_jellyfins_own() {
        let raw = &items_of(&json!([movie(json!({ "ProviderIds": { "Imdb": "nm123", "Tmdb": "x" } }))]), 1)[0];
        let id = title_id(SERVER, raw);
        assert_eq!(id, format!("jellyfin:{SERVER}:{ID}"));
        assert_eq!(parse_local_id(SERVER, &id), Some(ID));
        assert_eq!(parse_local_id("ffffffff", &id), None);
        assert_eq!(parse_local_id(SERVER, "jellyfin:0a1b2c3d:../../x"), None);
        assert!(lookup_keys(raw).is_empty());
    }

    #[test]
    fn provider_ids_match_titles() {
        let raw = &items_of(&json!([movie(json!({}))]), 1)[0];
        assert_eq!(lookup_keys(raw), ["imdb:tt0063350", "tmdb:movie:10331"]);
        assert_eq!(key_for("tt0063350", "movie").as_deref(), Some("imdb:tt0063350"));
        assert_eq!(key_for("tmdb:10331", "movie").as_deref(), Some("tmdb:movie:10331"));
        // A TMDB show and a TMDB movie can share a number.
        assert_eq!(key_for("tmdb:10331", "series").as_deref(), Some("tmdb:series:10331"));
        assert_eq!(key_for("kitsu:1", "series"), None);
        assert_eq!(key_for("tmdb:1;2", "movie"), None);
    }

    #[test]
    fn episodes() {
        let raw = &items_of(&json!([{ "Id": ID, "Type": "Episode", "Name": "Pilot", "ParentIndexNumber": 2, "IndexNumber": 3, "PremiereDate": "2020-01-01T00:00:00.0000000Z", "ImageTags": { "Primary": "aa" } }]), 1)[0];
        let ep = to_episode(SERVER, raw).unwrap();
        assert_eq!((ep.season, ep.episode, ep.id.as_str()), (2, 3, &*format!("jellyfin:{SERVER}:{ID}")));
        assert_eq!(ep.thumbnail.as_deref(), Some(&*format!("{SERVER}_{ID}_Primary_aa")));
        assert!(to_item(SERVER, raw).is_none());
    }

    #[test]
    fn a_multi_episode_file_is_each_of_its_episodes() {
        let ep = |extra: Value| {
            let mut raw = json!({ "Id": ID, "Type": "Episode", "Name": "Pilot", "ParentIndexNumber": 1, "IndexNumber": 1 });
            if let (Some(b), Value::Object(e)) = (raw.as_object_mut(), extra) {
                b.extend(e);
            }
            items_of(&json!([raw]), 1).remove(0)
        };
        // S01E01-E02 in one file: found for either.
        let double = ep(json!({ "IndexNumberEnd": 2 }));
        assert!(double.covers(1, 1) && double.covers(1, 2));
        assert!(!double.covers(1, 3) && !double.covers(2, 2));
        let single = ep(json!({}));
        assert!(single.covers(1, 1) && !single.covers(1, 2));
        // An end before the start (bad data) is the start alone.
        assert!(!ep(json!({ "IndexNumber": 5, "IndexNumberEnd": 3 })).covers(1, 4));
        // No season number: taken to be the season asked about.
        assert!(ep(json!({ "ParentIndexNumber": null })).covers(3, 1));
    }

    #[test]
    fn versions_carry_quality_words() {
        let raw = &items_of(
            &json!([movie(json!({ "MediaSources": [
                { "Id": ID, "Protocol": "File", "Size": 4_000_000_000_u64, "Name": "4K",
                  "MediaStreams": [{ "Type": "Video", "Codec": "hevc", "Width": 3840, "Height": 1600, "VideoRangeType": "DOVIWithHDR10" }, { "Type": "Audio", "Channels": 6 }] },
                { "Id": "a".repeat(32), "Protocol": "Http", "MediaStreams": [{ "Type": "Video", "Codec": "h264", "Width": 1280, "Height": 720 }] },
                { "Id": "b".repeat(32), "Protocol": "Rtmp" },
                { "Id": "nope", "Protocol": "File" }
            ] }))]),
            1,
        )[0];
        let found = versions(raw);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].label, "2160p HEVC DV 5.1");
        assert_eq!(found[0].size, Some(4_000_000_000));
        assert_eq!(found[0].name.as_deref(), Some("4K"));
        assert_eq!(found[1].label, "720p H.264");
    }
}
