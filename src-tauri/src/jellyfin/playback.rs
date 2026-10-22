//! Playing from Jellyfin, and telling the server how far the person got.
//!
//! The page plays `orbit-jellyfin://{item}/{media source}`; `player_open`
//! turns that into the server's direct-play address here. The token goes to
//! mpv as an `Authorization` header for that one file (mpv's per-file
//! `http-header-fields`), not as `api_key` in the address: an address ends up
//! in mpv's and the server's logs and in error messages, a header doesn't.
//! Direct play only: mpv plays nearly anything, so nothing is transcoded.

use reqwest::Url;
use serde_json::{Value, json};

use super::client;
pub use crate::media_server::Playable;
use super::items::{RawItem, TICKS_PER_SECOND, is_item_id};

/// What the page asks the player for.
pub const SCHEME: &str = "orbit-jellyfin://";
/// External subtitle files offered with one video.
const MAX_SUBTITLES: usize = 30;

/// The item and (optionally) media source an address names.
pub fn parse_address(address: &str) -> Result<(String, Option<String>), String> {
    let invalid = || "not a Jellyfin address".to_string();
    let rest = address.strip_prefix(SCHEME).ok_or_else(invalid)?;
    let (item, source) = match rest.split_once('/') {
        Some((item, source)) => (item, Some(source)),
        None => (rest, None),
    };
    if !is_item_id(item) || source.is_some_and(|s| !is_item_id(s)) {
        return Err(invalid());
    }
    Ok((item.to_ascii_lowercase(), source.map(str::to_ascii_lowercase)))
}

pub fn address(item: &str, media_source: &str) -> String {
    format!("{SCHEME}{item}/{media_source}")
}

/// Subtitle formats mpv reads, by Jellyfin's codec name.
fn subtitle_format(codec: &str) -> Option<&'static str> {
    match codec.to_ascii_lowercase().as_str() {
        "srt" | "subrip" => Some("srt"),
        "ass" => Some("ass"),
        "ssa" => Some("ssa"),
        "vtt" | "webvtt" => Some("vtt"),
        _ => None,
    }
}

/// The direct-play address of `item`'s media source `wanted` (or its first
/// playable one). A file on the server streams as-is with the person's token
/// in a header; a web address (a `.strm` file) plays directly, without it.
pub fn playable(base: &Url, auth: &str, item: &RawItem, wanted: Option<&str>) -> Result<Playable, String> {
    let sources = item.media_sources.as_deref().unwrap_or_default();
    let id_of = |s: &Value| s.get("Id").and_then(Value::as_str).map(str::to_ascii_lowercase);
    let protocol = |s: &Value| s.get("Protocol").and_then(Value::as_str).map(str::to_string);
    let source = sources
        .iter()
        .filter(|s| id_of(s).is_some_and(|id| is_item_id(&id)) && matches!(protocol(s).as_deref(), Some("File" | "Http")))
        .find(|s| wanted.is_none_or(|w| id_of(s).as_deref() == Some(w)))
        .ok_or("err.jellyfin.video-gone")?;
    let media_source = id_of(source).unwrap_or_default();
    if protocol(source).as_deref() == Some("Http") {
        let path = source.get("Path").and_then(Value::as_str).ok_or("missing address")?;
        let url = Url::parse(path).map_err(|_| "err.jellyfin.bad-address")?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("err.jellyfin.bad-address".into());
        }
        return Ok(Playable { url: url.into(), headers: Vec::new(), subtitles: Vec::new() });
    }
    let url = client::endpoint(base, &format!("/Videos/{}/stream", item.id), &[("static", "true"), ("mediaSourceId", &media_source)])?;
    let subtitles = source
        .get("MediaStreams")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|s| s.get("Type").and_then(Value::as_str) == Some("Subtitle") && s.get("IsExternal").and_then(Value::as_bool) == Some(true))
        .filter_map(|s| {
            let index = s.get("Index").and_then(Value::as_u64).filter(|i| *i < 10_000)?;
            let format = subtitle_format(s.get("Codec").and_then(Value::as_str)?)?;
            client::endpoint(base, &format!("/Videos/{}/{media_source}/Subtitles/{index}/Stream.{format}", item.id), &[]).ok().map(String::from)
        })
        .take(MAX_SUBTITLES)
        .collect();
    Ok(Playable { url: url.into(), headers: vec![format!("Authorization: {auth}")], subtitles })
}

