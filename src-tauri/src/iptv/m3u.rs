//! M3U/M3U8 playlists: `#EXTM3U` with `#EXTINF` entries. Every field is
//! untrusted (it comes from the provider), so text is length-capped, logos
//! must be http(s), and stream addresses are checked before they're kept.

use std::io::BufRead;

/// Caps that keep a hostile or broken playlist from exhausting memory.
pub const MAX_CHANNELS: usize = 200_000;
const MAX_TEXT: usize = 200;
const MAX_URL: usize = 4096;
const MAX_LINE: usize = 16 * 1024;

#[derive(Debug, Default, PartialEq)]
pub struct Entry {
    pub name: String,
    pub logo: Option<String>,
    pub group: Option<String>,
    pub tvg_id: Option<String>,
    pub url: String,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
    /// Replay from the channel's archive (see catchup.rs), if it has one.
    pub catchup: Option<Catchup>,
    /// The name and group as Orbit read them before it read Latin-1 lines (with
    /// replacement characters), when that differs: what its favourites were kept under.
    pub before_latin1: Option<(String, Option<String>)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Catchup {
    pub kind: &'static str,
    /// `catchup-source`: a template for `default` and `append`.
    pub source: Option<String>,
    /// How far back the archive goes.
    pub days: i64,
}

#[derive(Debug, Default)]
pub struct Playlist {
    pub entries: Vec<Entry>,
    /// The guide addresses from the header (`url-tvg` / `x-tvg-url` / `tvg-url`), at most `MAX_GUIDES`.
    pub epg: Vec<String>,
}

fn clip(text: &str, max: usize) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(max).collect()
}

/// Archives longer than this are treated as this long.
pub const MAX_ARCHIVE_DAYS: i64 = 30;
/// Kodi's default when a playlist names a replay kind but not how far back it goes.
const DEFAULT_ARCHIVE_DAYS: i64 = 5;

fn web_url(text: &str) -> Option<String> {
    let text = text.trim();
    let ok = text.len() <= MAX_URL && (text.starts_with("http://") || text.starts_with("https://")) && !text.chars().any(|c| c.is_whitespace() || c.is_control());
    ok.then(|| text.to_string())
}

/// `key="value"` pairs from an `#EXTINF` or `#EXTM3U` line (quotes optional).
fn attribute(line: &str, key: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(&format!("{key}=")) {
        let start = from + at;
        // Must be a whole attribute name, not the end of another one.
        let boundary = start == 0 || lower.as_bytes()[start - 1].is_ascii_whitespace();
        let value = &line[start + key.len() + 1..];
        if boundary {
            return Some(match value.strip_prefix('"') {
                Some(rest) => rest.split('"').next().unwrap_or_default().to_string(),
                None => value.split_whitespace().next().unwrap_or_default().to_string(),
            });
        }
        from = start + key.len();
    }
    None
}

/// `catchup`, `catchup-source` and `catchup-days` (or `timeshift` / `tvg-rec`)
/// from a line, falling back to the playlist's header for what's missing.
fn catchup(line: &str, url: &str, defaults: Option<&(Option<String>, Option<String>, Option<String>)>) -> Option<Catchup> {
    let from_header = |i: usize| defaults.and_then(|h| [&h.0, &h.1, &h.2][i].clone());
    let kind = attribute(line, "catchup").or_else(|| attribute(line, "catchup-type")).or_else(|| from_header(0));
    let source = attribute(line, "catchup-source").or_else(|| from_header(1)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s.len() <= MAX_URL && !s.chars().any(|c| c.is_whitespace() || c.is_control()));
    let days = attribute(line, "catchup-days").or_else(|| attribute(line, "timeshift")).or_else(|| attribute(line, "tvg-rec")).or_else(|| from_header(2)).and_then(|d| d.trim().parse::<i64>().ok());
    let kind = match kind {
        Some(k) => crate::iptv::catchup::kind(&k)?,
        // Without a kind: a template means `default`; just a length means Xtream's archive or `shift`.
        None if source.is_some() => "default",
        None if days.is_some_and(|d| d > 0) => {
            if crate::iptv::catchup::xc_parts(url).is_some() { "xc" } else { "shift" }
        }
        None => return None,
    };
    if matches!(kind, "default" | "append") && source.is_none() {
        return None;
    }
    let days = days.unwrap_or(DEFAULT_ARCHIVE_DAYS);
    (days > 0).then(|| Catchup { kind, source, days: days.min(MAX_ARCHIVE_DAYS) })
}

