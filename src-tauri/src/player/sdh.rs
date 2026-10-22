//! Settings → Audio & Subtitles → Remove hearing-impaired text: strips the
//! parts of subtitles written for deaf and hard-of-hearing viewers (sound
//! descriptions like `[door creaks]` or `(MUSIC)`, `♪` music lines and
//! speaker labels like `JOHN:`) from SubRip, WebVTT and ASS files Orbit
//! hands to mpv itself. Lines left with nothing to read are dropped, cues
//! left empty are dropped, and timing is never touched. (Subtitles inside the
//! video use mpv's own `sub-filter-sdh`.)
//!
//! The files are untrusted: the size is capped by the caller, every scan is
//! bounded, and nothing is interpreted beyond the text. It errs on keeping
//! text: a label must be in capitals and not a common acronym ("FBI:"), round
//! brackets only go when they're in capitals or open the line, and a file
//! written all in capitals keeps its labels and capital brackets.

use crate::player::MAX_SUBTITLE_BYTES;

/// How far a `[` or `(` looks for its closing bracket (descriptions are short).
const MAX_ENCLOSED: usize = 200;
/// How far an ASS `{…}` or SubRip `<…>` tag may run before it counts as text.
const MAX_TAG: usize = 200;
/// Capitals followed by a colon that start real dialogue far more often than they name a speaker.
pub(super) const ACRONYMS: &[&str] = &[
    "ABC", "AM", "ATF", "BBC", "CBS", "CEO", "CIA", "CNN", "CSI", "DEA", "DNA", "EMT", "ER", "ESPN", "EU", "FAQ", "FBI", "GPS", "HBO", "HQ", "ICU", "ID", "IRS", "KGB", "LAPD", "MI6", "NASA", "NATO", "NB", "NBC", "NSA", "NYPD",
    "OK", "PIN", "PM", "PS", "RIP", "SOS", "SWAT", "TV", "UK", "UN", "URL", "US", "USA", "VIP",
];

/// A copy of subtitle file `raw` without hearing-impaired text, or None when
/// it isn't SubRip, WebVTT or ASS (then it's used as it is). `keep_lyrics`
/// keeps sung lines (`♪ words ♪`) and only drops bare music notes.
pub fn strip(raw: &[u8], keep_lyrics: bool) -> Option<Vec<u8>> {
    if raw.is_empty() || raw.len() > MAX_SUBTITLE_BYTES {
        return None;
    }
    let (text, encoding) = decode(raw);
    let body = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let format = if body.starts_with("WEBVTT") {
        Format::Text
    } else if body.contains("[Events]") || body.lines().any(|l| starts_with_ignore_case(l, "Dialogue:")) {
        Format::Ass
    } else if body.contains("-->") {
        Format::Text
    } else {
        return None;
    };
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let options = Options { keep_lyrics, all_caps: mostly_capitals(&text), html: format == Format::Text };
    let out = match format {
        Format::Text => strip_blocks(&text, newline, options),
        Format::Ass => strip_ass(&text, newline, options),
    };
    Some(encode(&out, encoding))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    /// SubRip or WebVTT: blank-line separated cues with a `-->` timing line.
    Text,
    Ass,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Encoding {
    Utf8,
    /// UTF-16 with a byte order mark; written back as UTF-8 with one (mpv reads either).
    Utf16,
    /// Anything else, one byte per character (Windows-1252 and the like), kept byte for byte.
    Bytes,
}

#[derive(Clone, Copy)]
struct Options {
    keep_lyrics: bool,
    /// The whole file is in capitals: capitals mark nothing, so labels and capital brackets stay.
    all_caps: bool,
    /// SubRip/WebVTT `<i>`-style tags (in ASS, `<` is plain text).
    html: bool,
}

pub(super) fn decode(raw: &[u8]) -> (String, Encoding) {
    let little = match raw {
        [0xff, 0xfe, ..] => Some(true),
        [0xfe, 0xff, ..] => Some(false),
        _ => None,
    };
    if let Some(little) = little {
        let units = raw[2..].as_chunks::<2>().0.iter().map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) });
        let text: String = char::decode_utf16(units).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)).collect();
        return (format!("\u{feff}{text}"), Encoding::Utf16);
    }
    match std::str::from_utf8(raw) {
        Ok(text) => (text.to_string(), Encoding::Utf8),
        // Each byte as the character with that number, so writing it back is exact.
        Err(_) => (raw.iter().map(|&b| char::from(b)).collect(), Encoding::Bytes),
    }
}

