//! HTTP for the person's own Jellyfin server.
//!
//! Unlike addons (https only), a Jellyfin server is usually on the home
//! network and often plain http, so http and LAN addresses are allowed here;
//! the settings page marks an http server "Not secure". The rules shared with
//! Plex (redirects, size caps, timeouts) are in `media_server`. The access
//! token travels in the `Authorization` header, never in a URL, and reqwest
//! drops that header on a redirect to another host.

use std::time::Duration;

use reqwest::{Method, Url};
use serde_json::Value;

use crate::media_server::{self, NetError};
pub use crate::media_server::{JSON_TIMEOUT, Reply, device_name, display_host, endpoint, parse_server};
/// The addresses to try for what the person typed, e.g. "192.168.1.5:8096",
/// "jellyfin.example.com" or "https://example.com/jellyfin/". Without a
/// scheme, https is tried first, then http, but http only for an address on
/// this machine or the home network: the sign-in that follows sends the
/// password, and anyone on the way to a server on the internet could make
/// https fail on purpose to get it in plain text. Typing `http://` still works.
pub fn server_candidates(input: &str) -> Result<Vec<Url>, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("err.address.empty".into());
    }
    if input.len() > 2048 {
        return Err("err.address.too-long".into());
    }
    if input.contains("://") {
        return Ok(vec![server_base(input)?]);
    }
    let https = server_base(&format!("https://{input}"))?;
    if !looks_local(&https) {
        return Ok(vec![https]);
    }
    Ok(vec![https, server_base(&format!("http://{input}"))?])
}

/// The server's base address for what was typed or pasted. The address bar
/// of Jellyfin's web app reads `…/web/` or `…/web/index.html` (the page is in
/// the fragment): the API lives one level up, as Jellyfin's own apps take it.
fn server_base(input: &str) -> Result<Url, String> {
    let mut url = parse_server(input)?;
    let path = url.path();
    let lower = path.to_ascii_lowercase();
    if let Some(cut) = ["/web/index.html", "/web"].iter().find_map(|s| lower.ends_with(s).then(|| path.len() - s.len())) {
        let base = path[..cut].to_string();
        url.set_path(&base);
    }
    Ok(url)
}

