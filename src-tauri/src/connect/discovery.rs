//! Finding other Orbits on the home network with mDNS (DNS-SD), the way
//! printers and speakers are found, through the `mdns-sd` crate.
//!
//! What this device announces is only what another Orbit needs to reach it:
//! its random device id and long-term public key (auth.rs), the name the person
//! gave it, whether it's a PC or a TV, and its address and port. Not the profile, the computer's own
//! name, or anything derived from its address or hardware: the mDNS host name
//! is made from the random id too. It's announced only on the private
//! home-network address the server listens on (remote/checks.rs `pick_lan`),
//! never on a public, VPN or virtual adapter.
//!
//! What others announce is untrusted: each field is checked here, and an
//! announcement only says where a device might be (see devices.rs).

use std::net::{IpAddr, Ipv4Addr, SocketAddrV4};

use mdns_sd::{IfKind, ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};

use super::auth::{KEY_HEX, is_hex, is_id};
use super::devices::Event;
use super::wire::{Kind, device_name};

/// The DNS-SD service type Orbit Connect announces and looks for.
pub const SERVICE: &str = "_orbit-connect._tcp.local.";
/// The protocol version announced (`v`), so a later, incompatible Orbit can be told apart.
/// 2: with its long-term key (`key`), for numeric-comparison pairing (auth.rs).
const VERSION: &str = "2";

/// Announcing and looking. Dropping it withdraws the announcement and stops looking.
pub struct Discovery {
    daemon: ServiceDaemon,
}

impl Drop for Discovery {
    fn drop(&mut self) {
        // Sends the "goodbye" for this device's announcement, then stops the daemon's thread.
        let _ = self.daemon.shutdown();
    }
}

/// What this device announces.
pub struct Announce<'a> {
    pub ip: Ipv4Addr,
    pub port: u16,
    pub id: &'a str,
    pub name: &'a str,
    pub kind: Kind,
    /// Its long-term public key (auth.rs): public, and what pairing with it is checked against.
    pub key: &'a str,
}

pub fn start(me: &Announce<'_>, mut on_event: impl FnMut(Event) + Send + 'static) -> Result<Discovery, String> {
    let fail = |_| "couldn’t look for other devices".to_string();
    let daemon = ServiceDaemon::new().map_err(fail)?;
    // Only the home-network adapter the server listens on (loopback is on by default otherwise).
    daemon.disable_interface(IfKind::All).map_err(fail)?;
    daemon.enable_interface(IfKind::Addr(IpAddr::V4(me.ip))).map_err(fail)?;
    let host = format!("orbit-{}.local.", &me.id[..12]);
    let properties = [("v", VERSION), ("id", me.id), ("name", me.name), ("kind", me.kind.as_str()), ("key", me.key)];
    let mut info = ServiceInfo::new(SERVICE, me.id, &host, IpAddr::V4(me.ip), me.port, &properties[..]).map_err(fail)?;
    info.set_interfaces(vec![IfKind::Addr(IpAddr::V4(me.ip))]);
    daemon.register(info).map_err(fail)?;
    let events = daemon.browse(SERVICE).map_err(fail)?;
    let own = me.id.to_owned();
    std::thread::Builder::new()
        .name("orbit-connect-discovery".into())
        .spawn(move || {
            // Ends when the daemon shuts down (Connect turned off) and the channel closes.
            while let Ok(event) = events.recv() {
                match event {
                    ServiceEvent::ServiceResolved(service) => {
                        if let Some(found) = read(&service, &own) {
                            on_event(found);
                        }
                    }
                    ServiceEvent::ServiceRemoved(_, fullname) => {
                        if let Some(id) = instance_id(&fullname, &own) {
                            on_event(Event::Lost { id: id.to_owned() });
                        }
                    }
                    _ => {}
                }
            }
        })
        .map_err(|_| "couldn’t look for other devices".to_string())?;
    Ok(Discovery { daemon })
}

/// An announcement as a device on the list, if it's a well-formed Orbit
/// Connect one from another device, at a private address.
fn read(service: &ResolvedService, own: &str) -> Option<Event> {
    let addresses = service.get_addresses_v4();
    // Every Orbit announces itself under its id (`start`): one that doesn't isn't one.
    let id = service.get_property_val_str("id").filter(|id| instance_id(&service.fullname, own) == Some(*id));
    found(service.get_property_val_str("v"), id, service.get_property_val_str("name"), service.get_property_val_str("kind"), service.get_property_val_str("key"), &addresses.into_iter().collect::<Vec<_>>(), service.get_port(), own)
}

