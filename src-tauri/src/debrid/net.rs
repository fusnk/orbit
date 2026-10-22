//! HTTP for the debrid services, and keeping under their rate limits.
//!
//! Every request goes to a provider's fixed API host over https, built here
//! from constants: the page never supplies an address. Redirects are never
//! followed: no API call here needs one, and TorBox's link request carries
//! the API key in its query (TorBox accepts it nowhere else), so a redirect
//! must not be able to carry that address anywhere. Keys otherwise travel
//! as `Authorization: Bearer`, marked sensitive. reqwest's errors include the
//! request address, so they're reduced to a kind here and never formatted.

use std::sync::LazyLock;
use std::time::{Duration, Instant};

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue, RETRY_AFTER};
use reqwest::{Client, Method, Url, redirect};
use serde_json::Value;

/// Account lists and file lists; a huge account still fits.
pub const JSON_LIMIT: usize = 16 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
/// With no Retry-After, a 429 pauses requests this long.
const DEFAULT_BACKOFF: Duration = Duration::from_secs(30);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// A request that would wait longer than this for its turn fails instead (the page asks again later).
const MAX_QUEUE: Duration = Duration::from_secs(10);

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .referer(false)
        .redirect(redirect::Policy::none())
        .https_only(true)
        .build()
        .ok()
});

/// Why a request failed. Holds no address, key or body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fail {
    /// 401/403: the key was refused (revoked, or not this provider's).
    Denied,
    /// 429, or waiting out an earlier one: try again after this long.
    RateLimited(Duration),
    /// 404: the item or file is gone.
    Gone,
    Status(u16),
    Timeout,
    Network,
    TooLarge,
    /// An answer Orbit doesn't understand, or a link it won't play.
    Invalid,
    /// The key isn't in the OS keychain (removed there), or the keychain can't be read.
    NoKey,
}

/// One provider account's place in its rate limit: requests are spaced
/// `every` apart (just under the provider's limit), and after a 429 none go
/// out until `blocked_until`.
#[derive(Debug, Clone)]
pub struct Gate {
    next: Instant,
    blocked_until: Option<Instant>,
}

impl Gate {
    pub fn new(now: Instant) -> Self {
        Self { next: now, blocked_until: None }
    }

    /// Takes the next turn: how long to wait for it, or `RateLimited` while
    /// backing off (or if the queue is already too long).
    pub fn reserve(&mut self, now: Instant, every: Duration) -> Result<Duration, Fail> {
        if let Some(until) = self.blocked_until {
            if until > now {
                return Err(Fail::RateLimited(until - now));
            }
            self.blocked_until = None;
        }
        let at = self.next.max(now);
        let wait = at - now;
        if wait > MAX_QUEUE {
            return Err(Fail::RateLimited(wait));
        }
        self.next = at + every;
        Ok(wait)
    }

    /// The provider answered 429: no requests until `retry_after` (or a default) has passed.
    pub fn back_off(&mut self, now: Instant, retry_after: Option<Duration>) -> Duration {
        let pause = retry_after.unwrap_or(DEFAULT_BACKOFF).clamp(Duration::from_secs(1), MAX_BACKOFF);
        self.blocked_until = Some(now + pause);
        pause
    }
}

