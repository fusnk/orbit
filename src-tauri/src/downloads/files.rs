//! Where downloads go on disk and what they're called. Names come from addon
//! metadata (titles, episode names), so they're cleaned into something every
//! file system accepts and can never climb out of the downloads folder.

use std::path::{Path, PathBuf};

/// Video files are written as `<base>.part` and renamed when complete.
pub const PART_SUFFIX: &str = ".part";
/// Characters per path component: well under every file system's limit, and
/// short enough that `Series/<title>/Season NN/<name>` stays below Windows' 260.
const MAX_COMPONENT_CHARS: usize = 80;
/// Bytes per path component: Linux and macOS count a name's limit (255) in
/// UTF-8 bytes, so 80 non-Latin characters can be too long. This leaves room
/// for ` (n)` and a subtitle's `.<lang>.<n>.<ext>`.
const MAX_COMPONENT_BYTES: usize = 200;
/// Names Windows reserves for devices, with or without an extension.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "COM¹", "COM²", "COM³", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
    "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³", "CONIN$", "CONOUT$",
];

/// Whether Windows takes `name` for a device (`nul`, `COM1.txt`, `con .mkv`).
pub fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_uppercase();
    RESERVED.contains(&stem.as_str())
}

/// One file or folder name made safe on Windows, macOS and Linux.
pub fn sanitize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match c {
            // "Star Wars: A New Hope" reads best as "Star Wars - A New Hope".
            ':' => out.push_str(" -"),
            '/' | '\\' | '|' => out.push('-'),
            '"' => out.push('\''),
            '<' | '>' | '?' | '*' => {}
            c if c.is_control() => out.push(' '),
            c => out.push(c),
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut name = fit(&collapsed, MAX_COMPONENT_CHARS, MAX_COMPONENT_BYTES);
    // Windows drops trailing dots and spaces, so "Mr." and "Mr" would collide.
    while name.ends_with(['.', ' ']) {
        name.pop();
    }
    let name = name.trim_start_matches(['.', ' ']).to_string();
    if name.is_empty() {
        return "Untitled".into();
    }
    if is_reserved(&name) { format!("_{name}") } else { name }
}

/// The start of `text`: at most `chars` characters and `bytes` bytes of UTF-8.
fn fit(text: &str, chars: usize, bytes: usize) -> String {
    let mut used = 0;
    text.chars()
        .take(chars)
        .take_while(|c| {
            used += c.len_utf8();
            used <= bytes
        })
        .collect()
}

/// The year a movie came out, from "2011" or a range like "2011–2019".
fn first_year(year: Option<&str>) -> Option<&str> {
    let year = year?.trim();
    let digits = year.get(..4)?;
    digits.bytes().all(|b| b.is_ascii_digit()).then_some(digits)
}

/// `Movies/<Title (Year)>` and the file name without extension.
pub fn movie_layout(title: &str, year: Option<&str>) -> (PathBuf, String) {
    let name = match first_year(year) {
        Some(y) => sanitize(&format!("{title} ({y})")),
        None => sanitize(title),
    };
    (Path::new("Movies").join(&name), name)
}

/// `Series/<Title>/Season NN` and `<Title> - SNNENN - <Episode>`.
pub fn episode_layout(title: &str, season: i64, episode: i64, episode_title: Option<&str>) -> (PathBuf, String) {
    let show = sanitize(title);
    // The show's title is cut to leave room for the code (the name's length
    // limit would otherwise cut it off); the episode's name gets what's left.
    let code = format!(" - S{season:02}E{episode:02}");
    let head = episode_head(&show, &code);
    let base = match episode_title.map(str::trim).filter(|t| !t.is_empty()) {
        Some(name) => sanitize(&format!("{head}{code} - {name}")),
        None => sanitize(&format!("{head}{code}")),
    };
    // No room left for any of the episode's name.
    let base = match base.strip_suffix(" -") {
        Some(cut) => cut.to_string(),
        None => base,
    };
    let season_dir = if season == 0 { "Specials".to_string() } else { format!("Season {season:02}") };
    (Path::new("Series").join(show).join(season_dir), base)
}

/// The part of the show's folder name an episode's file name starts with,
/// before `code` (` - SNNENN`).
fn episode_head(show: &str, code: &str) -> String {
    let head = fit(show, MAX_COMPONENT_CHARS - code.chars().count(), MAX_COMPONENT_BYTES - code.len());
    head.trim_end_matches(['.', ' ', '-']).to_string()
}

