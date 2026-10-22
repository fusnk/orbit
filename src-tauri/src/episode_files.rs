//! Which file of a torrent to play. Season packs hold many episodes in one
//! torrent; addons usually say which file is the episode (`fileIdx`), but not
//! always, and then "the largest video" is the wrong episode. Here the file
//! names are read for an episode number (S01E02, 1x02, "Episode 2", anime
//! "Show - 02", "02 - Title" inside a season folder), ignoring samples and
//! extras.
//!
//! File names come from the torrent, so they're untrusted: they're only read
//! here, never used to build a path, and what's shown of them is cleaned and
//! capped (`shown`).

use serde::Deserialize;

/// The episode a torrent is opened for. `absolute` is its number counted
/// across seasons (S2E1 after a 12-episode S1 is 13), for anime packs that
/// number that way.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub struct Wanted {
    pub season: u32,
    pub episode: u32,
    #[serde(default)]
    pub absolute: Option<u32>,
}

impl Wanted {
    pub(crate) fn valid(&self) -> bool {
        self.season <= 1000 && self.episode <= 100_000 && self.absolute.is_none_or(|a| a <= 100_000)
    }
}

/// An episode number read from a file name: `first..=last` (one file can hold
/// a double episode), with the season if the name or its folders say.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Numbered {
    pub season: Option<u32>,
    pub first: u32,
    pub last: u32,
}

impl Numbered {
    fn covers(&self, n: u32) -> bool {
        (self.first..=self.last).contains(&n)
    }
}

const MAX_SHOWN: usize = 300;

/// Folder names that hold extras, not episodes.
const EXTRA_FOLDERS: &[&str] = &[
    "sample",
    "samples",
    "extra",
    "extras",
    "featurette",
    "featurettes",
    "bonus",
    "bonus features",
    "special features",
    "behind the scenes",
    "deleted scenes",
    "interviews",
    "trailer",
    "trailers",
    "nc",
    "ncop",
    "nced",
    "creditless",
];

/// Words for "season" in the languages releases are commonly named in.
const SEASON_WORDS: &[&str] = &["season", "saison", "staffel", "temporada", "stagione", "seizoen", "sezon", "series"];

/// A path's parts, whichever separator it uses.
fn parts(path: &str) -> Vec<&str> {
    path.split(['/', '\\']).filter(|c| !c.is_empty()).collect()
}

fn extension(name: &str) -> Option<String> {
    name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase())
}

pub(crate) fn is_video(path: &str) -> bool {
    let name = parts(path).pop().unwrap_or_default();
    extension(name).is_some_and(|ext| crate::torrent::VIDEO_EXTENSIONS.contains(&ext.as_str()))
}

/// The file name without its extension, in lower case (ASCII only, so byte positions stay put).
fn stem(name: &str) -> Vec<u8> {
    let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
    stem.to_ascii_lowercase().into_bytes()
}

fn starts_word(s: &[u8], i: usize) -> bool {
    i == 0 || !s[i - 1].is_ascii_alphanumeric()
}

fn ends_word(s: &[u8], i: usize) -> bool {
    i >= s.len() || !s[i].is_ascii_alphanumeric()
}

/// 1..=`max` digits at `at`, and where they end; None if there are none or more.
fn digits(s: &[u8], at: usize, max: usize) -> Option<(u32, usize)> {
    let mut end = at;
    while end < s.len() && s[end].is_ascii_digit() {
        end += 1;
    }
    if end == at || end - at > max {
        return None;
    }
    let value = s[at..end].iter().fold(0u32, |n, d| n * 10 + u32::from(d - b'0'));
    Some((value, end))
}

const fn is_separator(b: u8) -> bool {
    matches!(b, b' ' | b'.' | b'_' | b'-')
}