/// The title: everything after the first comma that isn't inside an
/// attribute's quotes (the title itself may hold commas and quotes).
fn title(line: &str) -> String {
    let mut quoted = false;
    for (i, c) in line.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ',' if !quoted => return line[i + 1..].to_string(),
            _ => {}
        }
    }
    String::new()
}

/// Lines like "═══ USA ═══" or "##### SPORTS #####" are dividers, not channels.
fn is_divider(name: &str) -> bool {
    let letters = name.chars().filter(|c| c.is_alphanumeric()).count();
    letters == 0 || name.starts_with("###") || name.starts_with("===") || name.starts_with('═') || name.starts_with("---")
}

/// The name an `#EXTINF` line gives: its title, else its `tvg-name`.
fn entry_name(info: &str) -> String {
    let shown = clip(&title(info), MAX_TEXT);
    if shown.is_empty() { clip(&attribute(info, "tvg-name").filter(|n| !n.trim().is_empty()).unwrap_or_else(|| title(info)), MAX_TEXT) } else { shown }
}

fn entry_group(info: &str) -> Option<String> {
    attribute(info, "group-title").or_else(|| attribute(info, "group")).map(|g| clip(&g, MAX_TEXT)).filter(|g| !g.is_empty())
}

fn ext_group(g: &str) -> Option<String> {
    Some(clip(g, MAX_TEXT)).filter(|g| !g.is_empty())
}

