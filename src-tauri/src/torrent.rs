//! Torrent streams (Settings → Playback, off by default), for addons that
//! offer torrents instead of web links. librqbit downloads the chosen file in
//! playback order while it plays; mpv reads it from a tiny HTTP server here.
//!
//! Hardening, and why:
//! - The server listens on 127.0.0.1 only, under a random secret path, answers
//!   only GET/HEAD for the file now playing, and checks the Host header, so
//!   neither other machines nor web pages (DNS rebinding) can read from it.
//! - The torrent engine opens no peer listening port, no UPnP and no local
//!   discovery: peers are only connected to, never accepted. DHT does bind a
//!   UDP socket (all interfaces, a random port) that other DHT nodes can
//!   reach, from the first torrent until Orbit quits. Uploading is off unless
//!   the person turns it on, since sharing pieces is what exposes torrent
//!   users the most.
//! - Magnet links come from addons, so they're rebuilt from the parts we
//!   understand (info hash, file index, tracker URLs), never passed through.
//! - Only one torrent runs at a time; it's deleted, files and all, when
//!   playback moves on, and the cache folder is emptied at startup.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use librqbit::api::TorrentIdOrHash;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session, SessionOptions};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use crate::episode_files::{self, Wanted, pick_file};

/// How long to wait for a torrent's file list from peers before giving up.
const METADATA_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_TRACKERS: usize = 30;
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the session (its DHT node and connections) outlives playback,
/// so playing again soon (the next episode, another source) doesn't start
/// it from scratch.
const IDLE_GRACE: Duration = Duration::from_secs(60);

/// Tests that set `ORBIT_TORRENT_PEER` run one at a time.
#[cfg(test)]
pub(crate) static TEST_PEER_LOCK: StdMutex<()> = StdMutex::new(());
pub(crate) const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "mov", "webm", "m4v", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg"];

/// Whether one name from a torrent (a file or folder) is safe to create inside
/// the torrent's folder. librqbit refuses `..` and slashes, but on Windows
/// `C:evil.dll` is drive-relative (joining it drops the folder and lands in the
/// working directory, Orbit's install folder: DLL planting), `name:stream` writes
/// a hidden stream of another file, `CON`/`NUL`… are devices, and a trailing dot
/// or space is silently dropped. Elsewhere only an empty name or `.`/`..` matter.
fn safe_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\0']) {
        return false;
    }
    !cfg!(windows) || !(name.contains(['\\', ':']) || name.ends_with(['.', ' ']) || crate::downloads::files::is_reserved(name))
}

/// Whether a file's path inside the torrent (as librqbit built it) is plain names only.
fn safe_relative(path: &std::path::Path) -> bool {
    path.components().all(|c| matches!(c, std::path::Component::Normal(n) if n.to_str().is_some_and(safe_name)))
}

/// The most files a torrent may list. Its metadata can be up to 32 MB (about
/// a million entries), and librqbit creates every file it lists, even when
/// only one is fetched: an empty file and an open handle each. Real season
/// packs and collections stay far below this.
pub(crate) const MAX_TORRENT_FILES: usize = 10_000;

/// Why `SafeNames` refused a torrent with more than `MAX_TORRENT_FILES` files.
#[derive(Debug)]
pub(crate) struct TooManyFiles;

impl std::fmt::Display for TooManyFiles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the torrent lists more than {MAX_TORRENT_FILES} files")
    }
}

impl std::error::Error for TooManyFiles {}

/// Whether adding a torrent failed because it lists too many files.
pub(crate) fn too_many_files(err: &anyhow::Error) -> bool {
    err.chain().any(|e| e.is::<TooManyFiles>())
}

/// librqbit's own file storage, behind a check of every name in the torrent
/// before any file is created: a torrent comes from whoever made it, so its
/// names are untrusted (see `safe_name`), and so is how many files it lists
/// (see `MAX_TORRENT_FILES`). A torrent that fails it doesn't start.
#[derive(Clone, Copy, Default)]
pub(crate) struct SafeNames(librqbit::storage::filesystem::FilesystemStorageFactory);

impl librqbit::storage::StorageFactory for SafeNames {
    type Storage = <librqbit::storage::filesystem::FilesystemStorageFactory as librqbit::storage::StorageFactory>::Storage;

