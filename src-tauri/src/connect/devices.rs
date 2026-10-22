//! The device list: paired devices (from the database) and devices announcing
//! themselves on the network (discovery.rs), and whether each is online.
//!
//! An announcement only says where a device might be: anyone on the network
//! can announce any id, name and key. So a paired device counts as online only
//! after it answered a signed request with a signed reply (`Reached`), and its
//! name is the one from that reply, never the announcement's. Unpaired devices
//! show with their announced name, only to be offered for pairing.
//!
//! Each paired device's long-term key is kept from its pairing (auth.rs) and
//! held to: only an announcement with that key is that device (its address is
//! used to reach it); one with the same id and another key is a different
//! device, listed apart and never offered for pairing under that id. Devices
//! paired before keys (`repair`) have no key kept: they have to pair again.

use std::collections::BTreeMap;
use std::net::SocketAddrV4;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::wire::Kind;

/// A paired device that hasn't answered for this long is shown as offline.
/// The ping (mod.rs) goes every 15 seconds; this allows for two missed.
pub const ONLINE_FOR: Duration = Duration::from_secs(45);
/// Announcements kept at most: a busy network can't make the list grow without end.
const MAX_SEEN: usize = 32;

/// What discovery and the pings report.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// A device announced itself at `addr`, with its long-term key.
    Found { id: String, name: String, kind: Kind, key: String, addr: SocketAddrV4 },
    /// Its announcement was withdrawn (it turned Connect off, or left the network).
    Lost { id: String },
    /// It answered a signed request with a signed reply, with this name and kind.
    Reached { id: String, name: String, kind: Kind },
    /// It didn't answer, or its answer didn't check out.
    Unreachable { id: String },
}

struct Seen {
    name: String,
    kind: Kind,
    addr: SocketAddrV4,
}

struct Peer {
    name: String,
    kind: Kind,
    /// Its long-term key, from pairing. None: paired before keys, so it has to pair again.
    key: Option<String>,
    /// When it last answered a signed request.
    reached: Option<Instant>,
}

/// One row of the list Settings and "Play on…" show.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    /// Its long-term key (what pairing with it is asked against); empty if none is known.
    pub key: String,
    pub paired: bool,
    pub online: bool,
    /// Paired before keys: it has to pair again.
    pub repair: bool,
    /// Announced with a paired device's id but another key: not that device.
    pub impostor: bool,
}

#[derive(Default)]
pub struct Devices {
    peers: BTreeMap<String, Peer>,
    /// By id and key: two announcements of one id with different keys are two devices.
    seen: BTreeMap<(String, String), Seen>,
}

impl Devices {
    /// A paired device (at start, from the database, or once pairing succeeds). Online once it answers.
    pub fn add_peer(&mut self, id: String, name: String, kind: Kind, key: Option<String>) {
        self.peers.insert(id, Peer { name, kind, key, reached: None });
    }

    pub fn remove_peer(&mut self, id: &str) {
        self.peers.remove(id);
    }

    /// The long-term key kept for paired device `id`.
    pub fn pinned(&self, id: &str) -> Option<&str> {
        self.peers.get(id)?.key.as_deref()
    }

    /// Where the device `id` with key `key` was last announced.
    pub fn address(&self, id: &str, key: &str) -> Option<SocketAddrV4> {
        self.seen.get(&(id.to_owned(), key.to_owned())).map(|s| s.addr)
    }

    /// Where paired device `id` was last announced, with the key kept for it.
    pub fn peer_address(&self, id: &str) -> Option<SocketAddrV4> {
        self.address(id, self.pinned(id)?)
    }

    /// Paired devices with a known address: the ones worth pinging.
    pub fn reachable_peers(&self) -> Vec<(String, SocketAddrV4)> {
        self.peers.keys().filter_map(|id| Some((id.clone(), self.peer_address(id)?))).collect()
    }

    /// Applies an event. Whether the list as shown changed.
    pub fn apply(&mut self, event: Event, now: Instant) -> bool {
        let before = self.list(now);
        match event {
            Event::Found { id, name, kind, key, addr } => {
                let entry = (id, key);
                let is_peer = |devices: &Self, (id, key): &(String, String)| devices.pinned(id) == Some(key.as_str());
                if !self.seen.contains_key(&entry) && self.seen.len() >= MAX_SEEN {
                    // Full: an announcement that isn't a paired device's makes room; a paired one's is always kept.
                    match self.seen.keys().find(|k| !is_peer(self, k)).cloned() {
                        Some(spare) => {
                            self.seen.remove(&spare);
                        }
                        None => return false,
                    }
                }
                // Moved to another address: whatever answered at the old one says nothing about the new one.
                if is_peer(self, &entry)
                    && self.seen.get(&entry).is_some_and(|s| s.addr != addr)
                    && let Some(peer) = self.peers.get_mut(&entry.0)
                {
                    peer.reached = None;
                }
                self.seen.insert(entry, Seen { name, kind, addr });
            }
            Event::Lost { id } => {
                self.seen.retain(|(seen, _), _| *seen != id);
                if let Some(peer) = self.peers.get_mut(&id) {
                    peer.reached = None;
                }
            }
            Event::Reached { id, name, kind } => {
                if let Some(peer) = self.peers.get_mut(&id).filter(|p| p.key.is_some()) {
                    peer.name = name;
                    peer.kind = kind;
                    peer.reached = Some(now);
                }
            }
            Event::Unreachable { id } => {
                if let Some(peer) = self.peers.get_mut(&id) {
                    peer.reached = None;
                }
            }
        }
        self.list(now) != before
    }

