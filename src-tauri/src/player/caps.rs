//! Settings → Audio & Subtitles → Fix ALL-CAPS subtitles: lines written all
//! in capitals ("WHERE ARE YOU GOING?") become sentence case ("Where are you
//! going?") in SubRip, WebVTT and ASS files Orbit hands to mpv itself. Only
//! the text changes: timing, cue numbers, tags (`<i>`, `{\an8}`) and lines
//! that already have lower case letters stay as they are. Subtitles inside
//! the video are drawn by mpv straight from the file and can't be rewritten.
//!
//! It can't know names: "JOHN" becomes "john" unless it starts a sentence.
//! The standalone "I" stays capital, and so do common acronyms (FBI, TV…).
//!
//! The files are untrusted: the size is capped, a tag is only looked for
//! within `MAX_TAG` characters, and nothing is interpreted beyond the text.

use crate::player::MAX_SUBTITLE_BYTES;
use crate::player::sdh::{ACRONYMS, decode, encode, starts_with_ignore_case};

/// How far a `<…>` or `{…}` tag may run before its opening bracket counts as text.
const MAX_TAG: usize = 200;

/// A copy of subtitle file `raw` with shouting lines in sentence case, or None
/// when it isn't SubRip, WebVTT or ASS, or nothing needed changing.
pub fn fix(raw: &[u8]) -> Option<Vec<u8>> {
    if raw.is_empty() || raw.len() > MAX_SUBTITLE_BYTES {
        return None;
    }
    let (text, encoding) = decode(raw);
    let body = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let ass = body.contains("[Events]") || body.lines().any(|l| starts_with_ignore_case(l, "Dialogue:"));
    let out = if ass {
        fix_ass(&text)
    } else if body.starts_with("WEBVTT") || body.contains("-->") {
        fix_blocks(&text)
    } else {
        return None;
    };
    (out != text).then(|| encode(&out, encoding))
}

/// SubRip and WebVTT: the lines after a `-->` timing line, up to the next blank line, are a cue's text.
fn fix_blocks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_cue = false;
    let mut capitalize = true;
    for (i, piece) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let (line, cr) = piece.strip_suffix('\r').map_or((piece, ""), |l| (l, "\r"));
        if line.trim().is_empty() {
            in_cue = false;
        } else if line.contains("-->") {
            in_cue = true;
            capitalize = true;
        } else if in_cue {
            out.push_str(&fix_line(line, Markup::Html, &mut capitalize));
            out.push_str(cr);
            continue;
        }
        out.push_str(piece);
    }
    out
}