/// A double episode's end: "E01E02", "E01-E02", "E01-02". Only a short, rising range counts.
fn range_end(s: &[u8], at: usize, first: u32) -> u32 {
    let mut i = at;
    if s.get(i) == Some(&b'-') {
        i += 1;
    }
    if s.get(i) == Some(&b'e') {
        i += 1;
    } else if i == at {
        return first;
    }
    match digits(s, i, 4) {
        Some((last, end)) if ends_word(s, end) || s.get(end) == Some(&b'e') => {
            if last > first && last - first <= 10 {
                last
            } else {
                first
            }
        }
        _ => first,
    }
}

/// "S01E02", "s1 e2", "S01.E02", "S01E01E02".
fn season_episode(s: &[u8]) -> Option<Numbered> {
    (0..s.len()).find_map(|i| {
        if s[i] != b's' || !starts_word(s, i) {
            return None;
        }
        let (season, mut j) = digits(s, i + 1, 3)?;
        if s.get(j).is_some_and(|&b| is_separator(b)) && s.get(j + 1) == Some(&b'e') {
            j += 1;
        }
        if s.get(j) != Some(&b'e') {
            return None;
        }
        let (first, k) = digits(s, j + 1, 4)?;
        Some(Numbered { season: Some(season), first, last: range_end(s, k, first) })
    })
}

/// "1x02" (but not "1920x1080").
fn cross(s: &[u8]) -> Option<Numbered> {
    (0..s.len()).find_map(|i| {
        if !starts_word(s, i) {
            return None;
        }
        let (season, j) = digits(s, i, 2)?;
        if s.get(j) != Some(&b'x') {
            return None;
        }
        let (episode, k) = digits(s, j + 1, 3)?;
        (k - j > 2 && ends_word(s, k)).then_some(Numbered { season: Some(season), first: episode, last: episode })
    })
}

/// "Episode 2", "Ep02", "Ep. 2", "E02".
fn episode_word(s: &[u8]) -> Option<Numbered> {
    (0..s.len()).find_map(|i| {
        if !starts_word(s, i) {
            return None;
        }
        let rest = &s[i..];
        let (mut j, spaced) = if rest.starts_with(b"episode") {
            (i + 7, true)
        } else if rest.starts_with(b"ep") {
            (i + 2, true)
        } else if rest.first() == Some(&b'e') {
            (i + 1, false)
        } else {
            return None;
        };
        if spaced {
            for _ in 0..2 {
                if s.get(j).is_some_and(|&b| is_separator(b) || b == b'#') {
                    j += 1;
                }
            }
        }
        let (first, k) = digits(s, j, 4)?;
        if !spaced && k - j < 2 {
            return None;
        }
        let version = s.get(k) == Some(&b'v') && s.get(k + 1).is_some_and(u8::is_ascii_digit);
        (ends_word(s, k) || version).then(|| Numbered { season: None, first, last: range_end(s, k, first) })
    })
}

/// Anime style: "[Group] Show - 05 [1080p]", "Show - 05v2".
fn dashed(s: &[u8]) -> Option<Numbered> {
    (1..s.len().saturating_sub(1)).find_map(|i| {
        if s[i] != b'-' || !matches!(s[i - 1], b' ' | b'_') || !matches!(s[i + 1], b' ' | b'_') {
            return None;
        }
        let (n, mut k) = digits(s, i + 2, 3)?;
        if s.get(k) == Some(&b'v') && s.get(k + 1).is_some_and(u8::is_ascii_digit) {
            k += 2;
        }
        (k >= s.len() || matches!(s[k], b' ' | b'_' | b'[' | b'(' | b'.' | b'-')).then_some(Numbered { season: None, first: n, last: n })
    })
}

/// "02 - Pilot", "02. Pilot", "02": a number leading the name (inside a season folder, usually).
fn leading(s: &[u8]) -> Option<Numbered> {
    let (n, k) = digits(s, 0, 3)?;
    (k >= s.len() || is_separator(s[k])).then_some(Numbered { season: None, first: n, last: n })
}