pub(super) fn encode(text: &str, encoding: Encoding) -> Vec<u8> {
    match encoding {
        Encoding::Utf8 | Encoding::Utf16 => text.as_bytes().to_vec(),
        // Only characters from the input (all below 256) and ASCII are ever written.
        Encoding::Bytes => text.chars().map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?')).collect(),
    }
}

pub(super) fn starts_with_ignore_case(line: &str, prefix: &str) -> bool {
    line.len() >= prefix.len() && line.is_char_boundary(prefix.len()) && line[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Fewer than one letter in ten is lower case (some old subtitles are all capitals).
fn mostly_capitals(text: &str) -> bool {
    let (mut letters, mut lower) = (0usize, 0usize);
    for c in text.chars().filter(|c| c.is_alphabetic()) {
        letters += 1;
        lower += usize::from(c.is_lowercase());
    }
    letters > 0 && lower * 10 < letters
}

/// SubRip and WebVTT: each block with a `-->` line is a cue; others (the
/// WEBVTT header, NOTE and STYLE blocks) stay as they are.
fn strip_blocks(text: &str, newline: &str, options: Options) -> String {
    let lines: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let mut blocks: Vec<Vec<String>> = Vec::new();
    let mut block: Vec<&str> = Vec::new();
    let flush = |block: &mut Vec<&str>, blocks: &mut Vec<Vec<String>>| {
        if block.is_empty() {
            return;
        }
        match block.iter().position(|l| l.contains("-->")) {
            None => blocks.push(block.iter().map(|l| (*l).to_string()).collect()),
            Some(timing) => {
                let cue = clean_cue(&block[timing + 1..], options);
                if let Some(cue) = cue {
                    blocks.push(block[..=timing].iter().map(|l| (*l).to_string()).chain(cue).collect());
                } else if timing + 1 == block.len() {
                    // Already empty: kept as it was.
                    blocks.push(block.iter().map(|l| (*l).to_string()).collect());
                }
            }
        }
        block.clear();
    };
    for line in &lines {
        if line.trim().is_empty() {
            flush(&mut block, &mut blocks);
        } else {
            block.push(line);
        }
    }
    flush(&mut block, &mut blocks);
    let mut out = blocks.iter().map(|b| b.join(newline)).collect::<Vec<_>>().join(&format!("{newline}{newline}"));
    out.push_str(newline);
    out
}

/// ASS/SSA: only `Dialogue:` lines' text (the column the `Format:` line names
/// Text, usually the last) changes; drawings (`{\p1}`) are left alone.
fn strip_ass(text: &str, newline: &str, options: Options) -> String {
    let mut text_column = 9;
    let mut out: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let (line, cr) = line.strip_suffix('\r').map_or((line, ""), |l| (l, "\r"));
        if starts_with_ignore_case(line, "Format:")
            && let Some(i) = line[7..].split(',').position(|n| n.trim().eq_ignore_ascii_case("text"))
        {
            text_column = i;
        }
        if !starts_with_ignore_case(line, "Dialogue:") {
            out.push(format!("{line}{cr}"));
            continue;
        }
        let Some(start) = line.char_indices().skip(9).filter(|&(_, c)| c == ',').nth(text_column.saturating_sub(1)).map(|(i, _)| i + 1) else {
            out.push(format!("{line}{cr}"));
            continue;
        };
        let (head, body) = line.split_at(start);
        if is_drawing(body) {
            out.push(format!("{line}{cr}"));
            continue;
        }
        let parts: Vec<&str> = split_ass_breaks(body);
        match clean_cue(&parts, options) {
            Some(lines) => {
                let changed = lines.len() != parts.len() || lines.iter().zip(&parts).any(|(a, b)| a != b);
                let body = if changed { lines.join("\\N") } else { body.to_string() };
                out.push(format!("{head}{body}{cr}"));
            }
            None if body.trim().is_empty() => out.push(format!("{line}{cr}")),
            None => {}
        }
    }
    let joined = out.join("\n");
    // `\r` was kept per line; only the line breaks between them were "\n".
    if newline == "\r\n" { joined } else { joined.replace('\r', "") }
}

/// `{\p1}` and up switch ASS into drawing mode: the "text" is shapes.
fn is_drawing(body: &str) -> bool {
    let bytes = body.as_bytes();
    let mut in_tag = false;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'{' => in_tag = true,
            b'}' => in_tag = false,
            b'\\' if in_tag && bytes.get(i + 1) == Some(&b'p') && bytes.get(i + 2).is_some_and(|d| (b'1'..=b'9').contains(d)) => return true,
            _ => {}
        }
    }
    false
}