    fn create(&self, shared: &librqbit::ManagedTorrentShared, metadata: &librqbit::TorrentMetadata) -> anyhow::Result<Self::Storage> {
        if metadata.file_infos.len() > MAX_TORRENT_FILES {
            return Err(TooManyFiles.into());
        }
        let name_ok = metadata.info.name().is_none_or(|n| safe_name(&n));
        if !name_ok || !metadata.file_infos.iter().all(|f| safe_relative(&f.relative_filename)) {
            anyhow::bail!("the torrent has a file name that isn't safe here");
        }
        self.0.create(shared, metadata)
    }

    fn is_type_id(&self, type_id: std::any::TypeId) -> bool {
        self.0.is_type_id(type_id)
    }

    fn clone_box(&self) -> librqbit::storage::BoxStorageFactory {
        use librqbit::storage::StorageFactoryExt;
        (*self).boxed()
    }
}

/// What the HTTP server serves: the file now playing, if any.
#[derive(Clone)]
struct Playing {
    torrent: Arc<ManagedTorrent>,
    file: usize,
}

struct Engine {
    session: Arc<Session>,
    upload: bool,
    current: Option<Arc<ManagedTorrent>>,
}

struct Server {
    port: u16,
    token: String,
}

pub struct Torrents {
    cache: PathBuf,
    engine: Mutex<Option<Engine>>,
    server: Mutex<Option<Server>>,
    playing: Arc<StdMutex<Option<Playing>>>,
    /// Bumped per file, so each gets its own address (mpv caches by URL).
    serial: StdMutex<u64>,
    /// Bumped by every open and stop. Adding a torrent can take a while
    /// (its file list comes from peers); one overtaken meanwhile — the
    /// player closed, or moved to another source — is removed rather than
    /// left downloading unseen.
    opens: AtomicU64,
    /// The info hash the latest open wants (None after a stop): an overtaken
    /// open leaves the torrent alone if the newer one wants it too.
    wanted: StdMutex<Option<String>>,
    /// Bumped by every open, stop and file list: the session is stopped after
    /// `IDLE_GRACE` only if nothing used it meanwhile (see `stop_if_idle`).
    activity: AtomicU64,
}

impl Torrents {
    /// Leftovers from last time (e.g. after a crash) are cleared at startup (see `discard_leftovers` in lib.rs).
    pub fn new(cache: PathBuf) -> Self {
        Self { cache, engine: Mutex::new(None), server: Mutex::new(None), playing: Arc::new(StdMutex::new(None)), serial: StdMutex::new(0), opens: AtomicU64::new(0), wanted: StdMutex::new(None), activity: AtomicU64::new(0) }
    }
}

/// The parts of an addon's torrent we use.
#[derive(Debug, PartialEq)]
pub(crate) struct Magnet {
    /// 40 hex characters, lower case.
    pub(crate) info_hash: String,
    pub(crate) file: Option<usize>,
    pub(crate) trackers: Vec<String>,
}

/// Any magnet link Orbit can't use (a pasted one can be cut short or mistyped).
const MAGNET: &str = "err.torrent.magnet";

/// Reads `magnet:?xt=urn:btih:…&so=…&tr=…`, keeping only what's valid.
pub(crate) fn parse_magnet(link: &str) -> Result<Magnet, String> {
    let query = link.strip_prefix("magnet:?").ok_or(MAGNET)?;
    if link.len() > 16 * 1024 {
        return Err(MAGNET.into());
    }
    let mut info_hash = None;
    let mut file = None;
    let mut trackers = Vec::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        // Only the parts used are decoded: a name (`dn`) in Latin-1 or with a
        // bare `%` doesn't cost a link whose hash is fine.
        match key {
            // A v2 hybrid also names its `urn:btmh:` hash; the v1 one is what's played.
            "xt" => {
                if let Some(hash) = percent_decode(value).ok_or(MAGNET)?.strip_prefix("urn:btih:") {
                    info_hash = Some(normalize_hash(hash).ok_or(MAGNET)?);
                }
            }
            // BEP 53 allows a list (`0,2,4-6`); its first file is the one played.
            // One that can't be read leaves the usual pick (episode or largest video).
            "so" => file = percent_decode(value).and_then(|v| v.split([',', '-']).next()?.parse::<usize>().ok()),
            "tr" if trackers.len() < MAX_TRACKERS => {
                if let Some(value) = percent_decode(value).filter(|v| tracker_ok(v)) {
                    trackers.push(value);
                }
            }
            _ => {}
        }
    }
    Ok(Magnet { info_hash: info_hash.ok_or(MAGNET)?, file, trackers })
}