enum Season {
    Found(u32),
    /// Names more than one season ("S01-S03", "Season 1 + Specials").
    Several,
    Unknown,
}

/// The season a folder, torrent or file name speaks of: "Season 2", "Staffel 2", "S02", "Specials".
fn season_of(text: &str) -> Season {
    let s = text.to_ascii_lowercase().into_bytes();
    let mut found: Vec<u32> = Vec::new();
    let mut ranged = false;
    for i in 0..s.len() {
        if !starts_word(&s, i) {
            continue;
        }
        let rest = &s[i..];
        // Where the number starts, and whether it followed a word ("Season 2") rather than an S ("S02").
        let at = if let Some(word) = SEASON_WORDS.iter().find(|w| rest.starts_with(w.as_bytes())) {
            let mut j = i + word.len();
            if s.get(j) == Some(&b's') {
                j += 1;
            }
            for _ in 0..2 {
                if s.get(j).is_some_and(|&b| is_separator(b)) {
                    j += 1;
                }
            }
            (j, true)
        } else if (rest.starts_with(b"specials") && ends_word(&s, i + 8)) || (rest.starts_with(b"special") && ends_word(&s, i + 7)) {
            found.push(0);
            continue;
        } else if rest.first() == Some(&b's') {
            (i + 1, false)
        } else {
            continue;
        };
        let (j, worded) = at;
        let Some((n, k)) = digits(&s, j, 2) else { continue };
        if !ends_word(&s, k) {
            continue;
        }
        found.push(n);
        // "Season 1-3", "Seasons 1 to 3", "S01-S03", "S01 ~ S03". ("S2 - 05" is anime's season 2, episode 5.)
        let mut r = k;
        while s.get(r) == Some(&b' ') {
            r += 1;
        }
        let joined = match s.get(r) {
            Some(b'-' | b'~' | b'&') => Some(r + 1),
            Some(b't') if s.get(r + 1) == Some(&b'o') => Some(r + 2),
            _ => None,
        };
        if let Some(mut r) = joined {
            while s.get(r) == Some(&b' ') {
                r += 1;
            }
            if !worded {
                if s.get(r) != Some(&b's') {
                    continue;
                }
                r += 1;
            }
            ranged |= s.get(r).is_some_and(u8::is_ascii_digit);
        }
    }
    found.sort_unstable();
    found.dedup();
    match (found.as_slice(), ranged) {
        ([], _) => Season::Unknown,
        ([n], false) => Season::Found(*n),
        _ => Season::Several,
    }
}

/// The episode `path` holds, if its name says. `torrent` is the torrent's own
/// name, the outermost folder (a season pack is often named "Show S02").
pub(crate) fn parse(path: &str, torrent: &str) -> Option<Numbered> {
    let all = parts(path);
    let (name, folders) = all.split_last()?;
    let s = stem(name);
    if let Some(found) = season_episode(&s).or_else(|| cross(&s)) {
        return Some(found);
    }
    let found = episode_word(&s).or_else(|| dashed(&s)).or_else(|| leading(&s))?;
    let stem_text = String::from_utf8_lossy(&s).into_owned();
    // The nearest name that tells the season: the file's, its folders (innermost first), the torrent's.
    for text in std::iter::once(stem_text.as_str()).chain(folders.iter().rev().copied()).chain(std::iter::once(torrent)) {
        match season_of(text) {
            Season::Found(n) => return Some(Numbered { season: Some(n), ..found }),
            Season::Several => break,
            Season::Unknown => {}
        }
    }
    Some(found)
}

