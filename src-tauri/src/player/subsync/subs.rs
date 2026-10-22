//! Reads the timing of a subtitle file (SubRip, WebVTT, ASS/SSA) and writes a
//! re-timed copy. Subtitle files come from addons or the user, so they're
//! untrusted: sizes and counts are capped, and nothing but the timestamps is
//! interpreted. The text is never decoded: timestamps are plain ASCII, so the
//! bytes around them are copied as they are, whatever the file's encoding
//! (mpv detects that itself when it loads the copy). Only UTF-16, where ASCII
//! isn't one byte per character, is converted to UTF-8 first.

use crate::player::MAX_SUBTITLE_BYTES;

/// More lines than any real film or episode has; beyond it a file is rejected.
pub const MAX_CUES: usize = 30_000;
/// 100 hours, in milliseconds: later timestamps aren't real ones.
const MAX_TIME_MS: i64 = 100 * 3600 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Srt,
    Vtt,
    Ass,
}

/// One timestamp in the file: where it is, and its value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    from: usize,
    to: usize,
    ms: i64,
}

/// One line of dialogue: its start and end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Cue {
    start: Stamp,
    end: Stamp,
}

#[derive(Debug)]
pub struct Subtitle {
    format: Format,
    bytes: Vec<u8>,
    cues: Vec<Cue>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    TooLarge,
    /// Not SubRip, WebVTT or ASS (e.g. MicroDVD's frame-numbered `.sub`), or no timed lines at all.
    Unsupported,
    TooManyLines,
}

impl Subtitle {
    pub fn parse(raw: &[u8]) -> Result<Self, ParseError> {
        if raw.is_empty() || raw.len() > MAX_SUBTITLE_BYTES {
            return Err(ParseError::TooLarge);
        }
        let bytes = from_utf16(raw).unwrap_or_else(|| raw.to_vec());
        let format = detect(&bytes);
        let cues = match format {
            Format::Ass => ass_cues(&bytes)?,
            Format::Srt | Format::Vtt => arrow_cues(&bytes)?,
        };
        if cues.is_empty() {
            return Err(ParseError::Unsupported);
        }
        Ok(Self { format, bytes, cues })
    }

    /// Each line's (start, end) in milliseconds, in file order.
    pub fn spans(&self) -> Vec<(i64, i64)> {
        self.cues.iter().map(|c| (c.start.ms, c.end.ms)).collect()
    }

    /// A copy with each line's times changed by `retime(start, end)` (one call per line, in file order).
    pub fn retimed(&self, mut retime: impl FnMut(usize, i64, i64) -> (i64, i64)) -> Vec<u8> {
        let mut stamps: Vec<(Stamp, i64)> = Vec::with_capacity(self.cues.len() * 2);
        for (i, cue) in self.cues.iter().enumerate() {
            let (start, end) = retime(i, cue.start.ms, cue.end.ms);
            let start = start.clamp(0, MAX_TIME_MS);
            stamps.push((cue.start, start));
            stamps.push((cue.end, end.clamp(start, MAX_TIME_MS)));
        }
        stamps.sort_by_key(|(s, _)| s.from);
        let mut out = Vec::with_capacity(self.bytes.len() + stamps.len() * 2);
        let mut at = 0;
        for (stamp, ms) in stamps {
            out.extend_from_slice(&self.bytes[at..stamp.from]);
            out.extend_from_slice(format_time(self.format, ms).as_bytes());
            at = stamp.to;
        }
        out.extend_from_slice(&self.bytes[at..]);
        out
    }
}

/// UTF-16 (with a byte order mark) as UTF-8 with one, so mpv still reads it as Unicode.
fn from_utf16(raw: &[u8]) -> Option<Vec<u8>> {
    let little = match raw {
        [0xff, 0xfe, ..] => true,
        [0xfe, 0xff, ..] => false,
        _ => return None,
    };
    let units = raw[2..].as_chunks::<2>().0.iter().map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) });
    let text: String = char::decode_utf16(units).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)).collect();
    let mut out = vec![0xef, 0xbb, 0xbf];
    out.extend_from_slice(text.as_bytes());
    Some(out)
}

