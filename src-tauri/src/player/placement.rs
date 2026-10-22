//! Player → Audio & subtitles → Keep at the bottom: removes placement
//! overrides (`{\an8}`, `{\a6}`, `{\pos(..)}`, `{\move(..)}`, `{\org(..)}`)
//! from SubRip and WebVTT files Orbit hands to mpv itself, so every line sits
//! at the chosen height. Everything else stays: italics, bold and colour tags
//! (`<i>`, `{\i1}`), text and timing. ASS/SSA files are never changed: their
//! placement is typesetting (signs, karaoke). Subtitles inside the video can't
//! be rewritten, so mpv strips them instead (see `player_set_subtitle_override`).
//!
//! The files are untrusted: the size is capped, an override block is only
//! looked for within `MAX_TAG` characters, and nothing is interpreted beyond
//! the tag names.

use crate::player::MAX_SUBTITLE_BYTES;
use crate::player::sdh::{decode, encode, starts_with_ignore_case};

/// How far a `{\…}` block may run before its `{` counts as text.
const MAX_TAG: usize = 200;

/// A copy of SubRip/WebVTT file `raw` without placement overrides, or None
/// when it has none or isn't SubRip or WebVTT (then it's used as it is).
pub fn strip(raw: &[u8]) -> Option<Vec<u8>> {
    if raw.is_empty() || raw.len() > MAX_SUBTITLE_BYTES {
        return None;
    }
    let (text, encoding) = decode(raw);
    let body = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let ass = body.contains("[Events]") || body.lines().any(|l| starts_with_ignore_case(l, "Dialogue:"));
    if ass || !(body.starts_with("WEBVTT") || body.contains("-->")) {
        return None;
    }
    let out = strip_text(&text)?;
    Some(encode(&out, encoding))
}

/// `text` with placement tags removed from its `{\…}` blocks, or None if there were none.
fn strip_text(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut changed = false;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        // Only override blocks (`{\…}`, as libass reads them); other braces are text or comments.
        if !after.trim_start_matches([' ', '\t']).starts_with('\\') {
            out.push('{');
            rest = after;
            continue;
        }
        // The block ends at the first `}` on the same line, close by and before another `{`; otherwise the `{` is text.
        let close = after.char_indices().take(MAX_TAG).find(|&(_, c)| matches!(c, '}' | '{' | '\n')).filter(|&(_, c)| c == '}').map(|(i, _)| i);
        let Some(close) = close else {
            out.push('{');
            rest = after;
            continue;
        };
        let block = &after[..close];
        let kept: Vec<&str> = block.split('\\').skip(1).filter(|tag| !is_placement(tag.trim())).collect();
        if kept.len() == block.split('\\').skip(1).count() {
            out.push('{');
            out.push_str(block);
            out.push('}');
        } else {
            changed = true;
            // A block left with nothing in it goes; the others keep their remaining tags.
            if kept.iter().any(|tag| !tag.trim().is_empty()) {
                out.push('{');
                for tag in kept {
                    out.push('\\');
                    out.push_str(tag);
                }
                out.push('}');
            }
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    changed.then_some(out)
}

/// `an1`–`an9`, legacy `a1`–`a11`, and `pos(`, `move(`, `org(` with their arguments.
fn is_placement(tag: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.len() <= 2 && s.bytes().all(|b| b.is_ascii_digit());
    if let Some(n) = tag.strip_prefix("an") {
        return digits(n);
    }
    if let Some(n) = tag.strip_prefix('a') {
        return digits(n);
    }
    ["pos(", "move(", "org("].iter().any(|p| tag.starts_with(p))
}

#[cfg(test)]
mod tests {
    use super::{strip, strip_text};

    fn clean(text: &str) -> String {
        strip_text(text).unwrap_or_else(|| text.to_string())
    }

    #[test]
    fn removes_placement_and_keeps_styling() {
        assert_eq!(clean("{\\an8}Top line"), "Top line");
        assert_eq!(clean("{\\pos(10,20)}Here"), "Here");
        assert_eq!(clean("{\\an8\\i1}Sign{\\i0}"), "{\\i1}Sign{\\i0}");
        assert_eq!(clean("{\\i1\\a6}x"), "{\\i1}x");
        assert_eq!(clean("{\\move(1,2,3,4)\\org(5,6)\\b1}y"), "{\\b1}y");
        assert_eq!(clean("{ \\an2 }z"), "z");
        // Styling, alpha and colour tags stay; so do italics in HTML form.
        for kept in ["<i>Italic</i>", "{\\i1}Italic{\\i0}", "{\\alpha&H80&}a", "{\\1a&H80&}b", "{\\c&H00FF00&}c", "{\\fad(100,200)}d", "{not a tag}e", "{\\an}f", "{\\an123}g"] {
            assert_eq!(strip_text(kept), None, "{kept}");
        }
    }

    #[test]
    fn an_unclosed_or_long_block_is_text() {
        assert_eq!(strip_text("{\\an8 and no end"), None);
        assert_eq!(strip_text("{\\an8\nnext}"), None);
        let long = format!("{{\\an8{}}}", "x".repeat(300));
        assert_eq!(strip_text(&long), None);
        assert_eq!(clean("{\\an8 {\\an8}x"), "{\\an8 x");
    }

    #[test]
    fn changes_subrip_and_webvtt_only() {
        let srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\n{\\an8}<i>Hello</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nPlain\r\n";
        assert_eq!(strip(srt.as_bytes()).unwrap(), srt.replace("{\\an8}", "").into_bytes());
        let vtt = "WEBVTT\n\nSTYLE\n::cue { color: red }\n\n00:01.000 --> 00:02.000\n{\\an8}Hi\n";
        assert_eq!(String::from_utf8(strip(vtt.as_bytes()).unwrap()).unwrap(), vtt.replace("{\\an8}", ""));
        // Nothing to remove, an ASS file, or not a subtitle file: used as it is.
        assert_eq!(strip(b"1\n00:00:01,000 --> 00:00:02,000\n<i>Hi</i>\n"), None);
        assert_eq!(strip(b"[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\an8}Sign\n"), None);
        assert_eq!(strip(b"{\\an8}just text"), None);
        assert_eq!(strip(b""), None);
    }

    #[test]
    fn keeps_the_file_encoding() {
        // Windows-1252 "é" stays one byte.
        let raw = b"1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Caf\xe9\n";
        assert_eq!(strip(raw).unwrap(), b"1\n00:00:01,000 --> 00:00:02,000\nCaf\xe9\n");
    }
}
