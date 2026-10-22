//! Phone remote: control Orbit from a phone's browser on the same network.
//!
//! Off by default. Turned on (Settings → General → Phone remote, Quick
//! settings or Ctrl+K), Rust serves a small page on this PC's private home
//! network address at a random port, and shows a QR code and a 6-digit code
//! to pair a phone with (see guard.rs). It stops when turned off and when
//! Orbit quits.
//!
//! What the phone sees: what's playing (title, episode, position, tracks and
//! the poster, fetched here so the phone never gets an addon's address),
//! search results, the picker's titles (Home's rows, mood picks, a surprise
//! and one title's details; see picker.rs), and nothing else. What it can do: the commands in
//! command.rs, each checked here, then handed to the page as
//! `remote://command`, where they run through the same actions as the
//! keyboard (so profile limits and every other rule still apply).
//!
//! Playback state comes from the player's own mpv events (see player/mod.rs);
//! the page adds the title, episode and poster, and search results.

pub(crate) mod checks;
pub(crate) mod command;
pub(crate) mod guard;
mod picker;
pub(crate) mod server;

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

pub use command::Command;
use guard::Guard;

/// The page hears commands here.
const COMMAND_EVENT: &str = "remote://command";
/// And here, when a phone pairs or pairing closes (Settings redraws, a toast says so).
const CHANGED_EVENT: &str = "remote://changed";
/// The phone page's strings, at most.
const MAX_STRINGS: usize = 120;
const MAX_STRING_CHARS: usize = 400;
/// Text about what's playing (title, episode line), in characters.
const MAX_TEXT_CHARS: usize = 200;
const MAX_ART_URL: usize = 2048;
/// Search results the phone gets.
const MAX_RESULTS: usize = 20;
/// Posters kept for the phone, so redraws don't fetch them again: at most
/// this many (the picker's rows hold a few hundred), and this many bytes.
const ART_CACHE: usize = 160;
const ART_CACHE_BYTES: usize = 32 * 1024 * 1024;

/// Volume, position and the rest, from mpv (see player/mod.rs).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub paused: bool,
    pub buffering: bool,
    pub volume: Option<f64>,
    pub muted: bool,
}

/// An audio or subtitle track, from mpv's track list.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    #[serde(skip)]
    pub audio: bool,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub selected: bool,
}

/// What's playing, as the page describes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NowPlaying {
    title: String,
    /// The episode line, e.g. "S1 · E3 · Pilot".
    detail: Option<String>,
    /// Its poster (an addon's https address). Fetched here; never sent to the phone.
    poster: Option<String>,
    live: bool,
    can_next: bool,
    /// 100, or 150 with "Allow volume above 100%".
    max_volume: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoundTitle {
    name: String,
    year: Option<String>,
    /// "movie" or "series" (anything else shows without a kind).
    kind: String,
    poster: Option<String>,
}

/// The phone page's words in the interface's language (the `remote.phone.*` strings).
#[derive(Deserialize, Serialize, Default, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PhoneStrings {
    lang: String,
    rtl: bool,
    strings: BTreeMap<String, String>,
}

#[derive(Default)]
struct Search {
    id: u64,
    query: String,
    done: bool,
    failed: bool,
    results: Vec<FoundTitle>,
}

