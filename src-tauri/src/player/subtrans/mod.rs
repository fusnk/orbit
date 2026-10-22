//! "Translate subtitles with AI" (Settings → Subtitles, off by default):
//! translates the subtitle showing into another language with the person's
//! own OpenAI, Gemini or Claude key, or a model running on this PC (LM Studio,
//! Ollama), and adds the result as a new track ("Spanish (AI)").
//!
//! The subtitle is read again as subtitle sync reads it (subsync), its lines
//! parsed by transcript.rs with italics kept, and sent in batches with ids
//! (cues.rs). Each batch's answer is checked: the same ids, nothing timed,
//! plain text. A batch that fails is asked once more, then keeps its
//! original lines, so one bad answer doesn't lose the rest. A finished
//! translation is kept in the cache folder by the subtitle's contents, the
//! language and the model, and reused.
//!
//! Subtitle text goes only where provider.rs allows (the three services' own
//! hosts, or a server on this PC). Keys live in the OS keychain per profile
//! under names the WebView's secret commands can't read (keychain.rs); the
//! page can save, remove or check for one, never read it back.

mod cues;
mod provider;

use std::hash::Hasher;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroize;

use super::mpv::Mpv;
use super::subsync::{self, SyncError};
use super::{MAX_SUBTITLE_BYTES, PlayerState, clean_label};
use crate::keychain;
use crate::profiles::ActiveProfile;
use cues::Line;
use provider::{Endpoint, Fail, Key, Provider};

const EVENT: &str = "player://translate";
/// Keychain names under this prefix are Orbit's own (see keychain.rs).
pub(crate) const KEY_PREFIX: &str = "subtrans.";
/// Batches asked at once: a cloud service takes several; a local model works through one at a time.
const CLOUD_PARALLEL: usize = 3;
/// Finished translations kept (each a few hundred kilobytes at most).
const CACHE_FILES: usize = 60;

fn key_entry(provider: Provider, profile: &str) -> String {
    format!("{KEY_PREFIX}{}.{profile}", provider.key())
}

/// The service settings the page sends: which service, which model, and (local only) the server's address.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    provider: String,
    model: String,
    #[serde(default)]
    server: String,
}

/// The language to translate into: its English name (for the model) and its code (for mpv's track list).
#[derive(Deserialize)]
pub struct Target {
    name: String,
    code: String,
}

impl Target {
    /// Both go into the prompt or the track list, so they're held to what a language's name and code look like.
    fn check(&self) -> Result<(), &'static str> {
        let name_ok = (1..=40).contains(&self.name.len()) && self.name.chars().all(|c| c.is_alphabetic() || matches!(c, ' ' | '-' | '(' | ')' | ','));
        let code_ok = (1..=16).contains(&self.code.len()) && self.code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if name_ok && code_ok { Ok(()) } else { Err("bad-language") }
    }
}

fn open(config: &Config, profile: &str) -> Result<(Endpoint, Option<Arc<Key>>), Fail> {
    let provider = Provider::parse(&config.provider).ok_or(Fail::NotLocal)?;
    let endpoint = Endpoint::new(provider, &config.server)?;
    if !provider.needs_key() {
        return Ok((endpoint, None));
    }
    match keychain::get(&key_entry(provider, profile)) {
        Ok(Some(key)) => Ok((endpoint, Some(Arc::new(Key::new(key))))),
        _ => Err(Fail::NoKey),
    }
}

/// Keeps `key` for the active profile and service (replacing one it had).
#[tauri::command]
pub async fn subtrans_set_key(active: State<'_, ActiveProfile>, provider: String, mut key: String) -> Result<(), String> {
    let trimmed = key.trim().to_string();
    key.zeroize();
    let key = Key::new(trimmed);
    let provider = Provider::parse(&provider).filter(|p| p.needs_key()).ok_or("unknown provider")?;
    if !valid_key(key.as_str()) {
        return Err("bad-key".into());
    }
    keychain::set(&key_entry(provider, &active.id()?), key.as_str())
}

/// API keys are printable ASCII without spaces (they go in a header).
fn valid_key(key: &str) -> bool {
    (8..=512).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_graphic())
}

#[tauri::command]
pub async fn subtrans_forget_key(active: State<'_, ActiveProfile>, provider: String) -> Result<(), String> {
    let provider = Provider::parse(&provider).filter(|p| p.needs_key()).ok_or("unknown provider")?;
    keychain::delete(&key_entry(provider, &active.id()?))
}

