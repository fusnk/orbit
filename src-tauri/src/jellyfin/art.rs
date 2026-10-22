//! Posters and backdrops from the person's Jellyfin server, through the
//! `jellyfin-art` protocol: the page asks for `{server}_{item}_{kind}[_{tag}]`
//! and Rust fetches it from the connected server.
//!
//! Why not load them straight from the server: its address is often plain
//! http on the LAN, which the page's CSP rightly blocks for images; some
//! servers require sign-in for images, and the token must never reach the
//! page or sit in an address; and the server's address stays out of the DOM.

use std::time::Duration;

use reqwest::Method;
use tauri::{AppHandle, Manager, UriSchemeResponder};

use super::client;
use super::items::is_item_id;
use crate::db::Db;
use crate::profiles::ActiveProfile;

pub const SCHEME: &str = "jellyfin-art";
const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
const IMAGE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq)]
struct Wanted<'a> {
    server: &'a str,
    item: &'a str,
    kind: &'static str,
    tag: Option<&'a str>,
}

/// `{server}_{item}_{kind}[_{tag}]`, every part checked.
fn parse(path: &str) -> Option<Wanted<'_>> {
    let mut parts = path.trim_start_matches('/').split('_');
    let server = parts.next().filter(|s| s.len() == 8 && s.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let item = parts.next().filter(|i| is_item_id(i))?;
    let kind = match parts.next()? {
        "Primary" => "Primary",
        "Backdrop" => "Backdrop",
        "Logo" => "Logo",
        "Thumb" => "Thumb",
        _ => return None,
    };
    let tag = match parts.next() {
        Some(t) if (1..=64).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_alphanumeric()) => Some(t),
        Some(_) => return None,
        None => None,
    };
    if parts.next().is_some() {
        return None;
    }
    Some(Wanted { server, item, kind, tag })
}

/// Wide enough for where each kind is shown (a backdrop fills the hero).
fn max_width(kind: &str) -> &'static str {
    match kind {
        "Backdrop" => "1920",
        "Thumb" => "800",
        "Logo" => "600",
        _ => "500",
    }
}

async fn fetch(app: &AppHandle, path: &str) -> Result<(Vec<u8>, String, bool), String> {
    let wanted = parse(path).ok_or("bad request")?;
    let profile = app.state::<ActiveProfile>().id()?;
    let session = super::session(&app.state::<Db>(), &profile)?.ok_or("not connected")?;
    if session.server != wanted.server {
        return Err("another server".into());
    }
    let mut query = vec![("maxWidth", max_width(wanted.kind)), ("quality", "90")];
    if let Some(tag) = wanted.tag {
        query.push(("tag", tag));
    }
    let url = client::endpoint(&session.base, &format!("/Items/{}/Images/{}", wanted.item, wanted.kind), &query)?;
    let reply = client::send(Method::GET, url, Some(&session.auth().await?), None, IMAGE_LIMIT, IMAGE_TIMEOUT).await?;
    let content_type = crate::media_server::raster(reply.content_type).ok_or("not an image")?;
    Ok((reply.body, content_type, wanted.tag.is_some()))
}

/// Answers one request from the page, off the protocol handler's thread.
/// A tagged image is that version of it for good; an untagged one may change.
pub fn serve(app: AppHandle, path: String, responder: UriSchemeResponder) {
    tauri::async_runtime::spawn(async move {
        crate::media_server::respond_image(responder, fetch(&app, &path).await);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const ITEM: &str = "f27caa37e5142225cceded48f6553502";

    #[test]
    fn parses_only_well_formed_requests() {
        assert_eq!(parse(&format!("/0a1b2c3d_{ITEM}_Primary_abc123")), Some(Wanted { server: "0a1b2c3d", item: ITEM, kind: "Primary", tag: Some("abc123") }));
        assert_eq!(parse(&format!("0a1b2c3d_{ITEM}_Backdrop")).map(|w| w.tag), Some(None));
        for bad in [
            format!("0a1b2c3d_{ITEM}_Chapter"),
            format!("0a1b2c3d_{ITEM}_Primary_a/b"),
            format!("0a1b2c3d_{ITEM}_Primary_a_b"),
            "0a1b2c3d_../../x_Primary".to_string(),
            format!("zzzzzzzz_{ITEM}_Primary"),
            String::new(),
        ] {
            assert_eq!(parse(&bad), None, "{bad}");
        }
    }
}
