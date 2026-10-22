//! XMLTV programme guides: `<channel id>` with display names, and
//! `<programme start stop channel>` with a title and description. Read as a
//! stream (guides run to hundreds of MB), keeping only programmes inside the
//! window asked for. Text is plain text, length-capped; nothing is HTML.

use std::borrow::Cow;
use std::io::BufRead;

use quick_xml::Reader;
use quick_xml::escape::{resolve_predefined_entity, unescape};
use quick_xml::events::{BytesStart, Event};

const MAX_ID: usize = 200;
const MAX_TITLE: usize = 200;
const MAX_DESC: usize = 1000;
/// Programmes kept from one guide, whatever its size.
pub const MAX_PROGRAMMES: usize = 2_000_000;
/// How long a programme with no `stop` and nothing after it on its channel is taken to run.
const OPEN_ENDED: i64 = 2 * 3600;
/// Marks a programme read without a `stop` while it waits for one.
const OPEN: i64 = i64::MIN;
/// Programmes waiting for their channel's next start, at most (one per channel).
const MAX_OPEN: usize = 20_000;

#[derive(Debug, PartialEq)]
pub struct Channel {
    pub id: String,
    pub names: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub struct Programme {
    pub channel: String,
    /// Unix seconds.
    pub start: i64,
    pub stop: i64,
    pub title: String,
    pub description: Option<String>,
}

/// Days since 1970-01-01 for a civil date (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "20261003180000 +0200" (seconds and offset optional; no offset means UTC) as Unix seconds.
/// The offset may also be glued on ("20261003180000+0200") or written "+02:00", and
/// "UTC", "GMT" or "Z" mean +0000. Any other offset or zone name is refused: read as
/// UTC it would shift the programme by hours.
pub fn parse_time(text: &str) -> Option<i64> {
    let text = text.trim();
    let split = text.find([' ', '+', '-']).unwrap_or(text.len());
    let (stamp, offset) = (&text[..split], text[split..].trim());
    let digits = |r: std::ops::Range<usize>| stamp.get(r).and_then(|s| s.parse::<i64>().ok());
    if !(stamp.len() == 12 || stamp.len() == 14) || !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (y, mo, d, h, mi) = (digits(0..4)?, digits(4..6)?, digits(6..8)?, digits(8..10)?, digits(10..12)?);
    let s = if stamp.len() == 14 { digits(12..14)? } else { 0 };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 60 {
        return None;
    }
    let seconds = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + s;
    if offset.is_empty() {
        return Some(seconds);
    }
    Some(seconds - offset_seconds(offset)?)
}

/// "+0200", "-0130", "+02:00" or "UTC"/"GMT"/"Z" as seconds east of UTC.
fn offset_seconds(offset: &str) -> Option<i64> {
    if ["UTC", "GMT", "Z"].iter().any(|zone| offset.eq_ignore_ascii_case(zone)) {
        return Some(0);
    }
    let sign = match offset.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let rest = &offset.as_bytes()[1..];
    let (hh, mm) = match rest {
        [a, b, c, d] => ([*a, *b], [*c, *d]),
        [a, b, b':', c, d] => ([*a, *b], [*c, *d]),
        _ => return None,
    };
    let two = |p: [u8; 2]| p.iter().all(u8::is_ascii_digit).then(|| i64::from(p[0] - b'0') * 10 + i64::from(p[1] - b'0'));
    let (oh, om) = (two(hh)?, two(mm)?);
    (oh <= 14 && om < 60).then_some(sign * (oh * 3600 + om * 60))
}

fn clip(text: &str, max: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().filter(|c| !c.is_control()).take(max).collect()
}

/// Bytes that aren't UTF-8, read as Latin-1, so a guide in ISO-8859-1 (or
/// Windows-1252, whose 0x80-0x9F become control characters `clip` drops)
/// keeps its titles. Orbit has no other decoders.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

fn decoded<E>(decoded: Result<Cow<'_, str>, E>, raw: &[u8]) -> String {
    decoded.map_or_else(|_| latin1(raw), Cow::into_owned)
}

fn attr(e: &BytesStart, name: &str) -> Option<String> {
    let a = e.try_get_attribute(name).ok().flatten()?;
    match a.normalized_value(quick_xml::XmlVersion::Implicit1_0) {
        Ok(v) => Some(v.into_owned()),
        Err(_) => unescape(&latin1(&a.value)).ok().map(Cow::into_owned),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Field {
    None,
    DisplayName,
    Title,
    Desc,
}

/// Reads a guide, handing over every channel and each programme that ends
/// after `from` and starts before `until` (Unix seconds).
pub fn parse(reader: impl BufRead, from: i64, until: i64, mut on_channel: impl FnMut(Channel), mut on_programme: impl FnMut(Programme)) -> Result<usize, String> {
    let mut xml = Reader::from_reader(reader);
    // Many panels' guides write "Tom & Jerry" unescaped: one such title would
    // otherwise throw the whole guide away.
    xml.config_mut().allow_dangling_amp = true;
    let mut buf = Vec::new();
    let mut channel: Option<Channel> = None;
    let mut programme: Option<Programme> = None;
    let mut field = Field::None;
    let mut text = String::new();
    let mut kept = 0usize;
    // Per channel, a programme with no `stop`, waiting for the next start.
    let mut open: std::collections::HashMap<String, Programme> = std::collections::HashMap::new();
    let mut keep = |p: Programme| {
        if p.stop > p.start && p.stop > from && p.start < until && kept < MAX_PROGRAMMES {
            kept += 1;
            on_programme(p);
        }
    };
    loop {
        let event = xml.read_event_into(&mut buf).map_err(|e| format!("The guide isn't valid XMLTV: {e}"))?;
        match event {
            Event::Start(e) | Event::Empty(e) if matches!(e.local_name().as_ref(), b"channel" | b"programme") => {
                if e.local_name().as_ref() == b"channel" {
                    channel = attr(&e, "id").map(|id| Channel { id: clip(&id, MAX_ID), names: Vec::new() });
                } else {
                    let channel = attr(&e, "channel").map(|ch| clip(&ch, MAX_ID));
                    let times = (attr(&e, "start").and_then(|t| parse_time(&t)), attr(&e, "stop").and_then(|t| parse_time(&t)));
                    // Whatever becomes of this programme (outside the window, no title), its start ends the one
                    // still open on its channel: only kept programmes reach the End arm, and a past one that
                    // didn't would have let the open one run on to the next kept start, hours later.
                    if let (Some(ch), (Some(start), _)) = (&channel, times)
                        && let Some(mut before) = open.remove(ch)
                    {
                        before.stop = if start > before.start { start } else { before.start + OPEN_ENDED };
                        keep(before);
                    }
                    programme = match (channel, times) {
                        (Some(channel), (Some(start), Some(stop))) if stop > start && stop > from && start < until => {
                            Some(Programme { channel, start, stop, title: String::new(), description: None })
                        }
                        // `stop` is optional in XMLTV: such a programme runs until the next one on its channel.
                        (Some(channel), (Some(start), None)) if start < until => Some(Programme { channel, start, stop: OPEN, title: String::new(), description: None }),
                        _ => None,
                    };
                }
            }
            Event::Start(e) => {
                field = match e.local_name().as_ref() {
                    b"display-name" if channel.is_some() => Field::DisplayName,
                    b"title" if programme.as_ref().is_some_and(|p| p.title.is_empty()) => Field::Title,
                    b"desc" if programme.as_ref().is_some_and(|p| p.description.is_none()) => Field::Desc,
                    _ => Field::None,
                };
                text.clear();
            }
            Event::Text(t) if field != Field::None && text.len() < MAX_DESC * 4 => text.push_str(&decoded(t.decode(), &t)),
            Event::CData(t) if field != Field::None && text.len() < MAX_DESC * 4 => text.push_str(&decoded(t.decode(), &t)),
            Event::GeneralRef(r) if field != Field::None && text.len() < MAX_DESC * 4 => {
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    text.push(c);
                } else if let Some(s) = r.decode().ok().and_then(|n| resolve_predefined_entity(&n)) {
                    text.push_str(s);
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                b"channel" => {
                    if let Some(c) = channel.take() {
                        on_channel(c);
                    }
                }
                b"programme" => {
                    if let Some(p) = programme.take().filter(|p| !p.title.is_empty()) {
                        if p.stop != OPEN {
                            keep(p);
                        } else if open.len() < MAX_OPEN {
                            open.insert(p.channel.clone(), p);
                        } else {
                            keep(Programme { stop: p.start + OPEN_ENDED, ..p });
                        }
                    }
                }
                _ => {
                    match field {
                        Field::DisplayName => {
                            if let Some(c) = channel.as_mut() {
                                let name = clip(&text, MAX_TITLE);
                                if !name.is_empty() && c.names.len() < 8 {
                                    c.names.push(name);
                                }
                            }
                        }
                        Field::Title => {
                            if let Some(p) = programme.as_mut() {
                                p.title = clip(&text, MAX_TITLE);
                            }
                        }
                        Field::Desc => {
                            if let Some(p) = programme.as_mut() {
                                p.description = Some(clip(&text, MAX_DESC)).filter(|d| !d.is_empty());
                            }
                        }
                        Field::None => {}
                    }
                    field = Field::None;
                }
            },
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    let mut last: Vec<Programme> = open.into_values().collect();
    last.sort_by_key(|p| p.start);
    for p in last {
        keep(Programme { stop: p.start + OPEN_ENDED, ..p });
    }
    Ok(kept)
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let check = |reader: Box<dyn BufRead>| {
        let r = parse(
            reader,
            i64::MIN,
            i64::MAX,
            |c| {
                assert!(c.id.chars().count() <= MAX_ID);
            },
            |p| {
                assert!(p.stop > p.start);
                assert!(p.title.chars().count() <= MAX_TITLE);
            },
        );
        assert!(r.is_err() || r.unwrap() <= MAX_PROGRAMMES);
    };
    check(Box::new(std::io::Cursor::new(data.to_vec())));
    use std::io::Read;
    check(Box::new(std::io::BufReader::new(
        flate2::read::MultiGzDecoder::new(std::io::Cursor::new(data.to_vec())).take(262144),
    )));
    let _ = parse_time(&String::from_utf8_lossy(data));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times() {
        assert_eq!(parse_time("19700101000000 +0000"), Some(0));
        assert_eq!(parse_time("20261003180000 +0200"), Some(1_791_043_200));
        assert_eq!(parse_time("202610031600"), Some(1_791_043_200));
        assert_eq!(parse_time("20261003160000 -0130"), Some(1_791_043_200 + 5400));
        assert_eq!(parse_time("2026-10-03"), None);
        assert_eq!(parse_time("20261303180000"), None);
        // Offsets glued on, or written with a colon.
        assert_eq!(parse_time("20261003180000+0200"), Some(1_791_043_200));
        assert_eq!(parse_time("20261003180000 +02:00"), Some(1_791_043_200));
        assert_eq!(parse_time("20261003143000-01:30"), Some(1_791_043_200));
        assert_eq!(parse_time("20261003180000 +0530"), parse_time("20261003123000 +0000"));
        // UTC by name.
        for utc in ["20261003160000 UTC", "20261003160000 gmt", "20261003160000 Z", "20261003160000 z"] {
            assert_eq!(parse_time(utc), Some(1_791_043_200), "{utc}");
        }
        // A malformed offset or another zone name is refused, not read as UTC.
        for bad in ["20261003180000 +2", "20261003180000 +02:0", "20261003180000 CEST", "20261003180000 UTCX", "20261003180000 +0260", "20261003180000 +0200 x", "20261003180000+é0"] {
            assert_eq!(parse_time(bad), None, "{bad}");
        }
    }

    fn run(xml: &[u8]) -> Vec<Programme> {
        let mut out = Vec::new();
        parse(xml, i64::MIN, i64::MAX, |_| {}, |p| out.push(p)).unwrap();
        out
    }

    #[test]
    fn reads_a_byte_order_mark_and_crlf() {
        let xml = "\u{feff}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<tv>\r\n<programme start=\"20261003180000 +0000\" stop=\"20261003190000 +0000\" channel=\"a\"><title>X</title></programme>\r\n</tv>";
        assert_eq!(run(xml.as_bytes()).len(), 1);
    }

    #[test]
    fn reads_latin1_text_and_attributes() {
        let xml = b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><tv>\
            <channel id=\"t\xe9l\xe9\"><display-name>T\xe9l\xe9 Un</display-name></channel>\
            <programme start=\"20261003180000 +0000\" stop=\"20261003190000 +0000\" channel=\"t\xe9l\xe9 &amp; co\">\
            <title>T\xe9l\xe9journal \x93direct\x94</title><desc>R\xe9sum\xe9</desc></programme></tv>";
        let mut channels = Vec::new();
        let mut programmes = Vec::new();
        parse(&xml[..], i64::MIN, i64::MAX, |c| channels.push(c), |p| programmes.push(p)).unwrap();
        assert_eq!(channels, vec![Channel { id: "télé".into(), names: vec!["Télé Un".into()] }]);
        assert_eq!(programmes.len(), 1);
        // Windows-1252 quotes (0x93, 0x94) are C1 controls in Latin-1 and are dropped.
        assert_eq!(programmes[0].title, "Téléjournal direct");
        assert_eq!(programmes[0].description.as_deref(), Some("Résumé"));
        assert_eq!(programmes[0].channel, "télé & co");
        assert!(('\u{80}'..='\u{9f}').all(|c| clip(&c.to_string(), 5).is_empty()));
    }

    #[test]
    fn reads_channels_and_programmes_in_the_window() {
        let xml = r#"<?xml version="1.0"?>
<tv>
  <channel id="news.one"><display-name>News One</display-name><display-name lang="fr">Nouvelles</display-name><icon src="x"/></channel>
  <programme start="20261003180000 +0000" stop="20261003190000 +0000" channel="news.one">
    <title lang="en">Evening &amp; News</title><desc><![CDATA[Top <stories>]]></desc>
  </programme>
  <programme start="20200101000000 +0000" stop="20200101010000 +0000" channel="news.one"><title>Old</title></programme>
  <programme start="20261003190000 +0000" stop="20261003180000 +0000" channel="news.one"><title>Backwards</title></programme>
  <programme start="20261003190000 +0000" stop="20261003200000 +0000" channel="news.one"><desc>No title</desc></programme>
</tv>"#;
        let (mut channels, mut programmes) = (Vec::new(), Vec::new());
        let from = parse_time("20261003000000").unwrap();
        let kept = parse(xml.as_bytes(), from, from + 86_400 * 2, |c| channels.push(c), |p| programmes.push(p)).unwrap();
        assert_eq!(channels, vec![Channel { id: "news.one".into(), names: vec!["News One".into(), "Nouvelles".into()] }]);
        assert_eq!(kept, 1);
        assert_eq!(programmes[0].title, "Evening & News");
        assert_eq!(programmes[0].description.as_deref(), Some("Top <stories>"));
        assert_eq!(programmes[0].stop - programmes[0].start, 3600);
    }

    #[test]
    fn a_programme_without_a_stop_runs_until_the_next_one() {
        let xml = r#"<tv>
  <programme start="20261003180000 +0000" channel="a"><title>One</title></programme>
  <programme start="20261003183000 +0000" channel="b"><title>Other channel</title></programme>
  <programme start="20261003190000 +0000" stop="20261003200000 +0000" channel="a"><title>Two</title></programme>
  <programme start="20261003200000 +0000" channel="a"><title>Three</title></programme>
</tv>"#;
        let mut got: Vec<(String, String, i64)> = run(xml.as_bytes()).into_iter().map(|p| (p.channel, p.title, p.stop - p.start)).collect();
        got.sort();
        assert_eq!(
            got,
            [("a".into(), "One".into(), 3600), ("a".into(), "Three".into(), OPEN_ENDED), ("a".into(), "Two".into(), 3600), ("b".into(), "Other channel".into(), OPEN_ENDED)]
        );
        // Outside the window once its end is known: left out.
        let from = parse_time("20261003190000").unwrap();
        let mut kept = Vec::new();
        parse(xml.as_bytes(), from, i64::MAX, |_| {}, |p| kept.push(p.title)).unwrap();
        kept.sort();
        assert_eq!(kept, ["Other channel", "Three", "Two"]);
    }

    #[test]
    fn a_programme_without_a_stop_ends_at_the_next_start_even_one_before_the_window() {
        // Yesterday's "Late Show" has no stop; the night's programme ends before the window; "Breakfast" is in it.
        let xml = r#"<tv>
  <programme start="20261002220000 +0000" channel="a"><title>Late Show</title></programme>
  <programme start="20261002230000 +0000" stop="20261003000000 +0000" channel="a"><title>Night</title></programme>
  <programme start="20261003070000 +0000" stop="20261003080000 +0000" channel="a"><title>Breakfast</title></programme>
</tv>"#;
        let got: Vec<(String, i64)> = run(xml.as_bytes()).into_iter().map(|p| (p.title, p.stop - p.start)).collect();
        assert_eq!(got, [("Late Show".into(), 3600), ("Night".into(), 3600), ("Breakfast".into(), 3600)]);
        // The window opens at 01:00: Late Show ended at 23:00, so it isn't stretched to 07:00 and shown.
        let from = parse_time("20261003010000").unwrap();
        let mut kept = Vec::new();
        parse(xml.as_bytes(), from, i64::MAX, |_| {}, |p| kept.push(p.title)).unwrap();
        assert_eq!(kept, ["Breakfast"]);
        // A programme dropped for having no title (or an empty element) still ends the open one.
        let xml = r#"<tv>
  <programme start="20261002220000 +0000" channel="a"><title>Late Show</title></programme>
  <programme start="20261002230000 +0000" stop="20261003000000 +0000" channel="a"/>
  <programme start="20261003070000 +0000" stop="20261003080000 +0000" channel="a"><desc>No title</desc></programme>
</tv>"#;
        let got: Vec<(String, i64)> = run(xml.as_bytes()).into_iter().map(|p| (p.title, p.stop - p.start)).collect();
        assert_eq!(got, [("Late Show".into(), 3600)]);
    }

    #[test]
    fn keeps_a_guide_with_a_bare_ampersand() {
        let xml = r#"<tv><programme start="20261003180000 +0000" stop="20261003190000 +0000" channel="a"><title>Tom & Jerry &amp; Friends</title><desc>Cat & mouse</desc></programme></tv>"#;
        let programmes = run(xml.as_bytes());
        assert_eq!(programmes.len(), 1);
        assert_eq!(programmes[0].title, "Tom & Jerry & Friends");
        assert_eq!(programmes[0].description.as_deref(), Some("Cat & mouse"));
    }

    #[test]
    fn rejects_broken_xml() {
        assert!(parse("<tv></channel>".as_bytes(), 0, i64::MAX, |_| {}, |_| {}).is_err());
    }
}
