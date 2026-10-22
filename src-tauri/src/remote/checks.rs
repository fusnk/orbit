//! Checks on every request to the phone remote's server, and the choice of
//! where it listens.
//!
//! The remote speaks plain HTTP: a home network has no certificate a phone
//! would trust, so TLS isn't possible without a warning page people learn to
//! click through. The network is therefore treated as untrusted beyond
//! pairing: what crosses it is only commands from a fixed list and what's on
//! screen (never an addon address, a link or a token of Orbit's), and these
//! checks keep other pages and other hosts from using a paired phone's session.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};

/// The cookie a paired phone keeps its session in.
pub const COOKIE: &str = "orbit_remote";
/// A session token: 32 random bytes, as hex.
pub const TOKEN_HEX: usize = 64;

/// The address to listen on: the private (RFC 1918) address this PC uses for
/// its home network. `primary` is the one the default route goes out of; if it
/// isn't private (a VPN, a public address), the best private one found among
/// `all`. Never a public, loopback, link-local or carrier-grade NAT address,
/// and never 0.0.0.0, which would listen on every adapter, public ones included.
pub fn pick_lan(primary: Option<IpAddr>, all: &[Ipv4Addr]) -> Option<Ipv4Addr> {
    if let Some(IpAddr::V4(ip)) = primary
        && ip.is_private()
    {
        return Some(ip);
    }
    // Home routers mostly hand out 192.168.x.x; 172.16/12 is often a virtual adapter's (Hyper-V, WSL, Docker).
    let rank = |ip: &Ipv4Addr| match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        _ => 2,
    };
    all.iter().copied().filter(Ipv4Addr::is_private).min_by_key(rank)
}

/// Only the remote's own address may be named in `Host`. A page elsewhere can
/// point a name it controls at this PC (DNS rebinding) to get around the
/// browser's same-origin rule; its requests then carry that name, not this
/// address, and are refused.
pub fn host_ok(host: Option<&str>, expected: &str) -> bool {
    host.is_some_and(|h| h.eq_ignore_ascii_case(expected))
}

/// Requests from another site are refused. Browsers name the page a request
/// comes from in `Origin` on every POST (and on cross-origin requests of any
/// kind), so a POST must carry exactly the remote's own origin, and any other
/// request that names one must name it too. With the session cookie set to
/// `SameSite=Strict`, no other site can make a paired phone act.
pub fn origin_ok(origin: Option<&str>, expected: &str, changes_something: bool) -> bool {
    match origin {
        Some(o) => o == expected,
        None => !changes_something,
    }
}

