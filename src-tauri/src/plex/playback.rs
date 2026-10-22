//! Playing from Plex, and telling the server how far the person got.
//!
//! The page plays `orbit-plex://{rating key}/{part}`; `player_open` turns that
//! into the part's file on the server here. The token goes to mpv as an
//! `X-Plex-Token` header for that one file (mpv's per-file
//! `http-header-fields`), not as `?X-Plex-Token=` in the address: an address
//! ends up in mpv's and the server's logs and in error messages, a header
//! doesn't. Direct play only: mpv plays nearly anything, so nothing is transcoded.

use reqwest::Url;

use super::items::{self, Meta, is_rating_key};
use crate::media_server::{Playable, endpoint};

/// What the page asks the player for.
pub const SCHEME: &str = "orbit-plex://";
/// Plex's name for items in a library, in timeline and scrobble requests.
pub const IDENTIFIER: &str = "com.plexapp.plugins.library";

/// The item and part an address names.
pub fn parse_address(address: &str) -> Result<(String, String), String> {
    let invalid = || "not a Plex address".to_string();
    let (item, part) = address.strip_prefix(SCHEME).ok_or_else(invalid)?.split_once('/').ok_or_else(invalid)?;
    if !is_rating_key(item) || !is_rating_key(part) {
        return Err(invalid());
    }
    Ok((item.to_string(), part.to_string()))
}

pub fn address(item: &str, part: &str) -> String {
    format!("{SCHEME}{item}/{part}")
}

/// The file of `item`'s part `wanted`, with the headers mpv sends for it
/// (this file and its subtitle files only) and its external subtitles.
pub fn playable(base: &Url, client_id: &str, token: &str, item: &Meta, wanted: &str) -> Result<Playable, String> {
    let (key, part) = items::find_part(item, wanted).ok_or("err.plex.video-gone")?;
    let url = endpoint(base, &key, &[])?;
    let subtitles = items::subtitle_paths(part).iter().filter_map(|path| endpoint(base, path, &[]).ok().map(String::from)).collect();
    let headers = vec![format!("X-Plex-Token: {token}"), format!("X-Plex-Client-Identifier: {client_id}"), "X-Plex-Product: Orbit".to_string()];
    Ok(Playable { url: url.into(), headers, subtitles })
}

/// Plex's playback state for one of the page's reports.
pub fn state_for(event: &str, paused: bool) -> Option<&'static str> {
    match event {
        "start" | "progress" => Some(if paused { "paused" } else { "playing" }),
        "stop" => Some("stopped"),
        _ => None,
    }
}

/// Seconds to whole milliseconds, up to ten days (past that it's a bad value, not a position).
fn millis(seconds: f64) -> i64 {
    if seconds.is_finite() { (seconds.clamp(0.0, 864_000.0) * 1000.0).round() as i64 } else { 0 }
}

/// The query of a `/:/timeline` report: where in the item the person is.
/// The server keeps it as the resume point, shows it on its dashboard, and
/// marks the item watched once it passes its own "played" threshold.
pub fn timeline_query(item: &str, state: &str, position: f64, duration: Option<f64>) -> Vec<(&'static str, String)> {
    let mut query = vec![
        ("ratingKey", item.to_string()),
        ("key", format!("/library/metadata/{item}")),
        ("identifier", IDENTIFIER.to_string()),
        ("state", state.to_string()),
        ("time", millis(position).to_string()),
    ];
    if let Some(d) = duration.filter(|d| d.is_finite() && *d > 0.0) {
        query.push(("duration", millis(d).to_string()));
    }
    query
}

/// Played to the end (or within the last 2%): marked watched outright, in
/// case the server's threshold is set past where the credits start.
pub fn finished(position: f64, duration: Option<f64>) -> bool {
    duration.is_some_and(|d| d.is_finite() && d > 0.0 && position.is_finite() && position >= d * 0.98)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn addresses() {
        assert_eq!(parse_address(&address("101", "11")).unwrap(), ("101".to_string(), "11".to_string()));
        for bad in ["orbit-plex://101", "orbit-plex://101/11/x", "orbit-plex://../11", "orbit-plex://101/11?X-Plex-Token=1", "orbit-jellyfin://101/11", "https://x/"] {
            assert!(parse_address(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn direct_play_keeps_the_token_out_of_addresses() {
        let meta = items::parse_meta(&json!({ "ratingKey": "101", "type": "movie", "title": "M", "Media": [{ "Part": [{ "id": 11, "key": "/library/parts/11/1700000000/file.mkv",
            "Stream": [{ "streamType": 3, "codec": "srt", "key": "/library/streams/90" }] }] }] }))
        .unwrap();
        let base = crate::media_server::parse_server("http://192.168.1.5:32400").unwrap();
        let play = playable(&base, "client1", "secretTOKEN1", &meta, "11").unwrap();
        assert_eq!(play.url, "http://192.168.1.5:32400/library/parts/11/1700000000/file.mkv");
        assert_eq!(play.subtitles, ["http://192.168.1.5:32400/library/streams/90"]);
        assert!(!play.url.contains("secretTOKEN1") && play.subtitles.iter().all(|s| !s.contains("secretTOKEN1")));
        assert_eq!(play.headers[0], "X-Plex-Token: secretTOKEN1");
        assert!(playable(&base, "client1", "secretTOKEN1", &meta, "12").is_err());
    }

    #[test]
    fn timeline_reports() {
        assert_eq!(state_for("progress", true), Some("paused"));
        assert_eq!(state_for("start", false), Some("playing"));
        assert_eq!(state_for("stop", false), Some("stopped"));
        assert_eq!(state_for("other", false), None);
        let query = timeline_query("101", "playing", 12.5, Some(5760.0));
        assert!(query.contains(&("time", "12500".to_string())));
        assert!(query.contains(&("duration", "5760000".to_string())));
        assert!(query.contains(&("key", "/library/metadata/101".to_string())));
        assert!(query.contains(&("identifier", IDENTIFIER.to_string())));
        let odd = timeline_query("101", "stopped", f64::NAN, Some(f64::INFINITY));
        assert!(odd.contains(&("time", "0".to_string())) && odd.iter().all(|(k, _)| *k != "duration"));
        // No token among them: it's a header.
        assert!(query.iter().all(|(k, _)| !k.contains("Token")));
        assert!(finished(5700.0, Some(5760.0)) && !finished(3000.0, Some(5760.0)) && !finished(10.0, None));
    }
}
