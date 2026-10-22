//! HTTP for IPTV providers. Unlike addons (https only), IPTV panels are
//! usually plain http, so it's allowed here — the settings page marks such
//! sources "Not secure". Still enforced: http(s) only, a redirect may not
//! move from a public host into this machine or the LAN (so a provider can't
//! point Orbit at local services), size caps on everything, and errors never
//! include the address (it holds the login).

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::{Client, Url, redirect};

// The addon check: one list of what counts as this machine or the LAN.
use crate::addons::net::is_private_host;

const MAX_REDIRECTS: usize = 5;

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    // A name may lead into the LAN only if the person gave it, and no proxy looks it up instead (see guard_lan).
    crate::addons::net::guard_lan(Client::builder())
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .referer(false)
        .redirect(redirect::Policy::custom(|attempt| {
            let allowed = attempt.previous().len() <= MAX_REDIRECTS
                && check_scheme(attempt.url()).is_ok()
                && attempt.previous().last().is_some_and(|from| !is_private_host(attempt.url()) || is_private_host(from));
            if allowed { attempt.follow() } else { attempt.error("redirect not allowed") }
        }))
        .build()
        .ok()
});

pub fn check_scheme(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => Ok(()),
        _ => Err("err.address.scheme".into()),
    }
}

/// A user-typed address (playlist, guide): http(s), at most 4 KB.
pub fn parse_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.len() > 4096 {
        return Err("err.address.too-long".into());
    }
    let url = Url::parse(input).map_err(|_| "err.address.invalid")?;
    check_scheme(&url)?;
    Ok(url)
}

/// Messages without the address, which carries the login.
fn describe(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "err.iptv.timeout".into()
    } else if err.is_redirect() {
        "err.server.redirect".into()
    } else if err.is_connect() {
        "err.iptv.unreachable".into()
    } else {
        "err.iptv.download".into()
    }
}

/// `own`: the address is one the person gave (a panel, a playlist, a guide),
/// so its name may lead into the LAN; one named by a provider's playlist may not.
async fn get(url: Url, own: bool) -> Result<reqwest::Response, String> {
    let client = CLIENT.as_ref().ok_or("HTTP client unavailable")?;
    if own {
        crate::addons::net::trust_host(&url);
    }
    let response = client.get(url).timeout(Duration::from_secs(600)).send().await.map_err(|e| describe(&e))?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("err.iptv.refused".into());
    }
    if !status.is_success() {
        return Err(crate::user_error::coded("iptv.status", &[("status", &status.as_u16().to_string())]));
    }
    Ok(response)
}

/// GETs a small document (Xtream JSON) as text, failing past `limit` bytes.
pub async fn fetch_text(url: Url, own: bool, limit: usize) -> Result<String, String> {
    let mut response = get(url, own).await?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| describe(&e))? {
        if body.len() + chunk.len() > limit {
            return Err("err.iptv.too-large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(text(&body))
}

/// The body as text without a leading byte-order mark, which some panels
/// send and serde_json refuses.
fn text(body: &[u8]) -> String {
    let body = body.strip_prefix("\u{feff}".as_bytes()).unwrap_or(body);
    String::from_utf8_lossy(body).into_owned()
}

/// Saves a large download (playlist, guide) to `path`, failing past `limit` bytes.
pub async fn download(url: Url, own: bool, path: &Path, limit: u64) -> Result<(), String> {
    let mut response = get(url, own).await?;
    if response.content_length().is_some_and(|len| len > limit) {
        return Err("err.iptv.too-large".into());
    }
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut written = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| describe(&e))? {
        written += chunk.len() as u64;
        if written > limit {
            return Err("err.iptv.too-large".into());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The most content allowed between two `separator` bytes (see `Runs`).
const MAX_RUN: usize = 1024 * 1024;

/// Fails the read once more than `MAX_RUN` bytes pass without `separator`
/// (a newline in a playlist, `<` in a guide). The parsers keep a whole line,
/// or a whole run of text, in memory before they can weigh it, so without
/// this one endless line (a few KB once gzipped) could fill the memory.
struct Runs<R> {
    inner: R,
    separator: u8,
    run: usize,
}

impl<R: Read> Read for Runs<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        for &b in &buf[..n] {
            self.run = if b == self.separator { 0 } else { self.run + 1 };
            if self.run > MAX_RUN {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "a line is too long"));
            }
        }
        Ok(n)
    }
}

