//! Headers an addon asked for with one of its web streams
//! (`behaviorHints.proxyHeaders.request`: a `Referer`, a `User-Agent`, an
//! `Origin`). The page has filtered them already (src/addons/proxy-headers.ts);
//! they're checked again here because they come from an addon, and they become
//! raw header lines for mpv/ffmpeg. The rules match the page's:
//!
//! - names are HTTP tokens and values visible ASCII (spaces only inside), so
//!   no CR/LF can end a line early and add a header or a second request;
//! - headers that steer the connection or the request (Host, lengths,
//!   encodings, Range, Connection, Upgrade, Proxy-*) belong to mpv and are refused;
//! - Cookie and Authorization are refused: mpv/ffmpeg resend a file's headers
//!   when its server redirects elsewhere (an accepted limit in docs/DEVELOPMENT.md), so a
//!   credential would reach whatever host the redirect names.
//!
//! Anything that fails refuses the whole open: the page never sends such
//! headers, so they only arrive from a bug or a page that isn't Orbit's.
//! Values are never logged or put in an error.

use std::collections::BTreeMap;

const MAX_HEADERS: usize = 16;
const MAX_NAME: usize = 64;
const MAX_VALUE: usize = 1024;
/// All names and values together.
const MAX_BYTES: usize = 4096;

const REFUSED: &[&str] = &[
    "host",
    "content-length",
    "content-encoding",
    "content-type",
    "transfer-encoding",
    "te",
    "trailer",
    "connection",
    "keep-alive",
    "upgrade",
    "expect",
    "range",
    "if-range",
    "accept-encoding",
    "http2-settings",
    "cookie",
    "cookie2",
    "authorization",
];

/// RFC 9110 token character.
fn token_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&c)
}

fn allowed(name: &str, value: &str) -> bool {
    let value_ok = !value.is_empty()
        && value.len() <= MAX_VALUE
        && value.bytes().all(|b| (0x20..=0x7e).contains(&b))
        && !value.starts_with(' ')
        && !value.ends_with(' ');
    let lower = name.to_ascii_lowercase();
    !name.is_empty() && name.len() <= MAX_NAME && name.bytes().all(token_char) && value_ok && !REFUSED.contains(&lower.as_str()) && !lower.starts_with("proxy-")
}

/// `headers` as `Name: value` lines for mpv's `http-header-fields`, or an
/// error if any is refused, repeated (names compare case-insensitively) or
/// past the caps.
pub fn header_lines(headers: &BTreeMap<String, String>) -> Result<Vec<String>, String> {
    let refused = || "err.player.link".to_string();
    if headers.len() > MAX_HEADERS || headers.iter().map(|(n, v)| n.len() + v.len()).sum::<usize>() > MAX_BYTES {
        return Err(refused());
    }
    let mut seen = Vec::with_capacity(headers.len());
    let mut lines = Vec::with_capacity(headers.len());
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if !allowed(name, value) || seen.contains(&lower) {
            return Err(refused());
        }
        seen.push(lower);
        lines.push(format!("{name}: {value}"));
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect()
    }

    #[test]
    fn plain_headers_become_lines() {
        let lines = header_lines(&map(&[("Referer", "https://site.example/watch?v=1"), ("User-Agent", "Mozilla/5.0 (X11; Linux x86_64)"), ("Origin", "https://site.example")])).unwrap();
        assert_eq!(lines, ["Origin: https://site.example", "Referer: https://site.example/watch?v=1", "User-Agent: Mozilla/5.0 (X11; Linux x86_64)"]);
        assert_eq!(header_lines(&BTreeMap::new()).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn control_characters_are_refused() {
        for value in ["a\r\nHost: evil", "a\nb", "a\rb", "a\0b", "a\tb", "a\u{7f}", "caf\u{e9}", " padded", "padded ", ""] {
            assert!(header_lines(&map(&[("Referer", value)])).is_err(), "{value:?}");
        }
        for name in ["Bad Name", "Bad:Name", "X\r\nY", "", "Ünicode", "a(b)", "a/b"] {
            assert!(header_lines(&map(&[(name, "x")])).is_err(), "{name:?}");
        }
    }

    #[test]
    fn connection_and_credential_headers_are_refused() {
        for name in ["Host", "content-length", "Transfer-Encoding", "Connection", "keep-alive", "Upgrade", "TE", "Range", "Expect", "Proxy-Authorization", "proxy-connection", "Cookie", "Authorization", "Accept-Encoding"] {
            assert!(header_lines(&map(&[(name, "x")])).is_err(), "{name}");
        }
        assert!(header_lines(&map(&[("X-Custom", "1"), ("Accept-Language", "en")])).is_ok());
    }

    #[test]
    fn repeats_and_caps_are_refused() {
        assert!(header_lines(&map(&[("Referer", "a"), ("referer", "b")])).is_err());
        let many: BTreeMap<String, String> = (0..=MAX_HEADERS).map(|i| (format!("X-H{i}"), "v".to_string())).collect();
        assert!(header_lines(&many).is_err());
        let enough: BTreeMap<String, String> = (0..MAX_HEADERS).map(|i| (format!("X-H{i}"), "v".to_string())).collect();
        assert!(header_lines(&enough).is_ok());
        assert!(header_lines(&map(&[(&"X".repeat(MAX_NAME + 1), "v")])).is_err());
        assert!(header_lines(&map(&[("X", &"v".repeat(MAX_VALUE + 1))])).is_err());
        assert!(header_lines(&map(&[("X", &"v".repeat(MAX_VALUE))])).is_ok());
        let big: BTreeMap<String, String> = (0..5).map(|i| (format!("X-H{i}"), "v".repeat(MAX_VALUE - 10))).collect();
        assert!(header_lines(&big).is_err());
    }
}