#[derive(Default)]
struct Inner {
    guard: Guard,
    server: Option<server::Running>,
    strings: PhoneStrings,
    /// Bumped when the words change (Orbit's language), so an open phone page fetches them again.
    words: u64,
    now: Option<NowPlaying>,
    /// Bumped with each new title, so the phone asks for the new poster.
    now_serial: u64,
    playback: Playback,
    tracks: Vec<Track>,
    search: Search,
    picker: picker::Picker,
    /// Recently fetched posters by address: bytes and content type.
    art: Vec<(String, hyper::body::Bytes, &'static str)>,
    /// Counts each time the remote is turned on, so a network watcher from an earlier time stops.
    generation: u64,
}

/// How often the remote checks it's still on this PC's home-network address.
const NETWORK_CHECK: std::time::Duration = std::time::Duration::from_secs(15);

/// Moves the remote to this PC's new home-network address when it changes (another Wi-Fi, a new
/// address from the router). The server listens on one address and the QR code names it, so
/// otherwise phones would be sent to an address that's gone until the remote is turned off and on.
/// A phone's session lives in a cookie for the old address, which its browser won't send to the new
/// one: so phones are forgotten and a new pairing opens. Ends when the remote is turned off (or on again).
async fn follow_network(app: AppHandle, generation: u64) {
    loop {
        tokio::time::sleep(NETWORK_CHECK).await;
        let remote = app.state::<Remote>();
        let Some(listening) = remote.lock().ok().filter(|inner| inner.generation == generation).and_then(|inner| inner.server.as_ref().map(|s| *s.addr.ip())) else { return };
        if !crate::connect::moved(listening, server::lan_address()) {
            continue;
        }
        // Couldn't start there yet (the adapter still coming up): the next round tries again.
        let Ok(started) = server::start(app.clone()).await else { continue };
        let moved = remote.lock().is_ok_and(|mut inner| {
            if inner.generation != generation || inner.server.is_none() {
                return false;
            }
            inner.server = Some(started);
            inner.guard.clear();
            Remote::open_pairing(&mut inner).is_ok()
        });
        if moved {
            remote.bump();
            announce(&app, "moved");
        }
    }
}

pub struct Remote {
    inner: Mutex<Inner>,
    /// Bumped whenever something the phone shows changes; its live updates wait on it.
    changed: watch::Sender<u64>,
}

impl Default for Remote {
    fn default() -> Self {
        Self { inner: Mutex::default(), changed: watch::channel(0).0 }
    }
}

/// What Settings shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    running: bool,
    /// The address to type by hand, e.g. `http://192.168.1.20:51234`.
    address: Option<String>,
    /// The QR code's link, which carries the one-time pairing token.
    pair_url: Option<String>,
    code: Option<String>,
    /// Seconds left to pair with the code.
    expires_in: Option<u64>,
    qr: Option<Qr>,
    devices: usize,
    max_devices: usize,
    /// Pairing closed after too many wrong codes.
    locked: bool,
}

/// A QR code's modules, row by row: `size` × `size` of '1' (dark) or '0'.
#[derive(Serialize)]
struct Qr {
    size: usize,
    cells: String,
}

fn qr(text: &str) -> Option<Qr> {
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M).ok()?;
    let cells = code.to_colors().iter().map(|c| if *c == qrcode::Color::Dark { '1' } else { '0' }).collect();
    Some(Qr { size: code.width(), cells })
}

pub(crate) fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "couldn’t make a pairing code")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Six random digits (without the slight bias a plain remainder would have).
pub(crate) fn random_code() -> Result<String, String> {
    loop {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).map_err(|_| "couldn’t make a pairing code")?;
        let n = u32::from_le_bytes(bytes);
        if n < u32::MAX - u32::MAX % 1_000_000 {
            return Ok(format!("{:06}", n % 1_000_000));
        }
    }
}

/// Text from the page, as shown on the phone: no control characters, capped.
fn clean(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_owned()
}

/// A poster address worth keeping: https and short. It's checked again (`check_artwork_url`) when fetched.
fn art_url(url: Option<String>) -> Option<String> {
    url.filter(|u| u.len() <= MAX_ART_URL && u.starts_with("https://"))
}

impl Inner {
    /// The ids of the playing file's audio (or subtitle) tracks: the only ones a command may pick.
    fn track_ids(&self, audio: bool) -> Vec<i64> {
        self.tracks.iter().filter(|t| t.audio == audio).map(|t| t.id).collect()
    }

    /// What's playing as a phone sees it; `art` adds the poster's address on this server.
    fn playing_json(&self, art: bool) -> Option<serde_json::Value> {
        self.now.as_ref().map(|now| {
            let tracks = |audio: bool| self.tracks.iter().filter(|t| t.audio == audio).collect::<Vec<_>>();
            serde_json::json!({
                "title": now.title,
                "detail": now.detail,
                "live": now.live,
                "canNext": now.can_next,
                "maxVolume": now.max_volume,
                "art": if art { now.poster.as_ref().map(|_| format!("/art/now?v={}", self.now_serial)) } else { None },
                "playback": self.playback,
                "audio": tracks(true),
                "subtitles": tracks(false),
            })
        })
    }