/// Hex (40) or base32 (32) info hashes, as 40 lower-case hex characters.
fn normalize_hash(hash: &str) -> Option<String> {
    if hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(hash.to_ascii_lowercase());
    }
    if hash.len() != 32 {
        return None;
    }
    let mut bits: u64 = 0;
    let mut count = 0;
    let mut out = String::with_capacity(40);
    for c in hash.bytes() {
        let v = match c.to_ascii_uppercase() {
            c @ b'A'..=b'Z' => c - b'A',
            c @ b'2'..=b'7' => c - b'2' + 26,
            _ => return None,
        };
        bits = (bits << 5) | u64::from(v);
        count += 5;
        while count >= 4 {
            count -= 4;
            out.push(char::from_digit(((bits >> count) & 0xF) as u32, 16)?);
        }
    }
    (out.len() == 40).then_some(out)
}

/// Trackers are contacted by librqbit itself: plain udp/http(s) addresses
/// only, never on this machine or the LAN. A magnet comes from an addon, and
/// an announce is a GET to whatever address it names, so a LAN tracker would
/// let a public addon reach a router or a local service (the rule for
/// addon requests). A name that only resolves into the LAN isn't caught
/// here, as librqbit does its own lookups.
fn tracker_ok(url: &str) -> bool {
    if url.len() > 512 || !["udp://", "http://", "https://"].iter().any(|s| url.starts_with(s)) || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    // udp:// isn't a scheme the URL parser knows, so its host is read again as an
    // http one's: `0x7f.1` is then 127.0.0.1, as the system's lookup would take it.
    let host = tauri::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string));
    host.and_then(|h| tauri::Url::parse(&format!("http://{h}/")).ok()).is_some_and(|u| !crate::addons::net::is_private_host(&u))
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Debug builds only: `ORBIT_TORRENT_PEER=127.0.0.1:port` makes the engine use
/// that one peer and nothing else (no DHT, no trackers), so torrent playback
/// can be tested against a local seeder without touching the internet.
pub(crate) fn test_peer() -> Option<std::net::SocketAddr> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("ORBIT_TORRENT_PEER").ok()?.parse().ok().filter(|a: &std::net::SocketAddr| a.ip().is_loopback())
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl Torrents {
    async fn session(&self, upload: bool) -> Result<Arc<Session>, String> {
        let mut engine = self.engine.lock().await;
        if let Some(e) = engine.as_ref().filter(|e| e.upload == upload) {
            return Ok(e.session.clone());
        }
        if let Some(old) = engine.take() {
            old.session.stop().await;
        }
        std::fs::create_dir_all(&self.cache).map_err(|e| e.to_string())?;
        let test_peer = test_peer();
        let opts = SessionOptions {
            // DHT finds peers without trackers; its state isn't kept between runs.
            dht: test_peer.is_none().then(|| librqbit::DhtSessionConfig { persistence: None, ..Default::default() }),
            disable_trackers: test_peer.is_some(),
            listen: None,
            disable_upload: !upload,
            // Every name in a torrent is checked before its files are made (see `SafeNames`).
            default_storage_factory: Some(librqbit::storage::StorageFactoryExt::boxed(crate::torrent::SafeNames::default())),
            disable_local_service_discovery: true,
            ..Default::default()
        };
        let session = Session::new_with_opts(self.cache.clone(), opts).await.map_err(|e| format!("Couldn’t start torrents: {e}"))?;
        *engine = Some(Engine { session: session.clone(), upload, current: None });
        Ok(session)
    }

    async fn server_url(&self) -> Result<String, String> {
        let mut server = self.server.lock().await;
        if server.is_none() {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let token = random_token()?;
            let (playing, secret) = (self.playing.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                while let Ok((socket, _)) = listener.accept().await {
                    let (playing, secret) = (playing.clone(), secret.clone());
                    tauri::async_runtime::spawn(async move {
                        let _ = serve(socket, port, &secret, &playing).await;
                    });
                }
            });
            *server = Some(Server { port, token });
        }
        let s = server.as_ref().ok_or("no server")?;
        let serial = {
            let mut n = self.serial.lock().map_err(|_| "unavailable")?;
            *n += 1;
            *n
        };
        Ok(format!("http://127.0.0.1:{}/{}/{serial}", s.port, s.token))
    }

    /// The torrent playing, if it's `info_hash` in a session with the same
    /// upload choice: it's kept for the next file. Stops serving the old file.
    async fn keep_if_same(&self, info_hash: &str, upload: bool) -> Option<Arc<ManagedTorrent>> {
        if let Ok(mut playing) = self.playing.lock() {
            *playing = None;
        }
        let engine = self.engine.lock().await;
        engine.as_ref().filter(|e| e.upload == upload).and_then(|e| e.current.clone()).filter(|h| h.info_hash().as_string() == info_hash)
    }

    /// Notes that torrents are in use; returns the mark `stop_if_idle` compares with.
    fn note_activity(&self) -> u64 {
        self.activity.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Stops the session if nothing has used torrents since `seen` and nothing
    /// is playing. Checked under the engine's lock, so an open starting now
    /// waits and then makes a fresh session. Returns whether it stopped.
    async fn stop_if_idle(&self, seen: u64) -> bool {
        let mut engine = self.engine.lock().await;
        if self.activity.load(Ordering::SeqCst) != seen || engine.as_ref().is_some_and(|e| e.current.is_some()) {
            return false;
        }
        match engine.take() {
            Some(old) => {
                old.session.stop().await;
                true
            }
            None => false,
        }
    }

    /// Removes the torrent that was playing, with its downloaded files.
    async fn stop_current(&self) {
        if let Ok(mut playing) = self.playing.lock() {
            *playing = None;
        }
        let mut engine = self.engine.lock().await;
        if let Some(e) = engine.as_mut()
            && let Some(old) = e.current.take()
        {
            let _ = e.session.delete(TorrentIdOrHash::Hash(old.info_hash()), true).await;
        }
    }
}

