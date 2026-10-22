//! "Sync automatically" for an added subtitle (from an addon or a file):
//! re-times it to match the video and adds the result as a new track,
//! leaving the original in the list.
//!
//! What the timing is matched against, cheapest first:
//! 1. The video's own text subtitles (any language), read from a Matroska
//!    file's index with a few small range reads (mkv.rs). Works for streams.
//! 2. For a video on this PC only (a download, a dropped file), the speech in
//!    its soundtrack (audio.rs + vad.rs). For a stream that would mean
//!    downloading all of it, so it's never done there.
//!
//! alass does the matching (align.rs). Everything runs on background tasks,
//! never on mpv's event thread; a newer sync, a cancel, or another file
//! opening makes a running one stop and drop its result.

mod align;
mod audio;
mod mkv;
mod source;
mod subs;
mod vad;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::mpv::Mpv;
use super::{LIBMPV, MAX_SUBTITLE_BYTES, PlayerState, clean_label};

const EVENT: &str = "player://sync";
/// Tracks looked through at most (a file with more is unusual).
const MAX_TRACKS: usize = 200;
/// mpv's names for text subtitle codecs (image ones have no lines to time).
const TEXT_CODECS: &[&str] = &["subrip", "ass", "ssa", "webvtt", "text", "mov_text"];
/// A move smaller than this isn't worth a second copy of the subtitle.
const NEGLIGIBLE_MS: i64 = 60;
/// After alignment, at least this share of the subtitle's time must coincide
/// with the reference, or the match is too doubtful to apply. Two subtitles
/// of the same video overlap well; detected speech less so.
const MIN_OVERLAP_SUBTITLE: f64 = 0.3;
const MIN_OVERLAP_SPEECH: f64 = 0.2;

/// What the video playing is, as far as reading it goes. Set when a file opens.
#[derive(Clone)]
pub(crate) enum Media {
    /// A web stream (debrid, Orbit's torrent server). The address stays in Rust.
    Web(String),
    /// A file on this PC, and the subtitle files Orbit saved beside it.
    File { path: PathBuf, subtitles: Vec<String> },
}

/// The sync running, if any: a newer one, a cancel or another file stops it.
#[derive(Default)]
pub struct Syncs {
    run: AtomicU64,
    cancel: Mutex<Arc<AtomicBool>>,
}

