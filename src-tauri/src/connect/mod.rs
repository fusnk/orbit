//! Orbit Connect: one Orbit plays on, or controls, another Orbit on the same
//! home network (PCs and the Android TV build), the way Spotify Connect does.
//! It's the phone remote's next step (remote/): the same home-network-only
//! server and the same checked player commands, now between two Orbits.
//!
//! Off by default; turned on in Settings → General, Quick settings or the
//! palette. While on, this device:
//! - announces itself with mDNS (discovery.rs): a random id, its public key
//!   and the name the person chose, nothing else about it or them;
//! - serves other paired Orbits (server.rs): what's playing, play a title,
//!   and the player's commands;
//! - can pair with another device, both showing a number the person checks
//!   matches (auth.rs).
//!
//! What crosses the network to play something is what names it (type, id,
//! season, episode), a position and preferred languages (wire.rs). The device
//! that plays finds the sources with its own addons and ranking, and runs it
//! through the same checks as anything picked on it (app/connect.ts), so its
//! profile, content limit and PIN still apply there. No stream or addon
//! address, key or token ever leaves the device that has it.
//!
//! Each pair shares a random secret, kept in the OS keychain
//! (`connect-peer.<id>`), as is this device's long-term private key
//! (`connect-key`); the database keeps only the paired device's id, name, kind
//! and public key. Removing a device deletes both, and tells the other device
//! to do the same. Devices paired with a typed code (before keys) are kept,
//! without their secret, only to be shown as needing to pair again: that kind
//! of pairing could have been intercepted, so it isn't trusted any more.

pub(crate) mod auth;
mod client;
mod devices;
mod discovery;
mod pairing;
mod server;
mod wire;

use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use auth::{Key, Rate, Replay, SECRET_BYTES, Transcript};
use devices::{Device, Devices, Event};
use pairing::{Confirmed, MAX_PEERS, PairError, PairWindow, SESSION_TIME};
use server::Check;
use wire::{Hello, Kind, PairCancel, PairCommit, PairConfirm, PairConfirmed, PairNonce, PairReveal, PairStart, Play};

/// The page hears what changed here (the device list, pairing; a toast for some).
const CHANGED_EVENT: &str = "connect://changed";
/// And a title another device asked this one to play.
const PLAY_EVENT: &str = "connect://play";
/// This device's own id, in the keychain (not a secret, but kept off backups,
/// which would copy it to another device, and out of the page's reach).
const ID_ENTRY: &str = "connect-id";
/// This device's long-term private key (auth.rs `Key`): its identity to the devices it pairs with.
const KEY_ENTRY: &str = "connect-key";
/// A paired device's shared secret: `connect-peer.<its id>`.
pub const PEER_PREFIX: &str = "connect-peer.";
/// How often paired devices are asked whether they're there.
const PING_EVERY: Duration = Duration::from_secs(15);
/// How often the sender asks whether the other device's person has confirmed too.
const CONFIRM_POLL: Duration = Duration::from_secs(1);

type Secret = Zeroizing<[u8; SECRET_BYTES]>;

#[derive(Clone)]
struct Me {
    id: String,
    name: String,
    kind: Kind,
}

impl Me {
    fn hello(&self) -> Hello {
        Hello { id: self.id.clone(), name: self.name.clone(), kind: self.kind }
    }
}

/// A pairing this device started, once both sides have the number.
struct Outgoing {
    id: String,
    name: String,
    kind: Kind,
    /// The other device's long-term key, kept with the pair.
    key: String,
    addr: SocketAddrV4,
    secret: Secret,
    sas: String,
    /// Its person confirmed here; waiting for the other device's.
    waiting: bool,
    started: Instant,
}

#[derive(Default)]
struct Inner {
    /// Set while Connect is on.
    me: Option<Me>,
    /// This device's long-term key, while Connect is on.
    identity: Option<Arc<Key>>,
    outgoing: Option<Outgoing>,
    server: Option<server::Running>,
    discovery: Option<discovery::Discovery>,
    pinger: Option<tauri::async_runtime::JoinHandle<()>>,
    window: PairWindow,
    /// Each paired device's secret, read from the keychain when Connect turns on.
    secrets: HashMap<String, Secret>,
    devices: Devices,
    replay: Replay,
    rate: Rate,
    /// Paired devices being pinged right now (see `ping`).
    pinging: HashSet<String>,
}

#[derive(Default)]
pub struct Connect {
    inner: Mutex<Inner>,
    /// Held for a whole turn on or off. Turning on awaits (the server, the keychain), so without it two at once
    /// (a quick double rename) would both start: the second overwrites the first's server and announcement,
    /// whose goodbye then withdraws the name just announced, and leaves its ping loop running.
    lifecycle: tokio::sync::Mutex<()>,
}

/// What Settings and "Play on…" show.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    running: bool,
    name: Option<String>,
    kind: Kind,
    /// Seconds this device stays open to pairing ("Pair a device"), while it is.
    expires_in: Option<u64>,
    /// Pairing closed after too many pairings were started.
    locked: bool,
    /// A pairing whose number the person is to compare with the other device's.
    prompt: Option<Prompt>,
    devices: Vec<Device>,
    max_devices: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    id: String,
    name: String,
    kind: Kind,
    sas: String,
    /// This device started it (else the other device did).
    outgoing: bool,
    /// The person here confirmed; waiting for the other device.
    waiting: bool,
}

/// Why a pairing message was refused (server.rs answers with its status).
#[derive(Debug, PartialEq, Eq)]
pub enum PairRefusal {
    /// This device isn't open to pairing, or that pairing isn't under way (any more).
    Closed,
    Locked,
    Full,
    /// The sender's id is paired here with another key.
    Identity,
    /// Malformed, or a proof that doesn't check out.
    Wrong,
    Failed,
}

impl From<PairError> for PairRefusal {
    fn from(e: PairError) -> Self {
        match e {
            PairError::Closed => Self::Closed,
            PairError::Locked => Self::Locked,
            PairError::Wrong => Self::Wrong,
            PairError::Full => Self::Full,
        }
    }
}