/// ASS lines are broken with `\N` (hard) or `\n` (soft).
fn split_ass_breaks(body: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut from = 0;
    let bytes = body.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && (bytes[i + 1] == b'N' || bytes[i + 1] == b'n') {
            parts.push(&body[from..i]);
            from = i + 2;
            i += 2;
        } else {
            i += 1;
        }
    }
    parts.push(&body[from..]);
    parts
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    /// Styling (`{\i1}`, `<i>`): never removed, so styles stay balanced.
    Tag(String),
    Ch(char),
    Break,
}

fn tokenize(lines: &[&str], html: bool) -> Vec<Tok> {
    let mut toks = Vec::new();
    for (n, line) in lines.iter().enumerate() {
        if n > 0 {
            toks.push(Tok::Break);
        }
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let close = match chars[i] {
                '{' => Some('}'),
                '<' if html && chars.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic() || *c == '/') => Some('>'),
                _ => None,
            };
            let end = close.and_then(|close| chars[i + 1..].iter().take(MAX_TAG).position(|&c| c == close || (close == '>' && c == '<')).filter(|&p| chars[i + 1 + p] == close).map(|p| i + 1 + p));
            if let Some(end) = end {
                toks.push(Tok::Tag(chars[i..=end].iter().collect()));
                i = end + 1;
            } else {
                toks.push(Tok::Ch(chars[i]));
                i += 1;
            }
        }
    }
    toks
}

const fn is_note(c: char) -> bool {
    matches!(c, '♪' | '♫' | '♬' | '♩')
}

/// One cue's lines without hearing-impaired text; None if nothing is left.
fn clean_cue(lines: &[&str], options: Options) -> Option<Vec<String>> {
    let mut toks: Vec<Option<Tok>> = tokenize(lines, options.html).into_iter().map(Some).collect();
    remove_enclosed(&mut toks, options);

    // Back into lines, noting which ones lost something.
    let mut rows: Vec<(Vec<Tok>, bool)> = vec![(Vec::new(), false)];
    for tok in toks {
        match tok {
            Some(Tok::Break) => rows.push((Vec::new(), false)),
            Some(tok) => rows.last_mut().expect("one row").0.push(tok),
            None => rows.last_mut().expect("one row").1 = true,
        }
    }

    let had = rows.len();
    let mut kept: Vec<Vec<Tok>> = Vec::new();
    // Tags of dropped lines carry over to the next line kept (e.g. an `{\an8}` position).
    let mut carried: Vec<Tok> = Vec::new();
    for (mut row, mut changed) in rows {
        let visible: String = row.iter().filter_map(|t| if let Tok::Ch(c) = t { Some(*c) } else { None }).collect();
        if is_music(&visible) {
            let words = visible.chars().any(|c| c.is_alphanumeric());
            if !options.keep_lyrics || !words {
                carried.extend(row.into_iter().filter(|t| matches!(t, Tok::Tag(_))));
                continue;
            }
        }
        if !options.all_caps && remove_label(&mut row) {
            changed = true;
        }
        if changed {
            tidy(&mut row);
            if !row.iter().any(|t| matches!(t, Tok::Ch(c) if c.is_alphanumeric() || is_note(*c))) {
                carried.extend(row.into_iter().filter(|t| matches!(t, Tok::Tag(_))));
                continue;
            }
        }
        let mut line = std::mem::take(&mut carried);
        line.extend(row);
        kept.push(line);
    }
    if kept.is_empty() {
        return None;
    }
    if let Some(last) = kept.last_mut() {
        last.append(&mut carried);
    }
    // A single speaker left from a two-speaker cue doesn't need the dialogue dash.
    if had > 1 && kept.len() == 1 {
        drop_dash(&mut kept[0]);
    }
    Some(kept.iter().map(|row| row.iter().map(|t| if let Tok::Tag(s) = t { s.clone() } else if let Tok::Ch(c) = t { c.to_string() } else { String::new() }).collect()).collect())
}

