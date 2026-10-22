//! HTTP for addon traffic.
//!
//! Addon requests run here rather than through the WebView's `fetch`, so the
//! scheme policy, size caps and timeouts are enforced in one place, and the
//! WebView's CSP can forbid network access outright.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use reqwest::{Client, Url, redirect};

use super::AddonError;

const RESOURCES: [&str; 5] = ["catalog", "meta", "stream", "subtitles", "addon_catalog"];
const MAX_REDIRECTS: usize = 3;

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    // The redirect rule reads only the address's text; a name that resolves
    // into the LAN is caught by `guard_lan`, unless it's an addon the person installed.
    guard_lan(Client::builder())
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(5))
        .referer(false)
        .redirect(redirect::Policy::custom(|attempt| {
            let allowed = attempt.previous().len() <= MAX_REDIRECTS
                && attempt.previous().last().is_some_and(|from| redirect_allowed(from, attempt.url()));
            if allowed { attempt.follow() } else { attempt.error("redirect not allowed") }
        }))
        .build()
        .ok()
});

fn is_private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || a == 0 // "this network", 0.0.0.0/8 (0.0.0.0 itself reaches this machine)
        || (a == 100 && (b & 0xc0) == 64) // carrier-grade NAT, 100.64.0.0/10
        || (a == 198 && (b & 0xfe) == 18) // benchmarking, 198.18.0.0/15
}

/// Whether `ip` is this machine or a private network: loopback, LAN and
/// unique-local ranges, link-local, unspecified, carrier-grade NAT, and IPv6
/// forms that carry one of those IPv4 addresses (mapped, compatible, NAT64, 6to4).
pub(crate) fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_private_v4(ip),
        IpAddr::V6(ip) => {
            let s = ip.segments();
            let embedded = |hi: u16, lo: u16| is_private_v4(Ipv4Addr::from((u32::from(hi) << 16) | u32::from(lo)));
            ip.is_loopback()
                || ip.is_unspecified()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link-local
                || ip.to_ipv4().is_some_and(is_private_v4) // ::ffff:a.b.c.d and ::a.b.c.d
                || (s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] && embedded(s[6], s[7])) // NAT64, 64:ff9b::/96
                || (s[0] == 0x2002 && embedded(s[1], s[2])) // 6to4, 2002::/16
        }
    }
}

/// Whether `url` points at this machine or a private network (`is_private_ip`),
/// or is `localhost` (with or without a trailing dot). Only the text is read:
/// a name that resolves into the LAN is caught when it's looked up (`GuardedDns`).
/// (IPTV and the media servers use it too.)
pub(crate) fn is_private_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return true };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        Ok(ip) => is_private_ip(ip),
        Err(_) => {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            host == "localhost" || host.ends_with(".localhost")
        }
    }
}

/// Host names the person gave Orbit themselves (an addon, an IPTV panel or
/// playlist, a guide, a media server): those may be on this machine or the LAN.
static OWN_HOSTS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);

