//! Downloading one file of a torrent in full (not in playback order, as
//! streaming does). Its own torrent session, separate from playback's, whose
//! cache is wiped; the same hardening applies: magnets are rebuilt from the
//! parts Orbit understands, no listening port, and uploading only when the
//! person turned sharing on. The file is fetched into a hidden staging folder
//! beside its destination and moved into place once every piece is verified.

use std::collections::{HashMap, HashSet};
use std::num::NonZeroU32;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::time::Duration;

use librqbit::api::TorrentIdOrHash;
use librqbit::limits::LimitsConfig;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session, SessionOptions};
use tokio::sync::{Mutex, OwnedMutexGuard};

use super::Failure;
use crate::episode_files::Wanted;
use super::files;
use super::http::{Known, MIN_FILE_BYTES, Sink};

const METADATA_TIMEOUT: Duration = Duration::from_secs(120);
const POLL: Duration = Duration::from_millis(250);
const SAVE_EVERY: u32 = 12;

/// Sessions by whether they upload, created on first use and stopped once no download uses them.
#[derive(Default)]
pub struct Swarm {
    sessions: Mutex<HashMap<bool, Arc<Session>>>,
    /// The torrent each running download uses, so pausing can let go of it.
    active: std::sync::Mutex<HashMap<String, Arc<ManagedTorrent>>>,
    /// One download per torrent at a time, by info hash. Two episodes of one
    /// season pack would share librqbit's handle: each would narrow its files
    /// to its own episode, and the first to finish (or fail) would delete the
    /// torrent from under the other. The second waits its turn instead.
    turns: std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// The turn each download holds, by id: kept here rather than by its task,
    /// because pausing stops the task first and lets go of its torrent after
    /// (see `downloads::stop`). Had the turn gone with the task, the next
    /// download of the torrent could start in between, pick up the paused
    /// one's torrent (still in the session, saving into its staging folder),
    /// and then lose it. `release` hands the turn on once the torrent is gone.
    held: std::sync::Mutex<HashMap<String, OwnedMutexGuard<()>>>,
    /// Settings → Downloads → speed limit, in bytes a second (0 for none).
    limit: AtomicU32,
    /// Downloads using the swarm (running, or waiting their turn). Once none
    /// is, the sessions stop (see `stop_if_idle`): no DHT node, peers or
    /// seeding are kept going with nothing to download.
    users: AtomicUsize,
}

/// One download counted in `Swarm::users` while it lasts, however it ends
/// (its task may be stopped part-way).
struct User<'a>(&'a AtomicUsize);

impl Drop for User<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The staging folder for download `id`, beside its destination.
pub fn staging(folder: &Path, id: &str) -> PathBuf {
    folder.join(format!(".orbit-{id}"))
}

/// A file path inside the torrent, kept inside the staging folder.
fn inside(staging: &Path, relative: &Path) -> Option<PathBuf> {
    relative.components().all(|c| matches!(c, Component::Normal(_))).then(|| staging.join(relative))
}

/// Failures a retry of the same magnet would hit again (what's in the torrent,
/// or Orbit refusing it): their partial data is useless. Everything else (no
/// peers, timeouts, a full or failing drive) may pass, so its pieces are kept.
fn permanent(failure: &Failure) -> bool {
    matches!(failure, Failure::NoVideoFile | Failure::NotVideo | Failure::TooManyFiles | Failure::Blocked | Failure::TooSmall)
}

impl Swarm {
    async fn session(&self, cache: &Path, upload: bool) -> Result<Arc<Session>, Failure> {
        let mut sessions = self.sessions.lock().await;
        if let Some(s) = sessions.get(&upload) {
            return Ok(s.clone());
        }
        std::fs::create_dir_all(cache).map_err(|e| super::http::disk_failure(&e))?;
        let test_peer = crate::torrent::test_peer();
        let opts = SessionOptions {
            dht: test_peer.is_none().then(|| librqbit::DhtSessionConfig { persistence: None, ..Default::default() }),
            disable_trackers: test_peer.is_some(),
            listen: None,
            disable_upload: !upload,
            disable_local_service_discovery: true,
            // Every name in a torrent is checked before its files are made (see `SafeNames`).
            default_storage_factory: Some(librqbit::storage::StorageFactoryExt::boxed(crate::torrent::SafeNames::default())),
            ratelimits: LimitsConfig { download_bps: NonZeroU32::new(self.limit.load(Ordering::Relaxed)), upload_bps: None },
            ..Default::default()
        };
        let session = Session::new_with_opts(cache.to_path_buf(), opts).await.map_err(|_| Failure::Torrent)?;
        sessions.insert(upload, session.clone());
        Ok(session)
    }