/// A line of music: starts or ends with a note, or is wrapped in `#`.
fn is_music(visible: &str) -> bool {
    let v = visible.trim();
    v.starts_with(is_note) || v.ends_with(is_note) || (v.len() > 1 && v.starts_with('#') && v.ends_with('#'))
}

/// Removes `[…]` (always: brackets aren't used in dialogue) and `(…)` when
/// in capitals or opening its line, across the cue's lines. Tags inside stay.
fn remove_enclosed(toks: &mut [Option<Tok>], options: Options) {
    for (open, close) in [('[', ']'), ('(', ')')] {
        let mut i = 0;
        while i < toks.len() {
            if toks[i] != Some(Tok::Ch(open)) {
                i += 1;
                continue;
            }
            let end = toks[i + 1..].iter().take(MAX_ENCLOSED).position(|t| matches!(t, Some(Tok::Ch(c)) if *c == close || *c == open)).map(|p| i + 1 + p);
            let Some(end) = end.filter(|&e| toks[e] == Some(Tok::Ch(close))) else {
                i += 1;
                continue;
            };
            let inside = toks[i + 1..end].iter().filter_map(|t| if let Some(Tok::Ch(c)) = t { Some(*c) } else { None });
            let (letters, lower) = inside.fold((0, false), |(n, low), c| (n + usize::from(c.is_alphabetic()), low || c.is_lowercase()));
            let remove = open == '[' || (!options.all_caps && letters >= 2 && !lower) || opens_line(toks, i);
            if remove {
                for t in &mut toks[i..=end] {
                    if matches!(t, Some(Tok::Ch(_))) {
                        *t = None;
                    }
                }
            }
            i = end + 1;
        }
    }
}

/// Nothing but spaces, a dialogue dash or tags before `at` on its line.
fn opens_line(toks: &[Option<Tok>], at: usize) -> bool {
    toks[..at].iter().rev().take_while(|t| *t != &Some(Tok::Break)).all(|t| match t {
        Some(Tok::Ch(c)) => c.is_whitespace() || *c == '-' || *c == '–',
        _ => true,
    })
}

/// Removes a speaker label (`JOHN:`, `- MAN 2:`, `MRS. O'NEIL:`) at the start of the line.
fn remove_label(row: &mut Vec<Tok>) -> bool {
    let chars: Vec<(usize, char)> = row.iter().enumerate().filter_map(|(i, t)| if let Tok::Ch(c) = t { Some((i, *c)) } else { None }).collect();
    let mut k = 0;
    while k < chars.len() && (chars[k].1.is_whitespace() || chars[k].1 == '-' || chars[k].1 == '–') {
        k += 1;
    }
    let start = k;
    while k < chars.len() && k - start <= 30 {
        let c = chars[k].1;
        if c == ':' || !(c.is_uppercase() || c.is_ascii_digit() || c.is_whitespace() || matches!(c, '.' | '\'' | '’' | '-' | '&' | '#')) {
            break;
        }
        k += 1;
    }
    if k >= chars.len() || chars[k].1 != ':' || !chars.get(start).is_some_and(|(_, c)| c.is_uppercase()) {
        return false;
    }
    // A label is followed by a space (or ends the line), unlike "10:30" or "http:".
    if chars.get(k + 1).is_some_and(|(_, c)| !c.is_whitespace()) {
        return false;
    }
    let label: String = chars[start..k].iter().map(|(_, c)| *c).collect();
    let label = label.trim();
    if label.chars().filter(|c| c.is_alphabetic()).count() < 2 || ACRONYMS.contains(&label) {
        return false;
    }
    let mut end = k + 1;
    while end < chars.len() && chars[end].1.is_whitespace() {
        end += 1;
    }
    let remove: Vec<usize> = chars[start..end].iter().map(|(i, _)| *i).collect();
    let mut n = 0;
    row.retain(|_| {
        n += 1;
        !remove.contains(&(n - 1))
    });
    true
}

