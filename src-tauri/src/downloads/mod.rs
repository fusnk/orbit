//! Offline downloads: movies and episodes saved to a folder the person
//! chooses, to play without a connection.
//!
//! The page picks a source (as for playback) and hands over its address and
//! description; from then on Rust owns the download. Hardening, and why:
//! - Addresses often embed debrid keys, so they're sealed in SQLite (see
//!   `store`), never logged, never in errors, file names or anything sent back
//!   to the page. The page can start or refresh a download but never read its
//!   address; likewise it never learns file paths: it plays and opens
//!   downloads by id, and Rust resolves the path.
//! - Addresses follow the addon rules (https, or http on 127.0.0.1 for local
//!   addons) and redirects may not cross into this machine or the LAN.
//! - File names come from addon metadata, so they're sanitised and stay
//!   inside the downloads folder (see `files`).
//! - The folder is set only through `download_folder_set`, which checks it
//!   exists and can be written; its key can't be written through `settings_set`.
//!
//! Two downloads run at a time; the rest wait. Settings → Downloads can cap
//! the speed and limit the hours downloads run (see `schedule`): outside
//! those hours queued downloads wait and running ones go back to waiting,
//! unless the person chose "Download now anyway" for one. Later additions fit here:
//! whole seasons and "keep the next N unwatched" start several downloads
//! through `start`; "delete after watching" and a storage cap call
//! `remove_files`; HLS would be another job kind beside http and torrent.

pub(crate) mod files;
mod http;
mod schedule;
mod store;
mod torrent;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::Db;
use crate::episode_files::Wanted;
use crate::library::{MAX_SNAPSHOT_BYTES, check_id, now_ms};
use crate::profiles::ActiveProfile;
use crate::vault::{self, VaultError};
use files::PART_SUFFIX;
use http::{Known, Sink};
use store::State as JobState;

/// How the page asks the player for a downloaded copy: `orbit-download://{id}`.
pub const SCHEME: &str = "orbit-download://";
const MAX_ACTIVE: usize = 2;
const EVENT: &str = "downloads://event";
/// Not writable through `settings_set` (its names can't contain ':'), so only
/// `download_folder_set` can point downloads somewhere, after checking it.
const FOLDER_KEY: &str = "downloads:folder";
const SUBTITLE_EXTENSIONS: [&str; 3] = ["srt", "vtt", "ass"];
const ART_LIMIT: usize = 8 * 1024 * 1024;
const SUBTITLE_LIMIT: usize = 5 * 1024 * 1024;
const EXTRA_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_SUBTITLES: usize = 4;
/// How often the download window is checked (it's whole hours, so this is plenty).
const SCHEDULE_TICK: Duration = Duration::from_secs(30);

/// Why a download stopped, or a request was refused. The page words these.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Failure {
    Network,
    Http { status: u16 },
    /// The address isn't allowed (scheme, redirect into the LAN, bad magnet).
    Blocked,
    /// An error page or something else that isn't a video.
    NotVideo,
    /// Finished, but too small to be a film or episode.
    TooSmall,
    /// The server sent less than it said it would.
    Incomplete,
    Expired,
    /// HLS/DASH playlists and live streams.
    NotDownloadable,
    DiskFull,
    Permission,
    Disk,
    /// Not enough free space to start.
    NoSpace,
    /// The downloads folder is missing or can't be written.
    Folder,
    /// A typed folder on a network share: those are chosen with the folder dialog.
    /// (Windows only: other systems have no shares as paths.)
    #[cfg_attr(not(windows), allow(dead_code))]
    NetworkFolder,
    Torrent,
    TorrentTimeout,
    NoVideoFile,
    /// The torrent lists more files than Orbit opens (`torrent::MAX_TORRENT_FILES`).
    TooManyFiles,
    /// The keychain is locked or the saved address can't be opened.
    Vault,
    Storage,
    NotFound,
    /// Was downloaded, but its file is no longer where Orbit saved it (moved or deleted).
    Missing,
    Invalid,
}

impl From<rusqlite::Error> for Failure {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}

impl From<VaultError> for Failure {
    fn from(_: VaultError) -> Self {
        Self::Vault
    }
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum Event {
    Progress { id: String, done: u64, total: Option<u64>, speed: f64 },
    State { id: String, state: &'static str, error: Option<Failure> },
    Removed { id: String },
    /// The download window opened or closed (always open without one).
    Schedule { open: bool },
}

fn emit(app: &AppHandle, event: Event) {
    let _ = app.emit(EVENT, event);
}

pub struct Downloads {
    tasks: std::sync::Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    swarm: torrent::Swarm,
    /// Where the download torrent sessions keep their (unused) default folder.
    cache: PathBuf,
    /// Bytes each running download has now (SQLite is only written every few
    /// seconds), so the space used matches the progress the page shows.
    live: std::sync::Mutex<HashMap<String, u64>>,
    /// One start at a time: two starts of the same episode at once would both
    /// find no earlier download to replace, and both download it.
    starting: tokio::sync::Mutex<()>,
    /// One pause, resume, refresh or removal at a time. Each changes the row
    /// first and then waits for the worker to stop; run side by side (a resume
    /// while a pause still waits), a second worker could start on the same
    /// file before the first had let go of it.
    control: tokio::sync::Mutex<()>,
    /// Settings → Downloads → "Only download between", as the page last set it.
    schedule: std::sync::Mutex<schedule::Schedule>,
    /// Downloads the person chose to run outside the window ("Download now
    /// anyway"). Kept in memory only: at startup nothing is running anyway
    /// (see `store::pause_unfinished`).
    anyway: std::sync::Mutex<HashSet<String>>,
}

impl Downloads {
    pub fn new(cache: PathBuf) -> Self {
        Self {
            tasks: Default::default(),
            swarm: Default::default(),
            cache,
            live: Default::default(),
            starting: Default::default(),
            control: Default::default(),
            schedule: Default::default(),
            anyway: Default::default(),
        }
    }

    /// Whether the download window is open now (always, without one).
    fn window_open(&self) -> bool {
        self.schedule.lock().map(|s| s.open_at(now_ms())).unwrap_or(true)
    }

    /// Whether download `id` may run now.
    fn may_run(&self, open: bool, id: &str) -> bool {
        open || self.anyway.lock().is_ok_and(|a| a.contains(id))
    }

    fn forget_anyway(&self, id: &str) {
        if let Ok(mut anyway) = self.anyway.lock() {
            anyway.remove(id);
        }
    }

    fn forget_live(&self, id: &str) {
        if let Ok(mut live) = self.live.lock() {
            live.remove(id);
        }
    }
}

/// At startup: nothing was left downloading by a previous run (see
/// `store::pause_unfinished`), files finished but not recorded are marked
/// done (see `mark_finished`), and partial files a crash left behind go.
/// `Downloads` must be managed first.
///
/// The sweep walks every downloads folder, which may be on a slow, asleep or
/// disconnected drive, so it runs in the background rather than holding up
/// the window. It holds both locks every new file goes through (`starting`
/// for new downloads, `control` for resumes and refreshes), so no download
/// can create a file while it decides what's orphaned.
pub fn init(app: &AppHandle) -> Result<(), String> {
    store::pause_unfinished(&*app.state::<Db>().lock()?).map_err(|e| e.to_string())?;
    // The download window opens and closes on its own: look every so often.
    let ticker = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(SCHEDULE_TICK).await;
            enforce_window(&ticker).await;
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let downloads = app.state::<Downloads>();
        let _starting = downloads.starting.lock().await;
        let _control = downloads.control.lock().await;
        let default = default_root(&app);
        let finisher = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || mark_finished(&finisher)).await;
        let checker = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || mark_missing(&checker)).await;
        let sweeper = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || sweep_orphans(&sweeper.state::<Db>(), default)).await;
    });
    Ok(())
}