/// The session token from the request's cookies, if it has the right shape.
pub fn session_cookie<'a>(headers: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    headers
        .flat_map(|h| h.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE)
        .map(|(_, value)| value)
        .filter(|v| v.len() == TOKEN_HEX && v.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// The cookie that keeps a phone paired. `HttpOnly`: the page's own script
/// never sees it. `SameSite=Strict`: it's sent only with the remote's own
/// requests. No `Secure`, which would stop it working over plain HTTP.
pub fn session_cookie_header(token: &str, max_age_secs: u64) -> String {
    format!("{COOKIE}={token}; Path=/; Max-Age={max_age_secs}; HttpOnly; SameSite=Strict")
}

/// Removes the cookie (the phone's own "Disconnect").
pub fn cleared_cookie_header() -> String {
    format!("{COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict")
}

/// Whether a connection may be served: from this PC's network only. A public
/// address would mean the port was forwarded from the internet.
pub fn peer_allowed(ip: IpAddr) -> bool {
    crate::addons::net::is_private_ip(ip)
}

/// Connections open at once from each address. The servers' overall caps keep
/// many connections from wearing Orbit down; this keeps one device on the
/// network from taking all of them (opening connections again as fast as the
/// header timeout closes them) and locking out the phones or Orbits that are paired.
#[derive(Clone)]
pub struct PeerSlots {
    open: Arc<Mutex<HashMap<IpAddr, usize>>>,
    max: usize,
}

/// One connection's place in `PeerSlots`, given back when it's dropped.
pub struct PeerSlot {
    open: Arc<Mutex<HashMap<IpAddr, usize>>>,
    ip: IpAddr,
}

impl PeerSlots {
    pub fn new(max: usize) -> Self {
        Self { open: Arc::default(), max }
    }

    /// A place for another connection from `ip`, if it has fewer than the most open.
    pub fn take(&self, ip: IpAddr) -> Option<PeerSlot> {
        let mut open = self.open.lock().ok()?;
        let count = open.entry(ip).or_default();
        if *count >= self.max {
            return None;
        }
        *count += 1;
        Some(PeerSlot { open: self.open.clone(), ip })
    }
}

impl Drop for PeerSlot {
    fn drop(&mut self) {
        if let Ok(mut open) = self.open.lock()
            && let Some(count) = open.get_mut(&self.ip)
        {
            *count -= 1;
            if *count == 0 {
                open.remove(&self.ip);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v4(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }

    #[test]
    fn listens_on_the_home_network_only() {
        assert_eq!(pick_lan(Some(IpAddr::V4(v4("192.168.1.20"))), &[]), Some(v4("192.168.1.20")));
        assert_eq!(pick_lan(Some(IpAddr::V4(v4("10.0.0.5"))), &[v4("192.168.1.20")]), Some(v4("10.0.0.5")));
        // The default route goes out of a public address or a VPN's: a private one from the list.
        assert_eq!(pick_lan(Some(IpAddr::V4(v4("81.2.69.160"))), &[v4("81.2.69.160"), v4("172.20.0.1"), v4("192.168.0.4")]), Some(v4("192.168.0.4")));
        assert_eq!(pick_lan(Some(IpAddr::V4(v4("100.101.1.2"))), &[v4("100.101.1.2"), v4("10.1.1.1")]), Some(v4("10.1.1.1")));
        assert_eq!(pick_lan(None, &[v4("172.20.0.1")]), Some(v4("172.20.0.1")));
        // Never public, loopback, link-local, CGNAT or "every adapter".
        assert_eq!(pick_lan(Some(IpAddr::V4(v4("8.8.8.8"))), &[v4("8.8.8.8"), v4("127.0.0.1"), v4("169.254.3.4"), v4("100.64.0.1"), v4("0.0.0.0")]), None);
        assert_eq!(pick_lan(Some(IpAddr::V6("fe80::1".parse().unwrap())), &[]), None);
        assert_eq!(pick_lan(Some(IpAddr::V4(Ipv4Addr::UNSPECIFIED)), &[]), None);
    }

    #[test]
    fn host_must_be_the_remotes_own_address() {
        assert!(host_ok(Some("192.168.1.20:51234"), "192.168.1.20:51234"));
        assert!(!host_ok(None, "192.168.1.20:51234"));
        assert!(!host_ok(Some("192.168.1.20"), "192.168.1.20:51234"));
        assert!(!host_ok(Some("evil.example:51234"), "192.168.1.20:51234"));
        assert!(!host_ok(Some("192.168.1.20:51234.evil.example"), "192.168.1.20:51234"));
        assert!(!host_ok(Some("localhost:51234"), "192.168.1.20:51234"));
    }

    #[test]
    fn origin_must_be_the_remotes_own() {
        let me = "http://192.168.1.20:51234";
        assert!(origin_ok(Some(me), me, true));
        assert!(origin_ok(Some(me), me, false));
        assert!(origin_ok(None, me, false));
        // A POST must say where it's from.
        assert!(!origin_ok(None, me, true));
        assert!(!origin_ok(Some("null"), me, true));
        assert!(!origin_ok(Some("https://evil.example"), me, false));
        assert!(!origin_ok(Some("http://192.168.1.20:51235"), me, true));
        assert!(!origin_ok(Some("https://192.168.1.20:51234"), me, true));
    }

    #[test]
    fn reads_the_session_cookie() {
        let token = "ab".repeat(32);
        let header = format!("theme=dark; {COOKIE}={token}; other=1");
        assert_eq!(session_cookie([header.as_str()].into_iter()), Some(token.as_str()));
        let second = format!("{COOKIE}={token}");
        assert_eq!(session_cookie(["a=b", second.as_str()].into_iter()), Some(token.as_str()));
        assert_eq!(session_cookie(["a=b"].into_iter()), None);
        // Wrong length or not hex: not a token at all.
        let short = format!("{COOKIE}={}", "ab".repeat(31));
        assert_eq!(session_cookie([short.as_str()].into_iter()), None);
        let odd = format!("{COOKIE}={}", "zz".repeat(32));
        assert_eq!(session_cookie([odd.as_str()].into_iter()), None);
        let lookalike = format!("x{COOKIE}={token}");
        assert_eq!(session_cookie([lookalike.as_str()].into_iter()), None);
    }

    #[test]
    fn the_cookie_is_http_only_and_strict() {
        let header = session_cookie_header("abc", 60);
        assert!(header.contains("HttpOnly"));
        assert!(header.contains("SameSite=Strict"));
        assert!(header.contains("Max-Age=60"));
        assert!(cleared_cookie_header().contains("Max-Age=0"));
    }

    #[test]
    fn serves_only_this_network() {
        assert!(peer_allowed("192.168.1.30".parse().unwrap()));
        assert!(peer_allowed("10.0.0.2".parse().unwrap()));
        assert!(!peer_allowed("81.2.69.160".parse().unwrap()));
        assert!(!peer_allowed("2001:db8::1".parse().unwrap()));
    }

    #[test]
    fn one_device_cannot_take_every_connection() {
        let slots = PeerSlots::new(2);
        let (greedy, other) = ("192.168.1.66".parse().unwrap(), "192.168.1.30".parse().unwrap());
        let first = slots.take(greedy).unwrap();
        let _second = slots.take(greedy).unwrap();
        assert!(slots.take(greedy).is_none());
        // Another device still gets in.
        assert!(slots.take(other).is_some());
        // A closed connection gives its place back.
        drop(first);
        let third = slots.take(greedy);
        assert!(third.is_some());
        assert!(slots.take(greedy).is_none());
    }
}