impl Syncs {
    /// Starts a run, stopping the one before: its number and its cancel flag.
    pub(super) fn start(&self) -> (u64, Arc<AtomicBool>) {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut current) = self.cancel.lock() {
            current.store(true, Ordering::SeqCst);
            *current = flag.clone();
        }
        (self.run.fetch_add(1, Ordering::SeqCst) + 1, flag)
    }

    /// Whether `run` is still the latest (no newer run or cancel since).
    pub(super) fn is_current(&self, run: u64) -> bool {
        self.run.load(Ordering::SeqCst) == run
    }

    pub fn cancel(&self) {
        self.run.fetch_add(1, Ordering::SeqCst);
        if let Ok(current) = self.cancel.lock() {
            current.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum SyncError {
    /// No subtitle chosen, or it's one of the video's own (already in time).
    NoSubtitle,
    Embedded,
    /// Its file couldn't be read again, or isn't SubRip, WebVTT or ASS.
    Unreadable,
    Unsupported,
    /// Nothing correctly timed to match against.
    NoReference,
    /// A match was found, but not a convincing one.
    Uncertain,
    Cancelled,
}

impl SyncError {
    /// What the page shows a message for.
    pub(super) const fn code(&self) -> &'static str {
        match self {
            Self::NoSubtitle => "no-subtitle",
            Self::Embedded => "embedded",
            Self::Unreadable => "unreadable",
            Self::Unsupported => "unsupported",
            Self::NoReference => "no-reference",
            Self::Uncertain => "uncertain",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Synced {
    /// How far the lines moved (typically), in seconds; positive is later.
    shift: f64,
    /// "subtitle" (the video's own) or "speech" (its soundtrack).
    reference: &'static str,
    /// A frame-rate mismatch was corrected.
    framerate: bool,
    /// Different parts moved by different amounts.
    split: bool,
    /// The re-timed track mpv now shows; None when it was already in time.
    track: Option<i64>,
}

#[derive(Serialize, Clone)]
struct Progress {
    run: u64,
    /// The page's number for this run, given back so it can tell its own run's progress from an older one's.
    ticket: u64,
    /// "reading", "listening" (with `progress`) or "aligning".
    stage: &'static str,
    progress: Option<f64>,
}

/// The subtitle track mpv shows now.
pub(super) struct Selected {
    pub(super) title: Option<String>,
    pub(super) lang: Option<String>,
    /// hex:// contents, a web address, or a path Orbit gave mpv.
    pub(super) file: String,
}

pub(super) fn selected_subtitle(mpv: &Mpv) -> Result<Selected, SyncError> {
    let sid: i64 = mpv.get_string("sid").and_then(|s| s.parse().ok()).ok_or(SyncError::NoSubtitle)?;
    let count: usize = mpv.get_string("track-list/count").and_then(|c| c.parse().ok()).unwrap_or(0);
    for i in 0..count.min(MAX_TRACKS) {
        let get = |key: &str| mpv.get_string(&format!("track-list/{i}/{key}"));
        if get("type").as_deref() != Some("sub") || get("id").and_then(|id| id.parse::<i64>().ok()) != Some(sid) {
            continue;
        }
        if get("external").as_deref() != Some("yes") {
            return Err(SyncError::Embedded);
        }
        let file = get("external-filename").ok_or(SyncError::Unreadable)?;
        return Ok(Selected { title: get("title").filter(|t| !t.is_empty()), lang: get("lang").filter(|l| !l.is_empty()), file });
    }
    Err(SyncError::NoSubtitle)
}

/// Whether the video has text subtitles of its own (worth reading its index for).
fn has_text_subtitles(mpv: &Mpv) -> bool {
    let count: usize = mpv.get_string("track-list/count").and_then(|c| c.parse().ok()).unwrap_or(0);
    (0..count.min(MAX_TRACKS)).any(|i| {
        let get = |key: &str| mpv.get_string(&format!("track-list/{i}/{key}"));
        get("type").as_deref() == Some("sub") && get("external").as_deref() == Some("no") && get("codec").is_some_and(|c| TEXT_CODECS.contains(&c.as_str()))
    })
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || text.len() > MAX_SUBTITLE_BYTES * 2 {
        return None;
    }
    let digit = |b: u8| (b as char).to_digit(16);
    text.as_bytes().as_chunks::<2>().0.iter().map(|p| Some((digit(p[0])? * 16 + digit(p[1])?) as u8)).collect()
}

/// The chosen subtitle's contents again: from memory (an uploaded or synced
/// one), its addon address (addon network rules), or a file Orbit saved
/// beside a download. Never any other local path.
pub(super) async fn subtitle_bytes(file: &str, media: Option<&Media>) -> Result<Vec<u8>, SyncError> {
    if let Some(hex) = file.strip_prefix("hex://") {
        return decode_hex(hex).ok_or(SyncError::Unreadable);
    }
    if file.starts_with("https://") || file.starts_with("http://") {
        let url = tauri::Url::parse(file).map_err(|_| SyncError::Unreadable)?;
        let (bytes, _) = crate::addons::net::fetch_bytes(url, MAX_SUBTITLE_BYTES, Duration::from_secs(20)).await.map_err(|_| SyncError::Unreadable)?;
        return Ok(bytes);
    }
    match media {
        Some(Media::File { subtitles, .. }) if subtitles.iter().any(|s| s == file) => {
            let path = PathBuf::from(file);
            let size = tokio::fs::metadata(&path).await.map_err(|_| SyncError::Unreadable)?.len();
            if size > MAX_SUBTITLE_BYTES as u64 {
                return Err(SyncError::Unreadable);
            }
            // Bound the read itself: a file may grow after the metadata check.
            use tokio::io::AsyncReadExt;
            let file = tokio::fs::File::open(path).await.map_err(|_| SyncError::Unreadable)?;
            let mut bytes = Vec::new();
            file.take(MAX_SUBTITLE_BYTES as u64 + 1).read_to_end(&mut bytes).await.map_err(|_| SyncError::Unreadable)?;
            if bytes.len() > MAX_SUBTITLE_BYTES { return Err(SyncError::Unreadable); }
            Ok(bytes)
        }
        _ => Err(SyncError::Unreadable),
    }
}

/// Whether the result is good enough to apply.
fn judge(result: &align::Alignment, speech: bool) -> Result<bool, SyncError> {
    let minimum = if speech { MIN_OVERLAP_SPEECH } else { MIN_OVERLAP_SUBTITLE };
    if result.overlap_after < minimum || result.overlap_after + 1e-9 < result.overlap_before {
        return Err(SyncError::Uncertain);
    }
    // Already in time: nothing to add.
    Ok(result.shift_ms.abs() >= NEGLIGIBLE_MS || result.split || result.scale != 1.0)
}

/// Re-times the subtitle shown now and shows the result. `audio`: the
/// soundtrack may be used (a video on this PC only; the page asks for it
/// when the person asks to sync, not for automatic syncs). `label` names the
/// new track ("Synced", in the person's language).
#[tauri::command]
pub async fn player_sync_subtitle(app: AppHandle, state: State<'_, PlayerState>, audio: bool, label: String, ticket: Option<u64>) -> Result<Synced, String> {
    let (run, cancel) = state.sync.start();
    let ticket = ticket.unwrap_or(0);
    let opens = state.opens.load(Ordering::SeqCst);
    let current = || run == state.sync.run.load(Ordering::SeqCst) && opens == state.opens.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst);
    let emit = |stage: &'static str, progress: Option<f64>| {
        let _ = app.emit(EVENT, Progress { run, ticket, stage, progress });
    };
    sync(&app, &state, Run { id: run, ticket, cancel: &cancel, current: &current, emit: &emit }, audio, &label).await.map_err(|e| e.code().to_string())
}

/// One sync: its number, how to tell it's still wanted, and how to report progress.
struct Run<'a> {
    id: u64,
    ticket: u64,
    cancel: &'a Arc<AtomicBool>,
    current: &'a (dyn Fn() -> bool + Sync),
    emit: &'a (dyn Fn(&'static str, Option<f64>) + Sync),
}