/// Tells the page when the window opens or closes; once it's closed, running
/// downloads (but ones started anyway) go back to waiting, keeping what they
/// have. Then starts whatever may run.
async fn enforce_window(app: &AppHandle) {
    let downloads = app.state::<Downloads>();
    let open = downloads.window_open();
    let changed = downloads.schedule.lock().is_ok_and(|mut s| s.was_open.replace(open) != Some(open));
    if changed {
        emit(app, Event::Schedule { open });
    }
    if !open {
        let _control = downloads.control.lock().await;
        let running: Vec<String> = downloads.tasks.lock().map(|t| t.keys().cloned().collect()).unwrap_or_default();
        for id in running.into_iter().filter(|id| !downloads.may_run(false, id)) {
            // Waiting before stopping, as for a pause (see `download_pause`).
            if transition(app, &id, &[JobState::Running], JobState::Queued).is_ok() {
                stop(&downloads, &id).await;
            }
        }
    }
    pump(app);
}

/// Marks done the downloads a previous run finished on disk but quit before
/// recording (see `store::mark_finished`), and clears what the finished job
/// would have: a leftover partial file or torrent staging folder.
fn mark_finished(app: &AppHandle) {
    let db = app.state::<Db>();
    let Ok(unfinished) = db.lock().map_err(drop).and_then(|conn| store::unfinished(&conn).map_err(drop)) else { return };
    // The drive may be slow or asleep: it's looked at without holding the database.
    for finished in store::on_disk(unfinished) {
        let row = db.lock().ok().and_then(|conn| store::mark_done(&conn, &finished).ok().filter(|&marked| marked).and_then(|_| store::get(&conn, &finished.id).ok().flatten()));
        let Some(row) = row else { continue };
        let _ = std::fs::remove_file(row.folder.join(format!("{}{PART_SUFFIX}", row.base)));
        let _ = std::fs::remove_dir_all(torrent::staging(&row.folder, &row.id));
        emit(app, Event::State { id: row.id, state: JobState::Done.as_str(), error: None });
    }
}

/// Marks failed the finished downloads whose file is no longer there (moved or
/// deleted outside Orbit). Left done, Play would keep reaching for the file and
/// never stream instead, and the space would still count; failed, the page
/// streams again and offers to download it again. A download whose drive is
/// unreachable (unplugged or asleep: neither the downloads folder nor the one
/// holding it is there) is left alone, as its file may well come back; one
/// marked anyway (a drive mounted inside a folder that stays) is marked done
/// again at the next start once its file is back (see `mark_finished`).
fn mark_missing(app: &AppHandle) {
    let db = app.state::<Db>();
    let Ok(done) = db.lock().map_err(drop).and_then(|conn| store::done(&conn).map_err(drop)) else { return };
    // The drive may be slow or asleep: it's looked at without holding the database.
    for row in done.into_iter().filter(file_missing) {
        forget_file(app, &row.id);
    }
}

/// Whether finished download `row`'s file is gone while its drive can be
/// reached: the downloads folder is there, or the folder holding it is (the
/// person deleted the whole downloads folder).
fn file_missing(row: &store::Download) -> bool {
    let reachable = row.root.is_dir() || row.root.parent().is_some_and(Path::is_dir);
    reachable && !row.video().is_some_and(|v| v.is_file())
}

/// Marks finished download `id` failed for its missing file, and tells the page.
fn forget_file(app: &AppHandle, id: &str) {
    let error = serde_json::to_value(Failure::Missing).ok();
    let marked = app.state::<Db>().lock().is_ok_and(|conn| store::mark_missing(&conn, id, error.as_ref()).unwrap_or(false));
    if marked {
        emit(app, Event::State { id: id.to_string(), state: JobState::Failed.as_str(), error: Some(Failure::Missing) });
    }
}

/// Removes partial files and torrent staging folders no download refers to
/// (see `files::orphans`), in every folder downloads have been saved to.
/// Runs while no download can start (see `init`), so none is being written.
fn sweep_orphans(db: &Db, default: Option<PathBuf>) {
    let Ok(rows) = db.lock().map_err(drop).and_then(|conn| store::all(&conn).map_err(drop)) else { return };
    let kept: std::collections::HashSet<PathBuf> =
        rows.iter().flat_map(|row| [row.folder.join(format!("{}{PART_SUFFIX}", row.base)), torrent::staging(&row.folder, &row.id)]).collect();
    let mut roots: Vec<PathBuf> = rows.into_iter().map(|row| row.root).chain(saved_root(db)).chain(default).collect();
    roots.sort();
    roots.dedup();
    for root in roots.iter().filter(|r| r.is_dir()) {
        for orphan in files::orphans(root, &kept) {
            let _ = if orphan.is_dir() { std::fs::remove_dir_all(&orphan) } else { std::fs::remove_file(&orphan) };
            if let Some(folder) = orphan.parent() {
                files::prune_empty(folder, root);
            }
        }
    }
}

/// Starts queued downloads while fewer than `MAX_ACTIVE` run (outside the
/// download window, only ones started anyway).
fn pump(app: &AppHandle) {
    let downloads = app.state::<Downloads>();
    let db = app.state::<Db>();
    let open = downloads.window_open();
    let Ok(mut tasks) = downloads.tasks.lock() else { return };
    let free = MAX_ACTIVE.saturating_sub(tasks.len());
    if free == 0 {
        return;
    }
    let Ok(conn) = db.lock() else { return };
    let waiting = store::queued(&conn, store::MAX_QUEUED).unwrap_or_default();
    let start = to_start(waiting, |id| tasks.contains_key(id), |id| downloads.may_run(open, id), free);
    for id in start {
        if store::set_state(&conn, &id, JobState::Running, None).is_err() {
            continue;
        }
        emit(app, Event::State { id: id.clone(), state: JobState::Running.as_str(), error: None });
        let (app, task_id) = (app.clone(), id.clone());
        tasks.insert(id, tauri::async_runtime::spawn(run(app, task_id)));
    }
}

/// Which of the `waiting` downloads to start, at most `free`: those allowed
/// to run now, and never one whose task is still there. A download put back
/// to waiting (the window closed) is queued a moment before its task has
/// stopped; started again meanwhile ("Download now anyway"), it would have
/// a second task on the same file, the first left running unseen.
fn to_start(waiting: Vec<String>, has_task: impl Fn(&str) -> bool, may_run: impl Fn(&str) -> bool, free: usize) -> Vec<String> {
    waiting.into_iter().filter(|id| !has_task(id) && may_run(id)).take(free).collect()
}