    /// What a command is checked against (command.rs): what's on screen right now.
    fn context<'a>(&'a self, audio: &'a [i64], subtitles: &'a [i64]) -> command::Context<'a> {
        command::Context {
            playing: self.now.is_some(),
            can_next: self.now.as_ref().is_some_and(|n| n.can_next),
            audio,
            subtitles,
            search: self.search.id,
            results: if self.search.done { self.search.results.len() } else { 0 },
            picker: self.picker.view(),
        }
    }
}

impl Remote {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner.lock().map_err(|_| "phone remote unavailable".to_string())
    }

    fn bump(&self) {
        self.changed.send_modify(|v| *v = v.wrapping_add(1));
    }

    fn status(&self) -> Result<Status, String> {
        let mut inner = self.lock()?;
        let now = Instant::now();
        let address = inner.server.as_ref().map(|s| format!("http://{}", s.addr));
        let locked = inner.guard.locked();
        let devices = inner.guard.devices(now);
        let pairing = address.as_ref().and_then(|a| inner.guard.pairing(now).map(|p| (format!("{a}/#pair={}", p.token), p.code.clone(), p.remaining(now).as_secs())));
        let (pair_url, code, expires_in) = match pairing {
            Some((url, code, left)) => (Some(url), Some(code), Some(left)),
            None => (None, None, None),
        };
        Ok(Status {
            running: address.is_some(),
            qr: pair_url.as_deref().and_then(qr),
            address,
            pair_url,
            code,
            expires_in,
            devices,
            max_devices: guard::MAX_DEVICES,
            locked,
        })
    }

    fn open_pairing(inner: &mut Inner) -> Result<(), String> {
        inner.guard.open_pairing(random_hex()?, random_code()?, Instant::now());
        Ok(())
    }

    /// Stops the server and forgets every phone. Called on quit too.
    pub fn shutdown(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            // Dropping it stops the server and closes every connection.
            inner.server = None;
            // Its network watcher stops.
            inner.generation += 1;
            inner.guard = Guard::default();
            inner.search = Search::default();
            inner.picker.clear();
            inner.art.clear();
        }
        self.bump();
    }

    /// Forgets the picker's titles: on a profile switch they were the last profile's.
    pub fn clear_picker(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.picker.clear();
        }
        self.bump();
    }

    /// Forgets the phone's search: on a profile switch its results were the last profile's.
    pub fn clear_search(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            // The id stays, so the next search's is still newer than any the page has seen.
            let id = inner.search.id;
            inner.search = Search { id, ..Default::default() };
        }
        self.bump();
    }

    /// Keeps search `id`'s results; false (and nothing changes) for an older search, or one
    /// cleared meanwhile: a result still on its way at a profile switch keeps the same id.
    fn set_search_results(&self, id: u64, results: Vec<FoundTitle>, failed: bool) -> Result<bool, String> {
        let mut inner = self.lock()?;
        if inner.search.id != id || inner.search.query.is_empty() {
            return Ok(false);
        }
        inner.search.results = results
            .into_iter()
            .take(MAX_RESULTS)
            .map(|r| FoundTitle {
                name: clean(&r.name, MAX_TEXT_CHARS),
                year: r.year.map(|y| clean(&y, 20)).filter(|y| !y.is_empty()),
                kind: if r.kind == "movie" || r.kind == "series" { r.kind } else { String::new() },
                poster: art_url(r.poster),
            })
            .collect();
        inner.search.done = true;
        inner.search.failed = failed;
        Ok(true)
    }

    /// The phone page's live state, as JSON.
    fn snapshot(&self) -> String {
        let Ok(inner) = self.inner.lock() else { return "{}".into() };
        let playing = inner.playing_json(true);
        // A search always has a query; none means none was made, or it was cleared.
        let search = (!inner.search.query.is_empty()).then(|| {
            let s = &inner.search;
            let results: Vec<_> = s
                .results
                .iter()
                .enumerate()
                .map(|(i, r)| serde_json::json!({ "name": r.name, "year": r.year, "kind": r.kind, "art": r.poster.as_ref().map(|_| format!("/art/result/{i}?v={}", s.id)) }))
                .collect();
            serde_json::json!({ "query": s.query, "done": s.done, "failed": s.failed, "results": results })
        });
        // Only the picker's number: its titles are fetched from /api/picker when it changes, not with every tick of playback.
        serde_json::json!({ "playing": playing, "search": search, "picker": inner.picker.serial, "words": inner.words }).to_string()
    }

    fn strings_json(&self) -> String {
        let (strings, words) = self.inner.lock().map(|i| (i.strings.clone(), i.words)).unwrap_or_default();
        serde_json::json!({ "lang": strings.lang, "dir": if strings.rtl { "rtl" } else { "ltr" }, "strings": strings.strings, "words": words }).to_string()
    }

    /// The phone page's words; when they change, the open pages hear of it and fetch them again.
    fn set_strings(&self, strings: PhoneStrings) {
        let changed = self.inner.lock().is_ok_and(|mut inner| {
            if inner.strings == strings {
                return false;
            }
            inner.strings = strings;
            inner.words += 1;
            true
        });
        if changed {
            self.bump();
        }
    }

    /// The poster address for `/art/now`, `/art/result/<n>` or `/art/pick/…`.
    fn art_for(&self, path: &str) -> Option<String> {
        let inner = self.inner.lock().ok()?;
        if path == "/art/now" {
            return inner.now.as_ref()?.poster.clone();
        }
        if path.starts_with("/art/pick/") {
            return inner.picker.art_for(path);
        }
        let index: usize = path.strip_prefix("/art/result/")?.parse().ok()?;
        inner.search.results.get(index)?.poster.clone()
    }

    fn cached_art(&self, url: &str) -> Option<(hyper::body::Bytes, &'static str)> {
        let inner = self.inner.lock().ok()?;
        inner.art.iter().find(|(u, ..)| u == url).map(|(_, bytes, kind)| (bytes.clone(), *kind))
    }

    fn keep_art(&self, url: String, bytes: hyper::body::Bytes, kind: &'static str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.art.push((url, bytes, kind));
            // The oldest go first; the newest always stays (it's at most `server::ART_LIMIT`).
            while inner.art.len() > 1 && (inner.art.len() > ART_CACHE || inner.art.iter().map(|(_, b, _)| b.len()).sum::<usize>() > ART_CACHE_BYTES) {
                inner.art.remove(0);
            }
        }
    }
}