/// Stops the sync running, if any.
#[tauri::command]
pub async fn player_sync_cancel(state: State<'_, PlayerState>) -> Result<(), String> {
    state.sync.cancel();
    Ok(())
}

async fn sync(app: &AppHandle, state: &PlayerState, this: Run<'_>, audio: bool, label: &str) -> Result<Synced, SyncError> {
    let Run { id: run, ticket, cancel, current, emit } = this;
    let mpv = state.engine.lock().ok().and_then(|e| e.as_ref().map(|e| e.mpv.clone())).ok_or(SyncError::NoSubtitle)?;
    let media = state.media.lock().ok().and_then(|m| m.clone());
    let started = mpv.get_string("sid");
    let chosen = selected_subtitle(&mpv)?;
    emit("reading", None);
    let raw = subtitle_bytes(&chosen.file, media.as_ref()).await?;
    let subtitle = tauri::async_runtime::spawn_blocking(move || subs::Subtitle::parse(&raw)).await.map_err(|_| SyncError::Unreadable)?.map_err(|e| match e {
        subs::ParseError::Unsupported => SyncError::Unsupported,
        _ => SyncError::Unreadable,
    })?;
    if !current() {
        return Err(SyncError::Cancelled);
    }

    // The reference: the video's own subtitles if it has any (cheap), else its speech (local files only).
    let mut reference = None;
    if has_text_subtitles(&mpv) {
        reference = match &media {
            Some(Media::Web(url)) => match source::Web::new(url) {
                Ok(mut web) => mkv::subtitle_timings(&mut web).await.ok(),
                Err(_) => None,
            },
            Some(Media::File { path, .. }) => mkv::subtitle_timings(&mut source::File(path.clone())).await.ok(),
            None => None,
        }
        .map(|spans| (spans, false));
    }
    if reference.is_none()
        && audio
        && let Some(Media::File { path, .. }) = &media
    {
        let library = app.path().resource_dir().map_err(|_| SyncError::NoReference)?.join(LIBMPV);
        let cache = app.path().app_cache_dir().map_err(|_| SyncError::NoReference)?.join("subsync");
        // Left over from a run cut short (the app closed mid-way).
        let _ = std::fs::remove_dir_all(&cache);
        let video = path.to_str().ok_or(SyncError::NoReference)?.to_string();
        let aid = mpv.get_string("aid").and_then(|a| a.parse::<u32>().ok());
        emit("listening", Some(0.0));
        let (flag, app) = (cancel.clone(), app.clone());
        let energies = tauri::async_runtime::spawn_blocking(move || {
            let progress = |p: f64| {
                let _ = app.emit(EVENT, Progress { run, ticket, stage: "listening", progress: Some(p) });
            };
            audio::energies(&library, &cache, &video, aid, &flag, &progress)
        })
        .await
        .map_err(|_| SyncError::NoReference)?
        .map_err(|e| if e == audio::AudioError::Cancelled { SyncError::Cancelled } else { SyncError::NoReference })?;
        reference = Some((vad::speech_spans(&energies), true));
    }
    let (reference, speech) = reference.ok_or(SyncError::NoReference)?;
    if !current() {
        return Err(SyncError::Cancelled);
    }

    emit("aligning", None);
    let lines = subtitle.spans();
    let result = tauri::async_runtime::spawn_blocking(move || align::align(&reference, &lines))
        .await
        .map_err(|_| SyncError::Uncertain)?
        .map_err(|e| match e {
            align::AlignError::TooShort => SyncError::NoReference,
            align::AlignError::TooLong => SyncError::Unsupported,
        })?;
    let changed = judge(&result, speech)?;
    if !current() {
        return Err(SyncError::Cancelled);
    }
    let mut synced = Synced { shift: result.shift_ms as f64 / 1000.0, reference: if speech { "speech" } else { "subtitle" }, framerate: result.scale != 1.0, split: result.split, track: None };
    if !changed {
        synced.shift = 0.0;
        return Ok(synced);
    }
    let bytes = subtitle.retimed(|i, _, _| result.spans[i]);
    // Added as a file, so placement tags come out here as for other added files (mpv's strip doesn't apply to it).
    let bytes = super::keep_at_bottom(state, &bytes).unwrap_or(bytes);
    let name = clean_label(&format!("{} · {label}", chosen.title.as_deref().or(chosen.lang.as_deref()).unwrap_or("Subtitle")));
    // Checked again under the lock `player_open` hands mpv a file with: another file can't open between
    // the check and the hand-over, so the copy can't land on the next episode.
    let _handing = state.current.lock().map_err(|_| SyncError::Cancelled)?;
    // Another subtitle (or none) picked while it ran is the person's choice: the copy doesn't replace it.
    if !current() || mpv.get_string("sid") != started {
        return Err(SyncError::Cancelled);
    }
    super::add_subtitle_hex(&mpv, &bytes, &name, chosen.lang.as_deref())?;
    synced.track = mpv.get_string("sid").and_then(|s| s.parse().ok());
    Ok(synced)
}