pub fn parse(reader: impl BufRead) -> Playlist {
    let mut playlist = Playlist::default();
    let mut pending: Option<Entry> = None;
    let mut group: Option<String> = None;
    // The header's catchup defaults; the #EXTINF line is kept until its address is known.
    let mut defaults: Option<(Option<String>, Option<String>, Option<String>)> = None;
    let mut info_line = String::new();
    // The pending entry's name and group, and the #EXTGRP group, as read before Latin-1 lines were.
    let mut pending_before: Option<(String, Option<String>)> = None;
    let mut group_before: Option<String> = None;
    for line in reader.split(b'\n') {
        let Ok(line) = line else { break };
        if line.len() > MAX_LINE {
            continue;
        }
        // A line that isn't UTF-8 is read as Latin-1 (as guides are, see xmltv.rs), so an
        // ISO-8859-1 playlist keeps its names and they still match the guide's. How older
        // versions read it (replacement characters) is kept to carry favourites over.
        let (line, lossy) = match String::from_utf8(line) {
            Ok(text) => (text, None),
            Err(e) => {
                let bytes = e.into_bytes();
                (bytes.iter().map(|&b| char::from(b)).collect(), Some(String::from_utf8_lossy(&bytes).into_owned()))
            }
        };
        // `trim` keeps a byte-order mark, which would hide the #EXTM3U header.
        let line = line.trim_start_matches('\u{feff}').trim();
        let lossy = lossy.as_deref().map(|l| l.trim_start_matches('\u{feff}').trim());
        if line.is_empty() {
            continue;
        }
        if let Some(header) = line.strip_prefix("#EXTM3U") {
            if defaults.is_none() {
                defaults = Some((attribute(header, "catchup"), attribute(header, "catchup-source"), attribute(header, "catchup-days")));
            }
            if playlist.epg.is_empty() {
                let tvg = attribute(header, "url-tvg").or_else(|| attribute(header, "x-tvg-url")).or_else(|| attribute(header, "tvg-url"));
                // Several guides can be listed, comma-separated; they're merged, earlier ones first.
                playlist.epg = tvg.map(|t| t.split(',').filter_map(web_url).take(super::MAX_GUIDES).collect()).unwrap_or_default();
            }
        } else if let Some(info) = line.strip_prefix("#EXTINF:") {
            info.clone_into(&mut info_line);
            pending = Some(Entry {
                name: entry_name(info),
                logo: attribute(info, "tvg-logo").or_else(|| attribute(info, "logo")).and_then(|l| web_url(&l)),
                group: entry_group(info),
                tvg_id: attribute(info, "tvg-id").map(|t| clip(&t, MAX_TEXT)).filter(|t| !t.is_empty()),
                ..Default::default()
            });
            pending_before = lossy.and_then(|l| l.strip_prefix("#EXTINF:")).map(|old| (entry_name(old), entry_group(old)));
        } else if let Some(g) = line.strip_prefix("#EXTGRP:") {
            group = ext_group(g);
            group_before = lossy.and_then(|l| l.strip_prefix("#EXTGRP:")).map_or_else(|| group.clone(), ext_group);
        } else if let Some(opt) = line.strip_prefix("#EXTVLCOPT:") {
            if let Some(entry) = pending.as_mut() {
                if let Some(ua) = opt.strip_prefix("http-user-agent=") {
                    entry.user_agent = Some(clip(ua, MAX_TEXT));
                } else if let Some(r) = opt.strip_prefix("http-referrer=") {
                    entry.referrer = web_url(r);
                }
            }
        } else if !line.starts_with('#') {
            let Some(mut entry) = pending.take() else { continue };
            // `url|User-Agent=…&Referer=…` is Kodi's way of attaching headers.
            let (address, headers) = line.split_once('|').unwrap_or((line, ""));
            let Some(url) = web_url(address) else { continue };
            for pair in headers.split('&') {
                match pair.split_once('=') {
                    Some((k, v)) if k.eq_ignore_ascii_case("user-agent") => entry.user_agent = Some(clip(v, MAX_TEXT)),
                    Some((k, v)) if k.eq_ignore_ascii_case("referer") || k.eq_ignore_ascii_case("referrer") => entry.referrer = web_url(v),
                    _ => {}
                }
            }
            entry.catchup = catchup(&info_line, &url, defaults.as_ref());
            entry.url = url;
            let (old_name, old_group) = pending_before.take().unwrap_or_else(|| (entry.name.clone(), entry.group.clone()));
            let old_group = if entry.group.is_none() { group_before.clone() } else { old_group };
            if entry.group.is_none() {
                entry.group.clone_from(&group);
            }
            if (&old_name, &old_group) != (&entry.name, &entry.group) {
                entry.before_latin1 = Some((old_name, old_group));
            }
            if is_divider(&entry.name) {
                continue;
            }
            playlist.entries.push(entry);
            if playlist.entries.len() >= MAX_CHANNELS {
                break;
            }
        }
    }
    playlist
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let p = parse(std::io::Cursor::new(data));
    assert!(p.entries.len() <= MAX_CHANNELS);
    assert!(p.epg.len() <= super::MAX_GUIDES);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_guide_named_tvg_url() {
        let p = parse("#EXTM3U tvg-url=\"https://e.example/g.xml\"\n#EXTINF:-1,A\nhttp://s.example/1\n".as_bytes());
        assert_eq!(p.epg, ["https://e.example/g.xml"]);
        // `x-tvg-url` alone isn't taken for `tvg-url` and the other way round: each is a whole name.
        assert_eq!(parse("#EXTM3U x-tvg-url=\"https://x.example/g.xml\"\n".as_bytes()).epg, ["https://x.example/g.xml"]);
    }

    #[test]
    fn reads_entries_attributes_and_header() {
        let text = "#EXTM3U url-tvg=\"https://epg.example/guide.xml.gz,https://b.example/x.xml\"\n\
            #EXTINF:-1 tvg-id=\"news.one\" tvg-name=\"News One HD\" tvg-logo=\"https://logo.example/n1.png\" group-title=\"News, World\",News One\n\
            #EXTVLCOPT:http-user-agent=Custom/1.0\n\
            http://stream.example:8080/live/1.ts\n\
            #EXTINF:-1,═══ SPORTS ═══\n\
            http://stream.example/divider\n\
            #EXTGRP:Sports\n\
            #EXTINF:-1 tvg-logo=\"javascript:alert(1)\",Match TV\n\
            https://stream.example/2.m3u8|User-Agent=Kodi&Referer=https://ref.example/\n\
            #EXTINF:-1,Bad\n\
            file:///C:/Windows/win.ini\n";
        let p = parse(text.as_bytes());
        assert_eq!(p.epg, ["https://epg.example/guide.xml.gz", "https://b.example/x.xml"]);
        assert_eq!(p.entries.len(), 2);
        let a = &p.entries[0];
        assert_eq!((a.name.as_str(), a.tvg_id.as_deref(), a.group.as_deref()), ("News One", Some("news.one"), Some("News, World")));
        assert_eq!(a.logo.as_deref(), Some("https://logo.example/n1.png"));
        assert_eq!(a.user_agent.as_deref(), Some("Custom/1.0"));
        let b = &p.entries[1];
        assert_eq!((b.name.as_str(), b.group.as_deref(), b.logo.as_deref()), ("Match TV", Some("Sports"), None));
        assert_eq!(b.url, "https://stream.example/2.m3u8");
        assert_eq!((b.user_agent.as_deref(), b.referrer.as_deref()), (Some("Kodi"), Some("https://ref.example/")));
    }

    #[test]
    fn reads_catchup() {
        let text = "#EXTM3U catchup=\"shift\" catchup-days=\"3\"
            #EXTINF:-1,Header defaults
http://s.example/1.ts
            #EXTINF:-1 catchup=\"append\" catchup-source=\"?start={utc}&end={utcend}\" catchup-days=\"99\",Append
http://s.example/2.m3u8
            #EXTINF:-1 catchup=\"vod\",Unknown kind
http://s.example/3.ts
            #EXTINF:-1 catchup=\"default\",Template missing
http://s.example/4.ts
";
        let p = parse(text.as_bytes());
        assert_eq!(p.entries[0].catchup, Some(Catchup { kind: "shift", source: None, days: 3 }));
        assert_eq!(p.entries[1].catchup, Some(Catchup { kind: "append", source: Some("?start={utc}&end={utcend}".into()), days: MAX_ARCHIVE_DAYS }));
        assert_eq!((p.entries[2].catchup.as_ref(), p.entries[3].catchup.as_ref()), (None, None));

        let bare = parse("#EXTM3U
#EXTINF:-1 tvg-rec=\"2\",X
http://p.example/live/u/p/7.ts
#EXTINF:-1 timeshift=\"1\",Y
http://s.example/y.m3u8
#EXTINF:-1,Z
http://s.example/z
".as_bytes());
        assert_eq!(bare.entries[0].catchup, Some(Catchup { kind: "xc", source: None, days: 2 }));
        assert_eq!(bare.entries[1].catchup, Some(Catchup { kind: "shift", source: None, days: 1 }));
        assert_eq!(bare.entries[2].catchup, None);
    }

    #[test]
    fn names_keep_their_commas() {
        let p = parse("#EXTM3U\n#EXTINF:-1 tvg-id=\"n\" group-title=\"News, World\",News, Weather & Sport\nhttp://x.example/1\n#EXTINF:-1,Movies, Classic\nhttp://x.example/2\n#EXTINF:-1 tvg-name=\"a,b\",The \"Best\" Show, Live\nhttp://x.example/3\n".as_bytes());
        let names: Vec<&str> = p.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["News, Weather & Sport", "Movies, Classic", "The \"Best\" Show, Live"]);
    }

    #[test]
    fn falls_back_to_tvg_name_and_unquoted_values() {
        let p = parse("#EXTM3U\n#EXTINF:-1 tvg-id=abc tvg-name=\"Fallback\",\nhttp://x.example/1\n".as_bytes());
        assert_eq!(p.entries[0].name, "Fallback");
        assert_eq!(p.entries[0].tvg_id.as_deref(), Some("abc"));
    }

    #[test]
    fn byte_order_mark_keeps_the_header() {
        let p = parse("\u{feff}#EXTM3U url-tvg=\"https://e.example/g.xml\" catchup=\"shift\"\r\n#EXTINF:-1,A\r\nhttp://s.example/1\r\n".as_bytes());
        assert_eq!(p.entries.len(), 1);
        assert_eq!(p.epg, ["https://e.example/g.xml"]);
        assert_eq!(p.entries[0].catchup.as_ref().map(|c| c.kind), Some("shift"));
    }

    #[test]
    fn reads_crlf_and_latin1() {
        let mut bytes = b"#EXTM3U\r\n#EXTINF:-1 group-title=\"T\xe9l\xe9\",Cha\xeene\r\nhttp://s.example/1\r\n".to_vec();
        bytes.extend_from_slice(b"#EXTINF:-1,Cha\xeene\r\nhttp://s.example/2\r\n");
        let p = parse(&bytes[..]);
        assert_eq!(p.entries.len(), 2);
        assert_eq!(p.entries[0].url, "http://s.example/1");
        assert_eq!((p.entries[0].name.as_str(), p.entries[0].group.as_deref()), ("Chaîne", Some("Télé")));
        assert_eq!(p.entries[1].name, "Chaîne");
        // What older versions read, for carrying favourites over.
        assert_eq!(p.entries[0].before_latin1, Some(("Cha\u{fffd}ne".into(), Some("T\u{fffd}l\u{fffd}".into()))));
        assert_eq!(p.entries[1].before_latin1, Some(("Cha\u{fffd}ne".into(), None)));
        // A Latin-1 #EXTGRP group too; a UTF-8 entry has nothing to carry over.
        let p = parse(&b"#EXTM3U\n#EXTGRP:Fran\xe7ais\n#EXTINF:-1,Une\nhttp://s.example/1\n#EXTINF:-1,Deux\nhttp://s.example/2\n"[..]);
        assert_eq!(p.entries[0].group.as_deref(), Some("Français"));
        assert_eq!(p.entries[0].before_latin1, Some(("Une".into(), Some("Fran\u{fffd}ais".into()))));
        assert_eq!(parse("#EXTM3U\n#EXTINF:-1 group-title=\"Télé\",Chaîne\nhttp://s.example/1\n".as_bytes()).entries[0].before_latin1, None);
    }
}