#[tauri::command]
pub async fn subtrans_key_saved(active: State<'_, ActiveProfile>, provider: String) -> Result<bool, String> {
    let provider = Provider::parse(&provider).filter(|p| p.needs_key()).ok_or("unknown provider")?;
    keychain::get(&key_entry(provider, &active.id()?)).map(|k| k.is_some())
}

/// Forgets a deleted profile's keys.
pub(crate) fn forget(profile: &str) -> Result<(), String> {
    // Each key is tried even if one before it couldn't be removed.
    crate::profiles::all_done([Provider::OpenAi, Provider::Gemini, Provider::Claude].map(|provider| ("translation key", keychain::delete(&key_entry(provider, profile)))))
}

/// "Test connection": the models the service offers (for a local server, to pick from).
/// Errors are codes the page words itself.
#[tauri::command]
pub async fn subtrans_models(active: State<'_, ActiveProfile>, config: Config) -> Result<Vec<String>, String> {
    let profile = active.id()?;
    let (endpoint, key) = open(&config, &profile).map_err(|e| e.code().to_string())?;
    provider::models(&endpoint, key.as_deref()).await.map_err(|e| e.code().to_string())
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Translated {
    /// The new track mpv now shows.
    track: Option<i64>,
    lines: usize,
    /// Lines left in the original language (their batch failed twice).
    kept: usize,
    /// It came from the cache: nothing was sent.
    cached: bool,
}

#[derive(Serialize, Clone)]
struct Progress {
    run: u64,
    /// The page's number for this run, given back so it can tell its own run's progress from an older one's.
    ticket: u64,
    done: usize,
    total: usize,
}

/// Translates the subtitle showing into `target` and shows the result as a
/// new track named `label` ("Spanish (AI)", in the person's language).
/// Errors are codes the page words itself.
#[tauri::command]
pub async fn player_translate_subtitle(app: AppHandle, state: State<'_, PlayerState>, active: State<'_, ActiveProfile>, config: Config, target: Target, label: String, ticket: Option<u64>) -> Result<Translated, String> {
    let (run, cancel) = state.translate.start();
    let ticket = ticket.unwrap_or(0);
    let opens = state.opens.load(Ordering::SeqCst);
    let profile = active.id()?;
    let current = || state.translate.is_current(run) && opens == state.opens.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst);
    translate(&app, &state, &profile, Job { run, ticket, cancel: &cancel, current: &current }, &config, &target, &label).await.map_err(str::to_string)
}

/// Stops the translation running, if any.
#[tauri::command]
pub async fn player_translate_cancel(state: State<'_, PlayerState>) -> Result<(), String> {
    state.translate.cancel();
    Ok(())
}

struct Job<'a> {
    run: u64,
    ticket: u64,
    cancel: &'a Arc<AtomicBool>,
    current: &'a (dyn Fn() -> bool + Sync),
}

