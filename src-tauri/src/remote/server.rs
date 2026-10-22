//! The phone remote's web server: HTTP/1 on this PC's private home-network
//! address only (see `checks::pick_lan`), at a random port, while the remote
//! is on. Every request passes the checks in checks.rs first; the API needs a
//! paired phone's session cookie, except the page itself, its words and pairing.

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, Instant};

use http_body_util::{BodyExt, Either, Full, Limited, channel::Channel};
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Semaphore, watch};
use tokio::task::JoinSet;

use super::checks;
use super::command::{self, Command, Refusal};
use super::guard::{Offer, PairError, SESSION_MAX};
use super::picker::{ShelfKind, kind_key};
use super::{Remote, announce, random_hex, send_command};

/// Connections open at once (each phone's live updates hold one).
const MAX_CONNECTIONS: usize = 24;
/// From one device at once: its live updates, the page and a few posters loading (a browser opens up to six).
const MAX_PER_DEVICE: usize = 8;
/// A request's headers must arrive within this.
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// And its body within this.
const BODY_TIMEOUT: Duration = Duration::from_secs(10);
/// Request line and headers, at most (hyper's minimum is 8 KiB).
const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_HEADERS: usize = 40;
/// Live updates go out at most this often, and at least this often (which also keeps the connection open).
const UPDATE_EVERY: Duration = Duration::from_millis(250);
const KEEP_ALIVE: Duration = Duration::from_secs(20);
const ART_LIMIT: usize = 4 * 1024 * 1024;
const ART_TIMEOUT: Duration = Duration::from_secs(10);

const INDEX_HTML: &str = include_str!("page/index.html");
const REMOTE_CSS: &str = include_str!("page/remote.css");
const REMOTE_JS: &str = include_str!("page/remote.js");
const ICON_SVG: &str = include_str!("page/icon.svg");

/// The page may load only its own script, styles and images, from this server:
/// no inline script, nothing third-party, no framing (clickjacking a remote).
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

type Body = Either<Full<Bytes>, Channel<Bytes>>;

/// A server that's running. Dropping it stops it, closing every connection.
pub struct Running {
    pub addr: SocketAddrV4,
    stop: watch::Sender<bool>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.send_replace(true);
    }
}

struct Site {
    app: AppHandle,
    /// `ip:port`, the only `Host` accepted.
    host: String,
    /// `http://ip:port`, the only `Origin` accepted.
    origin: String,
    stopped: watch::Receiver<bool>,
}

/// The address this PC uses on its home network, if it's a private one.
pub(crate) fn lan_address() -> Option<Ipv4Addr> {
    // Which address the default route leaves from. Connecting a UDP socket
    // only picks the route: no packet is sent.
    let primary = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|s| s.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).map(|()| s))
        .and_then(|s| s.local_addr())
        .ok()
        .map(|a| a.ip());
    let all: Vec<Ipv4Addr> = <network_interface::NetworkInterface as network_interface::NetworkInterfaceConfig>::show()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .flat_map(|i| i.addr)
                .filter_map(|a| match a.ip() {
                    IpAddr::V4(ip) => Some(ip),
                    IpAddr::V6(_) => None,
                })
                .collect()
        })
        .unwrap_or_default();
    checks::pick_lan(primary, &all)
}

/// A random port in the dynamic range, so an old link or a scan of usual ports finds nothing.
pub(crate) async fn bind(ip: Ipv4Addr) -> Result<TcpListener, String> {
    for _ in 0..8 {
        let mut bytes = [0u8; 2];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let port = 49152 + u16::from_le_bytes(bytes) % 16384;
        if let Ok(listener) = TcpListener::bind((ip, port)).await {
            return Ok(listener);
        }
    }
    TcpListener::bind((ip, 0)).await.map_err(|e| e.to_string())
}

