//! Video and subtitle files dropped onto the window from this PC.
//!
//! The page learns the paths of a drop from Tauri's drag-drop event, but it
//! is a less-trusted boundary (it renders addon content), so a path it sends
//! back is only accepted if:
//! - it is one of the paths the native drop event itself reported (recorded
//!   here from the window event, before the page hears of the drop), so the
//!   page can't name some other file on this PC;
//! - it canonicalizes to an existing regular file (no directories, devices
//!   or pipes; symlinks are followed and the target is what's checked);
//! - the target's extension is on a short allowlist of video or subtitle types.
//!
//! A video is then known by an id (`local:<hash of the canonical path>`) and
//! played as `orbit-local://<hash>`, which the player resolves back to the
//! path here, re-checking the file. The page never hands mpv a path, and the
//! web-only check for addon streams (`check_stream_url`) stays as strict as it was.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, DragDropEvent, Manager, State, Window, WindowEvent};

pub const SCHEME: &str = "orbit-local://";
const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "m4v", "avi", "mov", "webm", "ts", "m2ts", "wmv", "flv", "ogv"];
const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "ssa", "vtt", "sub"];
/// Only the first few videos and subtitles of a drop are remembered; nobody drops hundreds of videos to play one.
const MAX_DROPPED: usize = 32;
const MAX_PATH_BYTES: usize = 4096;
const MAX_NAME_CHARS: usize = 200;

#[derive(Default)]
pub struct LocalFiles {
    /// The paths of the last drop onto the main window, as the OS reported them.
    dropped: Mutex<Vec<PathBuf>>,
    /// Videos opened this session, by hash: what `orbit-local://` addresses mean.
    opened: Mutex<HashMap<String, PathBuf>>,
}

/// Records what was dropped onto the main window (see the module docs).
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else { return };
    if window.label() != "main" {
        return;
    }
    if let Ok(mut dropped) = window.state::<LocalFiles>().dropped.lock() {
        *dropped = remembered(paths);
    }
}

/// The paths of a drop worth remembering: videos and subtitles only, so a
/// folder's worth of other files (posters, .nfo) can't push its video out.
fn remembered(paths: &[PathBuf]) -> Vec<PathBuf> {
    paths.iter().filter(|p| kind_of(p).is_some()).take(MAX_DROPPED).cloned().collect()
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Video,
    Subtitle,
}

fn kind_of(path: &Path) -> Option<Kind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some(Kind::Video)
    } else if SUBTITLE_EXTENSIONS.contains(&ext.as_str()) {
        Some(Kind::Subtitle)
    } else {
        None
    }
}

/// The canonical path of an existing regular file of the wanted kind.
fn check_file(path: &Path, want: Kind) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.as_os_str().len() > MAX_PATH_BYTES {
        return Err("err.local.missing".into());
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| "err.local.missing")?;
    let meta = std::fs::metadata(&canonical).map_err(|_| "err.local.missing")?;
    if !meta.is_file() {
        return Err("err.local.not-file".into());
    }
    // The real file's extension counts, not a link's.
    if kind_of(&canonical) != Some(want) {
        return Err(match want {
            Kind::Video => "err.local.video-kind",
            Kind::Subtitle => "err.local.subtitle-kind",
        }
        .into());
    }
    Ok(canonical)
}

/// FNV-1a: stable across Rust versions and platforms (unlike `DefaultHasher`),
/// so a file's id, and with it its resume point, stays the same between runs.
/// Not a security boundary: the id only names the file in watch history.
fn hash(canonical: &Path) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in canonical.to_string_lossy().as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// How mpv is given the path. Windows' canonical form is a `\\?\` path; the
/// plain form is used instead when it names the very same file, as some
/// tools mishandle the prefix.
fn mpv_path(canonical: &Path) -> Result<String, String> {
    let text = canonical.to_str().ok_or("err.local.name")?;
    if cfg!(windows) {
        let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            Some(format!(r"\\{rest}"))
        } else {
            text.strip_prefix(r"\\?\").map(str::to_string)
        };
        if let Some(plain) = plain.filter(|p| std::fs::canonicalize(p).is_ok_and(|c| c == canonical)) {
            return Ok(plain);
        }
    }
    Ok(text.to_string())
}

fn was_dropped(files: &LocalFiles, path: &Path) -> Result<(), String> {
    let dropped = files.dropped.lock().map_err(|_| "unavailable")?;
    if dropped.iter().any(|d| d == path) { Ok(()) } else { Err("only files dropped onto Orbit can be opened".into()) }
}