impl From<String> for SyncError {
    /// mpv refused the re-timed copy.
    fn from(_: String) -> Self {
        Self::Unreadable
    }
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    subs::fuzz_input(data);
    mkv::fuzz_input(data);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_and_rejects_junk() {
        assert_eq!(decode_hex("00ff7a"), Some(vec![0, 255, 0x7a]));
        assert_eq!(decode_hex("0"), None);
        assert_eq!(decode_hex("zz"), None);
        assert_eq!(decode_hex(&"0".repeat(MAX_SUBTITLE_BYTES * 2 + 2)), None);
    }

    #[test]
    fn reads_subtitles_only_from_allowed_places() {
        let run = |file: &str, media: Option<&Media>| tauri::async_runtime::block_on(subtitle_bytes(file, media));
        assert_eq!(run("hex://6869", None), Ok(b"hi".to_vec()));
        // A path mpv lists is read only if Orbit saved it beside the download playing.
        let path = std::env::temp_dir().join(format!("orbit-subsync-{}.srt", std::process::id()));
        std::fs::write(&path, b"x").unwrap();
        let text = path.to_string_lossy().into_owned();
        let download = Media::File { path: PathBuf::from("video.mkv"), subtitles: vec![text.clone()] };
        assert_eq!(run(&text, Some(&download)), Ok(b"x".to_vec()));
        assert_eq!(run(&text, None), Err(SyncError::Unreadable));
        assert_eq!(run(&text, Some(&Media::File { path: PathBuf::from("video.mkv"), subtitles: vec![] })), Err(SyncError::Unreadable));
        assert_eq!(run("C:\\Windows\\win.ini", Some(&download)), Err(SyncError::Unreadable));
        // Plain http to a public host is against the addon rules.
        assert_eq!(run("http://subs.example/a.srt", None), Err(SyncError::Unreadable));
        assert_eq!(run("memory://x", None), Err(SyncError::Unreadable));
        let _ = std::fs::remove_file(path);
    }