impl Inner {
    /// Whether device `id` may pair with this one now: it isn't this device, and there's room for it.
    /// Pairing again replaces a device's old pairing, so it takes no more room.
    fn room_for(&self, id: &str) -> bool {
        self.me.as_ref().is_some_and(|me| me.id != id) && (self.secrets.contains_key(id) || self.secrets.len() < MAX_PEERS)
    }
}

fn secret_entry(id: &str) -> String {
    format!("{PEER_PREFIX}{id}")
}

fn lock(connect: &Connect) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
    connect.inner.lock().map_err(|_| "Orbit Connect is unavailable".to_string())
}

/// This device's id: made once, at random, and kept.
fn own_id() -> Result<String, String> {
    if let Some(id) = crate::keychain::get(ID_ENTRY)?.filter(|id| auth::is_id(id)) {
        return Ok(id);
    }
    let id = auth::random_id()?;
    crate::keychain::set(ID_ENTRY, &id)?;
    Ok(id)
}

/// This device's long-term key: made once, at random, and kept in the keychain.
fn own_key() -> Result<Key, String> {
    if let Some(key) = crate::keychain::get_bytes(KEY_ENTRY)?.map(Zeroizing::new).and_then(|seed| Key::from_seed(&seed).ok()) {
        return Ok(key);
    }
    let key = Key::generate()?;
    crate::keychain::set_bytes(KEY_ENTRY, &key.seed()?)?;
    Ok(key)
}

/// A paired device as kept: its long-term key and secret, or neither if it paired before keys.
struct Saved {
    id: String,
    name: String,
    kind: Kind,
    pair: Option<(String, Secret)>,
}

/// What to do with a stored pair (`load_peers`): keep it, keep it only to be paired again, or drop it.
#[derive(Debug, PartialEq, Eq)]
enum Stored {
    Usable,
    /// Paired with a typed code, whose pairing could have been intercepted: not trusted any more.
    PairAgain,
    Drop,
}

fn stored(id: &str, name: &str, kind: &str, key: Option<&str>, has_secret: bool) -> Stored {
    if !auth::is_id(id) || wire::device_name(name).is_none() || Kind::parse(kind).is_none() {
        return Stored::Drop;
    }
    match key {
        None => Stored::PairAgain,
        Some(key) if auth::is_hex(key, auth::KEY_HEX) && has_secret => Stored::Usable,
        // Its secret is gone (a keychain reset), or the row is damaged: it has to pair again from scratch.
        Some(_) => Stored::Drop,
    }
}

/// Paired devices from the database, each with its key and its secret from the keychain.
fn load_peers(app: &AppHandle) -> Result<Vec<Saved>, String> {
    let db = app.state::<crate::db::Db>();
    let rows: Vec<(String, String, String, Option<String>)> = {
        let conn = db.lock()?;
        let mut stmt = conn.prepare("SELECT id, name, kind, key FROM connect_peers").map_err(|e| e.to_string())?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect()
    };
    let mut peers = Vec::new();
    for (id, name, kind, key) in rows {
        let secret = crate::keychain::get_bytes(&secret_entry(&id))?.and_then(|bytes| <[u8; SECRET_BYTES]>::try_from(bytes.as_slice()).ok()).map(Zeroizing::new);
        match stored(&id, &name, &kind, key.as_deref(), secret.is_some()) {
            Stored::Usable => {
                if let (Some(name), Some(kind), Some(key), Some(secret)) = (wire::device_name(&name), Kind::parse(&kind), key, secret) {
                    peers.push(Saved { id, name, kind, pair: Some((key, secret)) });
                }
            }
            Stored::PairAgain => {
                // Its secret isn't used again: gone from the keychain, the row kept to say why it's offline.
                let _ = crate::keychain::delete(&secret_entry(&id));
                if let (Some(name), Some(kind)) = (wire::device_name(&name), Kind::parse(&kind)) {
                    peers.push(Saved { id, name, kind, pair: None });
                }
            }
            Stored::Drop => delete_peer(app, &id),
        }
    }
    Ok(peers)
}

/// Keeps a new pair, with the other device's long-term key: the secret in the keychain first, so a
/// row with a key never exists without one.
fn save_peer(app: &AppHandle, id: &str, name: &str, kind: Kind, key: &str, secret: &[u8]) -> Result<(), String> {
    crate::keychain::set_bytes(&secret_entry(id), secret)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    app.state::<crate::db::Db>()
        .lock()?
        .execute(
            "INSERT INTO connect_peers (id, name, kind, paired_at, key) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, paired_at = excluded.paired_at, key = excluded.key",
            rusqlite::params![id, name, kind.as_str(), i64::try_from(now).unwrap_or(0), key],
        )
        .map(drop)
        .map_err(|e| e.to_string())
}

fn delete_peer(app: &AppHandle, id: &str) {
    let _ = crate::keychain::delete(&secret_entry(id));
    if let Ok(conn) = app.state::<crate::db::Db>().lock() {
        let _ = conn.execute("DELETE FROM connect_peers WHERE id = ?1", [id]);
    }
}

fn announce(app: &AppHandle, reason: Option<&str>, name: Option<&str>) {
    let _ = app.emit_to("main", CHANGED_EVENT, serde_json::json!({ "reason": reason, "name": name }));
}

/// Tells the page again once a pairing just started could have lapsed (`SESSION_TIME`): nothing else
/// may change meanwhile (the other device quit, or left the network quietly), and the number, or
/// "Waiting for…", would otherwise stay on screen for a pairing that's gone.
fn announce_lapse(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SESSION_TIME).await;
        announce(&app, None, None);
    });
}

/// Hands a checked play command to the page, with the name of the device it came from.
fn send_play(app: &AppHandle, from: &str, play: &Play) {
    let _ = app.emit_to("main", PLAY_EVENT, serde_json::json!({ "from": from, "play": play }));
}