/// ASS/SSA: only `Dialogue:` lines' text (after the ninth comma) changes.
fn fix_ass(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for piece in text.split('\n') {
        let (line, cr) = piece.strip_suffix('\r').map_or((piece, ""), |l| (l, "\r"));
        let start = starts_with_ignore_case(line, "Dialogue:").then(|| line.char_indices().skip(9).filter(|&(_, c)| c == ',').nth(8).map(|(i, _)| i + 1)).flatten();
        match start {
            Some(start) => {
                let (head, body) = line.split_at(start);
                let mut capitalize = true;
                out.push(format!("{head}{}{cr}", fix_line(body, Markup::Ass, &mut capitalize)));
            }
            None => out.push(piece.to_string()),
        }
    }
    out.join("\n")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Markup {
    /// SubRip/WebVTT: `<i>` tags, and `{\…}` overrides some files carry.
    Html,
    /// ASS: `{…}` overrides and `\N`, `\n`, `\h` escapes.
    Ass,
}

/// A piece of a line: markup (kept as it is) or text.
enum Piece<'a> {
    Tag(&'a str),
    Text(&'a str),
}

/// Splits `line` into tags and text.
fn pieces(line: &str, markup: Markup) -> Vec<Piece<'_>> {
    let mut out = Vec::new();
    let mut text_start = 0;
    let mut i = 0;
    let bytes = line.as_bytes();
    while i < line.len() {
        let close = match bytes[i] {
            b'<' if markup == Markup::Html => Some('>'),
            b'{' => Some('}'),
            b'\\' if markup == Markup::Ass && matches!(bytes.get(i + 1), Some(b'N' | b'n' | b'h')) => {
                if text_start < i {
                    out.push(Piece::Text(&line[text_start..i]));
                }
                out.push(Piece::Tag(&line[i..i + 2]));
                i += 2;
                text_start = i;
                continue;
            }
            _ => None,
        };
        let end = close.and_then(|close| line[i + 1..].char_indices().take(MAX_TAG).find(|&(_, c)| c == close).map(|(j, _)| i + 1 + j + 1));
        if let Some(end) = end {
            if text_start < i {
                out.push(Piece::Text(&line[text_start..i]));
            }
            out.push(Piece::Tag(&line[i..end]));
            i = end;
            text_start = i;
        } else {
            // Step over a whole character (the bytes looked at above are all ASCII).
            i += line[i..].chars().next().map_or(1, char::len_utf8);
        }
    }
    if text_start < line.len() {
        out.push(Piece::Text(&line[text_start..]));
    }
    out
}

/// Words of a text, with what's between them.
fn words(text: &str) -> Vec<(bool, &str)> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut in_word = false;
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (k, &(i, c)) in chars.iter().enumerate() {
        // An apostrophe inside a word ("DON'T") belongs to it.
        let apostrophe = (c == '\'' || c == '’') && in_word && chars.get(k + 1).is_some_and(|&(_, n)| n.is_alphabetic());
        let word_char = c.is_alphabetic() || apostrophe;
        if word_char != in_word {
            if i > start {
                out.push((in_word, &text[start..i]));
            }
            start = i;
            in_word = word_char;
        }
    }
    if start < text.len() {
        out.push((in_word, &text[start..]));
    }
    out
}

/// Whether a line shouts: at least two letters, none lower case, and not just acronyms ("FBI!").
fn shouts(line: &str, markup: Markup) -> bool {
    let mut letters = 0usize;
    let mut plain_word = false;
    for piece in pieces(line, markup) {
        let Piece::Text(text) = piece else { continue };
        for (is_word, word) in words(text) {
            if !is_word {
                continue;
            }
            if word.chars().any(char::is_lowercase) {
                return false;
            }
            letters += word.chars().filter(|c| c.is_alphabetic()).count();
            plain_word |= !ACRONYMS.contains(&word);
        }
    }
    letters >= 2 && plain_word
}

/// `line` in sentence case if it shouts, else as it is. `capitalize` carries
/// whether the next word starts a sentence, from line to line within a cue.
fn fix_line(line: &str, markup: Markup, capitalize: &mut bool) -> String {
    // A dialogue dash starts a new speaker's sentence.
    if line.trim_start().starts_with('-') {
        *capitalize = true;
    }
    if !shouts(line, markup) {
        *capitalize = ends_sentence(line);
        return line.to_string();
    }
    let mut out = String::with_capacity(line.len());
    let mut ended = false;
    for piece in pieces(line, markup) {
        match piece {
            Piece::Tag(tag) => {
                // ASS's `\N` (a line break) and `\h` (a space) end a sentence's gap like whitespace.
                if tag.starts_with('\\') && ended {
                    *capitalize = true;
                    ended = false;
                }
                out.push_str(tag);
            }
            Piece::Text(text) => {
                for (is_word, part) in words(text) {
                    if is_word {
                        out.push_str(&recase(part, *capitalize));
                        *capitalize = false;
                        ended = false;
                        continue;
                    }
                    for c in part.chars() {
                        if matches!(c, '.' | '!' | '?' | '…') {
                            ended = true;
                        } else if c.is_whitespace() && ended {
                            *capitalize = true;
                            ended = false;
                        }
                    }
                    out.push_str(part);
                }
            }
        }
    }
    if ended {
        *capitalize = true;
    }
    out
}