async fn run(app: AppHandle, id: String) {
    let result = job(&app, &id).await;
    // The transfer is over (nothing more touches the files): give up the slot
    // first, so a pause or removal from here on has nothing to wait for.
    let downloads = app.state::<Downloads>();
    if let Ok(mut tasks) = downloads.tasks.lock() {
        tasks.remove(&id);
    }
    downloads.forget_live(&id);
    downloads.forget_anyway(&id);
    let (state, error) = match result {
        Ok(()) => (JobState::Done, None),
        Err(Failure::Expired) => (JobState::Expired, Some(Failure::Expired)),
        Err(f) => (JobState::Failed, Some(f)),
    };
    let written = app.state::<Db>().lock().is_ok_and(|conn| {
        let json = error.as_ref().and_then(|e| serde_json::to_value(e).ok());
        let current = store::get(&conn, &id).ok().flatten().map(|row| row.state);
        outcome_applies(current, state) && store::set_state(&conn, &id, state, json.as_ref()).is_ok()
    });
    if written {
        emit(&app, Event::State { id: id.clone(), state: state.as_str(), error });
    }
    pump(&app);
}

/// Whether a finished transfer's outcome may replace the row's state
/// (`current`, None once removed). A pause can land as a transfer ends: the
/// person's pause then stands over a failure, but a finished file is done.
fn outcome_applies(current: Option<JobState>, outcome: JobState) -> bool {
    match current {
        Some(JobState::Running) => true,
        Some(_) => outcome == JobState::Done,
        None => false,
    }
}

/// Saves progress to SQLite and reports it to the page.
struct JobSink<'a> {
    app: &'a AppHandle,
    id: &'a str,
}

impl Sink for JobSink<'_> {
    fn progress(&mut self, done: u64, total: Option<u64>, speed: f64) {
        if let Ok(mut live) = self.app.state::<Downloads>().live.lock() {
            live.insert(self.id.to_string(), done);
        }
        emit(self.app, Event::Progress { id: self.id.to_string(), done, total, speed });
    }

    fn save(&mut self, done: u64, known: &Known) {
        if let Ok(conn) = self.app.state::<Db>().lock() {
            let _ = store::save_progress(&conn, self.id, done, known.total, known.validator.as_deref(), known.ext.as_deref());
        }
    }
}

async fn job(app: &AppHandle, id: &str) -> Result<(), Failure> {
    let (row, source) = {
        let db = app.state::<Db>();
        let conn = db.lock().map_err(|_| Failure::Storage)?;
        let row = store::get(&conn, id)?.ok_or(Failure::NotFound)?;
        let source = store::open(&vault::cipher()?, &row)?;
        (row, source)
    };
    if !row.root.is_dir() {
        return Err(Failure::Folder);
    }
    std::fs::create_dir_all(&row.folder).map_err(|_| Failure::Folder)?;
    let mut sink = JobSink { app, id };
    if row.torrent {
        let downloads = app.state::<Downloads>();
        // Which episode, to find it in a season pack.
        let episode = row.season.zip(row.episode).and_then(|(s, e)| Some(Wanted { season: u32::try_from(s).ok()?, episode: u32::try_from(e).ok()?, absolute: None })).filter(Wanted::valid);
        downloads.swarm.fetch(&downloads.cache, id, &source, episode, row.upload, &row.folder, &row.base, &mut sink).await?;
        let _ = std::fs::remove_file(row.folder.join(format!("{}{PART_SUFFIX}", row.base)));
        return Ok(());
    }
    // A cloud file's address names it; a fresh link is made now (one that
    // expired is made again when the download resumes). It's never stored.
    let source = if source.starts_with(crate::debrid::SCHEME) {
        crate::debrid::resolve_download(app, &row.profile, &source).await.map_err(|e| match e {
            crate::debrid::Unavailable::Gone => Failure::NotFound,
            crate::debrid::Unavailable::Failed => Failure::Network,
        })?
    } else {
        source
    };
    let url = Url::parse(&source).map_err(|_| Failure::Blocked)?;
    let known = Known { total: row.total, validator: row.validator.clone(), ext: row.ext.clone() };
    let known = http::fetch(&url, &row.folder, &row.base, known, &mut sink).await?;
    let ext = known.ext.clone().unwrap_or_else(|| "mkv".into());
    let video = row.folder.join(format!("{}.{ext}", row.base));
    std::fs::rename(row.folder.join(format!("{}{PART_SUFFIX}", row.base)), &video).map_err(|e| http::disk_failure(&e))?;
    sink.save(known.total.unwrap_or_default(), &Known { ext: Some(ext), ..known });
    Ok(())
}

/// Stops download `id` if it's running, and waits until it has let go of its files.
async fn stop(downloads: &Downloads, id: &str) {
    let handle = downloads.tasks.lock().ok().and_then(|mut t| t.remove(id));
    if let Some(handle) = handle {
        handle.abort();
        let _ = handle.await;
    }
    downloads.forget_live(id);
    downloads.swarm.release(id).await;
}