impl Remote {
    /// What's playing, for a paired Orbit (Orbit Connect, see connect/): what a phone sees,
    /// without the poster, whose address is an addon's and never leaves this device.
    pub(crate) fn playing_for_connect(&self) -> Option<serde_json::Value> {
        self.inner.lock().ok()?.playing_json(false)
    }

    /// Checks a player command from a paired Orbit exactly as a phone's (command.rs), against
    /// what plays here. Only the player's own commands: moving around, searching, the picker and
    /// opening titles are the phone remote's, not Orbit Connect's. Listed by what's allowed, so a
    /// command the phone remote gains later isn't open to every paired Orbit without a decision.
    pub(crate) fn check_connect_command(&self, body: &[u8]) -> Result<Command, command::Refusal> {
        let inner = self.inner.lock().map_err(|_| command::Refusal::NotNow)?;
        let (audio, subtitles) = (inner.track_ids(true), inner.track_ids(false));
        match command::parse(body, &inner.context(&audio, &subtitles))? {
            command @ (Command::Pause { .. }
            | Command::SeekBy { .. }
            | Command::SeekTo { .. }
            | Command::Volume { .. }
            | Command::Mute { .. }
            | Command::Next
            | Command::Subtitle { .. }
            | Command::Audio { .. }
            | Command::Stop) => Ok(command),
            _ => Err(command::Refusal::Invalid),
        }
    }
}

/// Playback state from mpv's events (player/mod.rs). Cheap: kept even while
/// the remote is off, so a phone that pairs mid-film sees it at once.
pub(crate) fn player_status(app: &AppHandle, playback: Playback) {
    let Some(remote) = app.try_state::<Remote>() else { return };
    if let Ok(mut inner) = remote.inner.lock() {
        inner.playback = playback;
    }
    remote.bump();
}

