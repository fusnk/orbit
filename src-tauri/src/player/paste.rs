//! Player → Subtitles → Paste subtitles…: text pasted into the player,
//! checked and rebuilt before mpv sees it. The text is untrusted (it may be
//! anything on the clipboard), so only what reads as SubRip or WebVTT cues
//! gets through: a valid timing line, then text. Everything else (numbers,
//! cue ids, NOTE and STYLE blocks, stray lines, control characters) is
//! dropped, and the cues are written out again in the same format.

/// The most text taken (SubRip files for a whole film are far smaller).
pub const MAX_PASTE_BYTES: usize = 2 * 1024 * 1024;
/// More cues than this isn't one video's subtitles.
const MAX_CUES: usize = 50_000;
/// Times past this many hours aren't real.
const MAX_HOURS: u64 = 99;

#[derive(Debug, PartialEq, Eq)]
pub enum PasteError {
    Empty,
    TooBig,
    /// No cue could be read.
    NotSubtitles,
}

impl PasteError {
    /// What the page is told (it shows its own message for each).
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooBig => "too-big",
            Self::NotSubtitles => "not-subtitles",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Format {
    Srt,
    Vtt,
}

/// The pasted subtitles rebuilt as clean SubRip or WebVTT (whichever was
/// pasted), with how many cues they have.
pub fn rebuild(text: &str) -> Result<(String, usize), PasteError> {
    if text.len() > MAX_PASTE_BYTES {
        return Err(PasteError::TooBig);
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text).replace("\r\n", "\n").replace('\r', "\n");
    if text.trim().is_empty() {
        return Err(PasteError::Empty);
    }
    let format = if text.trim_start().starts_with("WEBVTT") { Format::Vtt } else { Format::Srt };
    let mut cues: Vec<(u64, u64, Vec<String>)> = Vec::new();
    // Read line by line, as mpv does: a valid timing line starts a cue and a blank line (or one of only
    // spaces) ends it, so a cue that runs straight into the next one's timing doesn't swallow it as text.
    let mut cue: Option<(u64, u64, Vec<String>)> = None;
    for line in text.lines() {
        if let Some((start, end)) = line.contains("-->").then(|| timing_line(line)).flatten() {
            if let Some((_, _, body)) = &mut cue
                && body.last().is_some_and(|l| l.bytes().all(|b| b.is_ascii_digit()))
            {
                // The next cue's number, written without a blank line before it.
                body.pop();
            }
            push_cue(&mut cues, cue.replace((start, end, Vec::new())))?;
        } else if line.trim().is_empty() {
            push_cue(&mut cues, cue.take())?;
        } else if let Some((_, _, body)) = &mut cue {
            let text = clean_text(line);
            if !text.trim().is_empty() {
                body.push(text);
            }
        }
    }
    push_cue(&mut cues, cue)?;
    if cues.is_empty() {
        return Err(PasteError::NotSubtitles);
    }
    let mut out = String::with_capacity(text.len());
    if format == Format::Vtt {
        out.push_str("WEBVTT\n\n");
    }
    for (n, (start, end, body)) in cues.iter().enumerate() {
        if format == Format::Srt {
            out.push_str(&format!("{}\n", n + 1));
        }
        out.push_str(&format!("{} --> {}\n{}\n\n", stamp(*start, format), stamp(*end, format), body.join("\n")));
    }
    Ok((out, cues.len()))
}

/// Keeps a finished cue that has text.
fn push_cue(cues: &mut Vec<(u64, u64, Vec<String>)>, cue: Option<(u64, u64, Vec<String>)>) -> Result<(), PasteError> {
    let Some(cue) = cue.filter(|(_, _, body)| !body.is_empty()) else { return Ok(()) };
    cues.push(cue);
    if cues.len() > MAX_CUES { Err(PasteError::TooBig) } else { Ok(()) }
}

/// "00:00:01,000 --> 00:00:02,500" (SubRip) or "00:01.000 --> 00:02.500 align:start" (WebVTT, settings ignored), in milliseconds.
fn timing_line(line: &str) -> Option<(u64, u64)> {
    let (from, to) = line.split_once("-->")?;
    let start = timestamp(from.trim())?;
    let end = timestamp(to.split_whitespace().next()?)?;
    (end > start).then_some((start, end))
}

/// "01:02:03,456", "01:02:03.456" or "02:03.456" in milliseconds.
fn timestamp(text: &str) -> Option<u64> {
    let (clock, fraction) = text.split_once([',', '.'])?;
    if fraction.is_empty() || fraction.len() > 3 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let millis = fraction.parse::<u64>().ok()? * 10u64.pow(3 - u32::try_from(fraction.len()).ok()?);
    let parts: Vec<&str> = clock.split(':').collect();
    let numbers: Vec<u64> = parts.iter().map(|p| if !p.is_empty() && p.len() <= 2 && p.bytes().all(|b| b.is_ascii_digit()) { p.parse().ok() } else { None }).collect::<Option<_>>()?;
    let (hours, minutes, seconds) = match numbers[..] {
        [h, m, s] => (h, m, s),
        [m, s] => (0, m, s),
        _ => return None,
    };
    if hours > MAX_HOURS || minutes > 59 || seconds > 59 {
        return None;
    }
    Some(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

fn stamp(millis: u64, format: Format) -> String {
    let (h, m, s, ms) = (millis / 3_600_000, millis / 60_000 % 60, millis / 1000 % 60, millis % 1000);
    let separator = if format == Format::Srt { ',' } else { '.' };
    format!("{h:02}:{m:02}:{s:02}{separator}{ms:03}")
}

/// A text line without control characters (tabs become spaces) or a stray `-->`, which would read as timing.
fn clean_text(line: &str) -> String {
    line.chars().map(|c| if c == '\t' { ' ' } else { c }).filter(|c| !c.is_control()).collect::<String>().replace("-->", "->").trim_end().to_string()
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    if let Ok((text, count)) = rebuild(&String::from_utf8_lossy(data)) {
        assert!(count <= MAX_CUES);
        assert!(rebuild(&text).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_PASTE_BYTES, PasteError, rebuild};

    #[test]
    fn subrip_is_rebuilt_and_numbered() {
        let pasted = "\u{feff}7\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n<i>there</i>\r\n\r\n\r\n9\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n";
        let (srt, cues) = rebuild(pasted).unwrap();
        assert_eq!(cues, 2);
        assert_eq!(srt, "1\n00:00:01,000 --> 00:00:02,500\nHello\n<i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n\n");
    }

    #[test]
    fn webvtt_stays_webvtt_without_its_extras() {
        let pasted = "WEBVTT - title\n\nNOTE a comment\n\nSTYLE\n::cue { color: red }\n\nintro\n01:02.5 --> 01:04.000 align:start\nHi\n";
        let (vtt, cues) = rebuild(pasted).unwrap();
        assert_eq!(cues, 1);
        assert_eq!(vtt, "WEBVTT\n\n00:01:02.500 --> 00:01:04.000\nHi\n\n");
    }

    #[test]
    fn bad_cues_are_skipped_and_control_characters_dropped() {
        let pasted = "1\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n2\n00:00:61,000 --> 00:01:02,000\nNo such second\n\n3\n00:00:01,000 --> 00:00:02,000\n\n\n4\n00:00:06,000 --> 00:00:07,000\nOk\u{7}\tnow --> then\n";
        let (srt, cues) = rebuild(pasted).unwrap();
        assert_eq!(cues, 1);
        assert_eq!(srt, "1\n00:00:06,000 --> 00:00:07,000\nOk now -> then\n\n");
    }

    #[test]
    fn cues_split_by_a_blank_looking_line_or_none_stay_apart() {
        // A line of spaces between cues, and a cue that runs straight into the next one's number and timing.
        let pasted = "1
00:00:01,000 --> 00:00:02,000
One
  
2
00:00:03,000 --> 00:00:04,000
Two
3
00:00:05,000 --> 00:00:06,000
Three
";
        let (srt, cues) = rebuild(pasted).unwrap();
        assert_eq!(cues, 3);
        assert_eq!(srt, "1
00:00:01,000 --> 00:00:02,000
One

2
00:00:03,000 --> 00:00:04,000
Two

3
00:00:05,000 --> 00:00:06,000
Three

");
    }

    #[test]
    fn nothing_usable_is_an_error() {
        assert_eq!(rebuild("  \n\n "), Err(PasteError::Empty));
        assert_eq!(rebuild("just some words\nfrom the clipboard"), Err(PasteError::NotSubtitles));
        assert_eq!(rebuild("1\nnot --> times\nText"), Err(PasteError::NotSubtitles));
        assert_eq!(rebuild(&"a".repeat(MAX_PASTE_BYTES + 1)), Err(PasteError::TooBig));
    }
}