/// Whether `stem` is a file name `episode_layout` gives an episode of `show`
/// (the folder's name). The file's name starts with the show's title cut to
/// fit the code, so it's rebuilt from the code found in `stem`.
fn is_episode_of(show: &str, stem: &str) -> bool {
    stem.match_indices('S').any(|(i, _)| {
        let rest = &stem[i + 1..];
        let digits = |s: &str| s.bytes().take_while(u8::is_ascii_digit).count();
        let season = digits(rest);
        let Some(after) = rest[season..].strip_prefix('E') else { return false };
        let episode = digits(after);
        if season == 0 || episode == 0 {
            return false;
        }
        let code = format!(" - S{}E{}", &rest[..season], &after[..episode]);
        stem.starts_with(&sanitize(&format!("{}{code}", episode_head(show, &code))))
    })
}

/// Whether `base` is already used in `dir`, by a video, its `.part`, or its
/// subtitles. Case is ignored: Windows and macOS don't tell "The Office" and
/// "the office" apart, so two downloads named so would share one file.
fn base_in_use(dir: &Path, base: &str) -> bool {
    let prefix = format!("{base}.").to_lowercase();
    std::fs::read_dir(dir).is_ok_and(|entries| entries.flatten().any(|e| e.file_name().to_string_lossy().to_lowercase().starts_with(&prefix)))
}

/// `base`, or `base (2)`, `base (3)`… when that name is taken by another file,
/// or by another download in `dir` (`taken`, their bases): one may have no file
/// there right now (it failed and threw its partial file away, or its finished
/// file was moved), yet it would write that name again when tried again, and
/// removing either would take the other's files.
pub fn unique_base(dir: &Path, base: &str, taken: &[String]) -> String {
    let free = |b: &str| !base_in_use(dir, b) && !taken.iter().any(|t| t.to_lowercase() == b.to_lowercase());
    if free(base) {
        return base.to_string();
    }
    (2..1000).map(|n| format!("{base} ({n})")).find(|b| free(b)).unwrap_or_else(|| format!("{base} ({})", crate::library::now_ms()))
}

/// Containers a download may be saved as (the same list torrents pick videos by).
fn known_extension(ext: &str) -> Option<&'static str> {
    let ext = ext.to_ascii_lowercase();
    crate::torrent::VIDEO_EXTENSIONS.iter().copied().find(|known| *known == ext)
}

/// A video extension at the end of a file name, if it has one.
pub fn extension_of(name: &str) -> Option<&'static str> {
    let (_, ext) = name.rsplit_once('.')?;
    known_extension(ext.trim_end_matches(['"', '\'', ';', ' ']))
}

/// The extension to save as: the server's file name, then the address's last
/// path segment, else a default for the content type.
pub fn choose_extension(content_disposition: Option<&str>, url_path: &str, content_type: Option<&str>) -> &'static str {
    let from_header = content_disposition.and_then(|value| {
        let lower = value.to_ascii_lowercase();
        let at = lower.rfind("filename")?;
        extension_of(value[at..].trim_end())
    });
    let from_path = url_path.rsplit('/').next().and_then(extension_of);
    from_header.or(from_path).unwrap_or_else(|| match content_type.map(str::to_ascii_lowercase) {
        Some(t) if t.contains("mp4") => "mp4",
        Some(t) if t.contains("webm") => "webm",
        _ => "mkv",
    })
}

/// Free space on the drive holding `path`, when the OS can say.
#[cfg(windows)]
pub fn free_space(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free = 0u64;
    // SAFETY: `wide` is NUL-terminated and outlives the call; the other pointers may be null.
    let ok = unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(free)
}