pub(crate) fn player_tracks(app: &AppHandle, tracks: Vec<Track>) {
    let Some(remote) = app.try_state::<Remote>() else { return };
    if let Ok(mut inner) = remote.inner.lock() {
        inner.tracks = tracks;
    }
    remote.bump();
}

/// Turns the remote on (or, if it's on, updates the phone page's words) and opens pairing.
#[tauri::command]
pub async fn remote_start(app: AppHandle, remote: State<'_, Remote>, strings: PhoneStrings) -> Result<Status, String> {
    let ok = strings.strings.len() <= MAX_STRINGS
        && (2..=3).contains(&strings.lang.len())
        && strings.lang.bytes().all(|b| b.is_ascii_lowercase())
        && strings.strings.iter().all(|(k, v)| k.starts_with("remote.phone.") && crate::check_name(k).is_ok() && v.chars().count() <= MAX_STRING_CHARS);
    if !ok {
        return Err("invalid phone strings".into());
    }
    remote.set_strings(strings);
    let running = remote.lock()?.server.is_some();
    if !running {
        let started = server::start(app.clone()).await?;
        let mut inner = remote.lock()?;
        // Turned on twice at once: the first one stays.
        if inner.server.is_none() {
            inner.server = Some(started);
            inner.generation += 1;
            tauri::async_runtime::spawn(follow_network(app.clone(), inner.generation));
            Remote::open_pairing(&mut inner)?;
        }
    }
    remote.status()
}

/// Turns the remote off: the server stops and every phone is forgotten.
#[tauri::command]
pub async fn remote_stop(remote: State<'_, Remote>) -> Result<Status, String> {
    remote.shutdown();
    remote.status()
}

#[tauri::command]
pub async fn remote_status(remote: State<'_, Remote>) -> Result<Status, String> {
    remote.status()
}

/// "Pair a phone": a new QR code and code (the old ones stop working).
#[tauri::command]
pub async fn remote_pair(remote: State<'_, Remote>) -> Result<Status, String> {
    {
        let mut inner = remote.lock()?;
        if inner.server.is_some() {
            Remote::open_pairing(&mut inner)?;
        }
    }
    remote.status()
}

/// "Disconnect all": every paired phone has to pair again.
#[tauri::command]
pub async fn remote_disconnect_all(remote: State<'_, Remote>) -> Result<Status, String> {
    remote.lock()?.guard.clear();
    remote.bump();
    remote.status()
}

/// What the player shows (None once it closes).
#[tauri::command]
pub async fn remote_now_playing(remote: State<'_, Remote>, playing: Option<NowPlaying>) -> Result<(), String> {
    let shown;
    {
        let mut inner = remote.lock()?;
        match playing {
            Some(p) => {
                let max_volume = if p.max_volume.is_finite() { p.max_volume.clamp(0.0, 150.0) } else { 100.0 };
                let poster = art_url(p.poster);
                if inner.now.as_ref().is_none_or(|n| n.poster != poster) {
                    inner.now_serial += 1;
                }
                inner.now = Some(NowPlaying {
                    title: clean(&p.title, MAX_TEXT_CHARS),
                    detail: p.detail.map(|d| clean(&d, MAX_TEXT_CHARS)).filter(|d| !d.is_empty()),
                    poster,
                    live: p.live,
                    can_next: p.can_next,
                    max_volume,
                });
            }
            None => {
                inner.now = None;
                inner.playback = Playback::default();
                inner.tracks.clear();
            }
        }
        shown = inner.now.as_ref().map(|n| (n.title.clone(), n.detail.clone()));
    }
    // The same title on Android's Now Playing (NativePlayer.kt's media session); after the lock, as it waits for the UI thread.
    #[cfg(target_os = "android")]
    let _ = crate::player::android::now_playing(shown.as_ref().map(|(title, detail)| (title.as_str(), detail.as_deref())));
    #[cfg(not(target_os = "android"))]
    let _ = shown;
    remote.bump();
    Ok(())
}

/// The results of search `id` (a phone's `search` command); older searches' are dropped.
#[tauri::command]
pub async fn remote_search_results(remote: State<'_, Remote>, id: u64, results: Vec<FoundTitle>, failed: bool) -> Result<(), String> {
    if remote.set_search_results(id, results, failed)? {
        remote.bump();
    }
    Ok(())
}