/// Samples, trailers, featurettes and the like: never what someone means to play.
pub(crate) fn is_extra(path: &str) -> bool {
    let all = parts(path);
    let Some((name, folders)) = all.split_last() else { return false };
    let folder_extra = folders.iter().any(|f| {
        let plain = f.to_ascii_lowercase().replace(['_', '.'], " ");
        EXTRA_FOLDERS.contains(&plain.trim())
    });
    if folder_extra {
        return true;
    }
    let s = stem(name);
    let text = String::from_utf8_lossy(&s);
    let words: Vec<&str> = text.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).collect();
    if words.contains(&"sample") {
        return true;
    }
    // An episode's own name can hold these words ("Trailer Park Boys S01E01"), so only unnumbered files count.
    let numbered = season_episode(&s).or_else(|| cross(&s)).is_some();
    !numbered && words.iter().any(|w| matches!(*w, "trailer" | "featurette" | "creditless") || w.starts_with("ncop") || w.starts_with("nced"))
}

/// Files that are the wanted episode: by season and episode, else (for packs
/// numbered without seasons) by the absolute number.
fn matching(files: &[(String, u64)], among: &[usize], wanted: Wanted, torrent: &str) -> (Vec<usize>, Vec<usize>) {
    let parsed: Vec<(usize, Numbered)> = among.iter().filter_map(|&i| parse(&files[i].0, torrent).map(|n| (i, n))).collect();
    let exact: Vec<usize> = parsed.iter().filter(|(_, n)| n.season == Some(wanted.season) && n.covers(wanted.episode)).map(|(i, _)| *i).collect();
    if !exact.is_empty() {
        return (exact, Vec::new());
    }
    let absolute = |n: &Numbered| wanted.absolute.is_some_and(|a| n.covers(a));
    let loose = parsed
        .iter()
        .filter(|(_, n)| match n.season {
            // No season named: season 1's episode, or the number counted across seasons.
            None => absolute(n) || (wanted.season == 1 && n.covers(wanted.episode)),
            // Some groups keep counting across seasons inside a season ("S02E13" for S2E1).
            Some(season) => season == wanted.season && wanted.season > 1 && absolute(n),
        })
        .map(|(i, _)| *i)
        .collect();
    (Vec::new(), loose)
}

fn largest(files: &[(String, u64)], among: &[usize]) -> Option<usize> {
    among.iter().copied().max_by_key(|&i| files[i].1)
}

/// The video to play: the addon's file index (unless it plainly names another
/// episode than the one wanted, which the torrent has), else the wanted
/// episode by name, else the largest video that isn't an extra.
pub(crate) fn pick_file(files: &[(String, u64)], index: Option<usize>, wanted: Option<Wanted>, torrent: &str) -> Result<usize, String> {
    let videos: Vec<usize> = (0..files.len()).filter(|&i| is_video(&files[i].0)).collect();
    if videos.is_empty() {
        return Err("err.torrent.no-video".into());
    }
    let main: Vec<usize> = videos.iter().copied().filter(|&i| !is_extra(&files[i].0)).collect();
    let main = if main.is_empty() { videos } else { main };
    let (exact, loose) = wanted.map(|w| matching(files, &main, w, torrent)).unwrap_or_default();
    if let Some(i) = index.filter(|&i| i < files.len() && is_video(&files[i].0)) {
        let names_another = wanted.is_some_and(|w| parse(&files[i].0, torrent).is_some_and(|n| n.season.is_some() && !(n.season == Some(w.season) && n.covers(w.episode))));
        if !(names_another && !exact.is_empty()) {
            return Ok(i);
        }
    }
    largest(files, &exact).or_else(|| largest(files, &loose)).or_else(|| largest(files, &main)).ok_or_else(|| "this torrent has no video file".into())
}