async fn translate(app: &AppHandle, state: &PlayerState, profile: &str, job: Job<'_>, config: &Config, target: &Target, label: &str) -> Result<Translated, &'static str> {
    let Job { run, ticket, cancel, current } = job;
    target.check()?;
    let (endpoint, key) = open(config, profile).map_err(Fail::code)?;
    let mpv = state.engine.lock().ok().and_then(|e| e.as_ref().map(|e| e.mpv.clone())).ok_or(SyncError::NoSubtitle.code())?;
    let media = state.media.lock().ok().and_then(|m| m.clone());
    let started = sid(&mpv);
    let chosen = subsync::selected_subtitle(&mpv).map_err(|e| e.code())?;
    let raw = subsync::subtitle_bytes(&chosen.file, media.as_ref()).await.map_err(|e| e.code())?;
    let name = clean_label(label);
    let cache = app.path().app_cache_dir().ok().map(|dir| dir.join("subtrans").join(cache_name(&raw, target, config)));

    if let Some(path) = &cache
        && let Some(bytes) = read_cached(path).await
    {
        let bytes = super::keep_at_bottom(state, &bytes).unwrap_or(bytes);
        // See below: checked under the lock `player_open` hands mpv a file with.
        let _handing = state.current.lock().map_err(|_| "cancelled")?;
        if !current() {
            return Err("cancelled");
        }
        let track = add(&mpv, &bytes, &name, &target.code, started)?;
        let lines = crate::player::transcript::styled_cues(&bytes).len();
        return Ok(Translated { track, lines, kept: 0, cached: true });
    }

    let lines: Vec<Line> = tauri::async_runtime::spawn_blocking(move || super::transcript::styled_cues(&raw).iter().map(Line::from).collect())
        .await
        .map_err(|_| "unreadable")?;
    if lines.is_empty() {
        return Err(SyncError::Unsupported.code());
    }
    let batches = cues::batches(&lines);
    let total = batches.len();
    let _ = app.emit(EVENT, Progress { run, ticket, done: 0, total });
    let ask = Ask { endpoint, key, model: config.model.trim().to_string(), system: cues::instructions(&target.name), lines: Arc::new(lines) };
    let parallel = if ask.endpoint.is_local() { 1 } else { CLOUD_PARALLEL };

    let asking = ask.clone();
    let send = move |batch| {
        let ask = asking.clone();
        async move { ask.batch(batch).await }
    };
    let progress = |done| {
        let _ = app.emit(EVENT, Progress { run, ticket, done, total });
    };
    let results = ask_all(&batches, parallel, send, cancel, current, progress).await?;

    let mut texts = Vec::with_capacity(ask.lines.len());
    let mut kept = 0;
    for (batch, result) in batches.iter().zip(results) {
        match result {
            Some(translated) => texts.extend(translated),
            None => {
                kept += batch.len();
                texts.extend(ask.lines[batch.clone()].iter().map(|l| cues::sanitize(&l.text)));
            }
        }
    }
    if kept == ask.lines.len() {
        return Err("bad-answer");
    }
    let srt = cues::to_srt(&ask.lines, &texts).into_bytes();
    // Only a complete translation is kept: one with lines left over is asked for again next time.
    if kept == 0
        && let Some(path) = &cache
    {
        write_cached(path, &srt).await;
    }
    let bytes = super::keep_at_bottom(state, &srt).unwrap_or(srt);
    // Checked under the lock `player_open` hands mpv a file with: another file can't open between the
    // check and the hand-over, so the translation can't land on the next episode.
    let _handing = state.current.lock().map_err(|_| "cancelled")?;
    if !current() {
        return Err("cancelled");
    }
    let track = add(&mpv, &bytes, &name, &target.code, started)?;
    Ok(Translated { track, lines: ask.lines.len(), kept, cached: false })
}

/// The subtitle track mpv shows (None when subtitles are off).
fn sid(mpv: &Mpv) -> Option<i64> {
    mpv.get_string("sid").and_then(|s| s.parse().ok())
}

/// How the translation joins mpv's tracks: shown only while the subtitle it was made from is still
/// the one picked. A subtitle (or none) picked while it ran is the person's choice and stays.
fn add_flag(started: Option<i64>, now: Option<i64>) -> &'static str {
    if started.is_some() && started == now { "select" } else { "auto" }
}

/// Adds the translation to mpv and gives its track id (the newest track: `sub-add` appends it).
fn add(mpv: &Mpv, bytes: &[u8], name: &str, lang: &str, started: Option<i64>) -> Result<Option<i64>, &'static str> {
    super::add_subtitle_hex_as(mpv, bytes, name, Some(lang), add_flag(started, sid(mpv))).map_err(|_| "unreadable")?;
    let count: i64 = mpv.get_string("track-list/count").and_then(|c| c.parse().ok()).unwrap_or(0);
    Ok(mpv.get_string(&format!("track-list/{}/id", count - 1)).and_then(|id| id.parse().ok()))
}