impl Connect {
    fn status(&self) -> Result<Status, String> {
        let mut inner = lock(self)?;
        let now = Instant::now();
        let running = inner.me.is_some();
        let expires_in = inner.window.remaining(now).filter(|_| running).map(|left| left.as_secs());
        if inner.outgoing.as_ref().is_some_and(|o| now.saturating_duration_since(o.started) >= SESSION_TIME) {
            inner.outgoing = None;
        }
        let incoming = inner.window.incoming(now).and_then(|i| Some(Prompt { id: i.from.clone(), name: i.name.clone(), kind: i.kind, sas: i.sas()?.to_owned(), outgoing: false, waiting: i.confirmed }));
        let prompt = incoming.or_else(|| inner.outgoing.as_ref().map(|o| Prompt { id: o.id.clone(), name: o.name.clone(), kind: o.kind, sas: o.sas.clone(), outgoing: true, waiting: o.waiting }));
        Ok(Status {
            running,
            name: inner.me.as_ref().map(|m| m.name.clone()),
            kind: Kind::this(),
            expires_in,
            locked: inner.window.locked(),
            prompt: prompt.filter(|_| running),
            devices: inner.devices.list(now),
            max_devices: MAX_PEERS,
        })
    }

    fn hello(&self) -> Option<Hello> {
        let inner = self.inner.lock().ok()?;
        inner.me.as_ref().map(Me::hello)
    }

    /// Checks a signed request: from a paired device, signed by it, not seen before, within the
    /// clock window and its rate. Its secret and the device's name when it passes.
    #[allow(clippy::too_many_arguments)]
    fn check_request(&self, from: &str, path: &str, time: u64, nonce: &str, signature: &str, body: &[u8], now: Instant, unix: u64) -> Result<(Secret, String), Check> {
        let mut inner = self.inner.lock().map_err(|_| Check::Unknown)?;
        let me = inner.me.as_ref().map(|m| m.id.clone()).ok_or(Check::Unknown)?;
        let secret = inner.secrets.get(from).cloned().ok_or(Check::Unknown)?;
        let request = auth::Request { method: "POST", path, to: &me, from, time, nonce, body };
        if !request.verify(&secret[..], signature) {
            return Err(Check::Unknown);
        }
        // Only after the signature: made-up requests can't fill the nonce list or use up a device's rate.
        // A copy is refused before it costs the device's rate; a request refused as too fast leaves no nonce behind.
        inner.replay.check(from, nonce, time, unix).map_err(Check::Rejected)?;
        if !inner.rate.allow(from, now) {
            return Err(Check::TooFast);
        }
        inner.replay.remember(from, nonce, time);
        let name = inner.devices.list(now).into_iter().find(|d| d.id == from).map(|d| d.name).unwrap_or_default();
        Ok((secret, name))
    }

    /// This device as pairing needs it: who it is and its long-term key (while Connect is on).
    fn identity(inner: &Inner) -> Result<(Me, Arc<Key>), PairRefusal> {
        Ok((inner.me.clone().ok_or(PairRefusal::Closed)?, inner.identity.clone().ok_or(PairRefusal::Closed)?))
    }

    /// Pairing, receiving side (auth.rs has the protocol). 1. A sender's keys: answered with this
    /// device's and its commitment, while this device is open to pairing.
    fn pair_start(&self, app: &AppHandle, offer: &PairStart) -> Result<PairCommit, PairRefusal> {
        let reply = self.inner.lock().map_err(|_| PairRefusal::Failed).and_then(|mut inner| Self::start_with(&mut inner, offer, Instant::now()));
        match &reply {
            Ok(_) => announce_lapse(app),
            Err(PairRefusal::Locked) => announce(app, Some("pair-stopped"), None),
            Err(_) => {}
        }
        reply
    }

    fn start_with(inner: &mut Inner, offer: &PairStart, now: Instant) -> Result<PairCommit, PairRefusal> {
        let (me, key) = Self::identity(inner)?;
        // Whether it's open comes first, so a device that isn't let in learns nothing else.
        if inner.window.locked() {
            return Err(PairRefusal::Locked);
        }
        if inner.window.remaining(now).is_none() {
            return Err(PairRefusal::Closed);
        }
        // Something posing as this very device: nothing to pair with.
        if offer.id == me.id {
            return Err(PairRefusal::Wrong);
        }
        // Paired here under this id with another key: not that device.
        if inner.devices.pinned(&offer.id).is_some_and(|pinned| pinned != offer.key) {
            return Err(PairRefusal::Identity);
        }
        if !inner.room_for(&offer.id) {
            return Err(PairRefusal::Full);
        }
        let name = wire::device_name(&offer.name).ok_or(PairRefusal::Wrong)?;
        Ok(inner.window.start(now, offer, name, &me.hello(), &key)?)
    }

    /// 2. The sender's nonce: this device's is revealed, and both now show the number.
    fn pair_reveal(&self, app: &AppHandle, message: &PairNonce) -> Result<PairReveal, PairRefusal> {
        let mut inner = self.inner.lock().map_err(|_| PairRefusal::Failed)?;
        let (me, key) = Self::identity(&inner)?;
        let nonce = inner.window.reveal(Instant::now(), &message.id, &message.nonce, &me.id, &key)?;
        drop(inner);
        announce(app, Some("compare"), None);
        Ok(PairReveal { nonce })
    }

    /// Step 3: the sender's person confirmed. Once the person here has too, the pair is kept and this
    /// side's proof goes back; until then, None (the sender asks again).
    fn pair_confirm(&self, app: &AppHandle, message: &PairConfirm) -> Result<Option<PairConfirmed>, PairRefusal> {
        let mut inner = self.inner.lock().map_err(|_| PairRefusal::Failed)?;
        if !inner.room_for(&message.id) {
            return Err(PairRefusal::Full);
        }
        let outcome = inner.window.confirm(Instant::now(), &message.id, &message.proof);
        drop(inner);
        let (incoming, secret, proof) = match outcome {
            Ok(Confirmed::Waiting) => return Ok(None),
            Ok(Confirmed::Paired(incoming, secret, proof)) => (incoming, secret, proof),
            Err(e) => {
                announce(app, None, None);
                return Err(e.into());
            }
        };
        // Not holding the lock while the keychain is written (on Android that waits for the main thread).
        save_peer(app, &incoming.from, &incoming.name, incoming.kind, &incoming.key, &secret[..]).map_err(|_| PairRefusal::Failed)?;
        self.keep_pair(&incoming.from, &incoming.name, incoming.kind, &incoming.key, secret);
        announce(app, Some("paired"), Some(&incoming.name));
        Ok(Some(PairConfirmed { proof }))
    }