/// Home's rows and the mood chips for the picker's request `id` (a phone's `browse`).
#[tauri::command]
pub async fn remote_picker_home(remote: State<'_, Remote>, id: u64, rows: Vec<picker::PickRow>, moods: Vec<picker::Mood>, failed: bool) -> Result<(), String> {
    if remote.lock()?.picker.set_home(id, rows, moods, failed)? {
        remote.bump();
    }
    Ok(())
}

/// A mood's picks, or the surprise (one title or none), for request `id`.
#[tauri::command]
pub async fn remote_picker_titles(remote: State<'_, Remote>, shelf: picker::ShelfKind, id: u64, titles: Vec<picker::PickTitle>, failed: bool) -> Result<(), String> {
    if remote.lock()?.picker.set_titles(shelf, id, titles, failed)? {
        remote.bump();
    }
    Ok(())
}

/// A title's details for request `id` (again, with the same id, after it's added to the library).
#[tauri::command]
pub async fn remote_picker_details(remote: State<'_, Remote>, id: u64, details: Option<picker::PickDetails>, failed: bool) -> Result<(), String> {
    if remote.lock()?.picker.set_details(id, details, failed) {
        remote.bump();
    }
    Ok(())
}

/// Hands a checked command to the page (Orbit Connect's player commands come this way too).
pub(crate) fn send_command(app: &AppHandle, command: &Command) {
    let _ = app.emit_to("main", COMMAND_EVENT, command);
}