pub async fn start(app: AppHandle) -> Result<Running, String> {
    let ip = lan_address().ok_or_else(|| crate::user_error::coded("remote.no-network", &[]))?;
    let listener = bind(ip).await?;
    let SocketAddr::V4(addr) = listener.local_addr().map_err(|e| e.to_string())? else { return Err("unexpected address".into()) };
    let (stop, stopped) = watch::channel(false);
    let site = Arc::new(Site { app, host: addr.to_string(), origin: format!("http://{addr}"), stopped: stopped.clone() });
    tauri::async_runtime::spawn(accept(listener, site, stopped));
    Ok(Running { addr, stop })
}

async fn accept(listener: TcpListener, site: Arc<Site>, mut stopped: watch::Receiver<bool>) {
    let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let per_device = checks::PeerSlots::new(MAX_PER_DEVICE);
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            _ = stopped.changed() => break,
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { continue };
                // Only this PC's own network: a public address means the port was forwarded from the internet.
                if !checks::peer_allowed(peer.ip()) {
                    continue;
                }
                // Too many open already, from this device or in all: this one is closed at once.
                let Some(own) = per_device.take(peer.ip()) else { continue };
                let Ok(slot) = slots.clone().try_acquire_owned() else { continue };
                let site = site.clone();
                connections.spawn(async move {
                    serve(stream, site).await;
                    drop((slot, own));
                });
                while connections.try_join_next().is_some() {}
            }
        }
    }
    connections.abort_all();
}

async fn serve(stream: TcpStream, site: Arc<Site>) {
    let service = service_fn(move |request| {
        let site = site.clone();
        async move { Ok::<_, Infallible>(handle(request, &site).await) }
    });
    let mut builder = http1::Builder::new();
    builder.timer(TokioTimer::new()).header_read_timeout(HEADER_TIMEOUT).max_buf_size(MAX_HEAD_BYTES).max_headers(MAX_HEADERS);
    let _ = builder.serve_connection(TokioIo::new(stream), service).await;
}

fn header(request: &Request<Incoming>, name: header::HeaderName) -> Option<&str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// A response with the headers every answer carries.
fn respond(status: StatusCode, content_type: Option<&'static str>, body: Body) -> Response<Body> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    if let Some(kind) = content_type {
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
    }
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    // Nothing here (a pairing link's address included) is ever sent on as a referrer.
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("cross-origin-resource-policy", HeaderValue::from_static("same-origin"));
    headers.insert("cross-origin-opener-policy", HeaderValue::from_static("same-origin"));
    response
}

fn full(status: StatusCode, content_type: Option<&'static str>, body: impl Into<Bytes>) -> Response<Body> {
    respond(status, content_type, Either::Left(Full::new(body.into())))
}

fn empty(status: StatusCode) -> Response<Body> {
    full(status, None, Bytes::new())
}

fn json(status: StatusCode, body: String) -> Response<Body> {
    full(status, Some("application/json"), body)
}

fn error(status: StatusCode, reason: &str) -> Response<Body> {
    json(status, serde_json::json!({ "error": reason }).to_string())
}