/// Answers one request from mpv: GET or HEAD of the playing file, with Range support.
async fn serve(mut socket: TcpStream, port: u16, secret: &str, playing: &StdMutex<Option<Playing>>) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    // The request must arrive promptly; the body that follows can take as long as the film.
    let read_request = async {
        while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = socket.read(&mut chunk).await?;
            if n == 0 || buf.len() + n > MAX_REQUEST_BYTES {
                return Ok(false);
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        Ok::<_, std::io::Error>(true)
    };
    if !tokio::time::timeout(REQUEST_TIMEOUT, read_request).await.unwrap_or(Ok(false))? {
        return Ok(());
    }
    let request = String::from_utf8_lossy(&buf);
    let mut lines = request.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split(' ');
    let (method, path) = (first.next().unwrap_or_default(), first.next().unwrap_or_default());
    let header = |name: &str| lines.clone().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_string()));
    let host_ok = header("host").is_some_and(|h| h == format!("127.0.0.1:{port}"));
    let path_ok = path.strip_prefix('/').and_then(|p| p.split_once('/')).is_some_and(|(token, _)| token == secret);
    let current = playing.lock().ok().and_then(|p| p.clone());
    let (Some(current), true, true, true) = (current, host_ok, path_ok, method == "GET" || method == "HEAD") else {
        return socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
    };
    let Ok(mut stream) = current.torrent.clone().stream(current.file).await else {
        return socket.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
    };
    let len = stream.len();
    let range = header("range").and_then(|r| parse_range(&r, len));
    let (start, end, status) = match range {
        Some((s, e)) => (s, e, "206 Partial Content"),
        None if header("range").is_some() => {
            let head = format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return socket.write_all(head.as_bytes()).await;
        }
        None => (0, len, "200 OK"),
    };
    let mut head = format!("HTTP/1.1 {status}\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nConnection: close\r\n", end - start);
    if range.is_some() {
        head.push_str(&format!("Content-Range: bytes {start}-{}/{len}\r\n", end.saturating_sub(1)));
    }
    head.push_str("\r\n");
    socket.write_all(head.as_bytes()).await?;
    if method == "HEAD" {
        return Ok(());
    }
    stream.seek(std::io::SeekFrom::Start(start)).await?;
    let mut body = stream.take(end - start);
    tokio::io::copy(&mut body, &mut socket).await.map(|_| ())
}

/// `bytes=start-[end]` as a half-open range within `len`, or None if unusable.
fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end = if end.trim().is_empty() { len } else { end.trim().parse::<u64>().ok()?.saturating_add(1).min(len) };
    (start < end && start < len).then_some((start, end))
}

/// Live numbers for the loading screen.
#[derive(serde::Serialize)]
pub struct TorrentStatus {
    peers: u32,
    /// Megabytes per second.
    speed: f64,
}