fn announce(app: &AppHandle, reason: &str) {
    let _ = app.emit_to("main", CHANGED_EVENT, serde_json::json!({ "reason": reason }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_six_digits() {
        for _ in 0..200 {
            let code = random_code().unwrap();
            assert_eq!(code.len(), 6);
            assert!(code.bytes().all(|b| b.is_ascii_digit()));
        }
        let token = random_hex().unwrap();
        assert_eq!(token.len(), 64);
        assert_ne!(token, random_hex().unwrap());
    }

    #[test]
    fn the_qr_code_holds_the_pairing_link() {
        let link = format!("http://192.168.100.200:65535/#pair={}", "f".repeat(64));
        let code = qr(&link).unwrap();
        assert_eq!(code.cells.len(), code.size * code.size);
        assert!(code.cells.bytes().all(|b| b == b'0' || b == b'1'));
    }

    #[test]
    fn page_text_is_cleaned_and_capped() {
        assert_eq!(clean(" Pilot\u{0007}\n ", 200), "Pilot");
        assert_eq!(clean(&"a".repeat(300), 200).len(), 200);
        assert_eq!(art_url(Some("https://img.example/p.jpg".into())), Some("https://img.example/p.jpg".into()));
        assert_eq!(art_url(Some("http://img.example/p.jpg".into())), None);
        assert_eq!(art_url(Some("jellyfin-art://x".into())), None);
        assert_eq!(art_url(Some(format!("https://x/{}", "a".repeat(MAX_ART_URL)))), None);
    }

    #[test]
    fn the_snapshot_never_carries_addresses() {
        let remote = Remote::default();
        {
            let mut inner = remote.inner.lock().unwrap();
            inner.now = Some(NowPlaying { title: "Film".into(), detail: None, poster: Some("https://secret.example/token/p.jpg".into()), live: false, can_next: false, max_volume: 100.0 });
            inner.search = Search { id: 3, query: "q".into(), done: true, failed: false, results: vec![FoundTitle { name: "A".into(), year: None, kind: "movie".into(), poster: Some("https://secret.example/a.jpg".into()) }] };
        }
        let json = remote.snapshot();
        assert!(!json.contains("secret.example"), "{json}");
        assert!(json.contains("/art/now?v=0"));
        assert!(json.contains("/art/result/0?v=3"));
        assert_eq!(remote.art_for("/art/result/0").as_deref(), Some("https://secret.example/a.jpg"));
        assert_eq!(remote.art_for("/art/result/1"), None);
        assert_eq!(remote.art_for("/art/other"), None);
    }

    #[test]
    fn another_orbit_may_send_only_player_commands() {
        let remote = Remote::default();
        remote.inner.lock().unwrap().now = Some(NowPlaying { title: "Film".into(), detail: None, poster: None, live: false, can_next: true, max_volume: 100.0 });
        for body in [r#"{"cmd":"pause","on":true}"#, r#"{"cmd":"seek-by","seconds":10}"#, r#"{"cmd":"volume","level":50}"#, r#"{"cmd":"next"}"#, r#"{"cmd":"stop"}"#] {
            assert!(remote.check_connect_command(body.as_bytes()).is_ok(), "{body}");
        }
        // Moving around, searching and the picker are the phone remote's: a paired Orbit can't browse, open or play titles here.
        for body in [
            r#"{"cmd":"nav","key":"ok"}"#,
            r#"{"cmd":"search","query":"x"}"#,
            r#"{"cmd":"browse"}"#,
            r#"{"cmd":"surprise","kind":"movie"}"#,
            r#"{"cmd":"mood","mood":"scare"}"#,
            r#"{"cmd":"details","from":"home","shelf":0,"row":0,"index":0}"#,
            r#"{"cmd":"pick","from":"home","shelf":0,"row":0,"index":0,"action":"play"}"#,
        ] {
            assert!(remote.check_connect_command(body.as_bytes()).is_err(), "{body}");
        }
    }

    #[test]
    fn turning_off_stops_the_network_watcher() {
        let remote = Remote::default();
        let watching = remote.inner.lock().unwrap().generation;
        remote.shutdown();
        // A watcher started before (for this generation) finds it isn't its remote any more, and ends.
        assert_ne!(remote.inner.lock().unwrap().generation, watching);
    }

    #[test]
    fn new_words_tell_open_phones_to_reload_them() {
        let remote = Remote::default();
        let words = |json: &str| serde_json::from_str::<serde_json::Value>(json).unwrap()["words"].as_u64().unwrap();
        let english = PhoneStrings { lang: "en".into(), rtl: false, strings: BTreeMap::from([("remote.phone.stop".into(), "Stop".into())]) };
        let french = PhoneStrings { lang: "fr".into(), rtl: false, strings: BTreeMap::from([("remote.phone.stop".into(), "Arrêter".into())]) };
        remote.set_strings(english.clone());
        let before = words(&remote.snapshot());
        assert_eq!(words(&remote.strings_json()), before);
        // The same words again (Orbit reloading in the same language): nothing for the phone to do.
        remote.set_strings(english);
        assert_eq!(words(&remote.snapshot()), before);
        // Another language: open phones see a new number and fetch the words again.
        remote.set_strings(french);
        let after = words(&remote.snapshot());
        assert_ne!(after, before);
        assert_eq!(words(&remote.strings_json()), after);
    }

    #[test]
    fn a_cleared_search_shows_nothing_and_keeps_its_id() {
        let remote = Remote::default();
        remote.inner.lock().unwrap().search = Search { id: 3, query: "q".into(), done: true, failed: false, results: vec![FoundTitle { name: "A".into(), year: None, kind: "movie".into(), poster: None }] };
        remote.clear_search();
        assert!(remote.snapshot().contains(r#""search":null"#));
        let inner = remote.inner.lock().unwrap();
        assert_eq!((inner.search.id, inner.search.results.len()), (3, 0));
    }

    #[test]
    fn results_still_on_their_way_skip_a_cleared_search() {
        let remote = Remote::default();
        let found = || vec![FoundTitle { name: "A".into(), year: None, kind: "movie".into(), poster: None }];
        remote.inner.lock().unwrap().search = Search { id: 3, query: "q".into(), ..Default::default() };
        // An older search's results are dropped; the current one's are kept.
        assert!(!remote.set_search_results(2, found(), false).unwrap());
        assert!(remote.set_search_results(3, found(), false).unwrap());
        // A profile switch clears it (keeping id 3): a late answer to it must not land.
        remote.clear_search();
        assert!(!remote.set_search_results(3, found(), false).unwrap());
        let inner = remote.inner.lock().unwrap();
        assert!(!inner.search.done);
        assert!(inner.search.results.is_empty());
    }
}