async fn handle(request: Request<Incoming>, site: &Site) -> Response<Body> {
    let authority_ok = request.uri().authority().is_none_or(|a| a.as_str().eq_ignore_ascii_case(&site.host));
    if !checks::host_ok(header(&request, header::HOST), &site.host) || !authority_ok {
        return empty(StatusCode::MISDIRECTED_REQUEST);
    }
    let post = request.method() == Method::POST;
    if !checks::origin_ok(header(&request, header::ORIGIN), &site.origin, post) {
        return empty(StatusCode::FORBIDDEN);
    }
    // The API speaks JSON only, which another site can't send without asking first (CORS preflight).
    if post && !header(&request, header::CONTENT_TYPE).is_some_and(|t| t.split(';').next().is_some_and(|t| t.trim().eq_ignore_ascii_case("application/json"))) {
        return empty(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let session = checks::session_cookie(request.headers().get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok())).map(str::to_owned);
    let remote = site.app.state::<Remote>();
    let path = request.uri().path().to_owned();
    match (request.method().clone(), path.as_str()) {
        (Method::GET, "/") => full(StatusCode::OK, Some("text/html; charset=utf-8"), INDEX_HTML),
        (Method::GET, "/remote.css") => full(StatusCode::OK, Some("text/css; charset=utf-8"), REMOTE_CSS),
        (Method::GET, "/remote.js") => full(StatusCode::OK, Some("text/javascript; charset=utf-8"), REMOTE_JS),
        (Method::GET, "/icon.svg") => full(StatusCode::OK, Some("image/svg+xml"), ICON_SVG),
        // The page's words: nothing private, needed before pairing.
        (Method::GET, "/api/strings") => json(StatusCode::OK, remote.strings_json()),
        (Method::GET, "/api/session") => {
            let paired = session.as_deref().is_some_and(|s| remote.lock().is_ok_and(|mut i| i.guard.session(s, Instant::now())));
            empty(if paired { StatusCode::NO_CONTENT } else { StatusCode::UNAUTHORIZED })
        }
        (Method::POST, "/api/pair") => pair(request, site).await,
        (Method::POST, "/api/forget") => {
            let forgot = session.as_deref().is_some_and(|s| remote.lock().is_ok_and(|mut inner| inner.guard.forget(s)));
            // Nothing changed without a session: an unpaired visitor can't make Orbit announce it.
            if forgot {
                remote.bump();
                announce(&site.app, "forgot");
            }
            let mut response = empty(StatusCode::NO_CONTENT);
            if let Ok(cookie) = HeaderValue::from_str(&checks::cleared_cookie_header()) {
                response.headers_mut().insert(header::SET_COOKIE, cookie);
            }
            response
        }
        (Method::POST, "/api/command") => match session {
            Some(s) => command(request, site, &s).await,
            None => empty(StatusCode::UNAUTHORIZED),
        },
        (Method::GET, "/api/events") => match session {
            Some(s) => events(site, s),
            None => empty(StatusCode::UNAUTHORIZED),
        },
        (Method::GET, "/api/picker") => match session {
            Some(s) => picker(site, &s),
            None => empty(StatusCode::UNAUTHORIZED),
        },
        (Method::GET, p) if p.starts_with("/art/") => match session {
            Some(s) => art(site, &s, p).await,
            None => empty(StatusCode::UNAUTHORIZED),
        },
        _ => empty(StatusCode::NOT_FOUND),
    }
}

/// The request's body, at most `limit` bytes, arriving within `BODY_TIMEOUT`.
async fn body(request: Request<Incoming>, limit: usize) -> Option<Bytes> {
    let read = Limited::new(request.into_body(), limit).collect();
    tokio::time::timeout(BODY_TIMEOUT, read).await.ok()?.ok().map(|b| b.to_bytes())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairRequest {
    token: Option<String>,
    code: Option<String>,
}

async fn pair(request: Request<Incoming>, site: &Site) -> Response<Body> {
    let Some(bytes) = body(request, 512).await else { return empty(StatusCode::BAD_REQUEST) };
    let Ok(offer) = serde_json::from_slice::<PairRequest>(&bytes) else { return empty(StatusCode::BAD_REQUEST) };
    let offer = match (&offer.token, &offer.code) {
        (Some(token), None) => Offer::Token(token),
        (None, Some(code)) => Offer::Code(code),
        _ => return empty(StatusCode::BAD_REQUEST),
    };
    let Ok(session) = random_hex() else { return empty(StatusCode::INTERNAL_SERVER_ERROR) };
    let remote = site.app.state::<Remote>();
    let outcome = match remote.lock() {
        Ok(mut inner) => inner.guard.pair(offer, session.clone(), Instant::now()),
        Err(_) => return empty(StatusCode::INTERNAL_SERVER_ERROR),
    };
    match outcome {
        Ok(()) => {
            remote.bump();
            announce(&site.app, "paired");
            let mut response = empty(StatusCode::NO_CONTENT);
            if let Ok(cookie) = HeaderValue::from_str(&checks::session_cookie_header(&session, SESSION_MAX.as_secs())) {
                response.headers_mut().insert(header::SET_COOKIE, cookie);
            }
            response
        }
        Err(PairError::Wrong) => error(StatusCode::FORBIDDEN, "wrong"),
        Err(PairError::Locked) => {
            announce(&site.app, "locked");
            error(StatusCode::LOCKED, "locked")
        }
        Err(PairError::Closed) => error(StatusCode::GONE, "closed"),
        Err(PairError::Full) => error(StatusCode::CONFLICT, "full"),
    }
}

/// Why a request is refused: not a paired phone's session, or more than its share of requests.
fn refusal(remote: &Remote, session: &str) -> Option<StatusCode> {
    let Ok(mut inner) = remote.lock() else { return Some(StatusCode::INTERNAL_SERVER_ERROR) };
    let now = Instant::now();
    if !inner.guard.session(session, now) {
        return Some(StatusCode::UNAUTHORIZED);
    }
    (!inner.guard.allow_command(session, now)).then_some(StatusCode::TOO_MANY_REQUESTS)
}

/// The picker's titles (picker.rs): read when the live updates' `picker` number moves, so
/// counted like a command.
fn picker(site: &Site, session: &str) -> Response<Body> {
    let remote = site.app.state::<Remote>();
    if let Some(status) = refusal(&remote, session) {
        return empty(status);
    }
    match remote.lock() {
        Ok(inner) => json(StatusCode::OK, inner.picker.json()),
        Err(_) => empty(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn command(request: Request<Incoming>, site: &Site, session: &str) -> Response<Body> {
    let remote = site.app.state::<Remote>();
    if let Some(status) = refusal(&remote, session) {
        return empty(status);
    }
    let Some(bytes) = body(request, command::MAX_BODY_BYTES).await else { return empty(StatusCode::BAD_REQUEST) };
    let parsed = {
        let Ok(mut inner) = remote.lock() else { return empty(StatusCode::INTERNAL_SERVER_ERROR) };
        let (audio, subtitles) = (inner.track_ids(true), inner.track_ids(false));
        let parsed = command::parse(&bytes, &inner.context(&audio, &subtitles));
        // A request waits for its answer from here on (older answers are then dropped).
        match &parsed {
            Ok(Command::Search { id, query }) => inner.search = super::Search { id: *id, query: query.clone(), ..Default::default() },
            Ok(Command::Browse { id }) => inner.picker.begin_shelf(ShelfKind::Home, *id, String::new()),
            Ok(Command::Mood { id, mood }) => inner.picker.begin_shelf(ShelfKind::Mood, *id, mood.clone()),
            Ok(Command::Surprise { id, media }) => inner.picker.begin_shelf(ShelfKind::Surprise, *id, kind_key(*media)),
            Ok(Command::Details { id, from, shelf, row, index }) => inner.picker.begin_details(*id, *from, *shelf, *row, *index),
            _ => {}
        }
        parsed
    };
    match parsed {
        Ok(cmd) => {
            if matches!(cmd, Command::Search { .. } | Command::Browse { .. } | Command::Mood { .. } | Command::Surprise { .. } | Command::Details { .. }) {
                remote.bump();
            }
            send_command(&site.app, &cmd);
            empty(StatusCode::NO_CONTENT)
        }
        Err(Refusal::NotNow) => empty(StatusCode::CONFLICT),
        Err(Refusal::Invalid) => empty(StatusCode::BAD_REQUEST),
    }
}

/// Live updates (server-sent events): the state now, then again each time it
/// changes (at most every `UPDATE_EVERY`), until the phone goes, its session
/// ends, or the remote is turned off.
fn events(site: &Site, session: String) -> Response<Body> {
    let remote = site.app.state::<Remote>();
    if !remote.lock().is_ok_and(|mut i| i.guard.session(&session, Instant::now())) {
        return empty(StatusCode::UNAUTHORIZED);
    }
    let (mut sender, body) = Channel::<Bytes>::new(2);
    let app = site.app.clone();
    let mut changes = remote.changed.subscribe();
    let mut stopped = site.stopped.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let remote = app.state::<Remote>();
            let paired = remote.lock().is_ok_and(|mut i| i.guard.session(&session, Instant::now()));
            let frame = if paired { format!("data: {}\n\n", remote.snapshot()) } else { "event: signed-out\ndata: {}\n\n".to_owned() };
            if sender.send_data(Bytes::from(frame)).await.is_err() || !paired || *stopped.borrow() {
                break;
            }
            tokio::select! {
                changed = changes.changed() => if changed.is_err() { break },
                () = tokio::time::sleep(KEEP_ALIVE) => {}
                _ = stopped.changed() => break,
            }
            tokio::time::sleep(UPDATE_EVERY).await;
        }
    });
    respond(StatusCode::OK, Some("text/event-stream"), Either::Right(body))
}

/// The raster image types a poster may be; anything else (SVG, which can carry script, say) isn't passed on.
fn image_type(content_type: Option<&str>) -> Option<&'static str> {
    let kind = content_type?.split(';').next()?.trim().to_ascii_lowercase();
    ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].into_iter().find(|k| *k == kind)
}