/// Deletes everything download `row` put on disk: the video or its partial
/// file, subtitles, the torrent staging folder, and (if no other download of
/// the title uses them) the poster and logo; then folders left empty.
/// Call after its row is gone.
fn remove_files(conn: &rusqlite::Connection, row: &store::Download) {
    let others = store::bases_in(conn, &row.folder.to_string_lossy(), &row.id).unwrap_or_default();
    let ours = |name: &str| {
        let ext = name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
        belongs(&row.base, &others, name) && (ext == "part" || SUBTITLE_EXTENSIONS.contains(&ext.as_str()) || crate::torrent::VIDEO_EXTENSIONS.contains(&ext.as_str()))
    };
    if let Ok(entries) = std::fs::read_dir(&row.folder) {
        for entry in entries.flatten() {
            if ours(&entry.file_name().to_string_lossy()) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let _ = std::fs::remove_dir_all(torrent::staging(&row.folder, &row.id));
    let art = row.art_folder();
    if store::title_users(conn, &row.title_id, &row.root.to_string_lossy()).unwrap_or(1) == 0 {
        remove_own_art(&art);
    }
    files::prune_empty(&row.folder, &row.root);
    files::prune_empty(&art, &row.root);
}

/// Whether `name`, in a download's folder, is named as download `base`'s
/// files are (`<base>.…`) and isn't instead a file of another download there
/// (`others`, their bases) whose name starts with this one's and a dot
/// ("Pilot" and "Pilot. Part 2"): removing or playing one never takes the other's.
fn belongs(base: &str, others: &[String], name: &str) -> bool {
    let theirs = |other: &String| other.len() > base.len() && name.starts_with(&format!("{other}."));
    name.starts_with(&format!("{base}.")) && !others.iter().any(theirs)
}

/// The poster and logo files in `folder`, Orbit's or not.
fn art_files(folder: &Path) -> Vec<String> {
    ["poster", "logo"].iter().flat_map(|name| ["jpg", "png", "webp"].map(|ext| format!("{name}.{ext}"))).filter(|f| folder.join(f).is_file()).collect()
}

/// Names the art files Orbit wrote in a folder, one per line. Orbit's layout
/// (`Movies/<Title (Year)>/`) is also Plex's, Jellyfin's and Kodi's, so the
/// downloads folder may be someone's media library, whose `poster.jpg` is
/// theirs: Orbit only ever replaces or deletes art this note lists. Art
/// written before the note existed isn't listed, so it's left alone too.
const ART_NOTE: &str = ".orbit-art";

/// The art files `folder`'s note says Orbit wrote (only art names, whatever else the note holds).
fn own_art(folder: &Path) -> Vec<String> {
    let note = std::fs::read_to_string(folder.join(ART_NOTE)).unwrap_or_default();
    let names = art_files(folder);
    note.lines().map(str::trim).filter(|line| names.iter().any(|n| n == line)).map(str::to_string).collect()
}

/// Writes the note for `owned`, or removes it when Orbit owns no art there.
fn note_art(folder: &Path, owned: &[String]) {
    let path = folder.join(ART_NOTE);
    let _ = if owned.is_empty() { std::fs::remove_file(path) } else { std::fs::write(path, owned.join("\n") + "\n") };
}

/// Saves `bytes` as `<kind>.<ext>` (poster or logo) in `folder`, unless the folder already has
/// art of that kind Orbit didn't write: that's the person's own, kept as it is.
fn save_art(folder: &Path, kind: &str, ext: &str, bytes: &[u8]) {
    let prefix = format!("{kind}.");
    let owned = own_art(folder);
    if art_files(folder).iter().any(|f| f.starts_with(&prefix) && !owned.contains(f)) {
        return;
    }
    for old in owned.iter().filter(|f| f.starts_with(&prefix)) {
        let _ = std::fs::remove_file(folder.join(old));
    }
    let name = format!("{kind}.{ext}");
    if std::fs::write(folder.join(&name), bytes).is_ok() {
        let mut kept: Vec<String> = owned.into_iter().filter(|f| !f.starts_with(&prefix)).collect();
        kept.push(name);
        note_art(folder, &kept);
    }
}

/// Deletes the art Orbit wrote in `folder`, and its note; anything else stays.
fn remove_own_art(folder: &Path) {
    for name in own_art(folder) {
        let _ = std::fs::remove_file(folder.join(name));
    }
    let _ = std::fs::remove_file(folder.join(ART_NOTE));
}

/// Stops and removes download `row`, files and all.
///
/// The row goes first, so nothing can start it again (`pump` only starts
/// rows it finds) while the worker is stopped; the files go once the worker
/// has let go of them. A crash between the two leaves files no row refers
/// to, which `sweep_orphans` clears at the next start.
async fn discard(app: &AppHandle, row: &store::Download) -> Result<(), Failure> {
    let downloads = app.state::<Downloads>();
    let _control = downloads.control.lock().await;
    let db = app.state::<Db>();
    store::delete(&*db.lock().map_err(|_| Failure::Storage)?, &row.id)?;
    stop(&downloads, &row.id).await;
    downloads.forget_anyway(&row.id);
    remove_files(&*db.lock().map_err(|_| Failure::Storage)?, row);
    emit(app, Event::Removed { id: row.id.clone() });
    Ok(())
}

/// Stops and removes every download of a deleted profile, files and all.
pub async fn remove_profile(app: &AppHandle, profile: &str) -> Result<(), String> {
    let rows = store::for_profile(&*app.state::<Db>().lock()?, profile).map_err(|e| e.to_string())?;
    // Each is removed even if one before it couldn't be.
    let mut failed = false;
    for row in &rows {
        failed |= discard(app, row).await.is_err();
    }
    pump(app);
    if failed { Err("couldn't remove the profile's downloads".into()) } else { Ok(()) }
}

// ── The downloads folder ──

/// Videos/Orbit, else Downloads/Orbit.
fn default_root(app: &AppHandle) -> Option<PathBuf> {
    // Android's "video" folder in Tauri is the app's cache, which the system may clear when space runs
    // low; its Downloads folder is the app's own storage, kept until Orbit is uninstalled.
    #[cfg(target_os = "android")]
    return app.path().download_dir().ok().map(|d| d.join("Orbit"));
    #[cfg(not(target_os = "android"))]
    app.path().video_dir().or_else(|_| app.path().download_dir()).ok().map(|d| d.join("Orbit"))
}

/// Whether `path` is an existing folder Orbit can write to (by writing a probe file).
fn check_folder(path: &Path) -> Result<(), Failure> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(Failure::Folder);
    }
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|_| Failure::Folder)?;
    let probe = path.join(format!(".orbit-write-{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>()));
    std::fs::write(&probe, b"").map_err(|e| match http::disk_failure(&e) {
        Failure::Permission => Failure::Permission,
        _ => Failure::Folder,
    })?;
    let _ = std::fs::remove_file(probe);
    Ok(())
}

fn saved_root(db: &Db) -> Option<PathBuf> {
    db.setting(FOLDER_KEY).and_then(|v| v.as_str().map(PathBuf::from)).filter(|p| p.is_absolute())
}

/// Where new downloads go: the chosen folder, else the default (created if needed).
fn root(app: &AppHandle, db: &Db) -> Result<PathBuf, Failure> {
    let root = match saved_root(db) {
        Some(root) => root,
        None => {
            let root = default_root(app).ok_or(Failure::Folder)?;
            std::fs::create_dir_all(&root).map_err(|_| Failure::Folder)?;
            root
        }
    };
    check_folder(&root)?;
    Ok(root)
}

// ── Commands ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleOffer {
    url: String,
    lang: String,
}

/// A download as the page asks for it. `title` is the display snapshot (as
/// for My Library); `name` and `year` name the files; `addon_key`,
/// `stream_type`, `stream_id` and `identity` find the stream again if its
/// link expires; `url` is the stream's address or magnet.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    title_id: String,
    video_id: String,
    title: Value,
    name: String,
    year: Option<String>,
    season: Option<i64>,
    episode: Option<i64>,
    episode_title: Option<String>,
    label: String,
    addon_key: String,
    stream_type: String,
    stream_id: String,
    identity: String,
    url: String,
    upload: bool,
    poster: Option<String>,
    logo: Option<String>,
    #[serde(default)]
    subtitles: Vec<SubtitleOffer>,
}

fn plain(text: &str, max: usize) -> bool {
    !text.is_empty() && text.chars().count() <= max && !text.chars().any(char::is_control)
}

/// Checks a request and says whether its source is a torrent.
fn check_request(r: &StartRequest) -> Result<bool, Failure> {
    let invalid = Failure::Invalid;
    check_id(&r.title_id).map_err(|_| invalid.clone())?;
    check_id(&r.video_id).map_err(|_| invalid.clone())?;
    check_id(&r.stream_id).map_err(|_| invalid.clone())?;
    let snapshot_ok = r.title.is_object() && r.title.to_string().len() <= MAX_SNAPSHOT_BYTES;
    let fields_ok = plain(&r.name, 300)
        && plain(&r.label, 300)
        && plain(&r.addon_key, 128)
        && r.year.as_deref().is_none_or(|y| plain(y, 40))
        && r.episode_title.as_deref().is_none_or(|t| t.is_empty() || plain(t, 300))
        && (1..=32).contains(&r.stream_type.len())
        && r.stream_type.bytes().all(|b| b.is_ascii_lowercase() || b == b'_' || b == b'-')
        && (1..=128).contains(&r.identity.len())
        && r.identity.bytes().all(|b| b.is_ascii_alphanumeric() || b == b':' || b == b'-')
        && r.season.is_some() == r.episode.is_some()
        && r.season.is_none_or(|s| (0..=10_000).contains(&s))
        && r.episode.is_none_or(|e| (0..=100_000).contains(&e));
    if !snapshot_ok || !fields_ok || r.url.len() > 8192 {
        return Err(invalid);
    }
    // A file in the person's debrid cloud: its link is made by the job each time it starts (see `job`).
    if r.url.starts_with(crate::debrid::SCHEME) {
        return crate::debrid::parse_address(&r.url).map(|_| false).ok_or(Failure::Invalid);
    }
    if r.url.starts_with("magnet:") {
        crate::torrent::parse_magnet(&r.url).map_err(|_| Failure::Blocked)?;
        return Ok(true);
    }
    let url = Url::parse(&r.url).map_err(|_| Failure::Blocked)?;
    http::check_url(&url)?;
    if http::is_playlist(&url) {
        return Err(Failure::NotDownloadable);
    }
    Ok(false)
}

