//! Bounded, plain-text transcript of the primary external subtitle track.
use super::{MAX_SUBTITLE_BYTES, PlayerState};
use serde::Serialize;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

const MAX_CUES: usize = 20_000;
const MAX_TEXT: usize = 4_000;
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub track_id: Option<i64>,
    pub available: bool,
    pub cues: Vec<Cue>,
}
#[derive(Default)]
pub(super) struct Cache(Mutex<VecDeque<(u64, u64, Transcript)>>);

#[tauri::command]
pub async fn player_transcript(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<Transcript, String> {
    let opens = state.opens.load(Ordering::SeqCst);
    let mpv = state.mpv(&app)?;
    let sid = mpv.get_string("sid").and_then(|s| s.parse::<i64>().ok());
    let unavailable = || Transcript {
        track_id: sid,
        available: false,
        cues: Vec::new(),
    };
    let Some(sid) = sid else {
        return Ok(unavailable());
    };
    let count = mpv
        .get_string("track-list/count")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let mut file = None;
    for i in 0..count.min(200) {
        let get = |key: &str| mpv.get_string(&format!("track-list/{i}/{key}"));
        if get("type").as_deref() == Some("sub")
            && get("id").and_then(|s| s.parse::<i64>().ok()) == Some(sid)
        {
            if get("external").as_deref() == Some("yes") {
                file = get("external-filename");
            }
            break;
        }
    }
    let Some(file) = file else {
        return Ok(unavailable());
    };
    // Only mpv's chosen track is accepted, never a path or URL supplied by IPC.
    let stamp = if file.starts_with("hex://") || file.starts_with("http") {
        None
    } else {
        tokio::fs::metadata(&file)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
    };
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    sid.hash(&mut hash);
    file.hash(&mut hash);
    stamp.hash(&mut hash);
    let key = hash.finish();
    if let Some(result) = state.transcript.0.lock().ok().and_then(|cache| {
        cache
            .iter()
            .find(|(open, cached_key, _)| *open == opens && *cached_key == key)
            .map(|(_, _, result)| result.clone())
    }) {
        return Ok(result);
    }
    let media = state.media.lock().ok().and_then(|m| m.clone());
    let Ok(raw) = super::subsync::subtitle_bytes(&file, media.as_ref()).await else {
        return Ok(unavailable());
    };
    let cues = tauri::async_runtime::spawn_blocking(move || parse(&raw))
        .await
        .map_err(|_| "Transcript unavailable")?;
    let result = Transcript {
        track_id: Some(sid),
        available: !cues.is_empty(),
        cues,
    };
    if opens != state.opens.load(Ordering::SeqCst)
        || mpv.get_string("sid").and_then(|s| s.parse::<i64>().ok()) != Some(sid)
    {
        return Ok(unavailable());
    }
    if let Ok(mut cache) = state.transcript.0.lock() {
        cache.retain(|(open, existing, _)| *open == opens && *existing != key);
        if cache.len() >= 4 {
            cache.pop_front();
        }
        cache.push_back((opens, key, result.clone()));
    }
    Ok(result)
}

fn time(value: &str) -> Option<f64> {
    let value = value.trim().replace(',', ".");
    let parts: Vec<&str> = value.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    let seconds: f64 = parts.last()?.parse().ok()?;
    let minutes: u32 = parts[parts.len() - 2].parse().ok()?;
    let hours: u32 = if parts.len() == 3 {
        parts[0].parse().ok()?
    } else {
        0
    };
    if !seconds.is_finite() || !(0.0..60.0).contains(&seconds) || minutes >= 60 || hours > 1000 {
        return None;
    }
    Some(f64::from(hours) * 3600.0 + f64::from(minutes) * 60.0 + seconds)
}
/// SubRip's italic, bold and underline tags, the only styling kept with `styled`.
const STYLE_TAGS: [&str; 6] = ["i", "/i", "b", "/b", "u", "/u"];
/// A cue's text without markup; with `styled`, italics, bold and underline
/// stay as SubRip tags (ASS's `{\i1}` becomes `<i>`).
fn text_of(value: &str, ass: bool, styled: bool) -> String {
    let mut out = String::new();
    let mut chars = value.chars().peekable();
    let mut drawing = false;
    while let Some(c) = chars.next() {
        if ass && c == '{' {
            let mut code = String::new();
            for c in chars.by_ref() {
                if c == '}' {
                    break;
                }
                code.push(c);
            }
            for command in code.split('\\') {
                if let Some(number) = command
                    .strip_prefix('p')
                    .and_then(|n| n.trim().parse::<u32>().ok())
                {
                    drawing = number != 0;
                }
                if styled && !drawing {
                    match command.trim() {
                        "i1" => out.push_str("<i>"),
                        "i0" => out.push_str("</i>"),
                        "b1" => out.push_str("<b>"),
                        "b0" => out.push_str("</b>"),
                        "u1" => out.push_str("<u>"),
                        "u0" => out.push_str("</u>"),
                        _ => {}
                    }
                }
            }
        } else if c == '<' && !ass {
            let mut look = chars.clone();
            let mut tag = String::new();
            for next in look.by_ref().take(256) {
                if next == '>' {
                    break;
                }
                tag.push(next);
            }
            let formatting = tag
                .trim_start_matches('/')
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic())
                || tag.chars().next().is_some_and(|c| c.is_ascii_digit());
            let closing = chars.clone().take(257).any(|c| c == '>');
            if formatting && closing {
                for next in chars.by_ref() {
                    if next == '>' {
                        break;
                    }
                }
                let name = tag.trim().to_ascii_lowercase();
                if styled && STYLE_TAGS.contains(&name.as_str()) {
                    out.push('<');
                    out.push_str(&name);
                    out.push('>');
                }
            } else {
                out.push(c);
            }
        } else if ass && c == '\\' {
            match chars.peek().copied() {
                Some('N' | 'n') => {
                    chars.next();
                    if !drawing {
                        out.push('\n');
                    }
                }
                Some('h') => {
                    chars.next();
                    if !drawing {
                        out.push(' ');
                    }
                }
                _ if !drawing => out.push(c),
                _ => {}
            }
        } else if !drawing && (!c.is_control() || c == '\n' || c == '\t') {
            out.push(c);
        }
        if out.len() >= MAX_TEXT {
            break;
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .trim()
        .to_string()
}
/// A cue timing line's start and end ("00:00:01,000 --> 00:00:02,000 align:start").
fn timings(line: &str) -> (Option<f64>, Option<f64>) {
    line.split_once("-->").map_or((None, None), |(start, end)| (time(start), end.split_whitespace().next().and_then(time)))
}
fn add(cues: &mut Vec<Cue>, start: Option<f64>, end: Option<f64>, text: String) {
    if let (Some(start), Some(end)) = (start, end)
        && end > start
        && !text.is_empty()
        && cues.len() < MAX_CUES
    {
        cues.push(Cue { start, end, text });
    }
}
fn parse(raw: &[u8]) -> Vec<Cue> {
    parse_as(raw, false)
}
/// Cues with their italics, bold and underline kept as SubRip tags (for translating them, see subtrans).
pub(super) fn styled_cues(raw: &[u8]) -> Vec<Cue> {
    parse_as(raw, true)
}
fn parse_as(raw: &[u8], styled: bool) -> Vec<Cue> {
    if raw.is_empty() || raw.len() > MAX_SUBTITLE_BYTES {
        return Vec::new();
    }
    let (decoded, encoding) = super::sdh::decode(raw);
    // Most legacy Western subtitles use Windows-1252, whose punctuation
    // occupies the Latin-1 control range. No charset guessing for other scripts.
    let decoded = if encoding == super::sdh::Encoding::Bytes {
        const C1: [char; 32] = [
            '€', '\u{fffd}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{fffd}',
            'Ž', '\u{fffd}', '\u{fffd}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›',
            'œ', '\u{fffd}', 'ž', 'Ÿ',
        ];
        decoded
            .chars()
            .map(|c| {
                if ('\u{80}'..='\u{9f}').contains(&c) {
                    C1[c as usize - 0x80]
                } else {
                    c
                }
            })
            .collect::<String>()
    } else {
        decoded
    };
    let text = decoded
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut cues = Vec::new();
    if text
        .lines()
        .any(|l| l.trim().eq_ignore_ascii_case("[Events]"))
    {
        let mut events = false;
        let mut fields: Vec<String> = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                events = line.eq_ignore_ascii_case("[Events]");
                continue;
            }
            if !events {
                continue;
            }
            if let Some(format) = line.strip_prefix("Format:") {
                fields = format
                    .split(',')
                    .map(|f| f.trim().to_ascii_lowercase())
                    .collect();
            }
            if let Some(body) = line.strip_prefix("Dialogue:") {
                let default = [
                    "layer", "start", "end", "style", "name", "marginl", "marginr", "marginv",
                    "effect", "text",
                ];
                let names: Vec<&str> = if fields.is_empty() {
                    default.to_vec()
                } else {
                    fields.iter().map(String::as_str).collect()
                };
                // Text must be last: commas in dialogue then remain intact.
                if names.last() != Some(&"text") {
                    continue;
                }
                let values: Vec<&str> = body.splitn(names.len(), ',').collect();
                if values.len() != names.len() {
                    continue;
                }
                let get = |name| names.iter().position(|n| *n == name).map(|i| values[i]);
                add(
                    &mut cues,
                    get("start").and_then(time),
                    get("end").and_then(time),
                    text_of(get("text").unwrap_or(""), true, styled),
                );
            }
        }
    } else {
        // A line of only spaces or tabs ends a cue too, as it does in mpv.
        let text = text.lines().map(|l| if l.trim().is_empty() { "" } else { l }).collect::<Vec<_>>().join("\n");
        for block in text.split("\n\n") {
            let first = block.trim_start().lines().next().unwrap_or("");
            if first == "NOTE"
                || first.starts_with("NOTE ")
                || first == "STYLE"
                || first == "REGION"
            {
                continue;
            }
            let mut lines = block.lines();
            let Some(mut timing) = lines.find(|l| l.contains("-->")) else {
                continue;
            };
            // A valid timing line further on starts the next cue (written without a blank line
            // before it, as mpv also reads it), rather than becoming this one's text.
            let mut body: Vec<&str> = Vec::new();
            for line in lines.chain(std::iter::once("")) {
                let next = line.contains("-->") && matches!(timings(line), (Some(_), Some(_)));
                if !next && !line.is_empty() {
                    body.push(line);
                    continue;
                }
                if next && body.last().is_some_and(|l| l.trim().bytes().all(|b| b.is_ascii_digit())) {
                    // The next cue's number.
                    body.pop();
                }
                let (start, end) = timings(timing);
                add(&mut cues, start, end, text_of(&body.join("\n"), false, styled));
                body.clear();
                timing = line;
            }
        }
    }
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    cues
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let cues = parse(data);
    assert!(cues.len() <= MAX_CUES);
    for c in &cues {
        assert!(c.start.is_finite() && c.end.is_finite());
        assert!(c.start >= 0.0 && c.end > c.start);
        assert!(c.text.chars().count() <= MAX_TEXT);
    }
    assert!(cues.windows(2).all(|w| w[0].start <= w[1].start));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn styled_cues_keep_italics_bold_and_underline_only() {
        let cues = styled_cues(b"1\n00:00:01,000 --> 00:00:02,000\n<i>Hi</i> <font color=red>you</font>\n<B>two</B>\n");
        assert_eq!(cues[0].text, "<i>Hi</i> you\n<b>two</b>");
        let ass = styled_cues(b"[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,0:00:01.00,0:00:02.00,{\\i1\\pos(1,2)}Hi{\\i0}\\Nthere\n");
        assert_eq!(ass[0].text, "<i>Hi</i>\nthere");
        assert_eq!(parse(b"1\n00:00:01,000 --> 00:00:02,000\n<i>Hi</i>\n")[0].text, "Hi");
    }
    #[test]
    fn literal_angles_and_vtt_comments() {
        assert_eq!(
            text_of("2 < 3 and an unmatched < angle", false, false),
            "2 < 3 and an unmatched < angle"
        );
        let cues = parse(b"WEBVTT\n\nNOTE comment\n00:00:00 --> 00:00:01\nNot a cue\n\nSTYLE\n00:00:00 --> 00:00:01\nAlso not a cue\n\nREGION\n00:00:00 --> 00:00:01\nNot a cue\n\n00:00:01 --> 00:00:02\nActual");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "Actual");
    }
    #[test]
    fn cue_count_and_timestamp_bounds() {
        let cue = "00:00:00 --> 00:00:01\nHi\n\n";
        assert_eq!(parse(cue.repeat(MAX_CUES + 1).as_bytes()).len(), MAX_CUES);
        for invalid in [
            "-1:00:00",
            "00:60:00",
            "00:00:60",
            "1001:00:00",
            "00:00:inf",
        ] {
            assert!(time(invalid).is_none());
        }
    }
    #[test]
    fn srt_tags_and_overlap() {
        let cues = parse(b"1\n00:00:02,000 --> 00:00:04,000\n<b>Hello</b> &amp; world\n\n2\n00:00:01,500 --> 00:00:03,000\nEarlier\n");
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start, 1.5);
        assert_eq!(cues[1].text, "Hello & world");
    }
    #[test]
    fn vtt_settings_unicode() {
        let cues = parse(
            "WEBVTT\n\nname\n01:02.500 --> 01:04.000 align:start\n<v Speaker>مرحبا</v>\n"
                .as_bytes(),
        );
        assert_eq!(cues[0].start, 62.5);
        assert_eq!(cues[0].text, "مرحبا");
    }
    #[test]
    fn ass_format_and_drawings() {
        let cues=parse(b"[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,0:00:01.20,0:00:03.40,{\\i1}Hi, there\\N{\\p1}m 0 0 l 1 1{\\p0}Again\nComment: 0,0:00:01.20,0:00:03.40,Hidden");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "Hi, there\nAgain");
    }
    #[test]
    fn invalid_input_is_bounded() {
        assert!(parse(b"garbage").is_empty());
        assert!(parse(b"00:00:NaN --> 00:00:01\na\n\n00:00:03 --> 00:00:02\nb").is_empty());
        assert!(parse(&vec![b'x'; MAX_SUBTITLE_BYTES + 1]).is_empty());
        assert!(text_of(&"x".repeat(MAX_TEXT * 2), false, false).len() <= MAX_TEXT);
    }
    #[test]
    fn utf16_and_legacy_bytes() {
        let mut raw = vec![0xff, 0xfe];
        for unit in "00:00:00,000 --> 00:00:01,000\nCafé".encode_utf16() {
            raw.extend(unit.to_le_bytes());
        }
        assert_eq!(parse(&raw)[0].text, "Café");
        assert_eq!(
            parse(b"00:00:00,000 --> 00:00:01,000\nCaf\xe9")[0].text,
            "Café"
        );
    }
    #[test]
    fn legacy_windows_punctuation() {
        assert_eq!(
            parse(b"00:00:00 --> 00:00:01\nIt\x92s \x80")[0].text,
            "It’s €"
        );
    }
    #[test]
    fn ssa_and_equal_start_stability() {
        let cues=parse(b"[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:00.00,0:00:01.00,Default,,0,0,0,,First\nDialogue: Marked=0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Second");
        assert_eq!(cues[0].text, "First");
        assert_eq!(cues[1].text, "Second");
    }
    #[test]
    fn a_cue_running_into_the_next_ones_timing_stays_apart() {
        let cues = styled_cues(b"1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n00:00:05,000 --> 00:00:06,000\nThree\n");
        assert_eq!(cues.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), ["One", "Two", "Three"]);
        assert_eq!(cues[1].start, 3.0);
        // A line of dialogue with an arrow in it is still dialogue.
        assert_eq!(parse(b"00:00:01,000 --> 00:00:02,000\nLeft --> right\n")[0].text, "Left --> right");
    }
    #[test]
    fn a_whitespace_only_line_separates_cues() {
        let cues = parse(b"1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n \r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n\t\r\n");
        assert_eq!(cues.len(), 2, "{cues:?}");
        assert_eq!(cues[0].text, "Hello");
        assert_eq!(cues[1].text, "World");
    }
}