/// Single spaces, none at either end, none before closing punctuation.
fn tidy(row: &mut Vec<Tok>) {
    let mut out: Vec<Tok> = Vec::with_capacity(row.len());
    let mut last: Option<char> = None;
    for tok in row.drain(..) {
        if let Tok::Ch(c) = tok {
            if c.is_whitespace() && last.is_none_or(char::is_whitespace) {
                continue;
            }
            if matches!(c, ',' | '.' | '!' | '?' | ';')
                && last.is_some_and(char::is_whitespace)
                && let Some(i) = out.iter().rposition(|t| matches!(t, Tok::Ch(_)))
            {
                out.remove(i);
            }
            last = Some(c);
        }
        out.push(tok);
    }
    while let Some(i) = out.iter().rposition(|t| matches!(t, Tok::Ch(_))) {
        if !matches!(out[i], Tok::Ch(c) if c.is_whitespace()) {
            break;
        }
        out.remove(i);
    }
    *row = out;
}

/// `- Fine.` → `Fine.`
fn drop_dash(row: &mut Vec<Tok>) {
    let Some(i) = row.iter().position(|t| matches!(t, Tok::Ch(_))) else { return };
    if !matches!(row[i], Tok::Ch('-' | '–')) {
        return;
    }
    row.remove(i);
    while let Some(j) = row.iter().position(|t| matches!(t, Tok::Ch(_))) {
        if !matches!(row[j], Tok::Ch(c) if c.is_whitespace()) {
            break;
        }
        row.remove(j);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn srt(text: &str, keep_lyrics: bool) -> String {
        String::from_utf8(strip(text.as_bytes(), keep_lyrics).unwrap()).unwrap()
    }

    /// The text lines of each cue, for short assertions.
    fn cues(text: &str) -> Vec<String> {
        text.split("\n\n").filter(|b| b.contains("-->")).map(|b| b.lines().skip(2).collect::<Vec<_>>().join("|")).collect()
    }

    fn one(line: &str) -> Vec<String> {
        cues(&srt(&format!("1\n00:00:01,000 --> 00:00:02,000\n{line}\n"), false))
    }

    #[test]
    fn removes_sound_descriptions() {
        assert_eq!(one("[door creaks]"), Vec::<String>::new());
        assert_eq!(one("(MUSIC)"), Vec::<String>::new());
        assert_eq!(one("(sighs) Fine."), vec!["Fine."]);
        assert_eq!(one("Wait [gunshot] what was that?"), vec!["Wait what was that?"]);
        assert_eq!(one("I'm fine [laughs]."), vec!["I'm fine."]);
        assert_eq!(one("He's here (WHISPERS) now"), vec!["He's here now"]);
        // Lower-case brackets mid-line are an aside, not a sound.
        assert_eq!(one("I was (sort of) right"), vec!["I was (sort of) right"]);
        assert_eq!(one("No closing [bracket here"), vec!["No closing [bracket here"]);
    }

    #[test]
    fn descriptions_may_span_lines() {
        assert_eq!(one("[man shouting\nin the distance]\nRun!"), vec!["Run!"]);
    }

    #[test]
    fn removes_speaker_labels_but_not_acronyms_or_times() {
        assert_eq!(one("JOHN: Get down!"), vec!["Get down!"]);
        assert_eq!(one("- MAN: Hey.\n- WOMAN 2: Hi."), vec!["- Hey.|- Hi."]);
        assert_eq!(one("MRS. O'NEIL: Tea?"), vec!["Tea?"]);
        assert_eq!(one("MAN (ON PHONE): Hello?"), vec!["Hello?"]);
        assert_eq!(one("FBI: Open up!"), vec!["FBI: Open up!"]);
        assert_eq!(one("OK: let's go"), vec!["OK: let's go"]);
        assert_eq!(one("Meet at 10:30 sharp"), vec!["Meet at 10:30 sharp"]);
        assert_eq!(one("Note: mixed case stays"), vec!["Note: mixed case stays"]);
        assert_eq!(one("I: one letter"), vec!["I: one letter"]);
        assert_eq!(one("JOHN:\nGet down!"), vec!["Get down!"]);
    }

    #[test]
    fn all_capitals_files_keep_labels() {
        let text = "1\n00:00:01,000 --> 00:00:02,000\nJOHN: GET DOWN! (QUIET)\n\n2\n00:00:03,000 --> 00:00:04,000\n[DOOR SLAMS] WHO IS IT?\n";
        assert_eq!(cues(&srt(text, false)), vec!["JOHN: GET DOWN! (QUIET)", "WHO IS IT?"]);
    }

    #[test]
    fn music_lines_and_lyrics() {
        let text = "1\n00:00:01,000 --> 00:00:02,000\n♪ ♪\n\n2\n00:00:03,000 --> 00:00:04,000\n♪ Hello darkness, my old friend ♪\n\n3\n00:00:05,000 --> 00:00:06,000\n♪ [upbeat music playing] ♪\n\n4\n00:00:07,000 --> 00:00:08,000\n# Happy birthday #\nThanks!\n";
        assert_eq!(cues(&srt(text, true)), vec!["♪ Hello darkness, my old friend ♪", "# Happy birthday #|Thanks!"]);
        // Without lyrics, sung lines go too; the spoken line in the same cue stays.
        assert_eq!(cues(&srt(text, false)), vec!["Thanks!"]);
    }

    #[test]
    fn keeps_timing_numbers_and_tags() {
        let text = "1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>[thunder]</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,500\r\n<i>JOHN: Run!</i>\r\n\r\n3\r\n00:00:05,000 --> 00:00:06,000\r\nUntouched line\r\n";
        let out = srt(text, false);
        assert_eq!(out, "2\r\n00:00:03,000 --> 00:00:04,500\r\n<i>Run!</i>\r\n\r\n3\r\n00:00:05,000 --> 00:00:06,000\r\nUntouched line\r\n");
    }

    #[test]
    fn dialogue_dash_goes_when_one_speaker_is_left() {
        assert_eq!(one("- [gasps]\n- What?"), vec!["What?"]);
        assert_eq!(one("- Hi.\n- Hello."), vec!["- Hi.|- Hello."]);
    }

    #[test]
    fn webvtt_keeps_header_and_notes() {
        let vtt = "WEBVTT\n\nNOTE made by hand\n\ncue-1\n00:01.000 --> 00:02.000 align:start\n(APPLAUSE)\n\n00:03.000 --> 00:04.000\nThank you.\n";
        assert_eq!(srt(vtt, false), "WEBVTT\n\nNOTE made by hand\n\n00:03.000 --> 00:04.000\nThank you.\n");
    }

    #[test]
    fn ass_dialogue_only_and_positions_kept() {
        let ass = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}[siren wailing]\\NJOHN: Go, now!\nDialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,(EXPLOSION)\nDialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 0 [x]\nComment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,[note]\nDialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,Plain, with commas\n";
        let out = String::from_utf8(strip(ass.as_bytes(), false).unwrap()).unwrap();
        assert!(out.contains("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}Go, now!\n"), "{out}");
        assert!(!out.contains("EXPLOSION"), "{out}");
        assert!(out.contains("{\\p1}m 0 0 l 10 0 [x]"), "{out}");
        assert!(out.contains("Comment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,[note]"), "{out}");
        assert!(out.contains("Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,Plain, with commas\n"), "{out}");
    }

    #[test]
    fn other_encodings_stay_byte_for_byte() {
        // Windows-1252 "café" and an SDH line.
        let mut raw = b"1\n00:00:01,000 --> 00:00:02,000\n[music]\ncaf".to_vec();
        raw.push(0xe9);
        raw.extend_from_slice(b"!\n");
        let out = strip(&raw, false).unwrap();
        assert_eq!(out, [b"1\n00:00:01,000 --> 00:00:02,000\ncaf".as_slice(), &[0xe9], b"!\n"].concat());
    }

    #[test]
    fn utf16_becomes_utf8() {
        let text = "1\n00:00:01,000 --> 00:00:02,000\nÜBER: Hallo\n";
        let mut raw = vec![0xff, 0xfe];
        raw.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        let out = String::from_utf8(strip(&raw, false).unwrap()).unwrap();
        assert_eq!(out, "\u{feff}1\n00:00:01,000 --> 00:00:02,000\nHallo\n");
    }

    #[test]
    fn unsupported_or_oversized_is_left_alone() {
        assert_eq!(strip(b"{0}{25}Hello\n", false), None);
        assert_eq!(strip(b"", false), None);
        assert_eq!(strip(&vec![b'a'; MAX_SUBTITLE_BYTES + 1], false), None);
    }

    #[test]
    fn bounded_on_hostile_input() {
        // Many unclosed brackets and tags: still linear enough to finish quickly.
        let line = "[(".repeat(20_000) + &"{<i".repeat(20_000);
        let text = format!("1\n00:00:01,000 --> 00:00:02,000\n{line}\n");
        assert!(strip(text.as_bytes(), false).is_some());
    }
}