fn random_id() -> Result<String, Failure> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| Failure::Vault)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn active_id(active: &ActiveProfile) -> Result<String, Failure> {
    active.id().map_err(|_| Failure::NotFound)
}

/// Queues a download of a movie or episode for the active profile, replacing
/// any earlier download of the same one. Returns the new download's id.
#[tauri::command]
pub async fn download_start(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, request: StartRequest) -> Result<String, Failure> {
    let torrent = check_request(&request)?;
    let downloads = app.state::<Downloads>();
    let _starting = downloads.starting.lock().await;
    let profile = active_id(&active)?;
    let cipher = vault::cipher()?;
    let root = root(&app, &db)?;

    let earlier = store::for_video(&*db.lock().map_err(|_| Failure::Storage)?, &profile, &request.video_id)?;
    for row in &earlier {
        discard(&app, row).await?;
    }

    let (relative, base) = match (request.season, request.episode) {
        (Some(season), Some(episode)) => files::episode_layout(&request.name, season, episode, request.episode_title.as_deref()),
        _ => files::movie_layout(&request.name, request.year.as_deref()),
    };
    let folder = root.join(relative);
    std::fs::create_dir_all(&folder).map_err(|e| match http::disk_failure(&e) {
        Failure::Permission => Failure::Permission,
        _ => Failure::Folder,
    })?;
    let id = random_id()?;
    let sealed = store::seal(&cipher, &id, &profile, &request.url)?;
    {
        let conn = db.lock().map_err(|_| Failure::Storage)?;
        let taken = store::bases_in(&conn, &folder.to_string_lossy(), "")?;
        let base = files::unique_base(&folder, &base, &taken);
        // Holds the name, so a second download started now can't pick the same one.
        std::fs::write(folder.join(format!("{base}{PART_SUFFIX}")), b"").map_err(|e| http::disk_failure(&e))?;
        let title = request.title.to_string();
        let new = store::NewDownload {
            id: &id,
            profile: &profile,
            title_id: &request.title_id,
            video_id: &request.video_id,
            title: &title,
            season: request.season,
            episode: request.episode,
            episode_title: request.episode_title.as_deref().filter(|t| !t.is_empty()),
            label: &request.label,
            addon_key: &request.addon_key,
            stream_type: &request.stream_type,
            stream_id: &request.stream_id,
            identity: &request.identity,
            torrent,
            upload: request.upload,
            root: &root.to_string_lossy(),
            folder: &folder.to_string_lossy(),
            base: &base,
        };
        store::insert(&conn, &new, &sealed, now_ms())?;
    }
    emit(&app, Event::State { id: id.clone(), state: JobState::Queued.as_str(), error: None });
    tauri::async_runtime::spawn(save_extras(app.clone(), id.clone(), request));
    pump(&app);
    Ok(id)
}