/// Retry-After in seconds (the HTTP-date form is rare for APIs, and taken as the default).
pub fn retry_after(value: Option<&str>) -> Option<Duration> {
    value?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

/// What a request carries besides its address.
pub enum Body<'a> {
    None,
    Form(&'a [(&'a str, &'a str)]),
    Json(&'a Value),
}

/// Sends one request and reads at most `limit` bytes of the answer. 204
/// answers with an empty body. The address must be https.
pub async fn send(method: Method, url: Url, bearer: Option<&str>, body: Body<'_>, limit: usize) -> Result<Vec<u8>, Fail> {
    if url.scheme() != "https" {
        return Err(Fail::Invalid);
    }
    let client = CLIENT.as_ref().ok_or(Fail::Network)?;
    let mut request = client.request(method, url).timeout(TIMEOUT).header("Accept", "application/json");
    if let Some(key) = bearer {
        let mut value = HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| Fail::Invalid)?;
        value.set_sensitive(true);
        request = request.header(AUTHORIZATION, value);
    }
    request = match body {
        Body::None => request,
        Body::Form(fields) => request.header(CONTENT_TYPE, "application/x-www-form-urlencoded").body(form_body(fields)),
        Body::Json(value) => request.json(value),
    };
    let mut response = request.send().await.map_err(|e| kind_of(&e))?;
    let status = response.status().as_u16();
    match status {
        401 => return Err(Fail::Denied),
        403 => {
            // A short read: only the error's name matters.
            let mut body = Vec::new();
            while let Ok(Some(chunk)) = response.chunk().await {
                body.extend_from_slice(&chunk);
                if body.len() > 16 * 1024 {
                    break;
                }
            }
            return Err(forbidden(&body));
        }
        404 => return Err(Fail::Gone),
        429 => return Err(Fail::RateLimited(retry_after(response.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok())).unwrap_or(DEFAULT_BACKOFF))),
        _ if !response.status().is_success() => return Err(Fail::Status(status)),
        _ => {}
    }
    if response.content_length().is_some_and(|len| len > limit as u64) {
        return Err(Fail::TooLarge);
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| kind_of(&e))? {
        if out.len() + chunk.len() > limit {
            return Err(Fail::TooLarge);
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// What a 403 means. Providers also answer 403 for a key that's fine but
/// can't do this (Real-Debrid: not premium, a blocked file, a locked account),
/// and treating that as a refused key would tell the person to add it again
/// and give up on a download for good. So it's the key only when the answer
/// names a token error, or names nothing at all.
fn forbidden(body: &[u8]) -> Fail {
    let error = serde_json::from_slice::<Value>(body).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_ascii_lowercase));
    match error.as_deref() {
        None | Some("bad_token" | "auth_error" | "no_auth") => Fail::Denied,
        Some(_) => Fail::Status(403),
    }
}

/// `application/x-www-form-urlencoded` fields (reqwest's own `form` is an optional feature Orbit doesn't build).
fn form_body(fields: &[(&str, &str)]) -> String {
    Url::parse("https://form.invalid/").map_or_else(
        |_| String::new(),
        |mut u| {
            u.query_pairs_mut().extend_pairs(fields);
            u.query().unwrap_or_default().to_string()
        },
    )
}

fn kind_of(err: &reqwest::Error) -> Fail {
    if err.is_timeout() { Fail::Timeout } else { Fail::Network }
}

/// JSON from a body (an empty one, e.g. a 204, is `null`).
pub fn json(body: &[u8]) -> Result<Value, Fail> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Null);
    }
    serde_json::from_slice(body).map_err(|_| Fail::Invalid)
}

/// A link the player or the downloader may be given: https, a public host,
/// no login in it. Providers' CDN links are all of that; anything else in an
/// answer is refused rather than played.
pub fn check_link(link: &str) -> Result<Url, Fail> {
    let url = Url::parse(link).map_err(|_| Fail::Invalid)?;
    let ok = url.scheme() == "https" && url.host_str().is_some() && url.username().is_empty() && url.password().is_none() && !crate::addons::net::is_private_host(&url) && link.len() <= 8192;
    if ok { Ok(url) } else { Err(Fail::Invalid) }
}