/// Whether a line ends a sentence (so the next starts with a capital).
fn ends_sentence(line: &str) -> bool {
    line.trim_end().trim_end_matches(['"', '\'', '’', '”', ')', ']']).ends_with(['.', '!', '?', '…'])
}

/// One shouted word in lower case: "I" and acronyms keep their capitals, and the first word of a sentence gets one.
fn recase(word: &str, capitalize: bool) -> String {
    if ACRONYMS.contains(&word) {
        return word.to_string();
    }
    let lower = word.to_lowercase();
    let pronoun = word == "I" || word.starts_with("I'") || word.starts_with("I’");
    if !capitalize && !pronoun {
        return lower;
    }
    let mut chars = lower.chars();
    chars.next().map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    if let Some(out) = fix(data) {
        assert!(out.len() <= data.len().saturating_mul(4).saturating_add(128));
    }
}

#[cfg(test)]
mod tests {
    use super::fix;

    fn fixed(input: &str) -> String {
        String::from_utf8(fix(input.as_bytes()).expect("changed")).unwrap()
    }

    #[test]
    fn shouting_cues_become_sentence_case() {
        let srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nWHERE ARE YOU GOING?\r\nI DON'T KNOW.\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTHE FBI IS HERE. RUN!\r\n";
        assert_eq!(
            fixed(srt),
            "1\r\n00:00:01,000 --> 00:00:02,000\r\nWhere are you going?\r\nI don't know.\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nThe FBI is here. Run!\r\n"
        );
    }

    #[test]
    fn a_sentence_carries_over_to_the_next_line() {
        assert_eq!(fixed("00:01.000 --> 00:02.000\nI TOLD YOU THAT\nWE'D BE LATE\n"), "00:01.000 --> 00:02.000\nI told you that\nwe'd be late\n");
    }

    #[test]
    fn tags_and_lines_with_lower_case_stay() {
        let vtt = "WEBVTT\n\nNOTE KEEP THIS\n\n00:01.000 --> 00:02.000 align:start\n<i>HELLO THERE</i>\n- {\\an8}YES?\nAlready fine.\n";
        assert_eq!(fixed(vtt), "WEBVTT\n\nNOTE KEEP THIS\n\n00:01.000 --> 00:02.000 align:start\n<i>Hello there</i>\n- {\\an8}Yes?\nAlready fine.\n");
    }

    #[test]
    fn nothing_to_change_or_not_subtitles_is_none() {
        assert!(fix(b"1\n00:00:01,000 --> 00:00:02,000\nNormal text.\n").is_none());
        assert!(fix(b"1\n00:00:01,000 --> 00:00:02,000\nFBI!\n").is_none(), "acronyms alone aren't shouting");
        assert!(fix(b"JUST SOME TEXT").is_none());
        assert!(fix(b"").is_none());
    }

    #[test]
    fn ass_dialogue_text_changes_but_not_its_fields_or_overrides() {
        let ass = "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,BOB,0,0,0,,{\\i1}GET OUT!{\\i0}\\NNOW.\n";
        assert_eq!(fixed(ass), "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,BOB,0,0,0,,{\\i1}Get out!{\\i0}\\NNow.\n");
    }

    #[test]
    fn letters_beyond_ascii_are_recased() {
        assert_eq!(fixed("00:01.000 --> 00:02.000\nÇA VA? ÉCOUTE-MOI.\n"), "00:01.000 --> 00:02.000\nÇa va? Écoute-moi.\n");
    }

    #[test]
    fn single_byte_files_stay_single_byte() {
        // "CAFÉ" in Windows-1252.
        let raw = b"00:01.000 --> 00:02.000\nCAF\xc9 NOW\n";
        assert_eq!(fix(raw).unwrap(), b"00:01.000 --> 00:02.000\nCaf\xe9 now\n");
    }
}