#[cfg(unix)]
pub fn free_space(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `c` is a valid C string and `stat` a properly sized out-parameter.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let ok = unsafe { libc::statvfs(c.as_ptr(), &mut stat) } == 0;
    #[allow(clippy::unnecessary_cast)]
    ok.then(|| stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(not(any(windows, unix)))]
pub fn free_space(_path: &Path) -> Option<u64> {
    None
}

/// Space kept free beyond the file itself, so a download never fills the drive to the last byte.
const HEADROOM: u64 = 256 * 1024 * 1024;

/// Whether `needed` more bytes fit; unknown sizes or free space don't block a download.
pub fn has_room(free: Option<u64>, needed: Option<u64>) -> bool {
    match (free, needed) {
        (Some(free), Some(needed)) => free >= needed.saturating_add(HEADROOM),
        _ => true,
    }
}

/// Partial files and torrent staging folders under `root` that Orbit made
/// and no download refers to (`kept`: each download's `<base>.part` and
/// `.orbit-<id>` paths), left by a crash mid-removal. Deliberately narrow,
/// since the folder may be one the person also uses: only Orbit's own
/// layout is looked in (`Movies/<title>/`, `Series/<show>/<season>/`), and
/// only names Orbit gives: `<title>.part` or `<title> (n).part` for a movie,
/// `<show> - S….part` for an episode, `.orbit-` and 32 hex digits for staging.
/// `kept` is matched ignoring case: on Windows and macOS a download may have
/// gone into a folder an earlier one made, named in another case.
pub fn orphans(root: &Path, kept: &std::collections::HashSet<PathBuf>) -> Vec<PathBuf> {
    let folded = |path: &Path| path.to_string_lossy().to_lowercase();
    let kept: std::collections::HashSet<String> = kept.iter().map(|p| folded(p)).collect();
    let dirs = |path: &Path| -> Vec<(String, PathBuf)> {
        std::fs::read_dir(path)
            .map(|entries| entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| (e.file_name().to_string_lossy().into_owned(), e.path())).collect())
            .unwrap_or_default()
    };
    let mut found = Vec::new();
    let mut look = |folder: &Path, ours: &dyn Fn(&str) -> bool| {
        let Ok(entries) = std::fs::read_dir(folder) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            let staging = kind.is_dir() && name.strip_prefix(".orbit-").is_some_and(|id| id.len() == 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
            let part = kind.is_file() && name.strip_suffix(PART_SUFFIX).is_some_and(ours);
            if (staging || part) && !kept.contains(&folded(&entry.path())) {
                found.push(entry.path());
            }
        }
    };
    for (title, folder) in dirs(&root.join("Movies")) {
        look(&folder, &|stem| {
            stem == title || stem.strip_prefix(title.as_str()).and_then(|r| r.strip_prefix(" (")?.strip_suffix(')')).is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        });
    }
    for (show, show_folder) in dirs(&root.join("Series")) {
        for (season, folder) in dirs(&show_folder) {
            if season == "Specials" || season.strip_prefix("Season ").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())) {
                look(&folder, &|stem| is_episode_of(&show, stem));
            }
        }
    }
    found
}