/// Starts streaming a torrent an addon offered and returns the local address
/// for the player. Replaces whatever torrent was playing before, except when
/// it's the same torrent (the next episode of a season pack): that one keeps
/// its peers and file list, and only the file changes. `episode` is the
/// episode wanted, to find it among a pack's files when the addon didn't say
/// which (see episode_files.rs); a file picked by hand comes without it.
#[tauri::command]
pub async fn torrent_open(app: AppHandle, torrents: State<'_, Torrents>, magnet: String, upload: bool, episode: Option<Wanted>) -> Result<String, String> {
    let opened = open(&torrents, &magnet, upload, episode).await;
    // Nothing plays after a failed open: the session goes after the grace period, as after a stop.
    if opened.is_err() {
        stop_later(&app);
    }
    opened
}

async fn open(torrents: &Torrents, magnet: &str, upload: bool, episode: Option<Wanted>) -> Result<String, String> {
    let link = parse_magnet(magnet)?;
    let episode = episode.filter(Wanted::valid);
    torrents.note_activity();
    let run = torrents.opens.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut wanted) = torrents.wanted.lock() {
        *wanted = Some(link.info_hash.clone());
    }
    let current = || torrents.opens.load(Ordering::SeqCst) == run;
    let kept = torrents.keep_if_same(&link.info_hash, upload).await;
    if kept.is_none() {
        torrents.stop_current().await;
    }
    let session = torrents.session(upload).await?;
    let handle = match kept.clone() {
        Some(handle) => handle,
        None => {
            let options = AddTorrentOptions {
                initial_peers: test_peer().map(|p| vec![p]),
                only_files: link.file.map(|f| vec![f]),
                overwrite: true,
                trackers: (!link.trackers.is_empty()).then_some(link.trackers),
                ..Default::default()
            };
            // Adding a magnet waits for its file list from peers, so the time limit covers it too.
            // librqbit's errors aren't shown: they can carry tracker addresses, which may hold passkeys.
            let added = tokio::time::timeout(METADATA_TIMEOUT, session.add_torrent(AddTorrent::from_url(format!("magnet:?xt=urn:btih:{}", link.info_hash)), Some(options)))
                .await
                .map_err(|_| "err.torrent.no-peers".to_string())?
                .map_err(|e| if too_many_files(&e) { "err.torrent.too-many-files" } else { "err.torrent.add" }.to_string())?;
            let handle = match added {
                AddTorrentResponse::Added(_, h) | AddTorrentResponse::AlreadyManaged(_, h) => h,
                AddTorrentResponse::ListOnly(_) => return Err("err.torrent.add".into()),
            };
            let mut engine = torrents.engine.lock().await;
            if !current() {
                let still_wanted = torrents.wanted.lock().is_ok_and(|w| w.as_deref() == Some(link.info_hash.as_str()));
                if !still_wanted {
                    let _ = session.delete(TorrentIdOrHash::Hash(handle.info_hash()), true).await;
                }
                return Err(STOPPED.into());
            }
            if let Some(e) = engine.as_mut() {
                e.current = Some(handle.clone());
            }
            handle
        }
    };
    let ready = async {
        tokio::time::timeout(METADATA_TIMEOUT, handle.wait_until_initialized())
            .await
            .map_err(|_| "err.torrent.no-peers".to_string())?
            .map_err(|_| "err.torrent.start".to_string())?;
        let (files, name) = file_list(&handle)?;
        let file = pick_file(&files, link.file, episode, &name)?;
        // The file is cached in full while it plays: refused up front rather than failing when the drive fills.
        let have = handle.stats().file_progress.get(file).copied().unwrap_or(0);
        let needed = files.get(file).map(|(_, len)| len.saturating_sub(have));
        if !crate::downloads::files::has_room(crate::downloads::files::free_space(&torrents.cache), needed) {
            return Err("err.torrent.no-space".to_string());
        }
        Ok(file)
    };
    let file = match ready.await {
        Ok(file) => file,
        Err(err) => {
            // Nothing plays it, so nothing may keep downloading for it (a whole pack, with no file
            // picked): removed as `stop_current` does. While it's the current torrent, `stop_if_idle`
            // would never end the session either. Checked under the engine lock: a newer open of the
            // same torrent may have kept it, and is left alone.
            let mut engine = torrents.engine.lock().await;
            if current()
                && let Some(e) = engine.as_mut()
                && let Some(old) = e.current.take()
            {
                let _ = e.session.delete(TorrentIdOrHash::Hash(old.info_hash()), true).await;
            }
            return Err(err);
        }
    };
    // Only the file playing is fetched (a kept torrent was fetching the previous one).
    if kept.is_some() || link.file != Some(file) {
        // Under the engine lock, and only while this is still the open wanted: an older open of the
        // same pack waking up late (another episode asked for since) mustn't put its file back.
        let _engine = torrents.engine.lock().await;
        if !current() {
            return Err(STOPPED.into());
        }
        // librqbit's errors aren't shown (see above).
        session.update_only_files(&handle, &HashSet::from([file])).await.map_err(|_| "err.torrent.start".to_string())?;
    }
    {
        let mut playing = torrents.playing.lock().map_err(|_| "unavailable")?;
        // Checked under the lock: a later open or stop clears `playing` after this.
        if !current() {
            return Err(STOPPED.into());
        }
        *playing = Some(Playing { torrent: handle, file });
    }
    torrents.server_url().await
}