    fn result(shift_ms: i64, before: f64, after: f64) -> align::Alignment {
        align::Alignment { spans: vec![], shift_ms, scale: 1.0, split: false, overlap_before: before, overlap_after: after }
    }

    #[test]
    fn applies_only_convincing_changes() {
        assert_eq!(judge(&result(1400, 0.1, 0.8), false), Ok(true));
        assert_eq!(judge(&result(20, 0.8, 0.8), false), Ok(false));
        assert_eq!(judge(&result(1400, 0.1, 0.25), false), Err(SyncError::Uncertain));
        assert_eq!(judge(&result(1400, 0.1, 0.25), true), Ok(true));
        assert_eq!(judge(&result(1400, 0.6, 0.5), false), Err(SyncError::Uncertain));
        assert_eq!(judge(&align::Alignment { scale: 25.0 / 23.976, ..result(0, 0.2, 0.8) }, false), Ok(true));
    }

    #[test]
    fn speech_in_the_soundtrack_times_a_late_subtitle() {
        // Ten minutes with 60 lines of "dialogue" (a tone over faint noise) at irregular times.
        let mut seed = 7u64;
        let mut next = |n: u64| {
            seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            ((seed >> 33) % n) as i64
        };
        let mut at = 5000;
        let mut speech = Vec::new();
        for _ in 0..60 {
            at += 1500 + next(5000);
            let line = (at, at + 800 + next(3000));
            at = line.1;
            speech.push(line);
        }
        let mut framer = vad::Framer::default();
        let samples = (at as usize + 5000) * vad::SAMPLE_RATE / 1000;
        let bytes: Vec<u8> = (0..samples)
            .flat_map(|n| {
                let ms = (n * 1000 / vad::SAMPLE_RATE) as i64;
                let noise = if n % 3 == 0 { 0.002 } else { -0.001 };
                let talking = speech.iter().any(|&(s, e)| (s..e).contains(&ms));
                let tone = if talking { 0.2 * (n as f64 * 0.37).sin() } else { 0.0 };
                (((noise + tone) * 32767.0) as i16).to_le_bytes()
            })
            .collect();
        framer.push_bytes(&bytes);
        let found = vad::speech_spans(&framer.frames);
        let late: Vec<_> = speech.iter().map(|(s, e)| (s + 1700, e + 1700)).collect();
        let result = align::align(&found, &late).unwrap();
        assert!((result.shift_ms + 1700).abs() <= 30, "{}", result.shift_ms);
        assert_eq!(judge(&result, true), Ok(true));
    }

    #[test]
    fn a_newer_sync_or_cancel_stops_the_running_one() {
        let syncs = Syncs::default();
        let (first, flag) = syncs.start();
        let (second, newer) = syncs.start();
        assert!(flag.load(Ordering::SeqCst) && !newer.load(Ordering::SeqCst) && second == first + 1);
        syncs.cancel();
        assert!(newer.load(Ordering::SeqCst) && syncs.run.load(Ordering::SeqCst) != second);
    }

    #[test]
    fn errors_have_codes_for_the_page() {
        assert_eq!(SyncError::NoReference.code(), "no-reference");
        let json = serde_json::to_value(Synced { shift: 1.4, reference: "subtitle", framerate: false, split: true, track: Some(5) }).unwrap();
        assert_eq!(json, serde_json::json!({"shift": 1.4, "reference": "subtitle", "framerate": false, "split": true, "track": 5}));
    }
}