/// Asks for every batch, `parallel` at a time, and gives each one's lines
/// (`None`: it kept its original lines). Nothing more is sent once the run
/// is cancelled or overtaken, including while the subtitle was still being
/// read, so a cancelled translation can't send text or run up a bill.
async fn ask_all<F, Fut>(batches: &[Range<usize>], parallel: usize, ask: F, cancel: &AtomicBool, current: &(dyn Fn() -> bool + Sync), mut progress: impl FnMut(usize)) -> Result<Vec<Option<Vec<String>>>, &'static str>
where
    F: Fn(Range<usize>) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<String>, Option<Fail>>> + Send + 'static,
{
    let total = batches.len();
    let mut results: Vec<Option<Vec<String>>> = vec![None; total];
    let mut tasks = tokio::task::JoinSet::new();
    let (mut next, mut done) = (0, 0);
    if !current() {
        return Err("cancelled");
    }
    loop {
        while tasks.len() < parallel && next < total {
            let (index, request) = (next, ask(batches[next].clone()));
            tasks.spawn(async move { (index, request.await) });
            next += 1;
        }
        let joined = tokio::select! {
            joined = tasks.join_next() => joined,
            () = stopped(cancel, current) => None,
        };
        if !current() {
            tasks.abort_all();
            return Err("cancelled");
        }
        let Some(joined) = joined else { break };
        let (index, outcome) = joined.map_err(|_| "failed")?;
        match outcome {
            Ok(texts) => results[index] = Some(texts),
            Err(Some(fail)) => {
                tasks.abort_all();
                return Err(fail.code());
            }
            Err(None) => {}
        }
        done += 1;
        progress(done);
    }
    Ok(results)
}

/// Resolves once the run is cancelled or overtaken (checked a few times a second).
async fn stopped(cancel: &AtomicBool, current: &(dyn Fn() -> bool + Sync)) {
    while !cancel.load(Ordering::SeqCst) && current() {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// What every batch's request shares.
#[derive(Clone)]
struct Ask {
    endpoint: Endpoint,
    key: Option<Arc<Key>>,
    model: String,
    system: String,
    lines: Arc<Vec<Line>>,
}

impl Ask {
    /// One batch's translated lines. A failure that would stop every batch
    /// is `Err(Some)`; anything else is retried once, then `Err(None)` (the
    /// batch keeps its original lines).
    async fn batch(&self, batch: Range<usize>) -> Result<Vec<String>, Option<Fail>> {
        let request = cues::request(&self.lines, &batch);
        for _ in 0..2 {
            match provider::complete(&self.endpoint, self.key.as_deref(), &self.model, &self.system, &request).await {
                Ok(answer) => {
                    if let Ok(texts) = cues::read_reply(&answer, &self.lines, &batch) {
                        return Ok(texts);
                    }
                }
                Err(fail) if fail.stops_everything() => return Err(Some(fail)),
                Err(_) => {}
            }
        }
        Err(None)
    }
}

/// The cache file for this subtitle (by its contents), language, service and model.
fn cache_name(raw: &[u8], target: &Target, config: &Config) -> String {
    // FNV-1a: stable across runs and Rust versions (unlike the standard hasher), and enough to tell subtitles apart.
    struct Fnv(u64);
    impl Hasher for Fnv {
        fn finish(&self) -> u64 {
            self.0
        }
        fn write(&mut self, bytes: &[u8]) {
            for b in bytes {
                self.0 = (self.0 ^ u64::from(*b)).wrapping_mul(0x100_0000_01b3);
            }
        }
    }
    let mut hash = Fnv(0xcbf2_9ce4_8422_2325);
    hash.write(raw);
    let content = hash.finish();
    let mut hash = Fnv(0xcbf2_9ce4_8422_2325);
    for part in [config.provider.as_str(), config.model.trim(), target.code.as_str()] {
        hash.write(part.as_bytes());
        hash.write(&[0]);
    }
    format!("{content:016x}-{:016x}.srt", hash.finish())
}

async fn read_cached(path: &Path) -> Option<Vec<u8>> {
    let size = tokio::fs::metadata(path).await.ok()?.len();
    // A translation can be somewhat longer than its original.
    if size == 0 || size > 2 * MAX_SUBTITLE_BYTES as u64 {
        return None;
    }
    tokio::fs::read(path).await.ok()
}

async fn write_cached(path: &Path, bytes: &[u8]) {
    let Some(dir) = path.parent() else { return };
    if tokio::fs::create_dir_all(dir).await.is_err() || tokio::fs::write(path, bytes).await.is_err() {
        return;
    }
    // Only the newest few are kept.
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(meta) = entry.metadata().await
            && meta.is_file()
        {
            files.push((meta.modified().unwrap_or(std::time::UNIX_EPOCH), entry.path()));
        }
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    for (_, old) in files.into_iter().skip(CACHE_FILES) {
        let _ = tokio::fs::remove_file(old).await;
    }
}

#[cfg(test)]
mod tests;