/// The active profile's downloads, oldest first. No paths or addresses.
#[tauri::command]
pub async fn download_list(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Vec<store::Item>, Failure> {
    let mut conn = db.lock().map_err(|_| Failure::Storage)?;
    // The first list of a run (at startup) binds older addresses to their profile; a failure keeps them as they were.
    if !RESEALED.load(std::sync::atomic::Ordering::Relaxed)
        && let Ok(cipher) = vault::cipher()
    {
        match store::reseal_legacy(&mut conn, &cipher) {
            Ok(_) => RESEALED.store(true, std::sync::atomic::Ordering::Relaxed),
            Err(e) => crate::diagnostics::warn(&format!("downloads: could not re-seal older addresses: {e}")),
        }
    }
    Ok(store::list(&conn, &active_id(&active)?)?)
}

/// Whether this run has re-sealed the legacy addresses (see `store::reseal_legacy`); tried again until it succeeds.
static RESEALED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn owned(db: &Db, active: &ActiveProfile, id: &str) -> Result<store::Download, Failure> {
    store::owned(&*db.lock().map_err(|_| Failure::Storage)?, &active_id(active)?, id)?.ok_or(Failure::NotFound)
}

/// Sets `id`'s state if it's currently one of `from`.
fn transition(app: &AppHandle, id: &str, from: &[JobState], to: JobState) -> Result<(), Failure> {
    let db = app.state::<Db>();
    let conn = db.lock().map_err(|_| Failure::Storage)?;
    let current = store::get(&conn, id)?.ok_or(Failure::NotFound)?.state;
    if from.contains(&current) {
        store::set_state(&conn, id, to, None)?;
        drop(conn);
        emit(app, Event::State { id: id.to_string(), state: to.as_str(), error: None });
    }
    Ok(())
}

#[tauri::command]
pub async fn download_pause(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), Failure> {
    owned(&db, &active, &id)?;
    let downloads = app.state::<Downloads>();
    let _control = downloads.control.lock().await;
    // Paused before stopping: a queued download can't be started meanwhile,
    // and a transfer ending meanwhile won't overwrite the pause (see `run`).
    transition(&app, &id, &[JobState::Running, JobState::Queued], JobState::Paused)?;
    stop(&downloads, &id).await;
    pump(&app);
    Ok(())
}

/// Resumes a paused download, or tries a failed or expired one again (with its saved address).
#[tauri::command]
pub async fn download_resume(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), Failure> {
    owned(&db, &active, &id)?;
    let downloads = app.state::<Downloads>();
    let _control = downloads.control.lock().await;
    transition(&app, &id, &[JobState::Paused, JobState::Failed, JobState::Expired], JobState::Queued)?;
    pump(&app);
    Ok(())
}

/// A fresh address for an expired download (the page found the same stream
/// again); it continues the same partial file.
#[tauri::command]
pub async fn download_refresh(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String, url: String) -> Result<(), Failure> {
    let row = owned(&db, &active, &id)?;
    if row.torrent || !matches!(row.state, JobState::Expired | JobState::Failed | JobState::Paused) {
        return Err(Failure::Invalid);
    }
    let parsed = Url::parse(&url).map_err(|_| Failure::Blocked)?;
    http::check_url(&parsed)?;
    if url.len() > 8192 || http::is_playlist(&parsed) {
        return Err(Failure::NotDownloadable);
    }
    let sealed = store::seal(&vault::cipher()?, &id, &row.profile, &url)?;
    let downloads = app.state::<Downloads>();
    let _control = downloads.control.lock().await;
    // Checked again as it's written: it may have been resumed or removed since.
    if !store::replace_source(&*db.lock().map_err(|_| Failure::Storage)?, &id, &sealed)? {
        return Err(Failure::Invalid);
    }
    emit(&app, Event::State { id: id.clone(), state: JobState::Queued.as_str(), error: None });
    pump(&app);
    Ok(())
}

/// Settings → Downloads, as the page saved them: the speed limit in MB/s
/// (0 for none), the download window (None for any time) and the page's
/// offset from UTC in minutes (`Date.getTimezoneOffset()`). Applies at once;
/// returns whether the window is open now.
#[tauri::command]
pub async fn download_schedule_set(app: AppHandle, limit: u32, window: Option<schedule::Window>, offset: i32) -> Result<bool, Failure> {
    let bytes = schedule::limit_bytes(limit).ok_or(Failure::Invalid)?;
    if window.is_some_and(|w| !w.valid()) || !(-14 * 60..=14 * 60).contains(&offset) {
        return Err(Failure::Invalid);
    }
    let downloads = app.state::<Downloads>();
    schedule::set_http_limit(bytes);
    downloads.swarm.set_limit(u32::try_from(bytes).unwrap_or(u32::MAX)).await;
    if let Ok(mut s) = downloads.schedule.lock() {
        s.window = window;
        s.offset = offset;
        // Told again, so the page that just set it knows.
        s.was_open = None;
    }
    enforce_window(&app).await;
    Ok(downloads.window_open())
}

/// "Download now anyway": a waiting download starts outside the window.
#[tauri::command]
pub async fn download_now(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), Failure> {
    let row = owned(&db, &active, &id)?;
    if row.state != JobState::Queued {
        return Err(Failure::Invalid);
    }
    let downloads = app.state::<Downloads>();
    if let Ok(mut anyway) = downloads.anyway.lock() {
        anyway.insert(id);
    }
    pump(&app);
    Ok(())
}

/// Cancels a download, or deletes a finished one, with its files.
#[tauri::command]
pub async fn download_remove(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), Failure> {
    let row = owned(&db, &active, &id)?;
    discard(&app, &row).await?;
    pump(&app);
    Ok(())
}

/// Shows a finished download in the system's file manager.
#[tauri::command]
pub async fn download_reveal(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<(), Failure> {
    let row = owned(&db, &active, &id)?;
    let target = row.video().filter(|v| v.is_file()).unwrap_or_else(|| row.folder.clone());
    if !target.exists() {
        return Err(Failure::NotFound);
    }
    reveal(&target).map_err(|_| Failure::NotFound)
}

/// Starts the file manager through `browser::launch`, which reaps the opener
/// once it exits: spawned and forgotten, every "Show in folder" left a zombie
/// process behind until Orbit quit (the bug the browser opener already fixed).
fn reveal(path: &Path) -> std::io::Result<()> {
    crate::browser::launch(&mut reveal_command(path)).map(|_| ())
}

#[cfg(windows)]
fn reveal_command(path: &Path) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    // Explorer parses its own command line: `/select,"path"` must reach it unquoted as a whole.
    let mut cmd = std::process::Command::new("explorer.exe");
    cmd.raw_arg(format!("/select,\"{}\"", path.display()));
    cmd
}

#[cfg(target_os = "macos")]
fn reveal_command(path: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new("open");
    cmd.arg("-R").arg(path);
    cmd
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_command(path: &Path) -> std::process::Command {
    let folder = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(folder);
    cmd
}

/// The poster saved with a download (empty when there's none), for the page to show offline.
#[tauri::command]
pub async fn download_art(db: State<'_, Db>, active: State<'_, ActiveProfile>, id: String) -> Result<tauri::ipc::Response, Failure> {
    let row = owned(&db, &active, &id)?;
    let folder = row.art_folder();
    let poster = art_files(&folder).into_iter().find(|f| f.starts_with("poster."));
    let bytes = poster.and_then(|f| std::fs::read(folder.join(f)).ok()).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Storage {
    /// The folder new downloads go to (the person chose it, or Orbit's default).
    folder: Option<String>,
    custom: bool,
    /// Bytes all downloads take, partial files included (they take the space too).
    used: u64,
    /// Free space on the folder's drive.
    free: Option<u64>,
}

#[tauri::command]
pub async fn download_storage(app: AppHandle, db: State<'_, Db>) -> Result<Storage, Failure> {
    let live = app.state::<Downloads>().live.lock().map(|l| l.clone()).unwrap_or_default();
    let used = store::bytes_used(&*db.lock().map_err(|_| Failure::Storage)?, &live)?;
    let saved = saved_root(&db);
    let folder = saved.clone().or_else(|| default_root(&app));
    Ok(Storage {
        free: folder.as_deref().and_then(|f| files::free_space(f).or_else(|| f.parent().and_then(files::free_space))),
        folder: folder.map(|f| f.to_string_lossy().into_owned()),
        custom: saved.is_some(),
        used,
    })
}

/// Sets where new downloads go (existing ones stay where they are); an empty
/// path goes back to the default. The folder must exist and be writable.
#[tauri::command]
pub async fn download_folder_set(db: State<'_, Db>, path: String) -> Result<(), Failure> {
    save_folder(&db, &path, false)
}

/// Asks for the downloads folder with the system's folder dialog (starting in
/// the current one) and saves it as `download_folder_set` would. Returns the
/// chosen path, or `None` if the person cancelled.
#[tauri::command]
pub async fn download_folder_pick(app: AppHandle, db: State<'_, Db>) -> Result<Option<String>, Failure> {
    let current = saved_root(&db).or_else(|| default_root(&app));
    let Some(folder) = crate::dialog::pick_folder(&app, current.as_deref()).await else { return Ok(None) };
    let path = folder.to_string_lossy().into_owned();
    save_folder(&db, &path, true)?;
    Ok(Some(path))
}

/// Whether `folder` may be the downloads folder, before it's looked at at all.
/// On Windows: a drive, or a network share (a NAS is a fair place for
/// downloads) if it was `picked` in the system's folder dialog; never a device
/// path (`\\.\…`, `\\?\GLOBALROOT\…`), which reaches past the file system. A
/// typed share is refused: merely checking it sends this PC's Windows sign-in
/// to its server, and a typed path is one the page sends, which a script on it
/// could aim at any server (as for the external player, see external.rs).
#[cfg(windows)]
fn folder_allowed(folder: &Path, picked: bool) -> Result<(), Failure> {
    use std::path::{Component, Prefix};
    match folder.components().next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::Disk(_) | Prefix::VerbatimDisk(_) => Ok(()),
            Prefix::UNC(..) | Prefix::VerbatimUNC(..) if picked => Ok(()),
            Prefix::UNC(..) | Prefix::VerbatimUNC(..) => Err(Failure::NetworkFolder),
            _ => Err(Failure::Folder),
        },
        _ => Err(Failure::Folder),
    }
}

#[cfg(not(windows))]
fn folder_allowed(_folder: &Path, _picked: bool) -> Result<(), Failure> {
    Ok(())
}

/// The checks and the save behind `download_folder_set` and `download_folder_pick`
/// (`picked`: the path came from the system's folder dialog).
fn save_folder(db: &Db, path: &str, picked: bool) -> Result<(), Failure> {
    let conn = || db.lock().map_err(|_| Failure::Storage);
    let path = path.trim().trim_matches('"');
    if path.is_empty() {
        conn()?.execute("DELETE FROM settings WHERE key = ?1", [FOLDER_KEY])?;
        return Ok(());
    }
    if path.chars().count() > 1024 || path.chars().any(char::is_control) {
        return Err(Failure::Folder);
    }
    let folder = PathBuf::from(path);
    folder_allowed(&folder, picked)?;
    check_folder(&folder)?;
    conn()?.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![FOLDER_KEY, Value::String(folder.to_string_lossy().into_owned()).to_string()],
    )?;
    Ok(())
}