    /// The sender gave up.
    fn pair_cancel(&self, app: &AppHandle, message: &PairCancel) {
        let cancelled = self.inner.lock().is_ok_and(|mut inner| inner.window.cancel(&message.id));
        if cancelled {
            announce(app, None, None);
        }
    }

    /// A pair just made (either side): its secret in use, its key held to.
    fn keep_pair(&self, id: &str, name: &str, kind: Kind, key: &str, secret: Secret) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.replay.forget(id);
            inner.rate.forget(id);
            inner.secrets.insert(id.to_owned(), secret);
            inner.devices.add_peer(id.to_owned(), name.to_owned(), kind, Some(key.to_owned()));
        }
    }

    /// Unpairs a device here (its secret and row are deleted).
    fn forget_peer(&self, app: &AppHandle, id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.secrets.remove(id);
            inner.devices.remove_peer(id);
            inner.replay.forget(id);
            inner.rate.forget(id);
        }
        delete_peer(app, id);
        announce(app, Some("forgot"), None);
    }

    /// Applies a device-list event; whether to ping the device (a paired one just announced).
    fn apply(&self, event: Event) -> (bool, Option<String>) {
        let Ok(mut inner) = self.inner.lock() else { return (false, None) };
        let ping = match &event {
            Event::Found { id, key, .. } if inner.devices.pinned(id) == Some(key.as_str()) => Some(id.clone()),
            _ => None,
        };
        (inner.devices.apply(event, Instant::now()), ping)
    }

    /// Stops the server and the announcement; pairings are kept. Called on quit too.
    pub fn shutdown(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            set_pinger(&mut inner, None);
            // Dropping them withdraws the announcement and closes every connection.
            inner.discovery = None;
            inner.server = None;
            inner.me = None;
            inner.identity = None;
            inner.outgoing = None;
            inner.window.close();
            inner.devices.clear_seen();
            inner.secrets.clear();
        }
        #[cfg(target_os = "android")]
        crate::android_connect::multicast(false);
    }
}

/// Keeps `pinger` as the one ping loop, stopping any loop before it.
fn set_pinger(inner: &mut Inner, pinger: Option<tauri::async_runtime::JoinHandle<()>>) {
    if let Some(old) = std::mem::replace(&mut inner.pinger, pinger) {
        old.abort();
    }
}

/// A signed request to a paired device.
async fn call(app: &AppHandle, id: &str, path: &str, body: Vec<u8>) -> Result<client::Reply, String> {
    let (addr, me, secret) = {
        let connect = app.state::<Connect>();
        let inner = lock(&connect)?;
        let me = inner.me.as_ref().map(|m| m.id.clone()).ok_or("err.connect.off")?;
        let addr = inner.devices.peer_address(id).ok_or_else(|| crate::user_error::coded("connect.offline", &[]))?;
        let secret = inner.secrets.get(id).cloned().ok_or_else(|| crate::user_error::coded("connect.offline", &[]))?;
        (addr, me, secret)
    };
    match client::signed(&client::Target { addr, id }, &me, &secret[..], path, body).await {
        Ok(reply) => Ok(reply),
        // Pressed faster than its rate allows: it's there, so it stays on the list.
        Err(client::Failure::Busy) => Err(crate::user_error::coded("connect.busy", &[])),
        Err(client::Failure::Unreachable) => {
            if app.state::<Connect>().apply(Event::Unreachable { id: id.to_owned() }).0 {
                announce(app, None, None);
            }
            Err(crate::user_error::coded("connect.offline", &[]))
        }
    }
}

/// A ping under way to one device; the next may start once it's dropped (done, or its task stopped).
struct Pinging {
    app: AppHandle,
    id: String,
}

impl Connect {
    /// Marks a ping to `id` as under way: false if one already is.
    fn start_ping(&self, id: &str) -> bool {
        self.inner.lock().is_ok_and(|mut inner| inner.pinging.insert(id.to_owned()))
    }

    fn end_ping(&self, id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pinging.remove(id);
        }
    }
}

impl Drop for Pinging {
    fn drop(&mut self) {
        self.app.state::<Connect>().end_ping(&self.id);
    }
}

/// Asks a paired device who it is; it's online once its signed answer checks out.
///
/// One at a time per device. A ping goes out each time a paired device's id is announced, and
/// anyone on the network can announce any id, at any address, as often as they like: without
/// this, a stream of made-up announcements would have Orbit open a connection per packet,
/// to wherever on the network they pointed.
async fn ping(app: AppHandle, id: String) {
    if !app.state::<Connect>().start_ping(&id) {
        return;
    }
    let _pinging = Pinging { app: app.clone(), id: id.clone() };
    let event = match call(&app, &id, "/v1/hello", b"{}".to_vec()).await {
        Ok(reply) if reply.status == 200 => match serde_json::from_slice::<Hello>(&reply.body) {
            Ok(hello) if hello.id == id => match wire::device_name(&hello.name) {
                Some(name) => Event::Reached { id, name, kind: hello.kind },
                None => Event::Unreachable { id },
            },
            _ => Event::Unreachable { id },
        },
        Ok(_) => Event::Unreachable { id },
        // `call` marked it offline already if it didn't answer; busy, it's there and stays as it was.
        Err(_) => return,
    };
    if app.state::<Connect>().apply(event).0 {
        announce(&app, None, None);
    }
}

/// Whether this device's home-network address is no longer the one Connect (or the phone remote) listens
/// and is announced on (another Wi-Fi, or a new address from the router). None: no network right now, which
/// may come back as it was.
pub(crate) fn moved(listening: Ipv4Addr, now: Option<Ipv4Addr>) -> bool {
    now.is_some_and(|ip| ip != listening)
}

