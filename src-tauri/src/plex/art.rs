//! Posters, backdrops and logos from the person's Plex server, through the
//! `plex-art` protocol: the page asks for `{server}_{rating key}_{kind}[_{version}]`
//! and Rust fetches it, resized by the server's photo transcoder.
//!
//! Why not load them straight from the server: its address is often plain
//! http on the LAN, which the page's CSP rightly blocks for images; Plex
//! images need the token, which must never reach the page or sit in an
//! address; and the server's address stays out of the DOM.

use std::time::Duration;

use reqwest::Method;
use tauri::{AppHandle, Manager, UriSchemeResponder};

use super::items::{Art, art_kind, is_rating_key, is_version};
use crate::db::Db;
use crate::profiles::ActiveProfile;

pub const SCHEME: &str = "plex-art";
const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
const IMAGE_TIMEOUT: Duration = Duration::from_secs(20);

/// `{server}_{key}_{kind}[_{version}]`, every part checked.
fn parse(path: &str) -> Option<(&str, Art)> {
    let mut parts = path.trim_start_matches('/').split('_');
    let server = parts.next().filter(|s| s.len() == 8 && s.bytes().all(|b| b.is_ascii_hexdigit()))?;
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
    Some((server, Art { key: key.to_string(), kind, version }))
}

/// The box each kind is fitted into (a backdrop fills the hero).
fn size(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "art" => ("1920", "1080"),
        "clearLogo" => ("600", "300"),
        _ => ("600", "900"),
    }
}

async fn fetch(app: &AppHandle, path: &str) -> Result<(Vec<u8>, String, bool), String> {
    let (server, art) = parse(path).ok_or("bad request")?;
    let profile = app.state::<ActiveProfile>().id()?;
    let plex = app.state::<super::Plex>();
    let session = super::require(&app.state::<Db>(), &plex, &profile)?;
    if session.server != server {
        return Err("another server".into());
    }
    let (width, height) = size(art.kind);
    let source = art.path();
    let reply = session.send(Method::GET, "/photo/:/transcode", &[("width", width), ("height", height), ("upscale", "1"), ("url", &source)], IMAGE_LIMIT, IMAGE_TIMEOUT).await?;
    let content_type = crate::media_server::raster(reply.content_type).ok_or("not an image")?;
    Ok((reply.body, content_type, art.version.is_some()))
}

/// Answers one request from the page, off the protocol handler's thread.
pub fn serve(app: AppHandle, path: String, responder: UriSchemeResponder) {
    tauri::async_runtime::spawn(async move {
        crate::media_server::respond_image(responder, fetch(&app, &path).await);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_well_formed_requests() {
        let (server, art) = parse("/0a1b2c3d_101_thumb_1700000000").unwrap();
        assert_eq!((server, art.path().as_str()), ("0a1b2c3d", "/library/metadata/101/thumb/1700000000"));
        assert_eq!(parse("0a1b2c3d_101_clearLogo").map(|(_, a)| a.version), Some(None));
        for bad in ["0a1b2c3d_101_file", "0a1b2c3d_101_thumb_a/b", "0a1b2c3d_101_thumb_1_2", "0a1b2c3d_../../x_thumb", "zzzzzzzz_101_thumb", "0a1b2c3d_101_thumb_1?X-Plex-Token=x", ""] {
            assert!(parse(bad).is_none(), "{bad}");
        }
    }
}