/// The server's endpoint for a playback report.
pub fn report_path(event: &str) -> Option<&'static str> {
    match event {
        "start" => Some("/Sessions/Playing"),
        "progress" => Some("/Sessions/Playing/Progress"),
        "stop" => Some("/Sessions/Playing/Stopped"),
        _ => None,
    }
}

/// A playback report: where in the item the person is, in ticks.
pub fn report_body(item: &str, media_source: Option<&str>, position: f64, paused: bool) -> Value {
    // Up to ten days in: anything past that is a bad value, not a position.
    let seconds = if position.is_finite() { position.clamp(0.0, 864_000.0) } else { 0.0 };
    let mut body = json!({
        "ItemId": item,
        "PositionTicks": (seconds * TICKS_PER_SECOND).round() as i64,
        "IsPaused": paused,
        "CanSeek": true,
        "PlayMethod": "DirectPlay",
    });
    if let Some(source) = media_source {
        body["MediaSourceId"] = json!(source);
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jellyfin::items::items_of;

    const ITEM: &str = "f27caa37e5142225cceded48f6553502";
    const SOURCE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn addresses() {
        assert_eq!(parse_address(&address(ITEM, SOURCE)).unwrap(), (ITEM.to_string(), Some(SOURCE.to_string())));
        assert_eq!(parse_address(&format!("{SCHEME}{}", ITEM.to_uppercase())).unwrap(), (ITEM.to_string(), None));
        for bad in ["orbit-jellyfin://../x", "orbit-jellyfin://abc", &format!("{SCHEME}{ITEM}/{SOURCE}/x"), &format!("{SCHEME}{ITEM}?api_key=1"), "https://x/"] {
            assert!(parse_address(bad).is_err(), "{bad}");
        }
    }

    fn item(sources: Value) -> RawItem {
        items_of(&json!([{ "Id": ITEM, "Type": "Movie", "Name": "M", "MediaSources": sources }]), 1).remove(0)
    }

    #[test]
    fn direct_play_keeps_the_token_out_of_addresses() {
        let base = client::parse_server("http://192.168.1.5:8096").unwrap();
        let auth = client::authorization("dev", Some("secret-token"));
        let raw = item(json!([{ "Id": SOURCE, "Protocol": "File", "MediaStreams": [
            { "Type": "Subtitle", "IsExternal": true, "Index": 3, "Codec": "subrip" },
            { "Type": "Subtitle", "IsExternal": true, "Index": 4, "Codec": "pgssub" },
            { "Type": "Subtitle", "IsExternal": false, "Index": 2, "Codec": "ass" }
        ] }]));
        let play = playable(&base, &auth, &raw, Some(SOURCE)).unwrap();
        assert_eq!(play.url, format!("http://192.168.1.5:8096/Videos/{ITEM}/stream?static=true&mediaSourceId={SOURCE}"));
        assert_eq!(play.subtitles, [format!("http://192.168.1.5:8096/Videos/{ITEM}/{SOURCE}/Subtitles/3/Stream.srt")]);
        assert!(!play.url.contains("secret-token") && play.subtitles.iter().all(|s| !s.contains("secret-token")));
        assert_eq!(play.headers, [format!("Authorization: {auth}")]);
        assert!(playable(&base, &auth, &raw, Some(&"b".repeat(32))).is_err());
    }

    #[test]
    fn web_addresses_play_without_the_token() {
        let base = client::parse_server("http://192.168.1.5:8096").unwrap();
        let raw = item(json!([{ "Id": SOURCE, "Protocol": "Http", "Path": "https://cdn.example.com/a.mkv" }]));
        let play = playable(&base, "auth", &raw, None).unwrap();
        assert_eq!(play, Playable { url: "https://cdn.example.com/a.mkv".into(), headers: vec![], subtitles: vec![] });
        let local = item(json!([{ "Id": SOURCE, "Protocol": "Http", "Path": "file:///etc/passwd" }]));
        assert!(playable(&base, "auth", &local, None).is_err());
    }

    #[test]
    fn reports() {
        assert_eq!(report_path("progress"), Some("/Sessions/Playing/Progress"));
        assert_eq!(report_path("other"), None);
        let body = report_body(ITEM, Some(SOURCE), 12.5, true);
        assert_eq!(body["PositionTicks"], 125_000_000);
        assert_eq!(body["MediaSourceId"], SOURCE);
        assert_eq!(body["IsPaused"], true);
        assert_eq!(report_body(ITEM, None, f64::NAN, false)["PositionTicks"], 0);
        assert!(report_body(ITEM, None, -5.0, false).get("MediaSourceId").is_none());
    }
}