/// Starts Connect again on this device's new address. The server listens on one address and the
/// announcement names it, so after the network changes other devices would otherwise be sent to an
/// address that's gone until Connect is turned off and on. Its own task: turning on stops the ping loop that noticed.
/// Boxed: it starts the ping loop that starts it.
fn follow_network(app: AppHandle) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(async move {
        let connect = app.state::<Connect>();
        let _turn = connect.lifecycle.lock().await;
        // Checked again in turn: it may have been turned off, or started again, meanwhile.
        let Some((name, listening)) = lock(&connect).ok().and_then(|inner| Some((inner.me.as_ref()?.name.clone(), *inner.server.as_ref()?.addr.ip()))) else { return };
        if !moved(listening, crate::remote::server::lan_address()) {
            return;
        }
        if turn_on(&app, &connect, name).await.is_err() {
            connect.shutdown();
            // Off now, though the person left it on: the page turns it back on, trying again less and
            // less often, as at launch (app/connect-state.ts `resumeConnect`).
            announce(&app, Some("stopped"), None);
            return;
        }
        announce(&app, None, None);
    })
}

async fn ping_all(app: AppHandle) {
    loop {
        let listening = lock(&app.state::<Connect>()).ok().and_then(|inner| inner.server.as_ref().map(|s| *s.addr.ip()));
        if listening.is_some_and(|ip| moved(ip, crate::remote::server::lan_address())) {
            tauri::async_runtime::spawn(follow_network(app.clone()));
        }
        let peers = lock(&app.state::<Connect>()).map(|i| i.devices.reachable_peers()).unwrap_or_default();
        for (id, _) in peers {
            ping(app.clone(), id).await;
        }
        tokio::time::sleep(PING_EVERY).await;
    }
}

/// Turns Connect on with this device's name, or, if it's on, announces the new name.
#[tauri::command]
pub async fn connect_start(app: AppHandle, connect: State<'_, Connect>, name: String) -> Result<Status, String> {
    let name = wire::device_name(&name).ok_or("invalid name")?;
    let _turn = connect.lifecycle.lock().await;
    if lock(&connect)?.me.as_ref().is_some_and(|m| m.name == name) {
        return connect.status();
    }
    turn_on(&app, &connect, name).await?;
    connect.status()
}

/// Starts the server, the announcement and the pings as `name`, stopping whatever ran before. Called holding `lifecycle`.
async fn turn_on(app: &AppHandle, connect: &Connect, name: String) -> Result<(), String> {
    connect.shutdown();
    let ip: Ipv4Addr = crate::remote::server::lan_address().ok_or_else(|| crate::user_error::coded("remote.no-network", &[]))?;
    let id = own_id()?;
    let identity = Arc::new(own_key()?);
    let peers = load_peers(app)?;
    // Android drops multicast packets unless an app holds Wi-Fi's multicast lock while it needs them.
    #[cfg(target_os = "android")]
    crate::android_connect::multicast(true);
    let running = server::start(app.clone(), ip).await?;
    let me = Me { id: id.clone(), name: name.clone(), kind: Kind::this() };
    let events = app.clone();
    let found = discovery::start(&discovery::Announce { ip, port: running.addr.port(), id: &id, name: &name, kind: me.kind, key: &identity.public }, move |event| {
        let (changed, ping_id) = events.state::<Connect>().apply(event);
        if changed {
            announce(&events, None, None);
        }
        if let Some(id) = ping_id {
            tauri::async_runtime::spawn(ping(events.clone(), id));
        }
    });
    let discovery = match found {
        Ok(d) => d,
        Err(e) => {
            connect.shutdown();
            return Err(e);
        }
    };
    let mut inner = lock(connect)?;
    for peer in peers {
        let key = peer.pair.as_ref().map(|(key, _)| key.clone());
        inner.devices.add_peer(peer.id.clone(), peer.name, peer.kind, key);
        if let Some((_, secret)) = peer.pair {
            inner.secrets.insert(peer.id, secret);
        }
    }
    inner.me = Some(me);
    inner.identity = Some(identity);
    inner.server = Some(running);
    inner.discovery = Some(discovery);
    set_pinger(&mut inner, Some(tauri::async_runtime::spawn(ping_all(app.clone()))));
    Ok(())
}

/// Turns Connect off: no announcement, no server. Paired devices stay paired.
#[tauri::command]
pub async fn connect_stop(connect: State<'_, Connect>) -> Result<Status, String> {
    let _turn = connect.lifecycle.lock().await;
    connect.shutdown();
    connect.status()
}

#[tauri::command]
pub async fn connect_status(connect: State<'_, Connect>) -> Result<Status, String> {
    connect.status()
}

/// "Pair a device": this device is open to pairing for a while (a pairing under way stops).
#[tauri::command]
pub async fn connect_open_pairing(connect: State<'_, Connect>) -> Result<Status, String> {
    {
        let mut inner = lock(&connect)?;
        if inner.me.is_some() {
            inner.window.open(Instant::now());
        }
    }
    connect.status()
}

#[tauri::command]
pub async fn connect_close_pairing(connect: State<'_, Connect>) -> Result<Status, String> {
    lock(&connect)?.window.close();
    connect.status()
}

fn coded(name: &str) -> String {
    crate::user_error::coded(name, &[])
}

/// What a refused pairing message means to the person (server.rs `pair_status`).
fn pair_error(status: u16) -> String {
    coded(match status {
        410 => "connect.not-pairing",
        423 => "connect.pair-stopped",
        409 => "connect.full",
        403 => "connect.identity",
        _ => "connect.offline",
    })
}

/// One pairing message to the device at `addr`, and its answer if it's `ok`.
async fn pair_step<T: serde::de::DeserializeOwned>(addr: SocketAddrV4, path: &str, body: &impl Serialize) -> Result<T, String> {
    let reply = client::pair(addr, path, serde_json::to_vec(body).map_err(|e| e.to_string())?).await.map_err(|_| coded("connect.offline"))?;
    if reply.status != 200 {
        return Err(pair_error(reply.status));
    }
    serde_json::from_slice(&reply.body).map_err(|_| coded("connect.offline"))
}

