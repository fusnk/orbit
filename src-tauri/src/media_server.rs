//! What the person's own media servers (Jellyfin, Plex) have in common: the
//! HTTP rules for reaching them, small checks on what they send, what the
//! player is given, and how their images are answered.
//!
//! Unlike addons (https only), such a server is usually on the home network
//! and often plain http, so http and LAN addresses are allowed here; the
//! settings page marks an http server "Not secure". Still enforced, as for
//! IPTV: http(s) only, a redirect may never move from a public host into this
//! machine or the LAN, size caps and timeouts on everything, and errors never
//! include the address. Sign-ins travel in headers (marked sensitive), never
//! in a URL, and a request carrying one never follows a redirect to another host
//! or port, or from https down to http.

use std::sync::LazyLock;
use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, HeaderName, HeaderValue};
use reqwest::{Client, Method, Url, redirect};
use serde_json::Value;
use tauri::http::{Response, StatusCode, header};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::addons::net::is_private_host;

const MAX_REDIRECTS: usize = 5;
/// Library pages, item details and episode lists.
pub const JSON_LIMIT: usize = 16 * 1024 * 1024;
pub const JSON_TIMEOUT: Duration = Duration::from_secs(30);

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| client(false));
/// For requests that carry a sign-in (a token header, or a password in the body).
static SIGNED_CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| client(true));
/// For asking an address who it is: the answer must come from that address
/// itself, so no redirect is followed (a redirect is just a failed check).
static PROBE_CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| builder().redirect(redirect::Policy::none()).build().ok());

/// `same_host`: redirects stay on the request's host. reqwest drops only
/// `Authorization` (and cookies) when a redirect changes host; `X-Plex-Token`
/// would follow it, and a 307/308 sends a sign-in's password on as well.
fn client(same_host: bool) -> Option<Client> {
    builder()
        .redirect(redirect::Policy::custom(move |attempt| {
            let allowed = attempt.previous().len() <= MAX_REDIRECTS
                && attempt.previous().last().is_some_and(|from| redirect_allowed(from, attempt.url()) && (!same_host || same_origin_redirect(from, attempt.url())));
            if allowed { attempt.follow() } else { attempt.error("redirect not allowed") }
        }))
        .build()
        .ok()
}

/// Where a request carrying a sign-in may be redirected: the same host and
/// port, and never from https down to http. The host alone isn't enough: a
/// different port is a different service (anything else listening on that
/// machine), and a downgrade would send the token in the clear to whoever
/// is on the network path. An httpâ†’https upgrade on the default ports is fine
/// (`port()` is `None` for a scheme's own default, so both sides compare equal).
fn same_origin_redirect(from: &Url, to: &Url) -> bool {
    from.host_str() == to.host_str() && from.port() == to.port() && !(from.scheme() == "https" && to.scheme() == "http")
}

fn builder() -> reqwest::ClientBuilder {
    // A name may lead into the LAN only if the person gave it, and no proxy looks it up instead (see guard_lan).
    crate::addons::net::guard_lan(Client::builder())
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(30))
        .referer(false)
}

/// A server may move to https or to another of its names, but never from a
/// public host into this machine or the LAN: otherwise a server on the
/// internet could point Orbit (with the person's token) at local services.
pub fn redirect_allowed(from: &Url, to: &Url) -> bool {
    check_scheme(to).is_ok() && (!is_private_host(to) || is_private_host(from))
}

pub fn check_scheme(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() && url.username().is_empty() && url.password().is_none() => Ok(()),
        _ => Err("err.address.scheme".into()),
    }
}

/// A server's base address: http(s), no login, query or fragment, and no
/// trailing slash (paths are appended to it).
pub fn parse_server(input: &str) -> Result<Url, String> {
    let mut url = Url::parse(input.trim()).map_err(|_| "err.address.invalid")?;
    check_scheme(&url)?;
    if url.query().is_some() {
        return Err("err.address.query".into());
    }
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url)
}

/// `host[:port]` for display, and whether it's plain http.
pub fn display_host(url: &Url) -> (String, bool) {
    let host = url.host_str().unwrap_or_default();
    let host = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    (host, url.scheme() == "http")
}