fn host_key(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

/// Marks `url`'s host as one the person chose (see `GuardedDns`).
pub(crate) fn trust_host(url: &Url) {
    if let (Some(host), Ok(mut own)) = (url.host_str(), OWN_HOSTS.lock()) {
        own.insert(host_key(host));
    }
}

/// For the clients that allow the LAN (addons, IPTV, media servers,
/// downloads, subtitle sync): names are looked up with `GuardedDns`, and no
/// proxy is used. Through a proxy (`HTTPS_PROXY`, or the system's), the proxy
/// looks the name up instead, so `GuardedDns` would only ever see the proxy's
/// own name: `192-168-1-1.nip.io` would reach the proxy's network (often this
/// machine or the LAN) unchecked, and a proxy on the LAN would be refused
/// itself. Going direct keeps the address checked the one connected to.
pub(crate) fn guard_lan(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder.no_proxy().dns_resolver(GuardedDns)
}

/// DNS for the clients that allow the LAN (addons, IPTV, media servers).
/// The redirect rule reads only the address's text, so on its own a
/// public provider could still reach the LAN through a name that resolves
/// there (`192-168-1-1.nip.io`, or DNS rebinding). Here, the lookup that the
/// connection then uses is checked: a name that resolves into this machine or
/// the LAN is refused unless the person gave that name themselves.
pub(crate) struct GuardedDns;

impl reqwest::dns::Resolve for GuardedDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = host_key(name.as_str());
        Box::pin(async move {
            let addrs = lookup(&host).await?;
            let own = OWN_HOSTS.lock().is_ok_and(|own| own.contains(&host));
            if !own && addrs.iter().any(|a| is_private_ip(a.ip())) {
                return Err("that name leads into the local network".into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Whether `url` is this machine or the LAN: by its text, or by what its name
/// resolves to now. Only a DNS lookup; nothing is sent to the address itself.
/// (A name that fails to resolve can't be fetched either, so it counts as not.)
pub(crate) async fn leads_into_lan(url: &Url) -> bool {
    if is_private_host(url) {
        return true;
    }
    let Some(host) = url.host_str() else { return true };
    lookup(&host_key(host)).await.is_ok_and(|addrs| addrs.iter().any(|a| is_private_ip(a.ip())))
}

async fn lookup(host: &str) -> std::io::Result<Vec<SocketAddr>> {
    // Tests need a name that leads into the LAN without any network, and that no other test trusts.
    #[cfg(test)]
    if host == tests::LAN_NAME {
        return Ok(vec![SocketAddr::from(([127, 0, 0, 1], 0))]);
    }
    Ok(tokio::net::lookup_host((host, 0)).await?.collect())
}

/// Redirect policy. Addons may redirect across hosts (Cinemeta's catalogs
/// live on another subdomain), but the target must pass the same scheme rules
/// as any addon URL, and a redirect may never cross from a public host into
/// this machine or the LAN: otherwise a remote addon could make Orbit send
/// requests to local services the user never pointed it at (SSRF). Addons
/// that are themselves local or on the LAN keep working.
/// An address written as a private IP (`https://192.168.1.1/`,
/// `http://127.0.0.1:8080/`) is connected to without a lookup, so
/// `GuardedDns` never sees it. It's refused (`Blocked { reason: "local" }`)
/// unless the person gave that host, as a name leading there would be:
/// addons hand Orbit addresses (subtitles, posters) that must not reach a
/// router or a local service.
fn check_reachable(url: &Url) -> Result<(), AddonError> {
    let Some(host) = url.host_str() else { return Ok(()) };
    let Ok(ip) = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() else { return Ok(()) };
    let own = || OWN_HOSTS.lock().is_ok_and(|own| own.contains(&host_key(host)));
    if is_private_ip(ip) && !own() { Err(AddonError::Blocked { reason: "local" }) } else { Ok(()) }
}

pub(crate) fn redirect_allowed(from: &Url, to: &Url) -> bool {
    check_origin(to).is_ok() && (!is_private_host(to) || is_private_host(from))
}

/// `https` anywhere, plain `http` only for 127.0.0.1. Not `localhost`: a
/// hosts-file entry could point that name somewhere else.
pub(crate) fn check_origin(url: &Url) -> Result<(), AddonError> {
    let allowed = match url.scheme() {
        "https" => true,
        "http" => url.host_str() == Some("127.0.0.1"),
        _ => false,
    };
    if allowed { Ok(()) } else { Err(AddonError::Blocked { reason: "scheme" }) }
}

/// Parses user input into a canonical transport URL ending in `/manifest.json`.
pub fn parse_transport_url(input: &str) -> Result<Url, AddonError> {
    let invalid = |reason| AddonError::InvalidUrl { reason };
    let input = input.trim();
    // `stremio://` is the protocol's install-link scheme and means https.
    // Schemes are case-insensitive, as the page and deep links already read them.
    let input = match input.get(..10).filter(|scheme| scheme.eq_ignore_ascii_case("stremio://")) {
        Some(_) => format!("https://{}", &input[10..]),
        None => input.to_string(),
    };

    let mut url = Url::parse(&input).map_err(|_| invalid("not-url"))?;
    check_origin(&url)?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("credentials"));
    }
    if url.query().is_some() {
        return Err(invalid("query"));
    }
    if !url.path().ends_with("/manifest.json") {
        return Err(invalid("manifest-path"));
    }
    url.set_fragment(None);
    Ok(url)
}

/// Builds the URL for a resource path (`/{resource}/{type}/{id}[/{extra}].json`)
/// under the addon's base. The path comes from the WebView, so it's limited to
/// URL-encoded segments that can't climb out of the base path.
pub fn resource_url(transport: &Url, path: &str) -> Result<Url, AddonError> {
    let bad = || AddonError::InvalidUrl { reason: "resource-path" };
    let rest = path.strip_prefix('/').and_then(|p| p.strip_suffix(".json")).ok_or_else(bad)?;
    if !rest.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.!~*'()%=&/".contains(&b)) {
        return Err(bad());
    }
    let segments: Vec<&str> = rest.split('/').collect();
    let well_formed = matches!(segments.len(), 3 | 4)
        // `%2e%2e` counts: the URL parser reads it as `..`.
        && segments.iter().all(|s| !s.is_empty() && !matches!(s.to_ascii_lowercase().replace("%2e", ".").as_str(), "." | ".."))
        && RESOURCES.contains(&segments[0]);
    if !well_formed {
        return Err(bad());
    }

    let base = transport.as_str().strip_suffix("/manifest.json").ok_or_else(bad)?;
    Url::parse(&format!("{base}{path}")).map_err(|_| bad())
}

/// Artwork (posters, backdrops) comes from addon metadata, so it's held to
/// the addon rules plus one more: https only and never this machine or the
/// LAN, since there's no legitimate reason for public artwork to live there.
pub fn check_artwork_url(url: &Url) -> Result<(), AddonError> {
    if url.scheme() != "https" || is_private_host(url) {
        return Err(AddonError::Blocked { reason: "scheme" });
    }
    Ok(())
}

/// GETs `url` and returns the body and its content type, failing once the
/// body exceeds `limit` bytes. The body is read incrementally, so an oversized
/// response is cut off instead of being buffered in full first.
pub async fn fetch_bytes(url: Url, limit: usize, timeout: Duration) -> Result<(Vec<u8>, Option<String>), AddonError> {
    fetch(url, None, None, limit, timeout).await
}

/// Like `fetch_text`, sending `token` as a bearer token. Secrets go in a
/// header, never the URL, which can end up in logs and error messages.
pub async fn fetch_text_authorized(url: Url, token: &str, limit: usize, timeout: Duration) -> Result<String, AddonError> {
    let (body, _) = fetch(url, Some(token), None, limit, timeout).await?;
    String::from_utf8(body).map_err(|_| AddonError::InvalidResponse { issues: vec!["response is not UTF-8".into()] })
}

/// Like `fetch_text`, naming Orbit as `user_agent` instead: some public
/// services (Wikidata) ask clients to describe themselves.
pub async fn fetch_text_as(url: Url, user_agent: &'static str, limit: usize, timeout: Duration) -> Result<String, AddonError> {
    let (body, _) = fetch(url, None, Some(user_agent), limit, timeout).await?;
    String::from_utf8(body).map_err(|_| AddonError::InvalidResponse { issues: vec!["response is not UTF-8".into()] })
}

async fn fetch(url: Url, token: Option<&str>, user_agent: Option<&'static str>, limit: usize, timeout: Duration) -> Result<(Vec<u8>, Option<String>), AddonError> {
    check_origin(&url)?;
    check_reachable(&url)?;
    let client = CLIENT.as_ref().ok_or(AddonError::Network { message: "HTTP client unavailable".into() })?;
    let mut request = client.get(url).timeout(timeout);
    if let Some(agent) = user_agent {
        request = request.header(reqwest::header::USER_AGENT, agent);
    }
    if let Some(token) = token {
        let mut value = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| AddonError::InvalidUrl { reason: "token" })?;
        value.set_sensitive(true);
        request = request.header(reqwest::header::AUTHORIZATION, value);
    }
    let mut response = request.send().await.map_err(network)?;

    let status = response.status();
    if token.is_some() && status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after_secs = response.headers().get(reqwest::header::RETRY_AFTER).and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse().ok());
        return Err(AddonError::RateLimited { retry_after_secs });
    }
    if !status.is_success() {
        return Err(AddonError::Http { status: status.as_u16() });
    }
    let too_large = AddonError::TooLarge { limit_bytes: limit };
    if response.content_length().is_some_and(|len| len > limit as u64) {
        return Err(too_large);
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_ascii_lowercase);
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if body.len() + chunk.len() > limit {
            return Err(too_large);
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, content_type))
}