/// Pairs with device `id`, which announced long-term key `key` (the row the person chose). Ends with
/// both devices showing a number (`Status.prompt`) for the person to compare: `connect_answer_pairing` goes on.
#[tauri::command]
pub async fn connect_pair(app: AppHandle, connect: State<'_, Connect>, id: String, key: String) -> Result<Status, String> {
    if !auth::is_id(&id) || !auth::is_hex(&key, auth::KEY_HEX) {
        return Err("invalid device".into());
    }
    let (me, identity, addr) = {
        let inner = lock(&connect)?;
        let (me, identity) = Connect::identity(&inner).map_err(|_| "err.connect.off".to_string())?;
        // The cap holds on this side too: each pair's secret also lets the other device send commands here.
        if !inner.room_for(&id) {
            return Err(coded("connect.full-here"));
        }
        // Paired here with another key: whatever this is, it isn't that device.
        if inner.devices.pinned(&id).is_some_and(|pinned| pinned != key) {
            return Err(coded("connect.identity"));
        }
        (me, identity, inner.devices.address(&id, &key).ok_or_else(|| coded("connect.offline"))?)
    };
    let fresh = Key::generate()?;
    let start = PairStart { id: me.id.clone(), name: me.name.clone(), kind: me.kind, key: identity.public.clone(), fresh: fresh.public.clone() };
    let commit: PairCommit = pair_step(addr, "/v1/pair/start", &start).await?;
    // The device that answers must be the one chosen, with the key it announced.
    if !commit.well_formed() || commit.id != id {
        return Err(coded("connect.offline"));
    }
    if commit.key != key {
        return Err(coded("connect.identity"));
    }
    let my_nonce = auth::pair_nonce()?;
    let reveal: PairReveal = pair_step(addr, "/v1/pair/nonce", &PairNonce { id: me.id.clone(), nonce: my_nonce.clone() }).await?;
    let transcript = Transcript { sender: &me.id, receiver: &id, sender_key: &identity.public, receiver_key: &commit.key, sender_fresh: &fresh.public, receiver_fresh: &commit.fresh };
    // Its nonce must be the one it committed to before it saw this one's: else it could have picked it to make the numbers match.
    if !auth::commit_ok(&reveal.nonce, &transcript, &commit.commit) {
        return Err(coded("connect.mismatch"));
    }
    let secret = Zeroizing::new(auth::pair_secret(&identity, &fresh, &commit.key, &commit.fresh, &transcript, &my_nonce, &reveal.nonce)?);
    let sas = auth::sas(&transcript, &my_nonce, &reveal.nonce).ok_or("invalid nonce")?;
    let name = wire::device_name(&commit.name).ok_or("invalid name")?;
    lock(&connect)?.outgoing = Some(Outgoing { id, name, kind: commit.kind, key: commit.key, addr, secret, sas, waiting: false, started: Instant::now() });
    announce(&app, None, None);
    announce_lapse(&app);
    connect.status()
}

/// The person compared the numbers of the pairing with device `id`. For a pairing this device
/// started, a match waits for the other device's person, then keeps the pair; for one the other
/// device started, it's said here and the other device finishes it.
#[tauri::command]
pub async fn connect_answer_pairing(app: AppHandle, connect: State<'_, Connect>, id: String, matches: bool) -> Result<Status, String> {
    let outgoing = {
        let mut inner = lock(&connect)?;
        match inner.outgoing.as_mut().filter(|o| o.id == id) {
            Some(o) => {
                o.waiting = matches;
                Some((o.addr, o.secret.clone(), inner.me.as_ref().map(|m| m.id.clone()).unwrap_or_default()))
            }
            None => {
                inner.window.answer(Instant::now(), &id, matches);
                None
            }
        }
    };
    announce(&app, None, None);
    let Some((addr, secret, me)) = outgoing else { return connect.status() };
    let finish = |connect: &Connect| {
        if let Ok(mut inner) = lock(connect) {
            inner.outgoing = None;
        }
        announce(&app, None, None);
    };
    if !matches {
        finish(&connect);
        let _ = client::pair(addr, "/v1/pair/cancel", serde_json::to_vec(&PairCancel { id: me }).map_err(|e| e.to_string())?).await;
        return connect.status();
    }
    let body = serde_json::to_vec(&PairConfirm { id: me, proof: auth::confirm_proof(&secret[..], true) }).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + SESSION_TIME;
    let result = loop {
        if Instant::now() >= deadline || lock(&connect)?.outgoing.as_ref().is_none_or(|o| o.id != id) {
            break Err(coded("connect.timeout"));
        }
        match client::pair(addr, "/v1/pair/confirm", body.clone()).await {
            Ok(reply) if reply.status == 200 => {
                break match serde_json::from_slice::<PairConfirmed>(&reply.body) {
                    // The other device derived the same secret: nothing sat in between.
                    Ok(answer) if auth::confirm_ok(&secret[..], false, &answer.proof) => Ok(()),
                    _ => Err(coded("connect.mismatch")),
                };
            }
            // Its person hasn't answered yet.
            Ok(reply) if reply.status == 202 => {}
            // It said the numbers don't match, or gave up.
            Ok(reply) if matches!(reply.status, 400 | 410) => break Err(coded("connect.mismatch")),
            Ok(reply) => break Err(pair_error(reply.status)),
            // A moment without the network: asked again until the time is up.
            Err(_) => {}
        }
        tokio::time::sleep(CONFIRM_POLL).await;
    };
    let done = lock(&connect)?.outgoing.take().filter(|o| o.id == id);
    announce(&app, None, None);
    result?;
    let o = done.ok_or_else(|| coded("connect.timeout"))?;
    save_peer(&app, &o.id, &o.name, o.kind, &o.key, &o.secret[..])?;
    connect.keep_pair(&o.id, &o.name, o.kind, &o.key, o.secret);
    lock(&connect)?.devices.apply(Event::Reached { id: o.id, name: o.name, kind: o.kind }, Instant::now());
    announce(&app, None, None);
    connect.status()
}

/// Removes a paired device here, and asks it to remove this one too (if it's there to ask).
#[tauri::command]
pub async fn connect_forget(app: AppHandle, connect: State<'_, Connect>, id: String) -> Result<Status, String> {
    if !auth::is_id(&id) {
        return Err("invalid device".into());
    }
    let _ = call(&app, &id, "/v1/forget", b"{}".to_vec()).await;
    connect.forget_peer(&app, &id);
    connect.status()
}