/// A poster, fetched here from the addon's address (which the phone never
/// learns) with the same checks as the app's own artwork.
async fn art(site: &Site, session: &str, path: &str) -> Response<Body> {
    let remote = site.app.state::<Remote>();
    if !remote.lock().is_ok_and(|mut i| i.guard.session(session, Instant::now())) {
        return empty(StatusCode::UNAUTHORIZED);
    }
    let Some(url) = remote.art_for(path) else { return empty(StatusCode::NOT_FOUND) };
    let (bytes, kind) = match remote.cached_art(&url) {
        Some(hit) => hit,
        None => {
            let Ok(parsed) = reqwest::Url::parse(&url) else { return empty(StatusCode::NOT_FOUND) };
            if crate::addons::net::check_artwork_url(&parsed).is_err() {
                return empty(StatusCode::NOT_FOUND);
            }
            let Ok((bytes, content_type)) = crate::addons::net::fetch_bytes(parsed, ART_LIMIT, ART_TIMEOUT).await else { return empty(StatusCode::BAD_GATEWAY) };
            let Some(kind) = image_type(content_type.as_deref()) else { return empty(StatusCode::NOT_FOUND) };
            let bytes = Bytes::from(bytes);
            remote.keep_art(url, bytes.clone(), kind);
            (bytes, kind)
        }
    };
    let mut response = full(StatusCode::OK, Some(kind), bytes);
    // The address changes with each title (`?v=`), so the phone may keep it a while.
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=600"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_raster_posters_pass() {
        assert_eq!(image_type(Some("image/jpeg")), Some("image/jpeg"));
        assert_eq!(image_type(Some("Image/PNG; charset=binary")), Some("image/png"));
        assert_eq!(image_type(Some("image/svg+xml")), None);
        assert_eq!(image_type(Some("text/html")), None);
        assert_eq!(image_type(None), None);
    }

    #[test]
    fn the_page_is_self_contained() {
        // No inline script or style (the CSP forbids them), and nothing from elsewhere.
        assert!(!INDEX_HTML.contains("<script>"));
        assert!(!INDEX_HTML.contains("style="));
        assert!(!INDEX_HTML.contains("<style"));
        for file in [INDEX_HTML, REMOTE_CSS, REMOTE_JS] {
            // The SVG namespace is a name, not something loaded.
            let file = file.replace("'http://www.w3.org/2000/svg'", "");
            assert!(!file.contains("http://") && !file.contains("https://") && !file.contains("//cdn") && !file.contains("@import"), "external reference");
        }
        assert!(!REMOTE_JS.contains("innerHTML") && !REMOTE_JS.contains("eval("));
    }
}