/// Like `fetch_bytes`, for text (addon JSON).
pub async fn fetch_text(url: Url, limit: usize, timeout: Duration) -> Result<String, AddonError> {
    let (body, _) = fetch_bytes(url, limit, timeout).await?;
    String::from_utf8(body).map_err(|_| AddonError::InvalidResponse { issues: vec!["response is not UTF-8".into()] })
}

/// reqwest errors include the request URL, which for configured addons holds
/// credentials, so it's stripped before the error can reach the UI or a log.
fn network(err: reqwest::Error) -> AddonError {
    if err.is_timeout() {
        AddonError::Timeout
    } else if err.is_redirect() {
        AddonError::Blocked { reason: "redirect" }
    } else {
        AddonError::Network { message: err.without_url().to_string() }
    }
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    if let Ok(url) = parse_transport_url(&text) {
        assert!(check_origin(&url).is_ok());
        let _ = resource_url(&url, &text);
    }
    let base = Url::parse("https://example.com/addon/manifest.json").unwrap();
    if let Ok(url) = resource_url(&base, &text) {
        assert_eq!(url.origin(), base.origin());
    }
    if let Ok(url) = Url::parse(&text) {
        if is_private_host(&url) {
            assert!(!redirect_allowed(&base, &url));
        }
        let _ = check_artwork_url(&url);
    }
    if data.len() >= 4 {
        let ip = Ipv4Addr::new(data[0], data[1], data[2], data[3]);
        let v4 = Url::parse(&format!("https://{ip}/")).unwrap();
        let mapped = Url::parse(&format!("https://[::ffff:{ip}]/")).unwrap();
        assert_eq!(is_private_host(&v4), is_private_host(&mapped));
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn transport_url_policy() {
        let ok = |s: &str| parse_transport_url(s).map(|u| u.to_string());
        assert_eq!(ok("  https://a.example/cfg/manifest.json#x ").unwrap(), "https://a.example/cfg/manifest.json");
        assert_eq!(ok("stremio://a.example/manifest.json").unwrap(), "https://a.example/manifest.json");
        assert_eq!(ok("Stremio://a.example/manifest.json").unwrap(), "https://a.example/manifest.json");
        assert!(ok("http://127.0.0.1:7000/manifest.json").is_ok());

        assert!(ok("http://a.example/manifest.json").is_err());
        assert!(ok("http://localhost:7000/manifest.json").is_err());
        assert!(ok("file:///C:/manifest.json").is_err());
        assert!(ok("https://u:p@a.example/manifest.json").is_err());
        assert!(ok("https://a.example/manifest.json?x=1").is_err());
        assert!(ok("https://a.example/other.json").is_err());

        // Each refusal is a code the page words in the person's language, never English text of its own.
        let reason = |s: &str| match parse_transport_url(s) {
            Err(AddonError::InvalidUrl { reason }) => reason,
            other => panic!("{s}: {other:?}"),
        };
        assert_eq!(reason("not a url"), "not-url");
        assert_eq!(reason("https://u:p@a.example/manifest.json"), "credentials");
        assert_eq!(reason("https://a.example/manifest.json?x=1"), "query");
        assert_eq!(reason("https://a.example/other.json"), "manifest-path");
        let base = parse_transport_url("https://a.example/manifest.json").unwrap();
        assert!(matches!(resource_url(&base, "/admin/movie/top.json"), Err(AddonError::InvalidUrl { reason: "resource-path" })));
    }

    #[test]
    fn resource_path_policy() {
        let base = parse_transport_url("https://a.example/cfg/manifest.json").unwrap();
        let url = |p: &str| resource_url(&base, p).map(|u| u.to_string());

        assert_eq!(url("/catalog/movie/top.json").unwrap(), "https://a.example/cfg/catalog/movie/top.json");
        assert_eq!(
            url("/catalog/movie/top/search=a%20b&skip=100.json").unwrap(),
            "https://a.example/cfg/catalog/movie/top/search=a%20b&skip=100.json"
        );
        assert!(url("/stream/series/tt1%3A1%3A2.json").is_ok());

        assert!(url("/../x/y/z.json").is_err());
        assert!(url("/catalog/../../x.json").is_err());
        for climbing in ["/catalog/movie/%2e%2e.json", "/catalog/%2E%2e/x.json", "/catalog/movie/.%2e/x.json", "/catalog/movie/%2e.json"] {
            assert!(url(climbing).is_err(), "{climbing}");
        }
        assert!(url("/catalog/movie/top").is_err());
        assert!(url("/admin/movie/top.json").is_err());
        assert!(url("/catalog/movie/a b.json").is_err());
        assert!(url("/catalog/movie/a?x=1.json").is_err());
        assert!(url("//evil.example/catalog/movie/top.json").is_err());
        assert!(url("/catalog/movie/a/b/c.json").is_err());
    }

    /// Serves canned raw HTTP responses on 127.0.0.1, one per connection, chosen by path.
    fn serve(respond: fn(&str, u16) -> Vec<u8>) -> u16 {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    line.clear();
                }
                let path = request_line.split(' ').nth(1).unwrap_or("/").to_string();
                let _ = (&stream).write_all(&respond(&path, port));
            }
        });
        port
    }

    fn fetch(port: u16, path: &str, limit: usize) -> Result<String, AddonError> {
        let url = Url::parse(&format!("http://127.0.0.1:{port}{path}")).unwrap();
        // As a local addon's address is, once installed.
        trust_host(&url);
        tauri::async_runtime::block_on(fetch_text(url, limit, Duration::from_secs(5)))
    }

    fn response(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!("HTTP/1.1 {status}\r\nConnection: close\r\n{headers}\r\n").into_bytes();
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn enforces_size_cap_with_and_without_content_length() {
        let port = serve(|path, _| {
            let body = vec![b'x'; 100];
            match path {
                "/declared" => response("200 OK", "Content-Length: 100\r\n", &body),
                // No Content-Length: the cap must still apply while streaming.
                _ => response("200 OK", "", &body),
            }
        });
        assert!(matches!(fetch(port, "/declared", 99), Err(AddonError::TooLarge { .. })));
        assert!(matches!(fetch(port, "/streamed", 99), Err(AddonError::TooLarge { .. })));
        assert_eq!(fetch(port, "/declared", 100).unwrap().len(), 100);
    }

    #[test]
    fn follows_redirects_up_to_the_hop_limit() {
        let port = serve(|path, _| {
            let hop = |to: &str| response("302 Found", &format!("Location: {to}\r\nContent-Length: 0\r\n"), b"");
            match path {
                "/one" => hop("/ok"),
                "/chain1" => hop("/chain2"),
                "/chain2" => hop("/chain3"),
                "/chain3" => hop("/chain4"),
                "/chain4" => hop("/ok"),
                "/ok" => response("200 OK", "Content-Length: 2\r\n", b"ok"),
                _ => response("404 Not Found", "Content-Length: 0\r\n", b""),
            }
        });
        assert_eq!(fetch(port, "/one", 1024).unwrap(), "ok");
        assert!(matches!(fetch(port, "/chain1", 1024), Err(AddonError::Blocked { reason: "redirect" })));
        assert!(matches!(fetch(port, "/missing", 1024), Err(AddonError::Http { status: 404 })));
    }

    #[test]
    fn tells_an_authorized_rate_limit_apart() {
        let port = serve(|path, _| match path {
            "/wait" => response("429 Too Many Requests", "Retry-After: 2\r\nContent-Length: 0\r\n", b""),
            _ => response("429 Too Many Requests", "Content-Length: 0\r\n", b""),
        });
        let authorized = |path: &str| {
            let url = Url::parse(&format!("http://127.0.0.1:{port}{path}")).unwrap();
            tauri::async_runtime::block_on(fetch_text_authorized(url, "token", 1024, Duration::from_secs(5)))
        };
        assert!(matches!(authorized("/wait"), Err(AddonError::RateLimited { retry_after_secs: Some(2) })));
        assert!(matches!(authorized("/plain"), Err(AddonError::RateLimited { retry_after_secs: None })));
        // An addon's 429 stays an HTTP status, as the page expects.
        assert!(matches!(fetch(port, "/wait", 1024), Err(AddonError::Http { status: 429 })));
    }

    #[test]
    fn redirect_policy() {
        let u = |s: &str| Url::parse(s).unwrap();
        // Across public hosts (Cinemeta's catalogs live on another subdomain).
        assert!(redirect_allowed(&u("https://v3-cinemeta.strem.io/a"), &u("https://cinemeta-catalogs.strem.io/b")));
        // Never from a public host into this machine or the LAN.
        for target in [
            "http://127.0.0.1:11470/x",
            "https://127.0.0.1/x",
            "https://192.168.1.1/admin",
            "https://10.0.0.5/x",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/x",
            "https://[fd00::1]/x",
            "https://localhost/x",
            "https://printer.localhost/x",
            "https://localhost./x",
            "https://0.0.0.0/x",
            "https://0.1.2.3/x",
            "https://198.18.0.1/x",
            "https://2130706433/x",
            "https://0x7f.1/x",
            "https://[::ffff:7f00:1]/x",
            "https://[::127.0.0.1]/x",
            "https://[64:ff9b::c0a8:101]/x",
            "https://[2002:c0a8:101::1]/x",
            "https://[fe80::1]/x",
        ] {
            assert!(!redirect_allowed(&u("https://addon.example.com/a"), &u(target)), "{target}");
        }
        // Never to plain http elsewhere.
        assert!(!redirect_allowed(&u("https://addon.example.com/a"), &u("http://other.example.com/b")));
        // Local and LAN addons can still redirect within those networks.
        assert!(redirect_allowed(&u("http://127.0.0.1:7000/a"), &u("http://127.0.0.1:7001/b")));
        assert!(redirect_allowed(&u("https://192.168.1.10/a"), &u("https://192.168.1.11/b")));
    }

    #[test]
    fn private_addresses_written_as_numbers_are_refused_unless_given() {
        // An address that is an IP never reaches `GuardedDns`: an addon's subtitle or
        // poster at `https://192.168.1.1/` or `https://127.0.0.2:8080/` must still be refused.
        let get = |url: &str| tauri::async_runtime::block_on(fetch_bytes(Url::parse(url).unwrap(), 1024, Duration::from_secs(5)));
        for url in ["https://10.255.255.1/sub.srt", "https://127.0.0.2:1/sub.srt", "https://[fd00::1]/a.jpg", "https://[::ffff:192.168.1.1]/a.jpg"] {
            assert!(matches!(get(url), Err(AddonError::Blocked { reason: "local" })), "{url}");
        }
        // One the person gave (a LAN addon, say) is reached.
        trust_host(&Url::parse("https://127.0.0.3:1/manifest.json").unwrap());
        assert!(matches!(get("https://127.0.0.3:1/sub.srt"), Err(AddonError::Network { .. })));
    }

    #[test]
    fn plain_http_is_only_for_this_machines_numeric_loopback() {
        let origin = |s: &str| check_origin(&Url::parse(s).unwrap()).is_ok();
        assert!(origin("https://a.example/x") && origin("http://127.0.0.1:7000/x"));
        // Not another loopback address or name: a hosts file can point names anywhere.
        for refused in ["http://127.0.0.2/x", "http://localhost/x", "http://[::1]/x", "http://a.example/x", "ftp://a.example/x", "ws://127.0.0.1/x", "wss://a.example/x", "data:text/plain,hi"] {
            assert!(!origin(refused), "{refused}");
        }
    }

    #[test]
    fn artwork_is_public_https_only() {
        let art = |s: &str| check_artwork_url(&Url::parse(s).unwrap()).is_ok();
        assert!(art("https://image.tmdb.org/t/p/w500/x.jpg"));
        // Even the local addon exception doesn't stretch to artwork.
        for refused in ["http://127.0.0.1:7000/poster.jpg", "https://127.0.0.1/poster.jpg", "https://192.168.0.2/p.jpg", "https://[fe80::1]/p.jpg", "https://media.localhost/p.jpg", "http://image.tmdb.org/x.jpg", "file:///etc/passwd"] {
            assert!(!art(refused), "{refused}");
        }
    }

    #[test]
    fn private_ranges_end_where_they_should() {
        let private = |s: &str| is_private_ip(s.parse().unwrap());
        for inside in ["10.0.0.0", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.0", "100.64.0.0", "100.127.255.255", "198.18.0.0", "198.19.255.255", "169.254.0.1", "255.255.255.255", "0.0.0.0", "::", "fc00::1", "fdff::1", "febf::1"] {
            assert!(private(inside), "{inside}");
        }
        for outside in ["9.255.255.255", "11.0.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0", "100.63.255.255", "100.128.0.0", "198.17.255.255", "198.20.0.0", "fbff::1", "2001:4860::8888"] {
            assert!(!private(outside), "{outside}");
        }
    }

    #[test]
    fn resource_urls_stay_under_the_addons_own_path() {
        let base = parse_transport_url("https://a.example:8443/u/cfg%2Fx/manifest.json").unwrap();
        let url = resource_url(&base, "/meta/series/tt1.json").unwrap();
        assert_eq!(url.as_str(), "https://a.example:8443/u/cfg%2Fx/meta/series/tt1.json");
        assert_eq!(url.origin(), base.origin());
        for resource in ["subtitles", "addon_catalog", "stream"] {
            assert!(resource_url(&base, &format!("/{resource}/movie/tt1.json")).is_ok(), "{resource}");
        }
        // Only a canonical transport (ending in /manifest.json) is a base.
        let odd = Url::parse("https://a.example/u/").unwrap();
        assert!(resource_url(&odd, "/meta/series/tt1.json").is_err());
        // Backslashes, `@` and `:` could change the host or path the parser reads.
        for sneaky in ["/meta/series/a\\b.json", "/meta/series/a@b.json", "/meta/series/a:b.json", "/meta/series/tt1.JSON", "meta/series/tt1.json", "/meta//tt1.json"] {
            assert!(resource_url(&base, sneaky).is_err(), "{sneaky}");
        }
    }

    #[test]
    fn redirects_may_leave_the_lan_but_never_for_plain_http_or_other_schemes() {
        let u = |s: &str| Url::parse(s).unwrap();
        // A local addon can send Orbit out to a public https host.
        assert!(redirect_allowed(&u("http://127.0.0.1:7000/a"), &u("https://cdn.example/b")));
        for refused in ["http://cdn.example/b", "file:///etc/passwd", "ftp://cdn.example/b"] {
            assert!(!redirect_allowed(&u("http://127.0.0.1:7000/a"), &u(refused)), "{refused}");
        }
    }

    #[test]
    fn public_addresses_stay_public() {
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "64:ff9b::808:808", "2002:808:808::1"] {
            assert!(!is_private_ip(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn names_that_lead_into_the_lan_are_refused_unless_given() {
        use reqwest::dns::Resolve;
        let lookup = |host: &'static str| tauri::async_runtime::block_on(GuardedDns.resolve(host.parse().unwrap()));
        // `localhost` resolves to this machine without any network.
        assert!(lookup("localhost").is_err());
        trust_host(&Url::parse("http://LOCALHOST.:8096/").unwrap());
        assert!(lookup("localhost").is_ok());
    }

    pub(crate) const LAN_NAME: &str = "lan-addon.test";

    #[test]
    fn addon_requests_refuse_names_that_lead_into_the_lan() {
        // A public addon's redirect to a name that resolves into the LAN (`192-168-1-1.nip.io`) passes the text check.
        let url = Url::parse(&format!("https://{LAN_NAME}:1/manifest.json")).unwrap();
        let client = CLIENT.as_ref().unwrap();
        let err = tauri::async_runtime::block_on(client.get(url).send()).unwrap_err();
        let mut causes = std::iter::successors(Some(&err as &dyn std::error::Error), |e| e.source());
        assert!(causes.any(|e| e.to_string().contains("leads into the local network")), "{err:?}");
    }

    #[test]
    fn names_that_lead_into_the_lan_are_refused_with_a_proxy_set() {
        // As with `HTTPS_PROXY` set: through the proxy, the name would be looked up there, unchecked.
        let proxy = reqwest::Proxy::all("http://127.0.0.1:9").unwrap();
        let client = guard_lan(Client::builder().proxy(proxy)).build().unwrap();
        let url = Url::parse(&format!("https://{LAN_NAME}:1/manifest.json")).unwrap();
        let err = tauri::async_runtime::block_on(client.get(url).send()).unwrap_err();
        let mut causes = std::iter::successors(Some(&err as &dyn std::error::Error), |e| e.source());
        assert!(causes.any(|e| e.to_string().contains("leads into the local network")), "{err:?}");
    }

    #[test]
    fn knows_addresses_that_lead_into_the_lan_before_any_request() {
        let leads = |url: &str| tauri::async_runtime::block_on(leads_into_lan(&Url::parse(url).unwrap()));
        for url in ["https://192.168.1.5/manifest.json", "https://localhost/manifest.json", "https://[::1]/manifest.json", &format!("https://{LAN_NAME}/manifest.json")] {
            assert!(leads(url), "{url}");
        }
        assert!(!leads("https://93.184.215.14/manifest.json"));
        // Asking doesn't make the name one the person gave.
        assert!(!OWN_HOSTS.lock().unwrap().contains(LAN_NAME));
    }

    #[test]
    fn network_errors_do_not_leak_the_url() {
        let url = Url::parse("http://127.0.0.1:1/secret-token/manifest.json").unwrap();
        trust_host(&url);
        let err = tauri::async_runtime::block_on(fetch_text(url, 1024, Duration::from_secs(5))).unwrap_err();
        let AddonError::Network { message } = err else { panic!("expected a network error, got {err:?}") };
        assert!(!message.contains("secret-token"), "{message}");
    }
}