/// `path` (which must start with "/") under the server's base, with `query`.
pub fn endpoint(base: &Url, path: &str, query: &[(&str, &str)]) -> Result<Url, String> {
    let mut url = Url::parse(&format!("{}{path}", base.as_str().trim_end_matches('/'))).map_err(|_| "invalid address")?;
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(url)
}

/// How Orbit names this device to a server (no computer name: it's shown to
/// the server's admin, and the OS is enough to tell devices apart).
pub fn device_name() -> &'static str {
    if cfg!(windows) {
        "Orbit on Windows"
    } else if cfg!(target_os = "macos") {
        "Orbit on macOS"
    } else {
        "Orbit on Linux"
    }
}

/// Text from a server: control characters removed, trimmed, at most `max` characters.
pub fn clean(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

pub fn is_imdb(id: &str) -> bool {
    id.len() <= 12 && id.strip_prefix("tt").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

pub fn is_tmdb(id: &str) -> bool {
    (1..=12).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

/// The lookup key for one of Orbit's title ids (`tt…` or `tmdb:…`), if it has
/// one: `imdb:tt…` or `tmdb:{type}:{id}` (a TMDB show and movie can share a number).
pub fn key_for(title_id: &str, kind: &str) -> Option<String> {
    if is_imdb(title_id) {
        return Some(format!("imdb:{title_id}"));
    }
    let tmdb = title_id.strip_prefix("tmdb:")?;
    (matches!(kind, "movie" | "series") && is_tmdb(tmdb)).then(|| format!("tmdb:{kind}:{tmdb}"))
}

/// FNV-1a of a server's id, shortened: stable, and keeps Orbit's ids short.
pub fn server_hash(server_id: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in server_id.to_ascii_lowercase().bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:08x}", hash >> 32)
}

pub fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Why a request failed, for each server's own words.
#[derive(Debug, PartialEq, Eq)]
pub enum NetError {
    Scheme,
    Header,
    Timeout,
    Redirect,
    Connect,
    Failed,
    /// 401 or 403.
    Denied,
    Status(u16),
    TooLarge,
}

impl NetError {
    /// The server couldn't be reached at that address (another may work).
    /// Not a slow answer: the address works (a big library page, disks
    /// spinning up), and giving it up would move a Plex server's token from
    /// its https address to plain http on the LAN for the rest of the run.
    pub fn unreachable(&self) -> bool {
        matches!(self, Self::Connect)
    }
}

fn kind_of(err: &reqwest::Error) -> NetError {
    // A connection that timed out is an address that doesn't answer (a LAN
    // address away from home, say), not a slow server: both flags are set.
    if err.is_connect() {
        NetError::Connect
    } else if err.is_timeout() {
        NetError::Timeout
    } else if err.is_redirect() {
        NetError::Redirect
    } else {
        NetError::Failed
    }
}

/// What came back: the body and its content type.
pub struct Reply {
    pub body: Vec<u8>,
    pub content_type: Option<String>,
}

/// A request header: name, value, and whether it's a secret (kept out of debug output).
pub type Header<'a> = (&'static str, &'a str, bool);

/// Sends a request and reads at most `limit` bytes of the answer.
pub async fn send(method: Method, url: Url, headers: &[Header<'_>], body: Option<&Value>, limit: usize, timeout: Duration) -> Result<Reply, NetError> {
    let signed = body.is_some() || headers.iter().any(|(_, _, secret)| *secret);
    send_on(if signed { &SIGNED_CLIENT } else { &CLIENT }, method, url, headers, body, limit, timeout).await
}

/// A GET that follows no redirect: for an identity check (Plex's `/identity`,
/// Jellyfin's `/System/Info/Public`), where only the address asked may answer.
pub async fn probe(url: Url, headers: &[Header<'_>], limit: usize, timeout: Duration) -> Result<Reply, NetError> {
    send_on(&PROBE_CLIENT, Method::GET, url, headers, None, limit, timeout).await
}

async fn send_on(client: &Option<Client>, method: Method, url: Url, headers: &[Header<'_>], body: Option<&Value>, limit: usize, timeout: Duration) -> Result<Reply, NetError> {
    check_scheme(&url).map_err(|_| NetError::Scheme)?;
    let client = client.as_ref().ok_or(NetError::Failed)?;
    // Every request starts at the person's own server (or plex.tv), which may be on the LAN.
    crate::addons::net::trust_host(&url);
    let mut request = client.request(method, url).timeout(timeout).header("Accept", "application/json, image/*");
    for (name, value, sensitive) in headers {
        let mut value = HeaderValue::from_str(value).map_err(|_| NetError::Header)?;
        value.set_sensitive(*sensitive);
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| NetError::Header)?;
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let mut response = request.send().await.map_err(|e| kind_of(&e))?;
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err(NetError::Denied);
    }
    if !response.status().is_success() {
        return Err(NetError::Status(status));
    }
    if response.content_length().is_some_and(|len| len > limit as u64) {
        return Err(NetError::TooLarge);
    }
    let content_type = response.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_ascii_lowercase);
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| kind_of(&e))? {
        if out.len() + chunk.len() > limit {
            return Err(NetError::TooLarge);
        }
        out.extend_from_slice(&chunk);
    }
    Ok(Reply { body: out, content_type })
}

/// What mpv is given: the address, request headers for it, and subtitle files.
#[derive(Debug, PartialEq)]
pub struct Playable {
    pub url: String,
    pub headers: Vec<String>,
    pub subtitles: Vec<String>,
}

/// A video from one of the person's servers (`orbit-jellyfin://…`, `orbit-plex://…`).
pub fn is_address(url: &str) -> bool {
    url.starts_with(crate::jellyfin::SCHEME) || url.starts_with(crate::plex::SCHEME)
}

/// The direct-play address of a server's video for the player.
pub async fn resolve(app: &AppHandle, profile: &str, address: &str) -> Result<Playable, String> {
    let db = app.state::<crate::db::Db>();
    if address.starts_with(crate::plex::SCHEME) {
        crate::plex::resolve(&db, &app.state::<crate::plex::Plex>(), profile, address).await
    } else {
        crate::jellyfin::resolve(&db, profile, address).await
    }
}

/// Raster images only: an SVG is a document that can hold script. Media types
/// are case-insensitive, so `image/SVG+xml` is an SVG too.
pub fn raster(content_type: Option<String>) -> Option<String> {
    content_type.map(|t| t.to_ascii_lowercase()).filter(|t| t.starts_with("image/") && !t.contains("svg"))
}

/// Whether an image protocol request comes from Orbit's own page. The
/// protocols answer with what Rust fetched using the person's tokens and keys
/// (Jellyfin, Plex, RPDB); any other webview (today there is none, addon
/// configure pages open in the system browser) is refused, so one added later
/// can't use them to reach the person's servers or tell what's in them.
pub fn is_main_webview(label: &str) -> bool {
    label == "main"
}

/// Answers a request from a webview other than Orbit's own (see `is_main_webview`).
pub fn refuse(responder: UriSchemeResponder) {
    if let Ok(response) = Response::builder().status(StatusCode::FORBIDDEN).body(Vec::new()) {
        responder.respond(response);
    }
}

/// Answers an image protocol request: the image (cached for a week when it's
/// a fixed version of it, an hour otherwise), or 404.
pub fn respond_image(responder: UriSchemeResponder, found: Result<(Vec<u8>, String, bool), String>) {
    let response = match found {
        Ok((body, content_type, fixed)) => Response::builder()
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, if fixed { "max-age=604800" } else { "max-age=3600" })
            .header("X-Content-Type-Options", "nosniff")
            .body(body),
        Err(_) => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
    };
    if let Ok(response) = response {
        responder.respond(response);
    }
}

/// A one-shot local server for identity checks: it answers `body` (JSON) at
/// `/next`, and redirects every other path there when `redirect` is set.
#[cfg(test)]
pub(crate) fn test_server(redirect: bool, body: &'static str) -> Url {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().take(4).flatten() {
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let reply = if !redirect || String::from_utf8_lossy(&buf[..n]).contains(" /next ") {
                format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
            } else {
                format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:{port}/next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            };
            let _ = stream.write_all(reply.as_bytes());
        }
    });
    Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_is_refused_however_it_is_spelled() {
        assert_eq!(raster(Some("image/jpeg".into())).as_deref(), Some("image/jpeg"));
        for svg in ["image/svg+xml", "image/SVG+xml", "Image/Svg+Xml; charset=utf-8", "text/html"] {
            assert_eq!(raster(Some(svg.into())), None, "{svg}");
        }
    }

    /// A one-shot server on 127.0.0.1 that redirects every request to `localhost` (another host, same machine).
    fn redirecting_server() -> Url {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(4).flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let reply = if String::from_utf8_lossy(&buf[..n]).contains(" /next ") {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_string()
                } else {
                    format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://localhost:{port}/next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                };
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        Url::parse(&format!("http://127.0.0.1:{port}/start")).unwrap()
    }

    #[test]
    fn signed_requests_stay_on_their_host() {
        let send_with = |headers: &[Header<'_>]| tauri::async_runtime::block_on(send(Method::GET, redirecting_server(), headers, None, 1024, Duration::from_secs(5)));
        assert!(matches!(send_with(&[("X-Plex-Token", "secret-token", true)]), Err(NetError::Redirect)));
        let body = serde_json::json!({ "Pw": "password" });
        assert!(matches!(tauri::async_runtime::block_on(send(Method::POST, redirecting_server(), &[], Some(&body), 1024, Duration::from_secs(5))), Err(NetError::Redirect)));
        // Without a sign-in the redirect is followed (`localhost` counts as the person's: it's on this machine).
        crate::addons::net::trust_host(&Url::parse("http://localhost/").unwrap());
        assert_eq!(send_with(&[("X-Plex-Product", "Orbit", false)]).map(|r| r.body).ok(), Some(b"ok".to_vec()));
    }

    #[test]
    fn signed_redirects_keep_the_origin() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(same_origin_redirect(&u("http://media.example.com/a"), &u("https://media.example.com/b")));
        assert!(same_origin_redirect(&u("http://192.168.1.5:8096/a"), &u("http://192.168.1.5:8096/b")));
        assert!(!same_origin_redirect(&u("https://media.example.com/"), &u("http://media.example.com/")));
        assert!(!same_origin_redirect(&u("http://192.168.1.5:8096/"), &u("http://192.168.1.5:8097/")));
        assert!(!same_origin_redirect(&u("https://media.example.com/"), &u("https://media.example.com:8443/")));
        assert!(!same_origin_redirect(&u("http://192.168.1.5:8096/"), &u("http://192.168.1.6:8096/")));
    }

    #[test]
    fn image_protocols_answer_the_main_webview_only() {
        assert!(is_main_webview("main"));
        assert!(!is_main_webview("addon-configure") && !is_main_webview("") && !is_main_webview("Main"));
    }

    #[test]
    fn identity_checks_follow_no_redirect() {
        // Even to a host the person's (`localhost`): the answer must come from the address asked.
        crate::addons::net::trust_host(&Url::parse("http://localhost/").unwrap());
        let reply = tauri::async_runtime::block_on(probe(redirecting_server(), &[], 1024, Duration::from_secs(5)));
        assert!(matches!(reply, Err(NetError::Status(307))));
    }

    #[test]
    fn lookup_keys_for_title_ids() {
        assert_eq!(key_for("tt0063350", "movie").as_deref(), Some("imdb:tt0063350"));
        assert_eq!(key_for("tmdb:10331", "series").as_deref(), Some("tmdb:series:10331"));
        assert_eq!(key_for("tmdb:1;2", "movie"), None);
        assert_eq!(key_for("tmdb:1", "channel"), None);
        assert!(is_imdb("tt1") && !is_imdb("tt") && !is_imdb("nm1"));
    }

    #[test]
    fn unreachable_errors_are_told_apart() {
        assert!(NetError::Connect.unreachable());
        assert!(!NetError::Timeout.unreachable() && !NetError::Denied.unreachable() && !NetError::Status(500).unreachable());
        tauri::async_runtime::block_on(async {
            // Nothing listening: unreachable.
            let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = Url::parse(&format!("http://127.0.0.1:{}/identity", closed.local_addr().unwrap().port())).unwrap();
            drop(closed);
            // Windows retries a refused connection for about 2 s before giving up: the limit leaves room for that.
            assert_eq!(probe(url, &[], 1024, Duration::from_secs(10)).await.err(), Some(NetError::Connect));
            // Connected, but no answer in time: a slow server, not a dead address.
            let slow = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = Url::parse(&format!("http://127.0.0.1:{}/identity", slow.local_addr().unwrap().port())).unwrap();
            assert_eq!(probe(url, &[], 1024, Duration::from_millis(300)).await.err(), Some(NetError::Timeout));
            drop(slow);
        });
    }
}
