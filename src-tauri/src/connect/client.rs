//! Requests to another Orbit: to its home-network address (from discovery),
//! signed with the pair's secret, and its signed answer checked before anything
//! in it is used.
//!
//! The client goes straight to that address: no proxy (a system proxy would
//! carry home-network traffic off to wherever it is), no redirects (an answer
//! can't send Orbit elsewhere), short timeouts and a capped answer.

use std::net::SocketAddrV4;
use std::sync::OnceLock;
use std::time::Duration;

use super::auth::{self, Request};
use super::server::{FROM, NONCE, SIGNATURE, TIME, unix_now};
use super::wire::MAX_REPLY_BYTES;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const TIMEOUT: Duration = Duration::from_secs(6);

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| "couldn’t reach the device")?;
    Ok(CLIENT.get_or_init(|| built))
}

/// An answer: its status and body.
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

async fn post(addr: SocketAddrV4, path: &str, body: Vec<u8>, headers: &[(&str, &str)]) -> Result<(u16, Option<String>, Vec<u8>), String> {
    // Discovery only hands over home-network addresses; checked again where the request goes.
    if !addr.ip().is_private() {
        return Err("not a home-network address".into());
    }
    let mut request = client()?.post(format!("http://{addr}{path}")).header("content-type", "application/json").body(body);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let mut response = request.send().await.map_err(|_| "couldn’t reach the device")?;
    let status = response.status().as_u16();
    let signature = response.headers().get(SIGNATURE).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "couldn’t reach the device")? {
        if bytes.len() + chunk.len() > MAX_REPLY_BYTES {
            return Err("the device’s answer was too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((status, signature, bytes))
}

/// A pairing message (unsigned: the pair has no secret yet; see auth.rs).
pub async fn pair(addr: SocketAddrV4, path: &str, body: Vec<u8>) -> Result<Reply, String> {
    let (status, _, body) = post(addr, path, body, &[]).await?;
    Ok(Reply { status, body })
}

/// Who's at the other end.
pub struct Target<'a> {
    pub addr: SocketAddrV4,
    pub id: &'a str,
}

/// Why a signed request got no answer that can be used.
#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    /// The device asked to slow down (too many requests at once). Unsigned, so nothing in it is
    /// used, but the device is there: it isn't marked offline for it.
    Busy,
    /// No answer, or one that didn't check out.
    Unreachable,
}

/// What an answer without a valid signature means. Unsigned answers are only the refusals sent
/// before a request is checked (server.rs): an unknown device or a stale clock (401), or too fast (429, 503).
fn unsigned(status: u16) -> Failure {
    match status {
        429 | 503 => Failure::Busy,
        _ => Failure::Unreachable,
    }
}

/// A signed request. Its answer is used only if its signature checks out: a
/// device that isn't the paired one can't answer in its place.
pub async fn signed(target: &Target<'_>, me: &str, secret: &[u8], path: &str, body: Vec<u8>) -> Result<Reply, Failure> {
    let nonce = auth::random_nonce().map_err(|_| Failure::Unreachable)?;
    let time = unix_now();
    let signature = Request { method: "POST", path, to: target.id, from: me, time, nonce: &nonce, body: &body }.sign(secret);
    let time = time.to_string();
    let (status, reply_signature, reply) = post(target.addr, path, body, &[(FROM, me), (TIME, &time), (NONCE, &nonce), (SIGNATURE, &signature)]).await.map_err(|_| Failure::Unreachable)?;
    match reply_signature {
        Some(s) if auth::verify_reply(secret, &nonce, status, &reply, &s) => Ok(Reply { status, body: reply }),
        _ => Err(unsigned(status)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn being_asked_to_slow_down_is_not_being_offline() {
        assert_eq!(unsigned(429), Failure::Busy);
        assert_eq!(unsigned(503), Failure::Busy);
        assert_eq!(unsigned(401), Failure::Unreachable);
        assert_eq!(unsigned(200), Failure::Unreachable);
    }
}
