//! Orbit Connect's server: HTTP/1 on this device's private home-network
//! address only, at a random port (both as the phone remote's, see
//! remote/server.rs), while Connect is on.
//!
//! Only other Orbits talk to it, never a browser: a request naming an `Origin`
//! is refused, and every request must be JSON, which a web page can't send to
//! another address without a CORS preflight this server never answers. So a
//! page open on some computer on the network can't even guess pairing codes.
//!
//! An unpaired device can only take part in pairing (`/v1/pair/…`), which works
//! while this device is open to pairing and ends with the person confirming. Everything else must be signed by a paired device
//! (auth.rs), at most once, within the clock window, and within its rate.

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::{Duration, Instant};

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use tauri::{AppHandle, Manager};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Semaphore, watch};
use tokio::task::JoinSet;

use super::auth::{self, NONCE_HEX, Rejected, TAG_HEX};
use super::wire::{PairCancel, PairConfirm, PairNonce, PairStart};
use super::wire::{self, Play};
use super::{Connect, PairRefusal};
use crate::remote::command::Refusal;

/// Connections open at once. Each request is short; a few devices make few.
const MAX_CONNECTIONS: usize = 16;
/// From one device at once: its pings, a status poll and a button press, with room to spare.
const MAX_PER_DEVICE: usize = 4;
const HEADER_TIMEOUT: Duration = Duration::from_secs(5);
const BODY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HEAD_BYTES: usize = 8 * 1024;
const MAX_HEADERS: usize = 24;

/// The headers a signed request carries.
pub const FROM: &str = "x-orbit-from";
pub const TIME: &str = "x-orbit-time";
pub const NONCE: &str = "x-orbit-nonce";
pub const SIGNATURE: &str = "x-orbit-signature";

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

pub async fn start(app: AppHandle, ip: Ipv4Addr) -> Result<Running, String> {
    let listener = crate::remote::server::bind(ip).await?;
    let SocketAddr::V4(addr) = listener.local_addr().map_err(|e| e.to_string())? else { return Err("unexpected address".into()) };
    let (stop, stopped) = watch::channel(false);
    tauri::async_runtime::spawn(accept(listener, Arc::new(app), stopped));
    Ok(Running { addr, stop })
}

async fn accept(listener: TcpListener, app: Arc<AppHandle>, mut stopped: watch::Receiver<bool>) {
    let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    // One device can't hold every connection and keep the paired ones out (see `PeerSlots`).
    let per_device = crate::remote::checks::PeerSlots::new(MAX_PER_DEVICE);
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            _ = stopped.changed() => break,
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { continue };
                // Only this home network: a public address means the port was forwarded from the internet.
                if !crate::remote::checks::peer_allowed(peer.ip()) {
                    continue;
                }
                let Some(own) = per_device.take(peer.ip()) else { continue };
                let Ok(slot) = slots.clone().try_acquire_owned() else { continue };
                let app = app.clone();
                connections.spawn(async move {
                    serve(stream, app).await;
                    drop((slot, own));
                });
                while connections.try_join_next().is_some() {}
            }
        }
    }
    connections.abort_all();
}

async fn serve(stream: TcpStream, app: Arc<AppHandle>) {
    let service = service_fn(move |request| {
        let app = app.clone();
        async move { Ok::<_, Infallible>(handle(request, &app).await) }
    });
    let mut builder = http1::Builder::new();
    builder.timer(TokioTimer::new()).header_read_timeout(HEADER_TIMEOUT).max_buf_size(MAX_HEAD_BYTES).max_headers(MAX_HEADERS);
    let _ = builder.serve_connection(TokioIo::new(stream), service).await;
}

fn respond(status: StatusCode, body: Vec<u8>, signature: Option<String>) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from(body)));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(value) = signature.and_then(|s| HeaderValue::from_str(&s).ok()) {
        headers.insert(SIGNATURE, value);
    }
    response
}

fn empty(status: StatusCode) -> Response<Full<Bytes>> {
    respond(status, Vec::new(), None)
}

fn text<'a>(request: &'a Request<Incoming>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

async fn body(request: Request<Incoming>, limit: usize) -> Option<Bytes> {
    let read = Limited::new(request.into_body(), limit).collect();
    tokio::time::timeout(BODY_TIMEOUT, read).await.ok()?.ok().map(|b| b.to_bytes())
}

pub fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