// ── Artwork and subtitles saved beside the video ──

/// Saves the poster, logo and subtitles a new download came with. Each is
/// optional: a failure here never stops the download.
async fn save_extras(app: AppHandle, id: String, request: StartRequest) {
    let Some(row) = app.state::<Db>().lock().ok().and_then(|c| store::get(&c, &id).ok().flatten()) else { return };
    let art = row.art_folder();
    for (name, url) in [("poster", request.poster), ("logo", request.logo)] {
        let Some(url) = url.and_then(|u| Url::parse(&u).ok()) else { continue };
        if crate::addons::net::check_artwork_url(&url).is_err() {
            continue;
        }
        if let Ok((bytes, _)) = crate::addons::net::fetch_bytes(url, ART_LIMIT, EXTRA_TIMEOUT).await
            && let Some(ext) = image_extension(&bytes)
        {
            while_kept(&app, &id, || save_art(&art, name, ext, &bytes));
        }
    }
    for offer in request.subtitles.into_iter().take(MAX_SUBTITLES) {
        let Ok(url) = Url::parse(&offer.url) else { continue };
        if crate::addons::net::check_origin(&url).is_err() {
            continue;
        }
        let Ok((bytes, _)) = crate::addons::net::fetch_bytes(url, SUBTITLE_LIMIT, EXTRA_TIMEOUT).await else { continue };
        let Some(ext) = subtitle_format(&bytes) else { continue };
        let lang = language_tag(&offer.lang);
        let name = (1..100)
            .map(|n| if n == 1 { format!("{}.{lang}.{ext}", row.base) } else { format!("{}.{lang}.{n}.{ext}", row.base) })
            .find(|name| !row.folder.join(name).exists());
        if let Some(name) = name {
            while_kept(&app, &id, || {
                let _ = std::fs::write(row.folder.join(name), bytes);
            });
        }
    }
}

/// Runs `write` only if download `id` still exists, holding the database
/// meanwhile: removing it can't slip in between, so what's written is either
/// removed with it or never written (`discard` deletes the row first).
fn while_kept(app: &AppHandle, id: &str, write: impl FnOnce()) {
    if let Ok(conn) = app.state::<Db>().lock()
        && store::get(&conn, id).ok().flatten().is_some()
    {
        write();
    }
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if !crate::wallpaper::is_image(bytes) {
        return None;
    }
    Some(if bytes.starts_with(b"\x89PNG") {
        "png"
    } else if bytes.starts_with(b"RIFF") {
        "webp"
    } else {
        "jpg"
    })
}

/// A subtitle language as a short, file-name-safe tag ("eng", "pt-br"), or "und".
fn language_tag(lang: &str) -> String {
    let tag: String = lang.trim().to_ascii_lowercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(8).collect();
    let tag = tag.trim_matches('-').to_string();
    if tag.is_empty() { "und".into() } else { tag }
}

/// The subtitle format of `bytes` (SubRip, WebVTT or ASS), or None if it isn't
/// a subtitle file at all (an error page, say).
fn subtitle_format(bytes: &[u8]) -> Option<&'static str> {
    let text = String::from_utf8_lossy(bytes);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if text.starts_with("WEBVTT") {
        return Some("vtt");
    }
    if text.contains("[Script Info]") && text.contains("Dialogue:") {
        return Some("ass");
    }
    let cue = |line: &str| {
        let Some((from, to)) = line.split_once("-->") else { return false };
        let time = |t: &str| {
            let t = t.trim();
            let t = t.split_whitespace().next().unwrap_or_default();
            t.len() >= 11 && t.bytes().all(|b| b.is_ascii_digit() || b":,.".contains(&b)) && t.matches(':').count() == 2
        };
        time(from) && time(to)
    };
    text.lines().take(200).any(cue).then_some("srt")
}

// ── Playback ──

pub struct LocalFile {
    pub video: String,
    pub subtitles: Vec<String>,
}