/// A file name as it may be shown: no control or text-direction characters
/// (which could make one name look like another), and not too long.
pub(crate) fn shown(name: &str) -> String {
    name.chars().filter(|&c| !c.is_control() && !matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')).take(MAX_SHOWN).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(season: Option<u32>, first: u32, last: u32) -> Option<Numbered> {
        Some(Numbered { season, first, last })
    }

    const fn want(season: u32, episode: u32) -> Option<Wanted> {
        Some(Wanted { season, episode, absolute: None })
    }

    fn files(names: &[(&str, u64)]) -> Vec<(String, u64)> {
        names.iter().map(|(name, len)| ((*name).to_string(), *len)).collect()
    }

    #[test]
    fn reads_common_episode_names() {
        assert_eq!(parse("Show.Name.S01E02.1080p.WEB.x264-GRP.mkv", ""), n(Some(1), 2, 2));
        assert_eq!(parse("show name s1e2.mp4", ""), n(Some(1), 2, 2));
        assert_eq!(parse("Show Name - S02 E10 - Title.mkv", ""), n(Some(2), 10, 10));
        assert_eq!(parse("Show.Name.S02.E10.720p.mkv", ""), n(Some(2), 10, 10));
        assert_eq!(parse("Show.S01E01E02.mkv", ""), n(Some(1), 1, 2));
        assert_eq!(parse("Show.S01E01-E02.mkv", ""), n(Some(1), 1, 2));
        assert_eq!(parse("Show.S01E01-02.mkv", ""), n(Some(1), 1, 2));
        assert_eq!(parse("Show.S01E01-1080p.mkv", ""), n(Some(1), 1, 1));
        assert_eq!(parse("Show 1x02 Title.avi", ""), n(Some(1), 2, 2));
        assert_eq!(parse("Show.10x105.mkv", ""), n(Some(10), 105, 105));
        assert_eq!(parse("Show.2017.S03E04.HDR.2160p.mkv", ""), n(Some(3), 4, 4));
        assert_eq!(parse("24.S08E24.mkv", ""), n(Some(8), 24, 24));
        assert_eq!(parse("Show (2005) - S01E01 - Pilot (1080p BluRay x265 Silence).mkv", ""), n(Some(1), 1, 1));
        assert_eq!(parse("Show.Name.S01.COMPLETE.1080p/Show.Name.S01E05.mkv", "Show.Name.S01.COMPLETE.1080p"), n(Some(1), 5, 5));
        assert_eq!(parse("The.Office.US.S05E14-15.Stress.Relief.mkv", ""), n(Some(5), 14, 15));
        assert_eq!(parse("One.Piece.E1071.1080p.mkv", ""), n(None, 1071, 1071));
        // Specials.
        assert_eq!(parse("Show.S00E03.Christmas.Special.mkv", ""), n(Some(0), 3, 3));
    }

    #[test]
    fn resolution_and_codecs_are_not_episodes() {
        assert_eq!(parse("Movie.1920x1080.x264.mkv", ""), None);
        assert_eq!(parse("Movie.2019.1080p.BluRay.x265.mkv", ""), None);
        assert_eq!(parse("Movie.2019.1080p.DDP5.1.Atmos.mkv", ""), None);
        assert_eq!(parse("Show - 1080p.mkv", ""), None);
    }

    #[test]
    fn takes_the_season_from_folders_and_the_torrent_name() {
        assert_eq!(parse("Season 2/Episode 3.mkv", "Show Complete"), n(Some(2), 3, 3));
        assert_eq!(parse("Season 02/03 - The Third.mkv", "Show"), n(Some(2), 3, 3));
        assert_eq!(parse("Show.S03/E05.mkv", "Show"), n(Some(3), 5, 5));
        assert_eq!(parse("Staffel 4/Folge Ep 7.mkv", ""), n(Some(4), 7, 7));
        assert_eq!(parse("Ep.07.mkv", "Show Saison 3 MULTi 1080p"), n(Some(3), 7, 7));
        assert_eq!(parse("Specials/Episode 1.mkv", "Show"), n(Some(0), 1, 1));
        assert_eq!(parse("Show Season 1 Episode 6.mkv", ""), n(Some(1), 6, 6));
        // A folder spanning seasons says nothing about which one.
        assert_eq!(parse("Episode 3.mkv", "Show S01-S03 1080p"), n(None, 3, 3));
        assert_eq!(parse("Episode 3.mkv", "Show Season 1-3"), n(None, 3, 3));
        assert_eq!(parse("Episode 3.mkv", "Show Seasons 1 to 3"), n(None, 3, 3));
        assert_eq!(parse("Episode 3.mkv", "Show S01 - S03"), n(None, 3, 3));
        assert_eq!(parse("Episode 3.mkv", "Show Season 1 + Specials"), n(None, 3, 3));
        // The file's own season beats the folder's.
        assert_eq!(parse("Season 1/Show.S02E01.mkv", ""), n(Some(2), 1, 1));
        // Backslashes, as Windows paths come.
        assert_eq!(parse("Season 5\\07.mkv", ""), n(Some(5), 7, 7));
    }

    #[test]
    fn reads_anime_numbering() {
        assert_eq!(parse("[Group] Show - 05 [1080p][ABCD1234].mkv", ""), n(None, 5, 5));
        assert_eq!(parse("[Group] Show - 05v2 [1080p].mkv", ""), n(None, 5, 5));
        assert_eq!(parse("[Group]_Show_-_118_[720p].mkv", ""), n(None, 118, 118));
        assert_eq!(parse("[Group] Show S2 - 05 [1080p].mkv", ""), n(Some(2), 5, 5));
        assert_eq!(parse("[Group] Show - 2019 [1080p].mkv", ""), None);
    }

    #[test]
    fn spots_extras() {
        assert!(is_extra("Sample/show.s01e01.sample.mkv"));
        assert!(is_extra("show.s01e01-sample.mkv"));
        assert!(is_extra("Featurettes/Making Of.mkv"));
        assert!(is_extra("Extras/Show S01E01 Commentary.mkv"));
        assert!(is_extra("Behind_The_Scenes/part 1.mkv"));
        assert!(is_extra("[Group] Show - NCOP1 [1080p].mkv"));
        assert!(is_extra("Show Official Trailer.mp4"));
        assert!(!is_extra("Trailer.Park.Boys.S01E01.mkv"));
        assert!(!is_extra("Season 1/Show.S01E01.mkv"));
        assert!(!is_extra("Samples of Life S01E01.mkv"));
    }

    #[test]
    fn picks_the_wanted_episode_from_a_pack() {
        let pack = files(&[
            ("Show.S01E01.1080p.mkv", 900),
            ("Show.S01E02.1080p.mkv", 800),
            ("Show.S01E03.1080p.mkv", 1200),
            ("Sample/show.s01e02.sample.mkv", 50),
            ("Show.S01E02.1080p.srt", 1),
        ]);
        assert_eq!(pick_file(&pack, None, want(1, 2), "Show.S01.1080p"), Ok(1));
        // Nothing wanted (a film, or no episode known): the largest video.
        assert_eq!(pick_file(&pack, None, None, ""), Ok(2));
        // Not in the pack: the largest video, as before.
        assert_eq!(pick_file(&pack, None, want(1, 9), ""), Ok(2));
        assert_eq!(pick_file(&pack, None, want(2, 2), ""), Ok(2));
    }

    #[test]
    fn multi_season_packs() {
        let pack = files(&[
            ("Season 1/Show.S01E01.mkv", 500),
            ("Season 1/Show.S01E02.mkv", 500),
            ("Season 2/Show.S02E01.mkv", 400),
            ("Season 2/Show.S02E02.mkv", 400),
            ("Specials/Show.S00E01.mkv", 300),
        ]);
        assert_eq!(pick_file(&pack, None, want(2, 1), "Show Complete Series"), Ok(2));
        assert_eq!(pick_file(&pack, None, want(0, 1), "Show Complete Series"), Ok(4));
        let folders = files(&[("Season 1/01 - Pilot.mkv", 500), ("Season 1/02.mkv", 500), ("Season 2/01 - Return.mkv", 400), ("Season 2/02.mkv", 400)]);
        assert_eq!(pick_file(&folders, None, want(2, 2), "Show"), Ok(3));
        assert_eq!(pick_file(&folders, None, want(1, 1), "Show"), Ok(0));
    }

    #[test]
    fn absolute_numbers_for_packs_without_seasons() {
        let pack = files(&[("[G] Show - 01 [1080p].mkv", 310), ("[G] Show - 13 [1080p].mkv", 300), ("[G] Show - 14 [1080p].mkv", 300), ("[G] Show - NCED [1080p].mkv", 400)]);
        // S2E1 is episode 13 counted from the start.
        assert_eq!(pick_file(&pack, None, Some(Wanted { season: 2, episode: 1, absolute: Some(13) }), "[G] Show"), Ok(1));
        // Without the count, a later season's episode isn't guessed from a bare number ("01" is S1E1):
        // the largest video plays, as for any torrent whose names don't help.
        assert_eq!(pick_file(&pack, None, Some(Wanted { season: 2, episode: 2, absolute: None }), "[G] Show"), Ok(0));
        assert_eq!(matching(&pack, &[0, 1, 2], Wanted { season: 2, episode: 1, absolute: None }, "[G] Show"), (vec![], vec![]));
        // Season 1 needs no count.
        let first = files(&[("[G] Show - 01 [1080p].mkv", 300), ("[G] Show - 02 [1080p].mkv", 300)]);
        assert_eq!(pick_file(&first, None, want(1, 2), "[G] Show"), Ok(1));
        // A season folder that keeps counting: "S02E13" is S2E1.
        let counted = files(&[("Show.S02E13.mkv", 300), ("Show.S02E14.mkv", 300)]);
        assert_eq!(pick_file(&counted, None, Some(Wanted { season: 2, episode: 2, absolute: Some(14) }), ""), Ok(1));
    }

    #[test]
    fn trusts_the_addons_file_index_unless_it_names_another_episode() {
        let pack = files(&[("Show.S01E01.mkv", 900), ("Show.S01E02.mkv", 800), ("notes.nfo", 1), ("Bonus.mkv", 2000)]);
        assert_eq!(pick_file(&pack, Some(0), want(1, 1), ""), Ok(0));
        // Points at E01, but E02 is wanted and is there.
        assert_eq!(pick_file(&pack, Some(0), want(1, 2), ""), Ok(1));
        // An unnumbered file: the addon knows best.
        assert_eq!(pick_file(&pack, Some(3), want(1, 2), ""), Ok(3));
        // Out of range or not a video: chosen by name instead.
        assert_eq!(pick_file(&pack, Some(9), want(1, 2), ""), Ok(1));
        assert_eq!(pick_file(&pack, Some(2), want(1, 2), ""), Ok(1));
        // Without an episode (a hand-picked file, a film), the index stands.
        assert_eq!(pick_file(&pack, Some(1), None, ""), Ok(1));
    }

    #[test]
    fn prefers_episodes_over_bigger_extras_and_samples() {
        let film = files(&[("Film.2019.1080p.mkv", 900), ("Sample/sample.mkv", 50), ("Extras/Making of.mkv", 1500), ("Film.nfo", 5000)]);
        assert_eq!(pick_file(&film, None, None, "Film.2019"), Ok(0));
        // Only extras: still something to play.
        assert_eq!(pick_file(&files(&[("Sample/sample.mkv", 50)]), None, None, ""), Ok(0));
        assert!(pick_file(&files(&[("a.txt", 1)]), None, None, "").is_err());
    }

    #[test]
    fn shown_names_are_clean_and_short() {
        assert_eq!(shown("a\u{202e}vkm.exe\u{0}b"), "avkm.exeb");
        assert_eq!(shown(&"x".repeat(1000)).len(), MAX_SHOWN);
    }
}