/// A torrent's files as (path, size), paths joined with "/", and its name.
pub(crate) fn file_list(handle: &ManagedTorrent) -> Result<(Vec<(String, u64)>, String), String> {
    let files = handle
        .with_metadata(|m| m.file_infos.iter().map(|f| (joined(&f.relative_filename), f.len)).collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    Ok((files, handle.name().unwrap_or_default()))
}

fn joined(path: &std::path::Path) -> String {
    path.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

/// One file of a torrent, for the file picker. The name is the torrent's (untrusted), cleaned by `shown`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    index: usize,
    name: String,
    size: u64,
    video: bool,
    /// A sample, trailer or other extra.
    extra: bool,
    season: Option<u32>,
    episode: Option<u32>,
    /// A double episode's last number.
    last_episode: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFiles {
    files: Vec<TorrentFile>,
    /// The file that would play for this magnet and episode.
    chosen: Option<usize>,
    /// The file playing now, if this is the torrent playing.
    playing: Option<usize>,
}

/// A torrent with thousands of files is no season pack; the picker lists this many at most.
const MAX_LISTED: usize = 5000;

fn describe(files: &[(String, u64)], name: &str, index: Option<usize>, episode: Option<Wanted>, playing: Option<usize>) -> TorrentFiles {
    let listed = files
        .iter()
        .enumerate()
        .take(MAX_LISTED)
        .map(|(i, (path, size))| {
            let numbered = episode_files::parse(path, name);
            TorrentFile {
                index: i,
                name: episode_files::shown(path),
                size: *size,
                video: episode_files::is_video(path),
                extra: episode_files::is_extra(path),
                season: numbered.and_then(|n| n.season),
                episode: numbered.map(|n| n.first),
                last_episode: numbered.filter(|n| n.last != n.first).map(|n| n.last),
            }
        })
        .collect();
    TorrentFiles { files: listed, chosen: pick_file(files, index, episode, name).ok(), playing }
}

/// The files of a torrent an addon offered, to choose one. The torrent playing
/// answers at once; any other is asked of its peers for its file list only
/// (nothing is downloaded).
#[tauri::command]
pub async fn torrent_files(app: AppHandle, torrents: State<'_, Torrents>, magnet: String, episode: Option<Wanted>) -> Result<TorrentFiles, String> {
    torrents.note_activity();
    let files = files_of(&torrents, &magnet, episode).await;
    // Asked without playing (the picker closed): the session doesn't stay for nothing.
    stop_later(&app);
    files
}

async fn files_of(torrents: &Torrents, magnet: &str, episode: Option<Wanted>) -> Result<TorrentFiles, String> {
    let link = parse_magnet(magnet)?;
    let episode = episode.filter(Wanted::valid);
    let playing = torrents.playing.lock().ok().and_then(|p| p.clone()).filter(|p| p.torrent.info_hash().as_string() == link.info_hash);
    if let Some(p) = playing {
        let (files, name) = file_list(&p.torrent)?;
        return Ok(describe(&files, &name, link.file, episode, Some(p.file)));
    }
    // Any session will do for a file list; one already running isn't restarted.
    let running = torrents.engine.lock().await.as_ref().map(|e| e.session.clone());
    let session = match running {
        Some(s) => s,
        None => torrents.session(false).await?,
    };
    let options = AddTorrentOptions {
        list_only: true,
        initial_peers: test_peer().map(|p| vec![p]),
        trackers: (!link.trackers.is_empty()).then_some(link.trackers),
        ..Default::default()
    };
    // As in `torrent_open`, librqbit's errors aren't shown.
    let added = tokio::time::timeout(METADATA_TIMEOUT, session.add_torrent(AddTorrent::from_url(format!("magnet:?xt=urn:btih:{}", link.info_hash)), Some(options)))
        .await
        .map_err(|_| "err.torrent.no-peers".to_string())?
        .map_err(|_| "err.torrent.read".to_string())?;
    let (files, name) = match added {
        AddTorrentResponse::ListOnly(list) => (
            list.info.iter_file_details().map(|d| (d.filename.to_vec().join("/"), d.len)).collect::<Vec<_>>(),
            list.info.name().map(|n| n.into_owned()).unwrap_or_default(),
        ),
        AddTorrentResponse::Added(_, h) | AddTorrentResponse::AlreadyManaged(_, h) => file_list(&h)?,
    };
    Ok(describe(&files, &name, link.file, episode, None))
}

/// What an open overtaken by another open or a stop answers (the page has moved on and ignores it).
const STOPPED: &str = "This torrent was stopped.";

/// Playback left the torrent: stop it and delete what it downloaded.
#[tauri::command]
pub async fn torrent_stop(app: AppHandle, torrents: State<'_, Torrents>) -> Result<(), String> {
    torrents.opens.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut wanted) = torrents.wanted.lock() {
        *wanted = None;
    }
    torrents.stop_current().await;
    stop_later(&app);
    Ok(())
}

/// Stops the session after `IDLE_GRACE` unless torrents are used again
/// meanwhile: no DHT node or connections are kept with nothing playing.
fn stop_later(app: &AppHandle) {
    let seen = app.state::<Torrents>().note_activity();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_GRACE).await;
        app.state::<Torrents>().stop_if_idle(seen).await;
    });
}