/// Removes now-empty folders from `dir` up to (not including) `root`. Only
/// empty folders go: `remove_dir` refuses anything with files in it.
pub fn prune_empty(dir: &Path, root: &Path) {
    let mut current = Some(dir);
    while let Some(d) = current {
        if !d.starts_with(root) || d == root || std::fs::remove_dir(d).is_err() {
            break;
        }
        current = d.parent();
    }
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let name = sanitize(&text);
    assert!(!name.contains(['/', '\\', ':']));
    assert!(name != "." && name != "..");
    let _ = movie_layout(&text, Some(&text));
    let _ = episode_layout(&text, 1, 1, Some(&text));
    let _ = choose_extension(Some(&text), &text, Some(&text));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize("Star Wars: A New Hope"), "Star Wars - A New Hope");
        assert_eq!(sanitize("What If...?"), "What If");
        assert_eq!(sanitize("AC/DC <Live> \"Tour\""), "AC-DC Live 'Tour'");
        assert_eq!(sanitize("  ..hidden  "), "hidden");
        assert_eq!(sanitize("Mr. "), "Mr");
        assert_eq!(sanitize("a\u{0}b\nc"), "a b c");
        assert_eq!(sanitize("CON"), "_CON");
        assert_eq!(sanitize("nul.txt"), "_nul.txt");
        assert_eq!(sanitize("Console"), "Console");
        assert_eq!(sanitize("conin$.txt"), "_conin$.txt");
        assert_eq!(sanitize("COM¹.mkv"), "_COM¹.mkv");
        assert_eq!(sanitize("lpt0"), "_lpt0");
        assert_eq!(sanitize("???"), "Untitled");
        assert_eq!(sanitize("../../etc"), "-..-etc");
        assert_eq!(sanitize(&"x".repeat(500)).chars().count(), MAX_COMPONENT_CHARS);
        // Truncation never leaves a trailing dot or space.
        let long = format!("{}. tail", "y".repeat(MAX_COMPONENT_CHARS - 2));
        assert!(!sanitize(&long).ends_with(['.', ' ']));
    }

    #[test]
    fn names_fit_byte_limited_file_systems() {
        // ext4 and APFS allow 255 bytes per name: 80 four-byte characters (320
        // bytes) can't be created, and three-byte ones leave no room for
        // `.<lang>.<n>.srt` or ` (n)`.
        for c in ['😀', '字'] {
            let name = sanitize(&c.to_string().repeat(200));
            assert!(name.len() <= MAX_COMPONENT_BYTES, "{} bytes", name.len());
            assert!(name.chars().all(|x| x == c));
            assert!(format!("{name} (999).abcdefgh.99.srt").len() <= 255);
        }
    }

    #[test]
    fn lays_out_movies_and_episodes() {
        let (dir, base) = movie_layout("Blade Runner", Some("1982"));
        assert_eq!(dir, Path::new("Movies").join("Blade Runner (1982)"));
        assert_eq!(base, "Blade Runner (1982)");
        assert_eq!(movie_layout("Untold", Some("2011–2019")).1, "Untold (2011)");
        assert_eq!(movie_layout("Untold", None).1, "Untold");

        let (dir, base) = episode_layout("Dark: Origins", 1, 2, Some("Lies"));
        assert_eq!(dir, Path::new("Series").join("Dark - Origins").join("Season 01"));
        assert_eq!(base, "Dark - Origins - S01E02 - Lies");
        assert_eq!(episode_layout("Show", 0, 3, None).0, Path::new("Series").join("Show").join("Specials"));
        assert_eq!(episode_layout("Show", 12, 104, Some(" ")).1, "Show - S12E104");
    }

    #[test]
    fn a_long_show_title_is_cut_never_the_episode_code() {
        for title in ["T".repeat(75), "T".repeat(300), "字".repeat(120)] {
            for name in [None, Some("Pilot"), Some(&*"N".repeat(100))] {
                let (_, base) = episode_layout(&title, 3, 12, name);
                assert!(base.contains(" - S03E12"), "{base}");
                assert!(base.chars().count() <= MAX_COMPONENT_CHARS && base.len() <= MAX_COMPONENT_BYTES, "{base}");
                assert!(!base.ends_with(['-', ' ']), "{base}");
            }
        }
        // A short one is left whole, with as much of the episode's name as fits.
        let (_, base) = episode_layout("Show", 1, 1, Some(&"N".repeat(100)));
        assert!(base.starts_with("Show - S01E01 - NNN") && base.chars().count() == MAX_COMPONENT_CHARS);
    }

    #[test]
    fn avoids_collisions() {
        let dir = std::env::temp_dir().join(format!("orbit-files-test-{}", crate::library::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_base(&dir, "Film (2020)", &[]), "Film (2020)");
        std::fs::write(dir.join("Film (2020).mkv"), b"x").unwrap();
        assert_eq!(unique_base(&dir, "Film (2020)", &[]), "Film (2020) (2)");
        std::fs::write(dir.join("Film (2020) (2).part"), b"x").unwrap();
        assert_eq!(unique_base(&dir, "Film (2020)", &[]), "Film (2020) (3)");
        // A longer name that merely starts the same isn't a collision.
        assert_eq!(unique_base(&dir, "Film", &[]), "Film");
        // Windows and macOS don't tell names apart by case: another addon's
        // "the office" is the same file there as "The Office".
        std::fs::write(dir.join("the office - S01E01.part"), b"x").unwrap();
        assert_eq!(unique_base(&dir, "The Office - S01E01", &[]), "The Office - S01E01 (2)");
        // Another download's name is taken even with none of its files there (in any case).
        let taken = ["Film (2020) (3)".to_string(), "pilot".to_string()];
        assert_eq!(unique_base(&dir, "Film (2020)", &taken), "Film (2020) (4)");
        assert_eq!(unique_base(&dir, "Pilot", &taken), "Pilot (2)");
        assert_eq!(unique_base(&dir, "Pilot (2)", &taken), "Pilot (2)");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn picks_extensions() {
        assert_eq!(choose_extension(Some("attachment; filename=\"Movie.2020.MP4\""), "/dl/abc", None), "mp4");
        assert_eq!(choose_extension(Some("attachment; filename*=UTF-8''Movie%20x.mkv"), "/x.mp4", None), "mkv");
        assert_eq!(choose_extension(None, "/dl/token/Movie.2020.1080p.WEBM", None), "webm");
        assert_eq!(choose_extension(Some("inline"), "/dl/token/file", Some("video/mp4")), "mp4");
        assert_eq!(choose_extension(None, "/play/file.exe", Some("application/octet-stream")), "mkv");
        assert_eq!(choose_extension(None, "/", None), "mkv");
    }

    #[test]
    fn decides_free_space() {
        let gb = 1024 * 1024 * 1024;
        assert!(has_room(Some(10 * gb), Some(2 * gb)));
        assert!(!has_room(Some(2 * gb), Some(2 * gb)));
        assert!(has_room(None, Some(2 * gb)));
        assert!(has_room(Some(gb), None));
    }

    #[test]
    fn finds_only_orbits_own_leftovers() {
        let root = std::env::temp_dir().join(format!("orbit-orphans-test-{}", crate::library::now_ms()));
        let movie = root.join("Movies").join("Film (2020)");
        let season = root.join("Series").join("Show").join("Season 01");
        let elsewhere = root.join("Other");
        for dir in [&movie, &season, &elsewhere] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let file = |path: PathBuf| {
            std::fs::write(&path, b"x").unwrap();
            path
        };
        let kept_part = file(movie.join("Film (2020).part"));
        let orphan_movie = file(movie.join("Film (2020) (2).part"));
        let orphan_episode = file(season.join("Show - S01E02 - Two.part"));
        let staging = season.join(format!(".orbit-{}", "ab".repeat(16)));
        std::fs::create_dir_all(&staging).unwrap();
        // Not Orbit's: other names, other folders, finished videos, a browser's partial file.
        file(movie.join("Something Else.part"));
        file(movie.join("Film (2020).mkv"));
        file(season.join("Other Show - S01E01.part"));
        file(elsewhere.join("Film (2020).part"));
        file(root.join("Movies").join("loose.part"));
        std::fs::create_dir_all(season.join(".orbit-notanid")).unwrap();

        // A download whose folder was named in another case (it went into the
        // folder an earlier download made, on a drive that ignores case).
        std::fs::create_dir_all(season.join(format!(".orbit-{}", "cd".repeat(16)))).unwrap();
        let kept_elsewhere = root.join("series").join("SHOW").join("season 01").join(format!(".orbit-{}", "cd".repeat(16)));

        let kept = std::collections::HashSet::from([kept_part.clone(), kept_elsewhere]);
        let mut found = orphans(&root, &kept);
        found.sort();
        let mut expected = vec![orphan_movie, orphan_episode, staging];
        expected.sort();
        assert_eq!(found, expected);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_leftover_episodes_of_shows_with_long_or_cut_titles() {
        let root = std::env::temp_dir().join(format!("orbit-orphans-long-test-{}", crate::library::now_ms()));
        let mut expected = Vec::new();
        for (title, season, episode, name) in
            [(&*"A Very Long Light Novel Title ".repeat(4), 1, 2, Some("Two")), ("AC/", 1, 1, None), ("Show", 100, 3, None), ("Show", 0, 1, Some("Pilot"))]
        {
            let (dir, base) = episode_layout(title, season, episode, name);
            let folder = root.join(dir);
            std::fs::create_dir_all(&folder).unwrap();
            let part = folder.join(format!("{base}{PART_SUFFIX}"));
            std::fs::write(&part, b"x").unwrap();
            expected.push(part);
        }
        let other = root.join(episode_layout("Show", 1, 1, None).0);
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("Other Show - S01E01.part"), b"x").unwrap();
        std::fs::write(other.join("Show - Season 1.part"), b"x").unwrap();
        let mut found = orphans(&root, &std::collections::HashSet::new());
        found.sort();
        expected.sort();
        assert_eq!(found, expected);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn prunes_only_empty_folders_inside_the_root() {
        let root = std::env::temp_dir().join(format!("orbit-prune-test-{}", crate::library::now_ms()));
        let deep = root.join("Series").join("Show").join("Season 01");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(root.join("Series").join("Show").join("poster.jpg"), b"x").unwrap();
        prune_empty(&deep, &root);
        assert!(!deep.exists());
        assert!(root.join("Series").join("Show").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