/// Text from a provider: control and text-direction characters removed, trimmed, at most `max` characters.
pub fn clean(text: &str, max: usize) -> String {
    crate::media_server::clean(text, max).chars().filter(|c| !matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')).collect()
}

/// Milliseconds since 1970 for an ISO 8601 / RFC 3339 time such as
/// "2026-10-01T12:34:56.000Z" or "2026-10-01T12:34:56+00:00" (offsets
/// other than UTC are applied). None if it isn't one.
pub fn iso_ms(text: &str) -> Option<i64> {
    let b = text.trim().as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        let part = b.get(from..from + len)?;
        part.iter().all(u8::is_ascii_digit).then(|| part.iter().fold(0i64, |n, d| n * 10 + i64::from(d - b'0')))
    };
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't' | b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (year, month, day, hour, minute, second) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    // Fractions of a second are dropped; then the zone.
    let mut at = 19;
    if b.get(at) == Some(&b'.') {
        at += 1;
        while b.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1;
        }
    }
    let offset_minutes = match b.get(at) {
        None | Some(b'Z' | b'z') => 0,
        Some(sign @ (b'+' | b'-')) => {
            let (h, m) = (num(at + 1, 2)?, if b.get(at + 3) == Some(&b':') { num(at + 4, 2)? } else { num(at + 3, 2)? });
            if *sign == b'+' { h * 60 + m } else { -(h * 60 + m) }
        }
        _ => return None,
    };
    // Days since 1970 (Howard Hinnant's days_from_civil).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + hour * 3_600 + minute * 60 + second) - offset_minutes * 60) * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_spaced_and_wait_out_a_429() {
        let start = Instant::now();
        let every = Duration::from_millis(250);
        let mut gate = Gate::new(start);
        assert_eq!(gate.reserve(start, every), Ok(Duration::ZERO));
        assert_eq!(gate.reserve(start, every), Ok(every));
        assert_eq!(gate.reserve(start, every), Ok(every * 2));
        // Later on, there's no wait.
        let later = start + Duration::from_secs(5);
        assert_eq!(gate.reserve(later, every), Ok(Duration::ZERO));
        // A 429 blocks everything until Retry-After has passed.
        assert_eq!(gate.back_off(later, Some(Duration::from_secs(8))), Duration::from_secs(8));
        assert_eq!(gate.reserve(later + Duration::from_secs(3), every), Err(Fail::RateLimited(Duration::from_secs(5))));
        assert_eq!(gate.reserve(later + Duration::from_secs(8), every), Ok(Duration::ZERO));
        // Backoff is bounded either way.
        assert_eq!(gate.back_off(later, Some(Duration::from_secs(100_000))), MAX_BACKOFF);
        assert_eq!(gate.back_off(later, Some(Duration::ZERO)), Duration::from_secs(1));
        assert_eq!(gate.back_off(later, None), DEFAULT_BACKOFF);
    }

    #[test]
    fn a_long_queue_fails_instead_of_waiting() {
        let start = Instant::now();
        let mut gate = Gate::new(start);
        let every = Duration::from_secs(4);
        // Waits of 0, 4 and 8 seconds are fine; 12 is past MAX_QUEUE.
        for _ in 0..3 {
            assert!(gate.reserve(start, every).is_ok());
        }
        assert!(matches!(gate.reserve(start, every), Err(Fail::RateLimited(_))));
    }

    #[test]
    fn retry_after_values() {
        assert_eq!(retry_after(Some("12")), Some(Duration::from_secs(12)));
        assert_eq!(retry_after(Some(" 3 ")), Some(Duration::from_secs(3)));
        assert_eq!(retry_after(Some("Wed, 21 Oct 2026 07:28:00 GMT")), None);
        assert_eq!(retry_after(None), None);
    }

    #[test]
    fn links_must_be_public_https() {
        assert!(check_link("https://abc.download.real-debrid.com/d/XYZ/file.mkv").is_ok());
        assert!(check_link("https://store-001.weur.tb-cdn.st/dld/uuid?token=abc").is_ok());
        for bad in ["http://abc.example/file.mkv", "https://127.0.0.1/x", "https://192.168.1.2/x", "https://user:pw@cdn.example/x", "file:///etc/passwd", "magnet:?xt=urn:btih:x", "not a link"] {
            assert!(check_link(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn iso_times() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("2026-10-05T12:00:00.000Z"), Some(1_791_201_600_000));
        assert_eq!(iso_ms("2026-10-05T14:00:00+02:00"), Some(1_791_201_600_000));
        assert_eq!(iso_ms("2026-10-05T12:00:00"), Some(1_791_201_600_000));
        assert_eq!(iso_ms("2024-02-29T00:00:00Z"), Some(1_709_164_800_000));
        for bad in ["", "2026-13-01T00:00:00Z", "yesterday", "2026-10-05", "2026-10-05T12:00:00X"] {
            assert_eq!(iso_ms(bad), None, "{bad}");
        }
    }

    #[test]
    fn cleaned_text_has_no_direction_tricks() {
        assert_eq!(clean("Movie\u{202e}vkm.exe\u{7}", 80), "Movievkm.exe");
        assert_eq!(clean("  x  ", 80), "x");
    }

    #[test]
    fn form_fields_are_encoded() {
        assert_eq!(form_body(&[("link", "https://x/a?b=1&c")]), "link=https%3A%2F%2Fx%2Fa%3Fb%3D1%26c");
    }

    #[test]
    fn a_403_is_the_key_only_when_the_provider_says_so() {
        // Real-Debrid answers 403 for a valid key that can't do this (not premium, a blocked file, a locked account).
        assert_eq!(forbidden(br#"{"error":"permission_denied","error_code":9}"#), Fail::Status(403));
        assert_eq!(forbidden(br#"{"error":"infringing_file","error_code":35}"#), Fail::Status(403));
        assert_eq!(forbidden(br#"{"success":false,"error":"PLAN_RESTRICTED_FEATURE","detail":"x"}"#), Fail::Status(403));
        // A refused key, by name, or a 403 that says nothing more.
        assert_eq!(forbidden(br#"{"error":"bad_token","error_code":8}"#), Fail::Denied);
        assert_eq!(forbidden(br#"{"success":false,"error":"BAD_TOKEN"}"#), Fail::Denied);
        assert_eq!(forbidden(br#"{"success":false,"error":"AUTH_ERROR"}"#), Fail::Denied);
        assert_eq!(forbidden(b""), Fail::Denied);
        assert_eq!(forbidden(b"<html>Forbidden</html>"), Fail::Denied);
    }

    #[test]
    fn empty_bodies_are_null() {
        assert_eq!(json(b""), Ok(Value::Null));
        assert_eq!(json(b"{\"a\":1}").unwrap()["a"], 1);
        assert_eq!(json(b"<html>"), Err(Fail::Invalid));
    }
}