#[tauri::command]
pub async fn torrent_status(torrents: State<'_, Torrents>) -> Result<Option<TorrentStatus>, String> {
    let engine = torrents.engine.lock().await;
    let Some(current) = engine.as_ref().and_then(|e| e.current.clone()) else { return Ok(None) };
    let live = current.stats().live;
    Ok(Some(TorrentStatus {
        peers: live.as_ref().map_or(0, |l| l.snapshot.peer_stats.live),
        speed: live.as_ref().map_or(0.0, |l| l.download_speed.mbps),
    }))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let _ = librqbit::torrent_from_bytes(data);
    let text = String::from_utf8_lossy(data);
    let _ = parse_magnet(&text);
    let _ = crate::episode_files::parse(&text, &text);
    let _ = normalize_hash(&text);
    let _ = percent_decode(&text);
    for len in [0, 1, u64::MAX] {
        if let Some((a, b)) = parse_range(&text, len) {
            assert!(a < b && b <= len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A file's path the way librqbit builds it: each name pushed in turn.
    fn torrent_path(names: &[&str]) -> PathBuf {
        let mut path = PathBuf::new();
        for name in names {
            path.push(name);
        }
        path
    }

    #[test]
    fn refuses_torrent_names_that_leave_the_folder() {
        for names in [&["Show", "S01E01.mkv"][..], &["Movie.2020.1080p.mkv"], &["Console", "file.txt"]] {
            assert!(safe_relative(&torrent_path(names)), "{names:?}");
        }
        assert!(!safe_relative(&torrent_path(&[".."])));
        assert!(!safe_name(""));
        if cfg!(windows) {
            // Drive-relative: pushing it drops the folder.
            assert!(!safe_relative(&torrent_path(&["Show", "C:version.dll"])));
            assert!(!safe_relative(&torrent_path(&["c:.."])));
            for name in ["file.mkv:hidden", "CON", "nul.txt", "COM1.mkv", "conout$", "LPT¹", "trailing.", "trailing "] {
                assert!(!safe_relative(&torrent_path(&["Show", name])), "{name}");
            }
        }
    }

    #[test]
    fn trackers_never_lead_into_this_machine_or_the_lan() {
        for ok in ["udp://tracker.example:80/announce", "https://tracker.example/announce", "http://93.184.215.14:6969/announce"] {
            assert!(tracker_ok(ok), "{ok}");
        }
        // An addon's magnet would otherwise have librqbit send GET requests to a router or a local service.
        for bad in [
            "http://192.168.1.1/apply.cgi?reboot=1",
            "http://127.0.0.1:8080/announce",
            "udp://10.0.0.1:80",
            "http://localhost:9000/x",
            "https://[::1]/announce",
            "http://169.254.169.254/latest/meta-data",
            "http://0x7f.1/announce",
            "udp://[fd00::1]:80",
            "udp://0x7f.1:80",
            "udp://2130706433:80",
        ] {
            assert!(!tracker_ok(bad), "{bad}");
        }
    }

    #[test]
    fn reads_magnets_keeping_only_known_parts() {
        let m = parse_magnet("magnet:?xt=urn:btih:08ADA5A7A6183AAE1E09D831DF6748D566095A10&dn=Sintel&so=2&tr=udp%3A%2F%2Ftracker.example%3A80&tr=javascript%3Aalert(1)&tr=file%3A%2F%2F%2Fetc").unwrap();
        assert_eq!(m.info_hash, "08ada5a7a6183aae1e09d831df6748d566095a10");
        assert_eq!(m.file, Some(2));
        assert_eq!(m.trackers, vec!["udp://tracker.example:80"]);
        assert!(parse_magnet("https://x/y.torrent").is_err());
        assert!(parse_magnet("magnet:?dn=no-hash").is_err());
        assert!(parse_magnet("magnet:?xt=urn:btih:xyz").is_err());
    }

    #[test]
    fn magnets_with_unreadable_extras_still_play() {
        const HASH: &str = "08ada5a7a6183aae1e09d831df6748d566095a10";
        // A Latin-1 or bare-`%` name, and a tracker that doesn't decode, are skipped.
        for link in [
            format!("magnet:?xt=urn:btih:{HASH}&dn=Am%E9lie"),
            format!("magnet:?xt=urn:btih:{HASH}&dn=100%+Wolf"),
            format!("magnet:?xt=urn:btih:{HASH}&tr=udp%3A%2F%2Fbad%E9%3A80&tr=udp%3A%2F%2Ftracker.example%3A80"),
        ] {
            let m = parse_magnet(&link).unwrap();
            assert_eq!(m.info_hash, HASH, "{link}");
            assert_eq!(m.trackers.len(), usize::from(link.contains("tracker.example")), "{link}");
        }
        // BEP 53 lists play their first file; one that can't be read leaves the usual pick.
        assert_eq!(parse_magnet(&format!("magnet:?xt=urn:btih:{HASH}&so=0,2")).unwrap().file, Some(0));
        assert_eq!(parse_magnet(&format!("magnet:?xt=urn:btih:{HASH}&so=4-6")).unwrap().file, Some(4));
        assert_eq!(parse_magnet(&format!("magnet:?xt=urn:btih:{HASH}&so=-1")).unwrap().file, None);
        // The hash itself is still checked.
        assert!(parse_magnet("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a1%E9").is_err());
    }

    #[test]
    fn hybrid_magnets_play_by_their_v1_hash() {
        // A BitTorrent v2 hybrid names both hashes; the v1 one (btih) is what plays.
        for link in [
            "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&xt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e&dn=Sintel",
            "magnet:?xt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e&xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10",
        ] {
            assert_eq!(parse_magnet(link).unwrap().info_hash, "08ada5a7a6183aae1e09d831df6748d566095a10", "{link}");
        }
        // Only a v2 hash: nothing Orbit can play.
        assert!(parse_magnet("magnet:?xt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e").is_err());
    }

    #[test]
    fn base32_hashes_become_hex() {
        // 20 zero bytes in base32 and hex.
        assert_eq!(normalize_hash("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").as_deref(), Some("0000000000000000000000000000000000000000"));
        assert_eq!(normalize_hash("MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U").as_deref(), Some("6162636465666768696a6b6c6d6e6f7071727374"));
        assert_eq!(normalize_hash("not-a-hash"), None);
    }

    /// After playback stops, the session (its DHT node and connections) is
    /// let go of once the grace period passes, unless torrents were used again
    /// meanwhile (a quick replay keeps it).
    #[test]
    fn an_idle_session_stops_unless_used_again() {
        let _peer = TEST_PEER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // A peer on 127.0.0.1 only: no DHT and no trackers, so nothing touches the internet.
        // SAFETY: every test that reads or writes this variable holds `TEST_PEER_LOCK`.
        unsafe { std::env::set_var("ORBIT_TORRENT_PEER", "127.0.0.1:9") };
        tauri::async_runtime::block_on(async {
            let cache = std::env::temp_dir().join(format!("orbit-idle-test-{}", std::process::id()));
            let torrents = Torrents::new(cache.clone());
            torrents.session(false).await.unwrap();
            let seen = torrents.note_activity();
            // Played again within the grace period: kept.
            torrents.note_activity();
            assert!(!torrents.stop_if_idle(seen).await);
            assert!(torrents.engine.lock().await.is_some());
            let seen = torrents.note_activity();
            assert!(torrents.stop_if_idle(seen).await);
            assert!(torrents.engine.lock().await.is_none());
            let _ = std::fs::remove_dir_all(&cache);
        });
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 100)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 20)));
        assert_eq!(parse_range("bytes=90-500", 100), Some((90, 100)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=5-2", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }
}