async fn handle(request: Request<Incoming>, app: &AppHandle) -> Response<Full<Bytes>> {
    // Another Orbit never names an origin; a browser always does on a POST.
    if request.method() != Method::POST || request.headers().contains_key(header::ORIGIN) {
        return empty(StatusCode::FORBIDDEN);
    }
    if !text(&request, header::CONTENT_TYPE.as_str()).is_some_and(|t| t.eq_ignore_ascii_case("application/json")) {
        return empty(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let path = request.uri().path().to_owned();
    match path.as_str() {
        "/v1/pair/start" | "/v1/pair/nonce" | "/v1/pair/confirm" | "/v1/pair/cancel" => pair(request, app, &path).await,
        "/v1/hello" | "/v1/status" | "/v1/play" | "/v1/control" | "/v1/forget" => signed(request, app, &path).await,
        _ => empty(StatusCode::NOT_FOUND),
    }
}

fn json_reply(body: &impl serde::Serialize) -> Response<Full<Bytes>> {
    respond(StatusCode::OK, serde_json::to_vec(body).unwrap_or_default(), None)
}

/// How a refused pairing message is answered (mod.rs `pair_error` reads it).
fn pair_status(refusal: &PairRefusal) -> StatusCode {
    match refusal {
        PairRefusal::Closed => StatusCode::GONE,
        PairRefusal::Locked => StatusCode::LOCKED,
        PairRefusal::Full => StatusCode::CONFLICT,
        PairRefusal::Identity => StatusCode::FORBIDDEN,
        PairRefusal::Wrong => StatusCode::BAD_REQUEST,
        PairRefusal::Failed => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Pairing's messages (auth.rs has the protocol): unsigned, as the pair has no secret yet.
async fn pair(request: Request<Incoming>, app: &AppHandle, path: &str) -> Response<Full<Bytes>> {
    let Some(bytes) = body(request, 1024).await else { return empty(StatusCode::BAD_REQUEST) };
    let connect = app.state::<Connect>();
    let bad = || empty(StatusCode::BAD_REQUEST);
    let answer = match path {
        "/v1/pair/start" => match serde_json::from_slice::<PairStart>(&bytes).ok().filter(PairStart::well_formed) {
            Some(offer) => connect.pair_start(app, &offer).map(|reply| json_reply(&reply)),
            None => return bad(),
        },
        "/v1/pair/nonce" => match serde_json::from_slice::<PairNonce>(&bytes).ok().filter(|m| auth::is_id(&m.id) && auth::is_pair_nonce(&m.nonce)) {
            Some(message) => connect.pair_reveal(app, &message).map(|reply| json_reply(&reply)),
            None => return bad(),
        },
        "/v1/pair/confirm" => match serde_json::from_slice::<PairConfirm>(&bytes).ok().filter(|m| auth::is_id(&m.id) && auth::is_hex(&m.proof, TAG_HEX)) {
            // Not yet: the person here hasn't compared the numbers; the sender asks again.
            Some(message) => connect.pair_confirm(app, &message).map(|reply| reply.map_or_else(|| empty(StatusCode::ACCEPTED), |r| json_reply(&r))),
            None => return bad(),
        },
        "/v1/pair/cancel" => match serde_json::from_slice::<PairCancel>(&bytes).ok().filter(|m| auth::is_id(&m.id)) {
            Some(message) => {
                connect.pair_cancel(app, &message);
                Ok(empty(StatusCode::NO_CONTENT))
            }
            None => return bad(),
        },
        _ => return empty(StatusCode::NOT_FOUND),
    };
    answer.unwrap_or_else(|refusal| empty(pair_status(&refusal)))
}

/// A signed request from a paired device: checked, run, and answered with a signed reply.
async fn signed(request: Request<Incoming>, app: &AppHandle, path: &str) -> Response<Full<Bytes>> {
    let from = text(&request, FROM).filter(|f| auth::is_id(f)).map(str::to_owned);
    let time = text(&request, TIME).filter(|t| (1..=20).contains(&t.len())).and_then(|t| t.parse::<u64>().ok());
    let nonce = text(&request, NONCE).filter(|n| auth::is_hex(n, NONCE_HEX)).map(str::to_owned);
    let signature = text(&request, SIGNATURE).filter(|s| auth::is_hex(s, TAG_HEX)).map(str::to_owned);
    let (Some(from), Some(time), Some(nonce), Some(signature)) = (from, time, nonce, signature) else { return empty(StatusCode::UNAUTHORIZED) };
    let Some(bytes) = body(request, wire::MAX_BODY_BYTES).await else { return empty(StatusCode::BAD_REQUEST) };
    let connect = app.state::<Connect>();
    // Unknown device, bad signature, a copy, a stale clock or too fast: refused, saying no more than that.
    let (secret, name) = match connect.check_request(&from, path, time, &nonce, &signature, &bytes, Instant::now(), unix_now()) {
        Ok(found) => found,
        Err(Check::Unknown | Check::Rejected(Rejected::Stale | Rejected::Replayed)) => return empty(StatusCode::UNAUTHORIZED),
        Err(Check::Rejected(Rejected::Busy)) => return empty(StatusCode::SERVICE_UNAVAILABLE),
        Err(Check::TooFast) => return empty(StatusCode::TOO_MANY_REQUESTS),
    };
    let (status, reply) = match path {
        "/v1/hello" => (StatusCode::OK, connect.hello().map(|h| serde_json::to_vec(&h).unwrap_or_default()).unwrap_or_default()),
        "/v1/status" => {
            let playing = app.state::<crate::remote::Remote>().playing_for_connect();
            (StatusCode::OK, serde_json::json!({ "playing": playing }).to_string().into_bytes())
        }
        "/v1/play" => match Play::parse(&bytes) {
            // The page finds the title with this device's own addons, and plays it through the same
            // checks as anything picked here (profile, content limit, PIN); see app/connect.ts.
            Some(play) => {
                super::send_play(app, &name, &play);
                (StatusCode::NO_CONTENT, Vec::new())
            }
            None => (StatusCode::BAD_REQUEST, Vec::new()),
        },
        "/v1/control" => match app.state::<crate::remote::Remote>().check_connect_command(&bytes) {
            // The same checked commands, and the same actions, as the phone remote's.
            Ok(command) => {
                crate::remote::send_command(app, &command);
                (StatusCode::NO_CONTENT, Vec::new())
            }
            Err(Refusal::NotNow) => (StatusCode::CONFLICT, Vec::new()),
            Err(Refusal::Invalid) => (StatusCode::BAD_REQUEST, Vec::new()),
        },
        // The other device removed this one: so does this one.
        "/v1/forget" => {
            connect.forget_peer(app, &from);
            (StatusCode::NO_CONTENT, Vec::new())
        }
        _ => (StatusCode::NOT_FOUND, Vec::new()),
    };
    let signature = auth::sign_reply(&secret[..], &nonce, status.as_u16(), &reply);
    respond(status, reply, Some(signature))
}

/// Why a signed request was refused.
pub enum Check {
    /// Not from a paired device, or not signed by it.
    Unknown,
    Rejected(Rejected),
    TooFast,
}