    /// Sets the download speed limit (bytes a second, 0 for none), at once for
    /// sessions already running. librqbit applies it per session: downloads
    /// that share uploads and ones that don't each get the full limit.
    pub async fn set_limit(&self, bytes_per_second: u32) {
        self.limit.store(bytes_per_second, Ordering::Relaxed);
        for session in self.sessions.lock().await.values() {
            session.ratelimits.set_download_bps(NonZeroU32::new(bytes_per_second));
        }
    }

    /// Lets go of download `id`'s torrent, keeping what it fetched (to resume
    /// later), then hands its turn to the next download of the torrent.
    pub async fn release(&self, id: &str) {
        // Forgotten only once it's deleted: a release cut short (its task
        // stopped meanwhile) leaves it for the next one to finish.
        let handle = self.active.lock().ok().and_then(|a| a.get(id).cloned());
        if let Some(handle) = handle {
            let sessions: Vec<Arc<Session>> = self.sessions.lock().await.values().cloned().collect();
            for session in sessions {
                let _ = session.delete(TorrentIdOrHash::Hash(handle.info_hash()), false).await;
            }
            if let Ok(mut active) = self.active.lock() {
                active.remove(id);
            }
        }
        drop(self.held.lock().ok().and_then(|mut h| h.remove(id)));
        self.stop_if_idle().await;
    }

    /// Stops the sessions if no download uses them. Decided under the
    /// sessions' lock, which a download takes (after counting itself) to get
    /// its session: one starting now waits, then makes a fresh one.
    async fn stop_if_idle(&self) {
        let mut sessions = self.sessions.lock().await;
        if self.users.load(Ordering::SeqCst) == 0 {
            for (_, session) in sessions.drain() {
                session.stop().await;
            }
        }
    }