/// Plays a title on device `id` (it finds the sources itself).
#[tauri::command]
pub async fn connect_play(app: AppHandle, id: String, play: Play) -> Result<(), String> {
    if !play.valid() {
        return Err("invalid title".into());
    }
    let reply = call(&app, &id, "/v1/play", serde_json::to_vec(&play).map_err(|e| e.to_string())?).await?;
    if reply.status == 204 { Ok(()) } else { Err(crate::user_error::coded("connect.refused", &[])) }
}

/// A player command for device `id` (as the phone remote's: pause, seek, volume, tracks, next, stop).
#[tauri::command]
pub async fn connect_control(app: AppHandle, id: String, command: serde_json::Value) -> Result<(), String> {
    let body = serde_json::to_vec(&command).map_err(|e| e.to_string())?;
    if !wire::control_ok(&body) {
        return Err("invalid command".into());
    }
    match call(&app, &id, "/v1/control", body).await?.status {
        204 => Ok(()),
        409 => Err(crate::user_error::coded("connect.not-playing", &[])),
        _ => Err(crate::user_error::coded("connect.refused", &[])),
    }
}

/// What's playing on device `id`, checked and cleaned (wire.rs `Status`).
#[tauri::command]
pub async fn connect_remote_status(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let reply = call(&app, &id, "/v1/status", b"{}".to_vec()).await?;
    let status = (reply.status == 200).then(|| wire::Status::parse(&reply.body)).flatten().ok_or_else(|| crate::user_error::coded("connect.offline", &[]))?;
    serde_json::to_value(status).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const PEER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const NONCE: &str = "00112233445566778899aabbccddeeff";

    fn running() -> Connect {
        let connect = Connect::default();
        {
            let mut inner = connect.inner.lock().unwrap();
            inner.me = Some(Me { id: ME.into(), name: "PC".into(), kind: Kind::Pc });
            inner.identity = Some(Arc::new(Key::generate().unwrap()));
            inner.secrets.insert(PEER.into(), Zeroizing::new([5u8; SECRET_BYTES]));
            inner.devices.add_peer(PEER.into(), "TV".into(), Kind::Tv, Some(PEER_KEY.into()));
        }
        connect
    }

    const PEER_KEY: &str = "1111111111111111111111111111111111111111111111111111111111111111";

    fn offer(id: &str, key: &str) -> PairStart {
        PairStart { id: id.into(), name: "Laptop".into(), kind: Kind::Pc, key: key.into(), fresh: Key::generate().unwrap().public }
    }

    #[test]
    fn a_paired_id_with_another_key_cannot_pair_again() {
        let connect = running();
        let mut inner = connect.inner.lock().unwrap();
        let now = Instant::now();
        // Not open to pairing: nothing else is said.
        assert_eq!(Connect::start_with(&mut inner, &offer(PEER, &"2".repeat(64)), now).err(), Some(PairRefusal::Closed));
        inner.window.open(now);
        assert_eq!(Connect::start_with(&mut inner, &offer(PEER, &"2".repeat(64)), now).err(), Some(PairRefusal::Identity));
        assert_eq!(Connect::start_with(&mut inner, &offer(ME, &"2".repeat(64)), now).err(), Some(PairRefusal::Wrong));
        // With its own key, it may pair again; a new device may too.
        assert!(Connect::start_with(&mut inner, &offer(PEER, PEER_KEY), now).is_ok());
        assert!(Connect::start_with(&mut inner, &offer("cccccccccccccccccccccccccccccccc", &"2".repeat(64)), now).is_ok());
    }

    #[test]
    fn pairings_made_with_a_code_have_to_be_made_again() {
        let key = "a".repeat(64);
        assert_eq!(stored(PEER, "TV", "tv", Some(&key), true), Stored::Usable);
        // Before keys: kept only to say so, its secret no longer used.
        assert_eq!(stored(PEER, "TV", "tv", None, true), Stored::PairAgain);
        assert_eq!(stored(PEER, "TV", "tv", None, false), Stored::PairAgain);
        // A key without its secret, or a damaged row: gone.
        assert_eq!(stored(PEER, "TV", "tv", Some(&key), false), Stored::Drop);
        assert_eq!(stored(PEER, "TV", "tv", Some("zz"), true), Stored::Drop);
        assert_eq!(stored("x", "TV", "tv", Some(&key), true), Stored::Drop);
        assert_eq!(stored(PEER, "TV", "fridge", None, true), Stored::Drop);
    }

    fn signed(secret: [u8; SECRET_BYTES], from: &str, nonce: &str, time: u64, body: &[u8]) -> String {
        auth::Request { method: "POST", path: "/v1/play", to: ME, from, time, nonce, body }.sign(&secret)
    }

    fn check(connect: &Connect, from: &str, nonce: &str, time: u64, signature: &str, body: &[u8], unix: u64) -> Result<String, &'static str> {
        connect.check_request(from, "/v1/play", time, nonce, signature, body, Instant::now(), unix).map(|(_, name)| name).map_err(|e| match e {
            Check::Unknown => "unknown",
            Check::Rejected(auth::Rejected::Stale) => "stale",
            Check::Rejected(auth::Rejected::Replayed) => "replayed",
            Check::Rejected(auth::Rejected::Busy) => "busy",
            Check::TooFast => "too fast",
        })
    }

    #[test]
    fn a_new_ping_loop_stops_the_one_before_it() {
        struct Dropped(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = Dropped(stopped.clone());
        let mut inner = Inner::default();
        set_pinger(&mut inner, Some(tauri::async_runtime::spawn(async move {
            let _flag = flag;
            std::future::pending::<()>().await;
        })));
        set_pinger(&mut inner, Some(tauri::async_runtime::spawn(std::future::pending::<()>())));
        let deadline = Instant::now() + Duration::from_secs(5);
        while !stopped.load(std::sync::atomic::Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(stopped.load(std::sync::atomic::Ordering::SeqCst));
        set_pinger(&mut inner, None);
    }

    #[test]
    fn at_most_max_peers_and_never_itself() {
        let connect = running();
        let mut inner = connect.inner.lock().unwrap();
        assert!(!inner.room_for(ME));
        assert!(inner.room_for(PEER));
        for n in 1..MAX_PEERS {
            inner.secrets.insert(format!("{n:032x}"), Zeroizing::new([1u8; SECRET_BYTES]));
        }
        assert_eq!(inner.secrets.len(), MAX_PEERS);
        // Full: no new device, on either side of a pairing; a paired one may pair again.
        assert!(!inner.room_for("cccccccccccccccccccccccccccccccc"));
        assert!(inner.room_for(PEER));
        inner.me = None;
        assert!(!inner.room_for(PEER));
    }

    #[test]
    fn one_ping_at_a_time_per_device() {
        let connect = running();
        assert!(connect.start_ping(PEER));
        // Announced again (perhaps by anyone) while it's being pinged: no second connection.
        assert!(!connect.start_ping(PEER));
        assert!(connect.start_ping("cccccccccccccccccccccccccccccccc"));
        connect.end_ping(PEER);
        assert!(connect.start_ping(PEER));
    }

    #[test]
    fn a_new_home_network_address_moves_connect() {
        let home = Ipv4Addr::new(192, 168, 1, 20);
        assert!(!moved(home, Some(home)));
        assert!(moved(home, Some(Ipv4Addr::new(192, 168, 1, 37))));
        assert!(moved(home, Some(Ipv4Addr::new(10, 0, 0, 4))));
        // No network for now: it may come back on the same address, so Connect stays as it is.
        assert!(!moved(home, None));
    }

    #[test]
    fn turning_on_or_off_waits_for_a_turn_in_progress() {
        let connect = Connect::default();
        let turn = connect.lifecycle.try_lock().unwrap();
        assert!(connect.lifecycle.try_lock().is_err());
        drop(turn);
        assert!(connect.lifecycle.try_lock().is_ok());
    }

    #[test]
    fn a_paired_devices_signed_request_passes_once() {
        let connect = running();
        let signature = signed([5; SECRET_BYTES], PEER, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, PEER, NONCE, 1000, &signature, b"{}", 1000), Ok("TV".into()));
        assert_eq!(check(&connect, PEER, NONCE, 1000, &signature, b"{}", 1001), Err("replayed"));
    }

    #[test]
    fn unpaired_or_forged_requests_are_refused() {
        let connect = running();
        // Signed with another secret, or by a device that isn't paired.
        let forged = signed([6; SECRET_BYTES], PEER, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, PEER, NONCE, 1000, &forged, b"{}", 1000), Err("unknown"));
        let stranger = "cccccccccccccccccccccccccccccccc";
        let theirs = signed([5; SECRET_BYTES], stranger, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, stranger, NONCE, 1000, &theirs, b"{}", 1000), Err("unknown"));
        // A body changed on the way.
        let signature = signed([5; SECRET_BYTES], PEER, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, PEER, NONCE, 1000, &signature, b"{ }", 1000), Err("unknown"));
        // A refused forgery doesn't use up the real request's nonce.
        assert_eq!(check(&connect, PEER, NONCE, 1000, &signature, b"{}", 1000), Ok("TV".into()));
    }

    #[test]
    fn old_requests_are_refused() {
        let connect = running();
        let signature = signed([5; SECRET_BYTES], PEER, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, PEER, NONCE, 1000, &signature, b"{}", 1000 + auth::MAX_SKEW_SECS + 1), Err("stale"));
    }

    #[test]
    fn nothing_passes_while_connect_is_off() {
        let connect = running();
        connect.inner.lock().unwrap().me = None;
        let signature = signed([5; SECRET_BYTES], PEER, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, PEER, NONCE, 1000, &signature, b"{}", 1000), Err("unknown"));
    }

    #[test]
    fn a_flood_from_a_paired_device_is_slowed() {
        let connect = running();
        let refused = (0..100u32)
            .map(|n| {
                let nonce = format!("{n:032x}");
                let signature = signed([5; SECRET_BYTES], PEER, &nonce, 1000, b"{}");
                check(&connect, PEER, &nonce, 1000, &signature, b"{}", 1000)
            })
            .filter(|r| *r == Err("too fast"))
            .count();
        assert!(refused > 0);
    }

    #[test]
    fn a_flood_from_one_paired_device_cannot_lock_out_the_others() {
        let connect = running();
        let other = "cccccccccccccccccccccccccccccccc";
        connect.inner.lock().unwrap().secrets.insert(other.into(), Zeroizing::new([6u8; SECRET_BYTES]));
        // Far more signed requests than the nonce list holds, all at once: past its burst, each is refused as too fast.
        for n in 0..9000u32 {
            let nonce = format!("{n:032x}");
            let signature = signed([5; SECRET_BYTES], PEER, &nonce, 1000, b"{}");
            let _ = check(&connect, PEER, &nonce, 1000, &signature, b"{}", 1000);
        }
        // Those refusals took no room in the nonce list, so another device's request still passes.
        let signature = signed([6; SECRET_BYTES], other, NONCE, 1000, b"{}");
        assert_eq!(check(&connect, other, NONCE, 1000, &signature, b"{}", 1000), Ok(String::new()));
    }

    #[test]
    fn a_request_refused_as_too_fast_can_be_sent_again() {
        let connect = running();
        let now = Instant::now();
        let send = |n: u32, at: Instant| {
            let nonce = format!("{n:032x}");
            let signature = signed([5; SECRET_BYTES], PEER, &nonce, 1000, b"{}");
            connect.check_request(PEER, "/v1/play", 1000, &nonce, &signature, b"{}", at, 1000).map(|_| ())
        };
        // Its burst used up: the next is refused as too fast.
        let mut n = 0;
        while send(n, now).is_ok() {
            n += 1;
        }
        // Sent again a moment later, it goes through, once.
        assert!(send(n, now + std::time::Duration::from_secs(1)).is_ok());
        assert!(matches!(send(n, now + std::time::Duration::from_secs(2)), Err(Check::Rejected(auth::Rejected::Replayed))));
    }
}