/// The finished video for `orbit-download://{id}` and its saved subtitles,
/// for the active profile only.
/// A finished download whose file was moved or deleted since is marked failed
/// (see `mark_missing`), so the next Play streams instead.
pub fn resolve(app: &AppHandle, profile: &str, id: &str) -> Result<LocalFile, String> {
    let gone = || "err.downloads.gone".to_string();
    let (row, others) = {
        let db = app.state::<Db>();
        let conn = db.lock()?;
        let row = store::owned(&conn, profile, id).map_err(|e| e.to_string())?.ok_or_else(gone)?;
        let others = store::bases_in(&conn, &row.folder.to_string_lossy(), &row.id).map_err(|e| e.to_string())?;
        (row, others)
    };
    if row.state == JobState::Done && file_missing(&row) {
        forget_file(app, &row.id);
    }
    let video = row.video().filter(|v| row.state == JobState::Done && v.is_file()).ok_or_else(gone)?;
    let mut subtitles: Vec<String> = std::fs::read_dir(&row.folder)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    belongs(&row.base, &others, &name) && name.rsplit('.').next().is_some_and(|ext| SUBTITLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
                })
                .map(|e| e.path().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    subtitles.sort();
    Ok(LocalFile { video: video.to_string_lossy().into_owned(), subtitles })
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    files::fuzz_input(data);
    let _ = http::parse_content_range(&String::from_utf8_lossy(data));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn a_typed_folder_is_never_a_network_share() {
        // Looking a share up sends this PC's Windows sign-in to its server, so one
        // only comes from the folder dialog, never from a path the page sends.
        for share in [r"\\evil.example\share", r"\\evil.example@SSL\dav", r"\\?\UNC\evil.example\share", "//evil.example/share"] {
            assert_eq!(folder_allowed(Path::new(share), false), Err(Failure::NetworkFolder), "{share}");
            assert_eq!(folder_allowed(Path::new(share), true), Ok(()), "{share} from the dialog");
        }
        for device in [r"\\.\C:\x", r"\\?\GLOBALROOT\Device\x", "Videos"] {
            assert_eq!(folder_allowed(Path::new(device), true), Err(Failure::Folder), "{device}");
        }
        assert_eq!(folder_allowed(Path::new(r"D:\Videos"), false), Ok(()));
        assert_eq!(folder_allowed(Path::new(r"\\?\D:\Videos"), false), Ok(()));
    }

    #[test]
    fn art_already_in_a_media_library_is_never_replaced_or_deleted() {
        let dir = std::env::temp_dir().join(format!("orbit-art-test-{}", crate::library::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        // The person's own library: a poster Plex or Jellyfin put there.
        std::fs::write(dir.join("poster.png"), b"theirs").unwrap();
        save_art(&dir, "poster", "jpg", b"orbit");
        save_art(&dir, "logo", "png", b"orbit logo");
        assert_eq!(std::fs::read(dir.join("poster.png")).unwrap(), b"theirs");
        assert!(!dir.join("poster.jpg").exists());
        assert_eq!(own_art(&dir), ["logo.png"]);
        // A newer logo replaces Orbit's own.
        save_art(&dir, "logo", "webp", b"newer");
        assert!(!dir.join("logo.png").exists());
        assert_eq!(own_art(&dir), ["logo.webp"]);
        // The last download of the title goes: only Orbit's art, and its note, go with it.
        remove_own_art(&dir);
        assert!(!dir.join("logo.webp").exists() && !dir.join(ART_NOTE).exists());
        assert_eq!(std::fs::read(dir.join("poster.png")).unwrap(), b"theirs");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn art_in_a_folder_orbit_made_is_kept_up_to_date_and_removed() {
        let dir = std::env::temp_dir().join(format!("orbit-own-art-test-{}", crate::library::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        save_art(&dir, "poster", "jpg", b"first");
        save_art(&dir, "poster", "png", b"second");
        assert!(!dir.join("poster.jpg").exists());
        assert_eq!(std::fs::read(dir.join("poster.png")).unwrap(), b"second");
        // A note naming other files (edited, or from a crafted folder) never reaches beyond the art names.
        std::fs::write(dir.join(ART_NOTE), "poster.png\n../secret.txt\nmovie.mkv\n").unwrap();
        std::fs::write(dir.join("movie.mkv"), b"video").unwrap();
        assert_eq!(own_art(&dir), ["poster.png"]);
        remove_own_art(&dir);
        assert!(!dir.join("poster.png").exists());
        assert!(dir.join("movie.mkv").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognises_subtitle_files() {
        assert_eq!(subtitle_format(b"1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n"), Some("srt"));
        assert_eq!(subtitle_format("\u{feff}1\n00:00:01.000 --> 00:00:02.000 X:1\nHi".as_bytes()), Some("srt"));
        assert_eq!(subtitle_format(b"WEBVTT\n\n00:01.000 --> 00:02.000\nHi"), Some("vtt"));
        assert_eq!(subtitle_format(b"[Script Info]\nTitle: x\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi"), Some("ass"));
        assert_eq!(subtitle_format(b"<html><body>Not found</body></html>"), None);
        assert_eq!(subtitle_format(b"{\"error\":\"quota\"}"), None);
    }

    #[test]
    fn cleans_language_tags() {
        assert_eq!(language_tag("eng"), "eng");
        assert_eq!(language_tag("pt-BR"), "pt-br");
        assert_eq!(language_tag("../../x"), "x");
        assert_eq!(language_tag(""), "und");
        assert_eq!(language_tag("Português"), "portugus");
    }

    fn request(url: &str) -> StartRequest {
        StartRequest {
            title_id: "tt1".into(),
            video_id: "tt1".into(),
            title: serde_json::json!({"meta": {}}),
            name: "Film".into(),
            year: Some("2020".into()),
            season: None,
            episode: None,
            episode_title: None,
            label: "1080p".into(),
            addon_key: "0123abcd".into(),
            stream_type: "movie".into(),
            stream_id: "tt1".into(),
            identity: "f:0a1b".into(),
            url: url.into(),
            upload: false,
            poster: None,
            logo: None,
            subtitles: Vec::new(),
        }
    }

    #[test]
    fn checks_requests() {
        assert_eq!(check_request(&request("https://debrid.example/dl/film.mkv")), Ok(false));
        assert_eq!(check_request(&request("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&so=1")), Ok(true));
        assert_eq!(check_request(&request("https://cdn.example/live/index.m3u8")), Err(Failure::NotDownloadable));
        assert_eq!(check_request(&request("http://cdn.example/film.mkv")), Err(Failure::Blocked));
        assert_eq!(check_request(&request("file:///C:/film.mkv")), Err(Failure::Blocked));
        assert_eq!(check_request(&request("magnet:?dn=nohash")), Err(Failure::Blocked));
        let mut bad = request("https://debrid.example/dl/film.mkv");
        bad.season = Some(1);
        assert_eq!(check_request(&bad), Err(Failure::Invalid));
        let mut bad = request("https://debrid.example/dl/film.mkv");
        bad.identity = "has spaces".into();
        assert_eq!(check_request(&bad), Err(Failure::Invalid));
    }

    #[test]
    fn a_pause_or_removal_outlasts_a_transfer_ending_at_the_same_time() {
        use JobState::*;
        // Still running: the outcome is recorded.
        assert!(outcome_applies(Some(Running), Failed));
        assert!(outcome_applies(Some(Running), Done));
        // Paused as it ended: the pause stands over a failure, but a finished file is done.
        assert!(!outcome_applies(Some(Paused), Failed));
        assert!(!outcome_applies(Some(Paused), Expired));
        assert!(outcome_applies(Some(Paused), Done));
        // Removed: nothing is written back (no row is resurrected or updated).
        assert!(!outcome_applies(None, Done));
        assert!(!outcome_applies(None, Failed));
    }

    #[test]
    fn a_download_never_claims_the_files_of_one_named_after_it() {
        // Two downloads in one season folder: one episode named by one addon
        // "Pilot", by another "Pilot. Part 2".
        let others = vec!["Show - S01E01 - Pilot. Part 2".to_string()];
        let base = "Show - S01E01 - Pilot";
        for name in ["Show - S01E01 - Pilot.mkv", "Show - S01E01 - Pilot.part", "Show - S01E01 - Pilot.eng.srt", "Show - S01E01 - Pilot.en.forced.srt"] {
            assert!(belongs(base, &others, name), "{name}");
        }
        for name in ["Show - S01E01 - Pilot. Part 2.mkv", "Show - S01E01 - Pilot. Part 2.eng.srt", "Show - S01E01 - Pilot (2).mkv", "Show - S01E01 - Pilots.mkv"] {
            assert!(!belongs(base, &others, name), "{name}");
        }
        // The longer one's own files are its own.
        assert!(belongs(&others[0], &[base.to_string()], "Show - S01E01 - Pilot. Part 2.mkv"));
    }

    #[test]
    fn a_download_still_stopping_is_never_started_twice() {
        let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // "a" is back to waiting (the window closed) but its task hasn't stopped yet.
        assert_eq!(to_start(ids(&["a", "b", "c"]), |id| id == "a", |_| true, 2), ids(&["b", "c"]));
        assert_eq!(to_start(ids(&["a", "b", "c"]), |_| false, |id| id != "b", 1), ids(&["a"]));
        assert_eq!(to_start(ids(&["b", "c"]), |_| false, |id| id == "c", 2), ids(&["c"]));
    }

    #[test]
    fn errors_never_carry_the_address() {
        let json = serde_json::to_string(&Failure::Http { status: 403 }).unwrap();
        assert_eq!(json, "{\"kind\":\"http\",\"status\":403}");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn show_in_folder_opens_the_files_folder_and_is_reaped() {
        let dir = std::env::temp_dir();
        let cmd = reveal_command(&dir.join("video.mkv"));
        assert_eq!(cmd.get_program(), "xdg-open");
        assert_eq!(cmd.get_args().collect::<Vec<_>>(), vec![dir.as_os_str()]);
        // Through the same launcher as the browser opener, so the child is
        // waited for (browser::tests::an_opener_is_reaped_once_it_exits).
        let id = crate::browser::launch(&mut std::process::Command::new("true")).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::fs::read_to_string(format!("/proc/{id}/stat")).is_ok() {
            assert!(std::time::Instant::now() < deadline, "opener left in the process table");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}