    /// Downloads the magnet's file into `<folder>/.orbit-<id>/` and moves it to
    /// `<folder>/<base>.<ext>`. Returns the extension and size.
    /// `episode` finds the episode in a season pack when the addon didn't say which file it is.
    ///
    /// Waits while another download of the same torrent runs (see `turns`).
    /// A download that fails lets go of its torrent, so nothing keeps
    /// downloading or seeding for it. Its staging folder is removed only when
    /// retrying can't help (see `permanent`); otherwise it holds the verified
    /// pieces a retry resumes from.
    #[allow(clippy::too_many_arguments)]
    pub async fn fetch(&self, cache: &Path, id: &str, magnet: &str, episode: Option<Wanted>, upload: bool, folder: &Path, base: &str, sink: &mut dyn Sink) -> Result<Known, Failure> {
        let link = crate::torrent::parse_magnet(magnet).map_err(|_| Failure::Blocked)?;
        self.users.fetch_add(1, Ordering::SeqCst);
        let user = User(&self.users);
        let hash = link.info_hash.clone();
        let turn = self.turns.lock().map_err(|_| Failure::Torrent)?.entry(hash.clone()).or_default().clone();
        let held = turn.clone().lock_owned().await;
        if let Ok(mut turns) = self.held.lock() {
            turns.insert(id.to_string(), held);
        }
        // A finished download has already let go of its torrent (and turn).
        let result = self.fetch_file(cache, id, link, episode, upload, folder, base, sink).await;
        if let Err(failure) = &result {
            self.release(id).await;
            if permanent(failure) {
                let _ = std::fs::remove_dir_all(staging(folder, id));
            }
        }
        // The last one for this torrent forgets its turn.
        if let Ok(mut turns) = self.turns.lock()
            && Arc::strong_count(&turn) == 2
        {
            turns.remove(&hash);
        }
        drop(user);
        self.stop_if_idle().await;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn fetch_file(&self, cache: &Path, id: &str, link: crate::torrent::Magnet, episode: Option<Wanted>, upload: bool, folder: &Path, base: &str, sink: &mut dyn Sink) -> Result<Known, Failure> {
        let session = self.session(cache, upload).await?;
        let stage = staging(folder, id);
        std::fs::create_dir_all(&stage).map_err(|e| super::http::disk_failure(&e))?;
        let options = AddTorrentOptions {
            initial_peers: crate::torrent::test_peer().map(|p| vec![p]),
            only_files: link.file.map(|f| vec![f]),
            output_folder: Some(stage.to_string_lossy().into_owned()),
            // Picks up pieces already on disk from an earlier, paused run.
            overwrite: true,
            trackers: (!link.trackers.is_empty()).then_some(link.trackers),
            ..Default::default()
        };
        // Adding a magnet waits for its file list from peers: the time limit covers that too.
        let added = tokio::time::timeout(METADATA_TIMEOUT, session.add_torrent(AddTorrent::from_url(format!("magnet:?xt=urn:btih:{}", link.info_hash)), Some(options)))
            .await
            .map_err(|_| Failure::TorrentTimeout)?
            .map_err(|e| if crate::torrent::too_many_files(&e) { Failure::TooManyFiles } else { Failure::Torrent })?;
        let handle = match added {
            AddTorrentResponse::Added(_, h) | AddTorrentResponse::AlreadyManaged(_, h) => h,
            AddTorrentResponse::ListOnly(_) => return Err(Failure::Torrent),
        };
        if let Ok(mut active) = self.active.lock() {
            active.insert(id.to_string(), handle.clone());
        }
        tokio::time::timeout(METADATA_TIMEOUT, handle.wait_until_initialized())
            .await
            .map_err(|_| Failure::TorrentTimeout)?
            .map_err(|_| Failure::Torrent)?;
        let files = handle
            .with_metadata(|m| m.file_infos.iter().map(|f| (f.relative_filename.clone(), f.len)).collect::<Vec<_>>())
            .map_err(|_| Failure::Torrent)?;
        let names: Vec<(String, u64)> = files.iter().map(|(p, len)| (p.to_string_lossy().into_owned(), *len)).collect();
        let index = crate::episode_files::pick_file(&names, link.file, episode, &handle.name().unwrap_or_default()).map_err(|_| Failure::NoVideoFile)?;
        let (relative, len) = files[index].clone();
        let ext = files::extension_of(&names[index].0).ok_or(Failure::NotVideo)?;
        if link.file != Some(index) {
            session.update_only_files(&handle, &HashSet::from([index])).await.map_err(|_| Failure::Torrent)?;
        }

        let mut known = Known { total: Some(len), validator: None, ext: Some(ext.to_string()) };
        let have = handle.stats().file_progress.get(index).copied().unwrap_or(0);
        if !files::has_room(files::free_space(folder), Some(len.saturating_sub(have))) {
            return Err(Failure::NoSpace);
        }
        sink.save(have, &known);
        let mut ticks = 0u32;
        loop {
            let stats = handle.stats();
            if stats.error.is_some() {
                // librqbit's error is only text: a drive with less than the headroom left is why, most likely.
                return Err(if files::has_room(files::free_space(folder), Some(0)) { Failure::Torrent } else { Failure::DiskFull });
            }
            let done = stats.file_progress.get(index).copied().unwrap_or(0);
            let speed = stats.live.as_ref().map_or(0.0, |l| l.download_speed.mbps * 1024.0 * 1024.0);
            sink.progress(done, Some(len), speed);
            ticks += 1;
            if ticks.is_multiple_of(SAVE_EVERY) {
                sink.save(done, &known);
                // Other downloads (or anything else) can fill the drive meanwhile: stop before it's full, as at the start.
                if !files::has_room(files::free_space(folder), Some(len.saturating_sub(done))) {
                    return Err(Failure::DiskFull);
                }
            }
            if done >= len {
                break;
            }
            tokio::time::sleep(POLL).await;
        }

        self.release(id).await;
        let from = inside(&stage, &relative).ok_or(Failure::Blocked)?;
        let to = folder.join(format!("{base}.{ext}"));
        std::fs::rename(&from, &to).map_err(|e| super::http::disk_failure(&e))?;
        let _ = std::fs::remove_dir_all(&stage);
        let size = std::fs::metadata(&to).map_err(|e| super::http::disk_failure(&e))?.len();
        if size < MIN_FILE_BYTES {
            let _ = std::fs::remove_file(&to);
            return Err(Failure::TooSmall);
        }
        known.total = Some(size);
        sink.save(size, &known);
        Ok(known)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn torrent_paths_stay_in_staging() {
        let stage = Path::new("/d/.orbit-1");
        assert_eq!(inside(stage, Path::new("Film/film.mkv")), Some(stage.join("Film/film.mkv")));
        assert_eq!(inside(stage, Path::new("../escape.mkv")), None);
        assert_eq!(inside(stage, Path::new("/abs.mkv")), None);
    }
}

/// Downloads against a seeder on 127.0.0.1 only: `ORBIT_TORRENT_PEER` (debug
/// builds) makes the download swarm talk to it alone, with no DHT and no
/// trackers, so nothing here touches the internet.
#[cfg(test)]
mod swarm_tests {
    use super::*;
    use librqbit::{CreateTorrentOptions, ListenerMode, ListenerOptions, create_torrent, spawn_utils::BlockingSpawner};

    /// The tests share `ORBIT_TORRENT_PEER`, so they run one at a time.
    use crate::torrent::TEST_PEER_LOCK as PEER;

    struct NullSink;
    impl Sink for NullSink {
        fn progress(&mut self, _: u64, _: Option<u64>, _: f64) {}
        fn save(&mut self, _: u64, _: &Known) {}
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orbit-swarm-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Seeds `files` (name, bytes) from 127.0.0.1 and points the swarm at it; returns the session and the info hash.
    async fn seeder(dir: &Path, files: &[(String, usize)]) -> (Arc<Session>, String) {
        let content = dir.join("Show");
        std::fs::create_dir_all(&content).unwrap();
        let mut seed = 1u32;
        for (name, len) in files {
            let bytes: Vec<u8> = (0..*len)
                .map(|_| {
                    seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                    (seed >> 16) as u8
                })
                .collect();
            std::fs::write(content.join(name), bytes).unwrap();
        }
        let t = create_torrent(&content, CreateTorrentOptions { piece_length: Some(64 * 1024), ..Default::default() }, &BlockingSpawner::new(1)).await.unwrap();
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
        let options = SessionOptions {
            dht: None,
            disable_trackers: true,
            listen: Some(ListenerOptions { mode: ListenerMode::TcpOnly, listen_addr: addr, ..Default::default() }),
            disable_local_service_discovery: true,
            ..Default::default()
        };
        let session = Session::new_with_opts(dir.join("seed-default"), options).await.unwrap();
        let added = session
            .add_torrent(AddTorrent::TorrentFileBytes(t.as_bytes().unwrap()), Some(AddTorrentOptions { overwrite: true, output_folder: Some(content.to_string_lossy().into_owned()), ..Default::default() }))
            .await
            .unwrap();
        added.into_handle().unwrap().wait_until_initialized().await.unwrap();
        // SAFETY: every test that reads or writes this variable holds `PEER`.
        unsafe { std::env::set_var("ORBIT_TORRENT_PEER", addr.to_string()) };
        (session, t.info_hash().as_string())
    }

    fn files_under(dir: &Path) -> usize {
        std::fs::read_dir(dir).map(|e| e.flatten().map(|e| if e.path().is_dir() { files_under(&e.path()) } else { 1 }).sum()).unwrap_or(0)
    }

    /// A download that fails after its torrent was added (here: no video in it)
    /// leaves nothing in the session downloading or seeding, and no staging folder.
    #[test]
    fn a_failed_download_lets_go_of_its_torrent() {
        let _peer = PEER.lock().unwrap_or_else(|e| e.into_inner());
        tauri::async_runtime::block_on(async {
            let dir = scratch("failed");
            let (_seed, hash) = seeder(&dir, &[("notes.txt".into(), 4 * 1024 * 1024), ("cover.jpg".into(), 1024 * 1024)]).await;
            let swarm = Swarm::default();
            swarm.set_limit(512 * 1024).await;
            let folder = dir.join("out");
            std::fs::create_dir_all(&folder).unwrap();
            let id = "0123456789abcdef0123456789abcdef";
            let result = swarm.fetch(&dir.join("cache"), id, &format!("magnet:?xt=urn:btih:{hash}"), None, false, &folder, "Film", &mut NullSink).await;
            assert_eq!(result, Err(Failure::NoVideoFile));
            // Nothing else to download: the swarm stopped (no DHT node or connections kept).
            assert!(swarm.sessions.lock().await.is_empty(), "the torrent session is still running");
            assert!(!swarm.active.lock().unwrap().contains_key(id));
            assert!(!staging(&folder, id).exists(), "the staging folder was left behind");
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// Counts what a download reported, so a test can pause it part-way.
    struct Done(Arc<std::sync::atomic::AtomicU64>);
    impl Sink for Done {
        fn progress(&mut self, done: u64, _: Option<u64>, _: f64) {
            self.0.store(done, Ordering::Relaxed);
        }
        fn save(&mut self, _: u64, _: &Known) {}
    }

    /// A download paused part-way, then resumed while its only peer is gone,
    /// fails for now (no peer, or no metadata in time) and keeps its staging folder with
    /// the pieces it had. A later permanent failure of the same download
    /// (the magnet now leads to a torrent with no video) removes it.
    #[test]
    fn a_transient_failure_keeps_resumable_progress() {
        let _peer = PEER.lock().unwrap_or_else(|e| e.into_inner());
        tauri::async_runtime::block_on(async {
            let dir = scratch("transient");
            let (seed, hash) = seeder(&dir, &[("Film.mkv".into(), 4 * 1024 * 1024)]).await;
            let swarm = Arc::new(Swarm::default());
            swarm.set_limit(512 * 1024).await;
            let (cache, folder) = (dir.join("cache"), dir.join("out"));
            std::fs::create_dir_all(&folder).unwrap();
            let id = "dddddddddddddddddddddddddddddddd";
            let magnet = format!("magnet:?xt=urn:btih:{hash}");

            // Pause once some of it is in, as `pause` does: stop the task, let go of the torrent.
            let done = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let task = {
                let (swarm, cache, folder, magnet, done) = (swarm.clone(), cache.clone(), folder.clone(), magnet.clone(), done.clone());
                tokio::spawn(async move { swarm.fetch(&cache, id, &magnet, None, false, &folder, "Film", &mut Done(done)).await })
            };
            tokio::time::timeout(Duration::from_secs(30), async {
                while done.load(Ordering::Relaxed) < 512 * 1024 {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("no progress");
            task.abort();
            let _ = task.await;
            swarm.release(id).await;
            assert!(files_under(&staging(&folder, id)) > 0, "nothing was staged");
            assert!(swarm.sessions.lock().await.is_empty(), "a paused download kept the torrent session running");

            // Resume with the seeder gone: a transient failure.
            seed.stop().await;
            drop(seed);
            let result = swarm.fetch(&cache, id, &magnet, None, false, &folder, "Film", &mut NullSink).await;
            assert!(matches!(result, Err(Failure::Torrent | Failure::TorrentTimeout)), "{result:?}");
            assert!(files_under(&staging(&folder, id)) > 0, "the staged pieces were removed");
            assert!(!swarm.active.lock().unwrap().contains_key(id));

            // The same download failing for good cleans up.
            let other = dir.join("other");
            std::fs::create_dir_all(&other).unwrap();
            let (_seed, junk) = seeder(&other, &[("notes.txt".into(), 1024 * 1024)]).await;
            let result = swarm.fetch(&cache, id, &format!("magnet:?xt=urn:btih:{junk}"), None, false, &folder, "Film", &mut NullSink).await;
            assert_eq!(result, Err(Failure::NoVideoFile));
            assert!(!staging(&folder, id).exists(), "the staging folder was left behind");
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// Two episodes of one season pack (one info hash, `so=0` and `so=1`) queued
    /// together (MAX_ACTIVE is 2): both finish, the second after the first.
    #[test]
    fn two_episodes_of_one_pack_both_download() {
        let _peer = PEER.lock().unwrap_or_else(|e| e.into_inner());
        tauri::async_runtime::block_on(async {
            let dir = scratch("pack");
            let (_seed, hash) = seeder(&dir, &[("Show.S01E01.mkv".into(), 3 * 1024 * 1024), ("Show.S01E02.mkv".into(), 3 * 1024 * 1024)]).await;
            let swarm = Arc::new(Swarm::default());
            swarm.set_limit(1024 * 1024).await;
            let cache = dir.join("cache");
            let episode = |n: usize, id: &'static str| {
                let (swarm, cache, folder, hash) = (swarm.clone(), cache.clone(), dir.join(format!("E{n}")), hash.clone());
                std::fs::create_dir_all(&folder).unwrap();
                tokio::spawn(async move {
                    let result = tokio::time::timeout(Duration::from_secs(60), swarm.fetch(&cache, id, &format!("magnet:?xt=urn:btih:{hash}&so={n}"), None, false, &folder, "Episode", &mut NullSink)).await;
                    (result, folder)
                })
            };
            let a = episode(0, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
            // B starts once A's torrent is in the session, as the second queued download would.
            while !swarm.active.lock().unwrap().contains_key("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            let b = episode(1, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
            let (ra, fa) = a.await.unwrap();
            let (rb, fb) = b.await.unwrap();
            assert!(matches!(ra, Ok(Ok(_))) && matches!(rb, Ok(Ok(_))), "A={ra:?} B={rb:?}");
            assert_eq!(std::fs::metadata(fa.join("Episode.mkv")).unwrap().len(), 3 * 1024 * 1024);
            assert_eq!(std::fs::metadata(fb.join("Episode.mkv")).unwrap().len(), 3 * 1024 * 1024);
            assert!(swarm.turns.lock().unwrap().is_empty());
            assert!(swarm.sessions.lock().await.is_empty(), "the torrent session is still running");
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// An episode of a season pack paused part-way (its task stopped, then its
    /// torrent let go of, as `downloads::stop` does) while the next episode of
    /// the pack waits its turn: the next one gets the torrent afresh, with its
    /// own staging folder, and finishes. It used to take its turn as soon as
    /// the paused task stopped, pick up the paused one's torrent (still in the
    /// session, saving into the other staging folder), and then lose it when
    /// that torrent was let go of.
    #[test]
    fn pausing_an_episode_hands_the_pack_over_cleanly() {
        let _peer = PEER.lock().unwrap_or_else(|e| e.into_inner());
        tauri::async_runtime::block_on(async {
            let dir = scratch("handover");
            let (_seed, hash) = seeder(&dir, &[("Show.S01E01.mkv".into(), 3 * 1024 * 1024), ("Show.S01E02.mkv".into(), 3 * 1024 * 1024)]).await;
            let swarm = Arc::new(Swarm::default());
            swarm.set_limit(512 * 1024).await;
            let cache = dir.join("cache");
            let (a, b) = ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
            let (fa, fb) = (dir.join("E1"), dir.join("E2"));
            for f in [&fa, &fb] {
                std::fs::create_dir_all(f).unwrap();
            }
            let done = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let first = {
                let (swarm, cache, folder, magnet, done) = (swarm.clone(), cache.clone(), fa.clone(), format!("magnet:?xt=urn:btih:{hash}&so=0"), done.clone());
                tokio::spawn(async move { swarm.fetch(&cache, a, &magnet, None, false, &folder, "Episode", &mut Done(done)).await })
            };
            tokio::time::timeout(Duration::from_secs(30), async {
                while done.load(Ordering::Relaxed) < 256 * 1024 {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("no progress");
            let second = {
                let (swarm, cache, folder, magnet) = (swarm.clone(), cache.clone(), fb.clone(), format!("magnet:?xt=urn:btih:{hash}&so=1"));
                tokio::spawn(async move { tokio::time::timeout(Duration::from_secs(60), swarm.fetch(&cache, b, &magnet, None, false, &folder, "Episode", &mut NullSink)).await })
            };
            // Paused: the task stops first, and its torrent is let go of a moment later.
            first.abort();
            let _ = first.await;
            tokio::time::sleep(Duration::from_millis(1500)).await;
            swarm.release(a).await;
            let result = second.await.unwrap();
            assert!(matches!(result, Ok(Ok(_))), "{result:?}");
            assert_eq!(std::fs::metadata(fb.join("Episode.mkv")).unwrap().len(), 3 * 1024 * 1024);
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// A torrent listing more than `MAX_TORRENT_FILES` files is refused before
    /// librqbit creates them (one empty file and handle per entry).
    #[test]
    fn a_torrent_with_too_many_files_is_refused() {
        let _peer = PEER.lock().unwrap_or_else(|e| e.into_inner());
        tauri::async_runtime::block_on(async {
            let dir = scratch("many");
            let mut files: Vec<(String, usize)> = (0..crate::torrent::MAX_TORRENT_FILES).map(|i| (format!("junk{i:05}.nfo"), 1)).collect();
            files.push(("Film.mkv".into(), 1024 * 1024));
            let (_seed, hash) = seeder(&dir, &files).await;
            let swarm = Swarm::default();
            let folder = dir.join("out");
            std::fs::create_dir_all(&folder).unwrap();
            let id = "cccccccccccccccccccccccccccccccc";
            let result = tokio::time::timeout(Duration::from_secs(60), swarm.fetch(&dir.join("cache"), id, &format!("magnet:?xt=urn:btih:{hash}"), None, false, &folder, "Film", &mut NullSink)).await;
            assert_eq!(result, Ok(Err(Failure::TooManyFiles)));
            assert_eq!(files_under(&folder), 0);
            let _ = std::fs::remove_dir_all(&dir);
        });
    }
}