/// A LAN or loopback address, or a name only the home network knows
/// (`nas`, `media.local`, `server.lan`, `box.home.arpa`).
fn looks_local(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_end_matches('.').to_ascii_lowercase();
    crate::addons::net::is_private_host(url) || !host.contains('.') || [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain"].iter().any(|s| host.ends_with(s))
}

/// Values in the header are quoted and URL-encoded, as Jellyfin expects.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The `Authorization` header Jellyfin clients send:
/// `MediaBrowser Client="Orbit", Device="…", DeviceId="…", Version="…"`,
/// plus `Token="…"` once signed in. (The older `X-Emby-*` headers and the
/// `api_key` query are deprecated and removed in Jellyfin 12.)
pub fn authorization(device_id: &str, token: Option<&str>) -> String {
    let mut header = format!(
        "MediaBrowser Client=\"Orbit\", Device=\"{}\", DeviceId=\"{}\", Version=\"{}\"",
        encode(device_name()),
        encode(device_id),
        encode(env!("CARGO_PKG_VERSION"))
    );
    if let Some(token) = token {
        header.push_str(&format!(", Token=\"{}\"", encode(token)));
    }
    header
}

/// Jellyfin's words for what went wrong (never the address).
fn describe(err: &NetError, auth: Option<&str>) -> String {
    match err {
        NetError::Scheme => "err.address.scheme".into(),
        NetError::Header => "invalid login".into(),
        NetError::Timeout => "err.jellyfin.timeout".into(),
        NetError::Redirect => "err.server.redirect".into(),
        NetError::Connect => "err.jellyfin.unreachable".into(),
        NetError::Failed => "err.jellyfin.failed".into(),
        NetError::Denied if auth.is_some_and(|a| a.contains("Token=")) => "err.jellyfin.signed-out".into(),
        NetError::Denied => "err.jellyfin.wrong-login".into(),
        NetError::Status(status) => crate::user_error::coded("jellyfin.status", &[("status", &status.to_string())]),
        NetError::TooLarge => "err.jellyfin.invalid".into(),
    }
}

/// Sends a request and reads at most `limit` bytes of the answer.
pub async fn send(method: Method, url: Url, auth: Option<&str>, body: Option<&Value>, limit: usize, timeout: Duration) -> Result<Reply, String> {
    let headers: Vec<media_server::Header<'_>> = auth.map(|a| ("Authorization", a, true)).into_iter().collect();
    media_server::send(method, url, &headers, body, limit, timeout).await.map_err(|e| describe(&e, auth))
}

/// A GET without the token that follows no redirect: for asking an address who it is.
pub async fn probe(url: Url, limit: usize, timeout: Duration) -> Result<Reply, String> {
    media_server::probe(url, &[], limit, timeout).await.map_err(|e| match e {
        NetError::Status(status) if (300..400).contains(&status) => "err.server.redirect".into(),
        e => describe(&e, None),
    })
}

/// GETs JSON.
pub async fn get_json(url: Url, auth: &str) -> Result<Value, String> {
    let reply = send(Method::GET, url, Some(auth), None, media_server::JSON_LIMIT, JSON_TIMEOUT).await?;
    serde_json::from_slice(&reply.body).map_err(|_| "err.jellyfin.invalid".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_server::redirect_allowed;
    use reqwest::header::HeaderValue;

    #[test]
    fn server_addresses() {
        let one = |s: &str| parse_server(s).map(|u| u.to_string());
        assert_eq!(one("http://192.168.1.5:8096/").unwrap(), "http://192.168.1.5:8096/");
        assert_eq!(one("https://media.example.com/jellyfin/").unwrap(), "https://media.example.com/jellyfin");
        assert!(one("ftp://media.example.com").is_err());
        assert!(one("http://user:pw@media.example.com").is_err());
        assert!(one("http://media.example.com/?api_key=x").is_err());
        assert!(one("file:///C:/x").is_err());

        let tried: Vec<String> = server_candidates(" 192.168.1.5:8096 ").unwrap().iter().map(ToString::to_string).collect();
        assert_eq!(tried, ["https://192.168.1.5:8096/", "http://192.168.1.5:8096/"]);
        assert_eq!(server_candidates("http://nas.local:8096").unwrap().len(), 1);
        // No silent fall back to plain http (and the password in the clear) for a server on the internet.
        assert_eq!(server_candidates("jellyfin.example.com").unwrap().len(), 1);
        for local in ["nas:8096", "media.local", "server.lan", "localhost:8096", "[fd00::5]:8096"] {
            assert_eq!(server_candidates(local).unwrap().len(), 2, "{local}");
        }
        assert!(server_candidates("  ").is_err());
        // An address copied from the browser while on Jellyfin's web app.
        for pasted in ["http://192.168.1.5:8096/web/#/home.html", "http://192.168.1.5:8096/web/index.html#!/home.html", "http://192.168.1.5:8096/web"] {
            assert_eq!(server_candidates(pasted).unwrap()[0].as_str(), "http://192.168.1.5:8096/", "{pasted}");
        }
        assert_eq!(server_candidates("https://media.example.com/jellyfin/web/#/home.html").unwrap()[0].as_str(), "https://media.example.com/jellyfin");
        // Only a whole last segment: a base path that merely ends in "web" stays.
        assert_eq!(server_candidates("https://example.com/myweb").unwrap()[0].as_str(), "https://example.com/myweb");
    }

    #[test]
    fn endpoints_stay_under_the_base() {
        let base = parse_server("https://media.example.com/jellyfin").unwrap();
        let url = endpoint(&base, "/Items", &[("userId", "abc"), ("searchTerm", "a&b c")]).unwrap();
        assert_eq!(url.as_str(), "https://media.example.com/jellyfin/Items?userId=abc&searchTerm=a%26b+c");
        let root = parse_server("http://10.0.0.2:8096").unwrap();
        assert_eq!(endpoint(&root, "/System/Info/Public", &[]).unwrap().as_str(), "http://10.0.0.2:8096/System/Info/Public");
    }

    #[test]
    fn hosts_for_display() {
        assert_eq!(display_host(&parse_server("http://192.168.1.5:8096").unwrap()), ("192.168.1.5:8096".to_string(), true));
        assert_eq!(display_host(&parse_server("https://media.example.com").unwrap()), ("media.example.com".to_string(), false));
    }

    #[test]
    fn authorization_header() {
        let anonymous = authorization("abc123", None);
        assert!(anonymous.starts_with("MediaBrowser Client=\"Orbit\", Device=\"Orbit%20on%20"));
        assert!(anonymous.contains("DeviceId=\"abc123\""));
        assert!(anonymous.contains(&format!("Version=\"{}\"", env!("CARGO_PKG_VERSION"))));
        assert!(!anonymous.contains("Token="));
        let signed_in = authorization("abc123", Some("tok\"en"));
        // A quote can't end the value early.
        assert!(signed_in.ends_with(", Token=\"tok%22en\""));
        assert!(HeaderValue::from_str(&signed_in).is_ok());
    }

    #[test]
    fn redirects_never_reach_the_lan_from_outside() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(redirect_allowed(&u("http://media.example.com/"), &u("https://media.example.com/")));
        assert!(redirect_allowed(&u("http://192.168.1.5:8096/"), &u("http://192.168.1.5:8920/")));
        assert!(!redirect_allowed(&u("https://media.example.com/"), &u("http://192.168.1.5/")));
        assert!(!redirect_allowed(&u("https://media.example.com/"), &u("http://localhost:8096/")));
        assert!(!redirect_allowed(&u("https://media.example.com/"), &u("file:///etc/passwd")));
    }
}