/// The device id an announcement's full name (`<id>._orbit-connect._tcp.local.`) is for, if it's
/// another device's. As every Orbit is announced under its id, the name alone says which device an
/// announcement or its withdrawal is about: nothing has to be remembered from when it was found, so
/// no list to fill up, and an announcement under some other name can't stand for (or withdraw) a device.
fn instance_id<'a>(fullname: &'a str, own: &str) -> Option<&'a str> {
    fullname.strip_suffix(SERVICE)?.strip_suffix('.').filter(|id| is_id(id) && *id != own)
}

/// The checks on an announcement's fields (apart from mdns-sd's types, so they can be tested).
#[allow(clippy::too_many_arguments)]
fn found(version: Option<&str>, id: Option<&str>, name: Option<&str>, kind: Option<&str>, key: Option<&str>, addresses: &[Ipv4Addr], port: u16, own: &str) -> Option<Event> {
    let id = id.filter(|id| is_id(id) && *id != own)?;
    if version != Some(VERSION) || port == 0 {
        return None;
    }
    // Home-network (RFC 1918) addresses only, as the server listens on (`pick_lan`): Connect never
    // reaches past the home network, nor into this machine's loopback.
    let ip = addresses.iter().copied().filter(Ipv4Addr::is_private).min()?;
    let key = key.filter(|k| is_hex(k, KEY_HEX))?;
    Some(Event::Found { id: id.to_owned(), name: device_name(name?)?, kind: Kind::parse(kind?)?, key: key.to_owned(), addr: SocketAddrV4::new(ip, port) })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";
    const OWN: &str = "ffffffffffffffffffffffffffffffff";
    const KEY: &str = "0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";

    fn v4(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }

    #[test]
    fn reads_another_orbits_announcement() {
        assert_eq!(
            found(Some("2"), Some(ID), Some(" Living room "), Some("tv"), Some(KEY), &[v4("192.168.1.20")], 50123, OWN),
            Some(Event::Found { id: ID.into(), name: "Living room".into(), kind: Kind::Tv, key: KEY.into(), addr: SocketAddrV4::new(v4("192.168.1.20"), 50123) })
        );
    }

    #[test]
    fn ignores_its_own_and_malformed_announcements() {
        let ok = |v, id, name, kind, ips: &[Ipv4Addr], port| found(v, id, name, kind, Some(KEY), ips, port, OWN).is_some();
        let home = [v4("192.168.1.20")];
        assert!(ok(Some("2"), Some(ID), Some("TV"), Some("tv"), &home, 1));
        assert!(!ok(Some("2"), Some(OWN), Some("Me"), Some("pc"), &home, 1));
        // An Orbit from before keys (it would pair the old way).
        assert!(!ok(Some("1"), Some(ID), Some("TV"), Some("tv"), &home, 1));
        assert!(!ok(None, Some(ID), Some("TV"), Some("tv"), &home, 1));
        assert!(!ok(Some("2"), Some("my-hostname"), Some("TV"), Some("tv"), &home, 1));
        assert!(!ok(Some("2"), Some(ID), Some(" "), Some("tv"), &home, 1));
        assert!(!ok(Some("2"), Some(ID), None, Some("tv"), &home, 1));
        assert!(!ok(Some("2"), Some(ID), Some("TV"), Some("fridge"), &home, 1));
        assert!(!ok(Some("2"), Some(ID), Some("TV"), Some("tv"), &home, 0));
        // No key, or not one.
        assert!(found(Some("2"), Some(ID), Some("TV"), Some("tv"), None, &home, 1, OWN).is_none());
        assert!(found(Some("2"), Some(ID), Some("TV"), Some("tv"), Some("abc"), &home, 1, OWN).is_none());
    }

    #[test]
    fn an_announcement_is_named_for_its_device() {
        assert_eq!(instance_id(&format!("{ID}.{SERVICE}"), OWN), Some(ID));
        // This device's own, another name, or another service.
        assert_eq!(instance_id(&format!("{OWN}.{SERVICE}"), OWN), None);
        assert_eq!(instance_id(&format!("Living room.{SERVICE}"), OWN), None);
        assert_eq!(instance_id(&format!("x{ID}.{SERVICE}"), OWN), None);
        assert_eq!(instance_id(&format!("{ID}._other._tcp.local."), OWN), None);
        assert_eq!(instance_id(SERVICE, OWN), None);
    }

    #[test]
    fn only_private_addresses_are_used() {
        let at = |ips: &[Ipv4Addr]| match found(Some("2"), Some(ID), Some("TV"), Some("tv"), Some(KEY), ips, 1, OWN) {
            Some(Event::Found { addr, .. }) => Some(*addr.ip()),
            _ => None,
        };
        assert_eq!(at(&[v4("8.8.8.8")]), None);
        assert_eq!(at(&[v4("127.0.0.1")]), None);
        assert_eq!(at(&[]), None);
        assert_eq!(at(&[v4("8.8.8.8"), v4("10.0.0.7")]), Some(v4("10.0.0.7")));
    }
}