/// Opens a downloaded file for reading, unzipping it if it's gzip (by its
/// first bytes, not its name), and stopping after `limit` bytes of content so
/// a small compressed file can't expand without end. Fails at a run of more
/// than 1 MB without `separator` (see `Runs`).
pub fn open(path: &Path, limit: u64, separator: u8) -> Result<Box<dyn BufRead + Send>, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 2];
    let gz = file.read_exact(&mut magic).is_ok() && magic == [0x1f, 0x8b];
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    Ok(if gz {
        Box::new(BufReader::new(Runs { inner: flate2::read::MultiGzDecoder::new(BufReader::new(file)).take(limit), separator, run: 0 }))
    } else {
        Box::new(BufReader::new(Runs { inner: file.take(limit), separator, run: 0 }))
    })
}

/// Streams VOD through Rust so mpv cannot follow an unchecked provider redirect.
pub async fn vod_response(url: Url, head: bool, range: Option<&str>) -> Result<reqwest::Response, String> {
    let client = CLIENT.as_ref().ok_or("HTTP client unavailable")?;
    // Always the person's own panel (see vod::resolve), which may be on the LAN.
    crate::addons::net::trust_host(&url);
    let method = if head { reqwest::Method::HEAD } else { reqwest::Method::GET };
    let mut request = client.request(method, url);
    if let Some(range) = range { request = request.header(reqwest::header::RANGE, range); }
    let response = request.send().await.map_err(|e| describe(&e))?;
    if !response.status().is_success() && response.status().as_u16() != 416 { return Err("err.iptv.playback-refused".into()); }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert!(parse_url("http://panel.example:8080/get.php?username=a").is_ok());
        assert!(parse_url("file:///C:/x.m3u").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
        let private = |u: &str| is_private_host(&Url::parse(u).unwrap());
        assert!(private("http://192.168.1.5/") && private("http://localhost:8080/"));
        // Carrier-grade NAT and IPv4-mapped IPv6 can't slip past the redirect rule.
        assert!(private("http://100.64.0.1/") && private("http://[::ffff:127.0.0.1]/") && private("http://[::ffff:192.168.1.5]/"));
        assert!(!private("http://panel.example/") && !private("http://8.8.8.8/"));
    }

    #[test]
    fn text_drops_a_byte_order_mark() {
        assert_eq!(text("\u{feff}[]".as_bytes()), "[]");
        assert_eq!(text(b"[]"), "[]");
        let account = text("\u{feff}{\"user_info\":{\"auth\":1,\"status\":\"Active\"},\"server_info\":{}}".as_bytes());
        assert!(super::super::xtream::check_account(&account).is_ok());
        assert!(super::super::xtream::streams("[]", &text("\u{feff}[]".as_bytes()), 10).is_ok());
    }

    #[test]
    fn opens_gzip_by_content_with_a_cap() {
        let dir = std::env::temp_dir().join(format!("orbit-iptv-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let plain = dir.join("a.xml");
        std::fs::write(&plain, b"hello world").unwrap();
        let mut s = String::new();
        open(&plain, 5, b'\n').unwrap().read_to_string(&mut s).unwrap();
        assert_eq!(s, "hello");
        let gz = dir.join("b.bin");
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&vec![b'x'; 10_000]).unwrap();
        std::fs::write(&gz, enc.finish().unwrap()).unwrap();
        let mut out = Vec::new();
        open(&gz, 1000, b'x').unwrap().read_to_end(&mut out).unwrap();
        assert_eq!(out.len(), 1000);
        // A gzipped endless line (10 MB in about 10 KB) is refused, not read into memory.
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&vec![b'a'; 10 * 1024 * 1024]).unwrap();
        let long = dir.join("c.bin");
        std::fs::write(&long, enc.finish().unwrap()).unwrap();
        assert!(std::fs::metadata(&long).unwrap().len() < 64 * 1024);
        let mut lines = open(&long, u64::MAX, b'\n').unwrap().split(b'\n');
        assert!(lines.next().unwrap().is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