    fn online(&self, id: &str, peer: &Peer, now: Instant) -> bool {
        self.peer_address(id).is_some() && peer.reached.is_some_and(|at| now.saturating_duration_since(at) < ONLINE_FOR)
    }

    /// Paired devices first (online ones leading), then devices offered for pairing; by name within each.
    pub fn list(&self, now: Instant) -> Vec<Device> {
        let mut paired: Vec<Device> = self
            .peers
            .iter()
            .map(|(id, p)| {
                // One paired before keys is paired again with the key it announces now.
                let key = p.key.clone().or_else(|| self.seen.keys().find(|(seen, _)| seen == id).map(|(_, key)| key.clone())).unwrap_or_default();
                Device { id: id.clone(), name: p.name.clone(), kind: p.kind, key, paired: true, online: self.online(id, p, now), repair: p.key.is_none(), impostor: false }
            })
            .collect();
        paired.sort_by(|a, b| b.online.cmp(&a.online).then_with(|| a.name.cmp(&b.name)));
        let mut offered: Vec<Device> = self
            .seen
            .iter()
            .filter_map(|((id, key), s)| {
                let impostor = match self.peers.get(id) {
                    None => false,
                    // A paired device (this key is its own), or one to pair again (listed with the paired ones).
                    Some(Peer { key: None, .. }) => return None,
                    Some(Peer { key: Some(pinned), .. }) if pinned == key => return None,
                    Some(_) => true,
                };
                Some(Device { id: id.clone(), name: s.name.clone(), kind: s.kind, key: key.clone(), paired: false, online: true, repair: false, impostor })
            })
            .collect();
        offered.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.key.cmp(&b.key)));
        paired.extend(offered);
        paired
    }

    /// Forgets every announcement (Connect turned off); paired devices stay, offline.
    pub fn clear_seen(&mut self) {
        self.seen.clear();
        for peer in self.peers.values_mut() {
            peer.reached = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TV: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const LAPTOP: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn addr(last: u8) -> SocketAddrV4 {
        SocketAddrV4::new([192, 168, 1, last].into(), 50000)
    }

    fn key(c: char) -> String {
        c.to_string().repeat(64)
    }

    fn found(id: &str, name: &str, last: u8) -> Event {
        found_with(id, name, 'k', last)
    }

    fn found_with(id: &str, name: &str, k: char, last: u8) -> Event {
        Event::Found { id: id.into(), name: name.into(), kind: Kind::Tv, key: key(k), addr: addr(last) }
    }

    fn reached(id: &str, name: &str) -> Event {
        Event::Reached { id: id.into(), name: name.into(), kind: Kind::Tv }
    }

    fn peer(d: &mut Devices, id: &str, name: &str) {
        d.add_peer(id.into(), name.into(), Kind::Tv, Some(key('k')));
    }

    fn row(list: &[Device], id: &str) -> Device {
        list.iter().find(|d| d.id == id).cloned().unwrap()
    }

    #[test]
    fn a_paired_device_is_online_only_once_it_answers() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "Living room");
        assert!(!row(&d.list(now), TV).online);
        // Announced: not yet, as anyone could announce its id.
        assert!(!d.apply(found(TV, "Living room", 20), now));
        assert!(!row(&d.list(now), TV).online);
        assert_eq!(d.reachable_peers(), vec![(TV.to_owned(), addr(20))]);
        // Its signed answer: online.
        assert!(d.apply(reached(TV, "Living room"), now));
        assert!(row(&d.list(now), TV).online);
        // No answer for a while: offline again.
        assert!(!row(&d.list(now + ONLINE_FOR), TV).online);
    }

    #[test]
    fn an_answer_without_an_announcement_is_not_enough() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(reached(TV, "TV"), now);
        assert!(!row(&d.list(now), TV).online);
    }

    #[test]
    fn going_away_or_failing_makes_it_offline() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found(TV, "TV", 20), now);
        d.apply(reached(TV, "TV"), now);
        assert!(d.apply(Event::Unreachable { id: TV.into() }, now));
        assert!(!row(&d.list(now), TV).online);
        d.apply(reached(TV, "TV"), now);
        assert!(d.apply(Event::Lost { id: TV.into() }, now));
        assert!(!row(&d.list(now), TV).online);
        assert!(d.reachable_peers().is_empty());
    }

    #[test]
    fn moving_to_another_address_needs_a_new_answer() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found(TV, "TV", 20), now);
        d.apply(reached(TV, "TV"), now);
        assert!(d.apply(found(TV, "TV", 66), now));
        assert!(!row(&d.list(now), TV).online);
        assert_eq!(d.peer_address(TV), Some(addr(66)));
    }

    #[test]
    fn another_key_under_a_paired_id_is_another_device() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found(TV, "TV", 20), now);
        d.apply(reached(TV, "TV"), now);
        // Something announces the TV's id, with its own key, from elsewhere.
        assert!(d.apply(found_with(TV, "TV", 'e', 66), now));
        let list = d.list(now);
        // The TV stays where it is, and online.
        assert_eq!(d.peer_address(TV), Some(addr(20)));
        assert!(list.iter().any(|x| x.id == TV && x.paired && x.online));
        // The other is listed apart, as not the paired device, and can't stand in for it.
        let other = list.iter().find(|x| x.id == TV && !x.paired).unwrap();
        assert!(other.impostor);
        assert_eq!(other.key, key('e'));
        assert_eq!(d.reachable_peers(), vec![(TV.to_owned(), addr(20))]);
        // Announced only under another key, the paired device has no address at all.
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found_with(TV, "TV", 'e', 66), now);
        assert_eq!(d.peer_address(TV), None);
        d.apply(reached(TV, "TV"), now);
        assert!(!row(&d.list(now), TV).online);
    }

    #[test]
    fn a_device_paired_before_keys_has_to_pair_again() {
        let now = Instant::now();
        let mut d = Devices::default();
        d.add_peer(TV.into(), "TV".into(), Kind::Tv, None);
        d.apply(found_with(TV, "TV", 'n', 20), now);
        d.apply(reached(TV, "TV"), now);
        let list = d.list(now);
        // One row: paired, to pair again, never online, offered with the key it announces now.
        assert_eq!(list.len(), 1);
        assert!(list[0].paired && list[0].repair && !list[0].online);
        assert_eq!(list[0].key, key('n'));
        assert!(d.pinned(TV).is_none());
        assert!(d.reachable_peers().is_empty());
    }

    #[test]
    fn a_paired_devices_name_comes_from_its_signed_answer() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found(TV, "Pay here", 20), now);
        assert_eq!(row(&d.list(now), TV).name, "TV");
        d.apply(reached(TV, "Bedroom TV"), now);
        assert_eq!(row(&d.list(now), TV).name, "Bedroom TV");
        // An answer from a device that isn't paired changes nothing.
        assert!(!d.apply(reached(LAPTOP, "Laptop"), now));
    }

    #[test]
    fn unpaired_devices_are_offered_for_pairing_after_paired_ones() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "Zed");
        d.apply(found(LAPTOP, "Laptop", 30), now);
        let list = d.list(now);
        assert_eq!(list.iter().map(|x| (x.id.as_str(), x.paired)).collect::<Vec<_>>(), vec![(TV, true), (LAPTOP, false)]);
        assert_eq!(list[1].key, key('k'));
        // Paired: it moves up, and goes offline until it answers.
        d.add_peer(LAPTOP.into(), "Laptop".into(), Kind::Pc, Some(key('k')));
        assert!(d.list(now).iter().all(|x| x.paired && !x.online));
        d.remove_peer(LAPTOP);
        assert!(!row(&d.list(now), LAPTOP).paired);
    }

    #[test]
    fn two_devices_with_one_name_are_two_rows() {
        let now = Instant::now();
        let mut d = Devices::default();
        d.apply(found_with(TV, "Orbit TV", 'a', 20), now);
        d.apply(found_with(LAPTOP, "Orbit TV", 'b', 21), now);
        let list = d.list(now);
        assert_eq!(list.len(), 2);
        assert_ne!(list[0].key, list[1].key);
    }

    #[test]
    fn the_announced_list_is_capped() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found(TV, "TV", 1), now);
        for n in 0..MAX_SEEN as u32 * 2 {
            d.apply(Event::Found { id: format!("{n:032x}"), name: "x".into(), kind: Kind::Pc, key: key('k'), addr: addr(2) }, now);
        }
        assert!(d.list(now).len() <= MAX_SEEN);
        // The paired device's announcement is never pushed out.
        assert_eq!(d.peer_address(TV), Some(addr(1)));
    }

    #[test]
    fn turning_off_forgets_announcements_but_keeps_pairings() {
        let now = Instant::now();
        let mut d = Devices::default();
        peer(&mut d, TV, "TV");
        d.apply(found(TV, "TV", 20), now);
        d.apply(found(LAPTOP, "Laptop", 30), now);
        d.apply(reached(TV, "TV"), now);
        d.clear_seen();
        let list = d.list(now);
        assert_eq!(list.len(), 1);
        assert!(list[0].paired && !list[0].online);
    }
}