/// A file's name without its extension, as a label.
fn display_name(canonical: &Path) -> String {
    let stem = canonical.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    stem.chars().filter(|c| !c.is_control()).take(MAX_NAME_CHARS).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVideo {
    /// The title id progress is kept under: `local:<hash>`.
    id: String,
    /// What the player opens: `orbit-local://<hash>`.
    url: String,
    /// The file name without its extension (the page tidies it into a title).
    name: String,
}

/// Prepares a dropped video for the player (see the module docs).
#[tauri::command]
pub async fn local_video(files: State<'_, LocalFiles>, path: String) -> Result<LocalVideo, String> {
    let path = PathBuf::from(path);
    was_dropped(&files, &path)?;
    let canonical = check_file(&path, Kind::Video)?;
    let key = hash(&canonical);
    let name = display_name(&canonical);
    files.opened.lock().map_err(|_| "unavailable")?.insert(key.clone(), canonical);
    Ok(LocalVideo { id: format!("local:{key}"), url: format!("{SCHEME}{key}"), name })
}

/// The path mpv plays for `orbit-local://{key}`: only a video opened by
/// `local_video` this session, and only while it's still that kind of file.
pub fn resolve(files: &LocalFiles, key: &str) -> Result<String, String> {
    let path = files.opened.lock().map_err(|_| "unavailable")?.get(key).cloned().ok_or("err.local.drop-again")?;
    mpv_path(&check_file(&path, Kind::Video)?)
}

/// Adds a dropped subtitle file to what's playing. Like a chosen file
/// (`player_upload_subtitle`), it reaches mpv as bytes, not as a path.
#[tauri::command]
pub async fn local_add_subtitle(app: AppHandle, files: State<'_, LocalFiles>, player: State<'_, crate::player::PlayerState>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    was_dropped(&files, &path)?;
    let canonical = check_file(&path, Kind::Subtitle)?;
    let limit = crate::player::MAX_SUBTITLE_BYTES;
    let mut bytes = Vec::new();
    std::fs::File::open(&canonical)
        .and_then(|f| f.take(limit as u64 + 1).read_to_end(&mut bytes))
        .map_err(|_| "err.local.missing")?;
    crate::player::add_subtitle_bytes(&app, &player, &bytes, &display_name(&canonical))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orbit-local-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn kinds_follow_the_allowlist() {
        for ok in ["a.mkv", "a.MP4", "b.c.m2ts", "x.ogv", "x.webm"] {
            assert_eq!(kind_of(Path::new(ok)), Some(Kind::Video), "{ok}");
        }
        for ok in ["a.srt", "a.ASS", "a.ssa", "a.vtt", "a.sub"] {
            assert_eq!(kind_of(Path::new(ok)), Some(Kind::Subtitle), "{ok}");
        }
        for bad in ["a.exe", "a.m3u", "a.m3u8", "a.txt", "mkv", "a.mkv.lnk", "a.", "a.edl"] {
            assert_eq!(kind_of(Path::new(bad)), None, "{bad}");
        }
    }

    #[test]
    fn only_existing_regular_files_of_the_wanted_kind() {
        let dir = temp_dir("check");
        let video = dir.join("Movie.2019.mkv");
        std::fs::write(&video, b"x").unwrap();
        let other = dir.join("notes.txt");
        std::fs::write(&other, b"x").unwrap();
        let folder = dir.join("folder.mkv");
        std::fs::create_dir_all(&folder).unwrap();

        let canonical = check_file(&video, Kind::Video).unwrap();
        assert_eq!(canonical, std::fs::canonicalize(&video).unwrap());
        assert!(check_file(&video, Kind::Subtitle).is_err());
        assert!(check_file(&other, Kind::Video).is_err());
        assert!(check_file(&folder, Kind::Video).is_err(), "a directory is not a file");
        assert!(check_file(&dir.join("missing.mkv"), Kind::Video).is_err());
        assert!(check_file(Path::new("relative.mkv"), Kind::Video).is_err());
        // `..` is resolved before checking, so it can't dress up another file.
        assert!(check_file(&dir.join("folder.mkv").join("..").join("notes.txt"), Kind::Video).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_big_drop_still_remembers_its_videos() {
        // A whole folder dropped: posters, .nfo files and so on first (sorted by name), the video after them.
        let dir = std::env::temp_dir();
        let mut paths: Vec<PathBuf> = (0..40).map(|i| dir.join(format!("{i:02}.jpg"))).collect();
        paths.push(dir.join("Show.S01E01.mkv"));
        paths.push(dir.join("Show.S01E01.en.srt"));
        assert_eq!(remembered(&paths), [dir.join("Show.S01E01.mkv"), dir.join("Show.S01E01.en.srt")]);
        let many: Vec<PathBuf> = (0..100).map(|i| dir.join(format!("{i}.mkv"))).collect();
        assert_eq!(remembered(&many).len(), MAX_DROPPED);
    }

    #[test]
    fn only_dropped_paths_are_accepted() {
        let files = LocalFiles::default();
        let dropped = std::env::temp_dir().join("a.mkv");
        *files.dropped.lock().unwrap() = vec![dropped.clone()];
        assert!(was_dropped(&files, &dropped).is_ok());
        assert!(was_dropped(&files, &std::env::temp_dir().join("b.mkv")).is_err());
    }

    #[test]
    fn resolves_only_videos_opened_this_session() {
        let dir = temp_dir("resolve");
        let video = dir.join("clip.mp4");
        std::fs::write(&video, b"x").unwrap();
        let files = LocalFiles::default();
        assert!(resolve(&files, "0123456789abcdef").is_err());
        let canonical = std::fs::canonicalize(&video).unwrap();
        let key = hash(&canonical);
        files.opened.lock().unwrap().insert(key.clone(), canonical.clone());
        let path = resolve(&files, &key).unwrap();
        assert_eq!(std::fs::canonicalize(&path).unwrap(), canonical);
        assert!(!path.contains("://"), "a plain path, never a URL: {path}");
        // Gone since: no longer played.
        std::fs::remove_file(&video).unwrap();
        assert!(resolve(&files, &key).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ids_are_stable_and_short() {
        let a = hash(Path::new("/videos/a.mkv"));
        assert_eq!(a, hash(Path::new("/videos/a.mkv")));
        assert_ne!(a, hash(Path::new("/videos/b.mkv")));
        assert_eq!(a.len(), 16);
        assert!(a.bytes().all(|b| b.is_ascii_hexdigit()));
        // Fixed value: the id must not change between builds, or resume points are lost.
        assert_eq!(hash(Path::new("")), "cbf29ce484222325");
    }

    #[test]
    fn names_are_plain_labels() {
        assert_eq!(display_name(Path::new("/v/My.Movie.2019.mkv")), "My.Movie.2019");
        assert_eq!(display_name(Path::new("/v/a\u{7}b.mkv")), "ab");
    }
}