fn detect(bytes: &[u8]) -> Format {
    let body = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    let head = &body[..body.len().min(4096)];
    if body.starts_with(b"WEBVTT") {
        Format::Vtt
    } else if contains(head, b"[Script Info]") || contains(head, b"[Events]") || lines(bytes).any(|(_, l)| starts_with_ignore_case(l, b"Dialogue:")) {
        Format::Ass
    } else {
        Format::Srt
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn starts_with_ignore_case(line: &[u8], prefix: &[u8]) -> bool {
    line.len() >= prefix.len() && line[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Lines with their starting offsets, without the line break.
fn lines(bytes: &[u8]) -> impl Iterator<Item = (usize, &[u8])> {
    let mut at = 0;
    std::iter::from_fn(move || {
        if at >= bytes.len() {
            return None;
        }
        let start = at;
        let end = bytes[at..].iter().position(|&b| b == b'\n').map_or(bytes.len(), |n| at + n);
        at = end + 1;
        let line = &bytes[start..end];
        Some((start, line.strip_suffix(b"\r").unwrap_or(line)))
    })
}

/// SubRip and WebVTT: `00:01:02,500 --> 00:01:04,000` (WebVTT: `.` and optional hours, then settings).
fn arrow_cues(bytes: &[u8]) -> Result<Vec<Cue>, ParseError> {
    let mut cues = Vec::new();
    for (offset, line) in lines(bytes) {
        let Some(arrow) = line.windows(3).position(|w| w == b"-->") else { continue };
        let Some(start) = stamp_in(line, offset, 0, arrow) else { continue };
        let after = arrow + 3;
        let skip = line[after..].iter().take_while(|b| b.is_ascii_whitespace()).count();
        let len = line[after + skip..].iter().take_while(|b| !b.is_ascii_whitespace()).count();
        let Some(end) = stamp_in(line, offset, after + skip, after + skip + len) else { continue };
        if cues.len() == MAX_CUES {
            return Err(ParseError::TooManyLines);
        }
        cues.push(Cue { start, end });
    }
    Ok(cues)
}

/// The timestamp in `line[from..to]`, ignoring spaces around it.
fn stamp_in(line: &[u8], offset: usize, from: usize, to: usize) -> Option<Stamp> {
    let lead = line[from..to].iter().take_while(|b| b.is_ascii_whitespace()).count();
    let trail = line[from..to].iter().rev().take_while(|b| b.is_ascii_whitespace()).count();
    let (from, to) = (from + lead, to.checked_sub(trail)?);
    let ms = parse_time(line.get(from..to)?)?;
    Some(Stamp { from: offset + from, to: offset + to, ms })
}

/// ASS/SSA: `Dialogue: 0,0:01:02.50,0:01:04.00,Style,...`, with the column
/// order from the `[Events]` section's `Format:` line (Start and End are
/// usually the second and third).
fn ass_cues(bytes: &[u8]) -> Result<Vec<Cue>, ParseError> {
    let (mut start_col, mut end_col) = (1, 2);
    let mut cues = Vec::new();
    for (offset, line) in lines(bytes) {
        if starts_with_ignore_case(line, b"Format:") {
            let names: Vec<Vec<u8>> = line[7..].split(|&b| b == b',').map(|n| n.trim_ascii().to_ascii_lowercase()).collect();
            if let (Some(s), Some(e)) = (names.iter().position(|n| n == b"start"), names.iter().position(|n| n == b"end")) {
                (start_col, end_col) = (s, e);
            }
            continue;
        }
        if !starts_with_ignore_case(line, b"Dialogue:") {
            continue;
        }
        // Column bounds (only up to the last one needed: the text may contain commas).
        let wanted = start_col.max(end_col);
        let mut bounds = Vec::with_capacity(wanted + 1);
        let mut from = 9;
        for (i, &b) in line.iter().enumerate().skip(9) {
            if bounds.len() > wanted {
                break;
            }
            if b == b',' {
                bounds.push((from, i));
                from = i + 1;
            }
        }
        let (Some(&(s0, s1)), Some(&(e0, e1))) = (bounds.get(start_col), bounds.get(end_col)) else { continue };
        let (Some(start), Some(end)) = (stamp_in(line, offset, s0, s1), stamp_in(line, offset, e0, e1)) else { continue };
        if cues.len() == MAX_CUES {
            return Err(ParseError::TooManyLines);
        }
        cues.push(Cue { start, end });
    }
    Ok(cues)
}

/// `[[H:]M]M:SS[.,]fff`, as milliseconds. Fractions of any length up to 3 digits (ASS has 2).
fn parse_time(text: &[u8]) -> Option<i64> {
    if text.is_empty() || text.len() > 16 {
        return None;
    }
    let (clock, fraction) = match text.iter().rposition(|&b| b == b'.' || b == b',') {
        Some(i) => (&text[..i], &text[i + 1..]),
        None => (text, &b""[..]),
    };
    if fraction.len() > 3 || !fraction.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let parts: Vec<&[u8]> = clock.split(|&b| b == b':').collect();
    if !(2..=3).contains(&parts.len()) || parts.iter().any(|p| p.is_empty() || p.len() > 3 || !p.iter().all(u8::is_ascii_digit)) {
        return None;
    }
    let number = |p: &[u8]| p.iter().fold(0i64, |n, d| n * 10 + i64::from(d - b'0'));
    let (h, m, s) = match parts.as_slice() {
        [h, m, s] => (number(h), number(m), number(s)),
        [m, s] => (0, number(m), number(s)),
        _ => return None,
    };
    if m >= 60 || s >= 60 {
        return None;
    }
    let mut frac = number(fraction);
    for _ in fraction.len()..3 {
        frac *= 10;
    }
    let ms = ((h * 60 + m) * 60 + s) * 1000 + frac;
    (ms <= MAX_TIME_MS).then_some(ms)
}

fn format_time(format: Format, ms: i64) -> String {
    let (h, m, s, f) = (ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
    match format {
        Format::Srt => format!("{h:02}:{m:02}:{s:02},{f:03}"),
        Format::Vtt => format!("{h:02}:{m:02}:{s:02}.{f:03}"),
        // Centiseconds, rounded down (ASS has no finer unit).
        Format::Ass => format!("{h}:{m:02}:{s:02}.{:02}", f / 10),
    }
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    if let Ok(subs) = Subtitle::parse(data) {
        assert!(subs.spans().len() <= MAX_CUES);
        let out = subs.retimed(|_, s, e| (s, e));
        assert!(Subtitle::parse(&out).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello, there\r\n\r\n2\r\n00:01:00,250 --> 00:01:03,000 X1:10\r\n<i>Second</i>\r\n";

    #[test]
    fn reads_and_shifts_subrip() {
        let sub = Subtitle::parse(SRT.as_bytes()).unwrap();
        assert_eq!(sub.format, Format::Srt);
        assert_eq!(sub.spans(), vec![(1000, 2500), (60_250, 63_000)]);
        let out = String::from_utf8(sub.retimed(|_, s, e| (s + 1400, e + 1400))).unwrap();
        assert_eq!(out, SRT.replace("00:00:01,000 --> 00:00:02,500", "00:00:02,400 --> 00:00:03,900").replace("00:01:00,250 --> 00:01:03,000", "00:01:01,650 --> 00:01:04,400"));
    }

    #[test]
    fn negative_times_stop_at_zero() {
        let sub = Subtitle::parse(SRT.as_bytes()).unwrap();
        let out = String::from_utf8(sub.retimed(|_, s, e| (s - 2000, e - 2000))).unwrap();
        assert!(out.contains("00:00:00,000 --> 00:00:00,500"), "{out}");
    }

    #[test]
    fn reads_webvtt_with_short_times_and_settings() {
        let vtt = "WEBVTT\n\n01:02.500 --> 01:04.000 align:start\nHi\n\n1:00:00.000 --> 1:00:01.000\nBye\n";
        let sub = Subtitle::parse(vtt.as_bytes()).unwrap();
        assert_eq!(sub.format, Format::Vtt);
        assert_eq!(sub.spans(), vec![(62_500, 64_000), (3_600_000, 3_601_000)]);
        let out = String::from_utf8(sub.retimed(|_, s, e| (s + 500, e + 500))).unwrap();
        assert!(out.contains("00:01:03.000 --> 00:01:04.500 align:start"), "{out}");
    }

    #[test]
    fn reads_ass_with_its_own_column_order_and_keeps_styling() {
        let ass = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:05.20,0:00:07.00,Default,{\\i1}Hi, you{\\i0}\nComment: 0,0:00:09.00,0:00:10.00,Default,note\n";
        let sub = Subtitle::parse(ass.as_bytes()).unwrap();
        assert_eq!(sub.format, Format::Ass);
        assert_eq!(sub.spans(), vec![(5200, 7000)]);
        let out = String::from_utf8(sub.retimed(|_, s, e| (s - 1000, e - 1000))).unwrap();
        assert!(out.contains("Dialogue: 0,0:00:04.20,0:00:06.00,Default,{\\i1}Hi, you{\\i0}"), "{out}");
        assert!(out.contains("Comment: 0,0:00:09.00"));

        let odd = "[Events]\nFormat: Layer, Style, Start, End, Text\nDialogue: 0,Default,0:00:01.00,0:00:02.00,Hi\n";
        assert_eq!(Subtitle::parse(odd.as_bytes()).unwrap().spans(), vec![(1000, 2000)]);
    }

    #[test]
    fn keeps_other_encodings_byte_for_byte() {
        // Windows-1252 "café" around the timestamps.
        let mut raw = b"1\n00:00:01,000 --> 00:00:02,000\ncaf".to_vec();
        raw.push(0xe9);
        raw.extend_from_slice(b"\n");
        let out = Subtitle::parse(&raw).unwrap().retimed(|_, s, e| (s + 1000, e + 1000));
        assert_eq!(&out[..], &[b"1\n00:00:02,000 --> 00:00:03,000\ncaf".as_slice(), &[0xe9, b'\n']].concat()[..]);
    }

    #[test]
    fn converts_utf16() {
        let text = "1\n00:00:01,000 --> 00:00:02,000\nÜber\n";
        let mut raw = vec![0xff, 0xfe];
        raw.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        let sub = Subtitle::parse(&raw).unwrap();
        assert_eq!(sub.spans(), vec![(1000, 2000)]);
        let out = sub.retimed(|_, s, e| (s, e));
        assert_eq!(&out[3..], text.as_bytes());
    }

    #[test]
    fn rejects_bad_input() {
        assert_eq!(Subtitle::parse(b"").unwrap_err(), ParseError::TooLarge);
        assert_eq!(Subtitle::parse(&vec![b'a'; MAX_SUBTITLE_BYTES + 1]).unwrap_err(), ParseError::TooLarge);
        // MicroDVD counts frames, not time.
        assert_eq!(Subtitle::parse(b"{0}{25}Hello\n{30}{60}World\n").unwrap_err(), ParseError::Unsupported);
        assert_eq!(Subtitle::parse(b"1\n00:00:61,000 --> 00:00:62,000\nx\n").unwrap_err(), ParseError::Unsupported);
        assert_eq!(Subtitle::parse(b"1\nnot --> times\n").unwrap_err(), ParseError::Unsupported);
        let many = "00:00:01,000 --> 00:00:02,000\nx\n\n".repeat(MAX_CUES + 1);
        assert_eq!(Subtitle::parse(many.as_bytes()).unwrap_err(), ParseError::TooManyLines);
    }

    #[test]
    fn times_parse_strictly() {
        assert_eq!(parse_time(b"01:02:03,004"), Some(3_723_004));
        assert_eq!(parse_time(b"0:00:01.5"), Some(1500));
        assert_eq!(parse_time(b"0:00:01.50"), Some(1500));
        assert_eq!(parse_time(b"02:03.250"), Some(123_250));
        for bad in [&b"1:2:3:4"[..], b"aa:bb", b"00:00:01.0000", b"-0:00:01.00", b"", b"00:60:00,000"] {
            assert_eq!(parse_time(bad), None, "{}", String::from_utf8_lossy(bad));
        }
        assert_eq!(format_time(Format::Ass, 3_723_456), "1:02:03.45");
        assert_eq!(format_time(Format::Srt, 3_723_456), "01:02:03,456");
    }
}
