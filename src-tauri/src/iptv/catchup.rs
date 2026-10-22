//! Catch-up (replay): building the address of a past programme from a
//! channel's archive. The rules follow Kodi's IPTV Simple client, which most
//! providers write their playlists for:
//!
//! - `default`: `catchup-source` is the whole address, with placeholders.
//! - `append`: `catchup-source` is added to the end of the channel's address.
//! - `shift`: `?utc={start}&lutc={now}` is added to the channel's address.
//! - `flussonic`: the archive lives beside the stream (`…/index-{start}-{duration}.m3u8`).
//! - `xc`: Xtream Codes' `timeshift/{user}/{pass}/{minutes}/{Y-m-d:H-M}/{id}.ts`.
//!
//! Addresses carry the login, so this runs in Rust only. Placeholders are
//! filled with numbers, never with text from elsewhere.

use reqwest::Url;

/// One programme to replay. Times are Unix seconds; `offset` is the
/// difference from UTC (in seconds) for placeholders that want a local time.
#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub start: i64,
    pub end: i64,
    pub now: i64,
    pub offset: i64,
}

/// A playlist's `catchup` value as one Orbit understands (Kodi's aliases folded in).
pub fn kind(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "default" => Some("default"),
        "append" => Some("append"),
        "shift" | "timeshift" => Some("shift"),
        "flussonic" | "flussonic-hls" | "flussonic-ts" | "fs" => Some("flussonic"),
        "xc" => Some("xc"),
        _ => None,
    }
}

/// Year, month, day for days since 1970-01-01 (proleptic Gregorian).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// `pattern` with Y m d H M S replaced by the (local) time's parts.
fn format_time(seconds: i64, offset: i64, pattern: &str) -> String {
    let local = seconds + offset;
    let (y, mo, d) = civil_from_days(local.div_euclid(86_400));
    let s = local.rem_euclid(86_400);
    pattern
        .chars()
        .map(|c| match c {
            'Y' => format!("{y:04}"),
            'm' => format!("{mo:02}"),
            'd' => format!("{d:02}"),
            'H' => format!("{:02}", s / 3600),
            'M' => format!("{:02}", s / 60 % 60),
            'S' => format!("{:02}", s % 60),
            other => other.to_string(),
        })
        .collect()
}

/// The value of one placeholder (without its braces), or None if unknown.
fn placeholder(name: &str, w: Window) -> Option<String> {
    let duration = (w.end - w.start).max(0);
    let (name, arg) = name.split_once(':').map_or((name, None), |(n, a)| (n, Some(a)));
    let divide = |value: i64| match arg {
        None => Some(value.to_string()),
        Some(a) => a.parse::<i64>().ok().filter(|n| *n > 0).map(|n| (value / n).to_string()),
    };
    let time = |at: i64| match arg {
        None => Some(at.to_string()),
        Some(pattern) => Some(format_time(at, w.offset, pattern)),
    };
    match name {
        "utc" | "start" => time(w.start),
        "utcend" | "end" => time(w.end),
        "lutc" | "now" | "timestamp" => time(w.now),
        "duration" => divide(duration),
        "offset" => divide((w.now - w.start).max(0)),
        "Y" | "m" | "d" | "H" | "M" | "S" if arg.is_none() => Some(format_time(w.start, w.offset, name)),
        _ => None,
    }
}

/// Fills `{name}` and `${name}` placeholders; unknown ones are left as they are.
pub fn fill(template: &str, w: Window) -> String {
    let mut out = String::with_capacity(template.len() + 32);
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let dollar = rest[..open].ends_with('$');
        out.push_str(&rest[..if dollar { open - 1 } else { open }]);
        let after = &rest[open + 1..];
        match after.find('}').and_then(|close| Some((close, placeholder(&after[..close], w)?))) {
            Some((close, value)) => {
                out.push_str(&value);
                rest = &after[close + 1..];
            }
            None => {
                out.push_str(if dollar { "${" } else { "{" });
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Only web addresses are played.
fn web(address: &str) -> Result<Url, String> {
    let url = Url::parse(address).map_err(|_| "err.iptv.replay-address")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("err.iptv.replay-address".into());
    }
    Ok(url)
}

/// Xtream's archive address for stream `id` on `server` (whose clock is `w.offset` from UTC).
pub fn xtream(server: &Url, username: &str, password: &str, id: &str, ext: &str, w: Window) -> Result<Url, String> {
    let minutes = ((w.end - w.start).max(60) + 59) / 60;
    let mut url = server.clone();
    url.set_query(None);
    url.path_segments_mut()
        .map_err(|_| "invalid server address")?
        .pop_if_empty()
        .push("timeshift")
        .push(username)
        .push(password)
        .push(&minutes.to_string())
        .push(&format_time(w.start, w.offset, "Y-m-d:H-M"))
        .push(&format!("{id}.{ext}"));
    Ok(url)
}

/// An Xtream stream address (`…/[live/]{user}/{pass}/{id}.{ext}`) as its
/// panel, username, password, stream id and extension.
pub fn xc_parts(stream: &str) -> Option<(Url, String, String, String, String)> {
    let url = web(stream).ok()?;
    let segments: Vec<String> = url.path_segments()?.map(String::from).collect();
    let [.., user, pass, file] = segments.as_slice() else { return None };
    let (id, ext) = file.rsplit_once('.').unwrap_or((file, "ts"));
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut server = url.clone();
    server.set_path("");
    server.set_query(None);
    Some((server, percent_decode(user), percent_decode(pass), id.to_string(), ext.to_string()))
}

/// The replay address for a channel at `stream` with archive `kind` (and its `catchup-source`).
pub fn address(stream: &str, kind: &str, source: Option<&str>, w: Window) -> Result<Url, String> {
    let with_query = |extra: &str| {
        let joiner = if stream.contains('?') { '&' } else { '?' };
        format!("{stream}{joiner}{}", extra.trim_start_matches(['?', '&']))
    };
    match kind {
        "default" => web(&fill(source.ok_or("err.iptv.no-replay")?, w)),
        "append" => {
            let extra = fill(source.ok_or("err.iptv.no-replay")?, w);
            // A source starting with ? or & adds to the query; anything else is added as written.
            if extra.starts_with(['?', '&']) { web(&with_query(&extra)) } else { web(&format!("{stream}{extra}")) }
        }
        "shift" => web(&with_query(&format!("utc={}&lutc={}", w.start, w.now))),
        "flussonic" => {
            let mut url = web(stream)?;
            let last = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or_default().to_string();
            let replay = if last == "mpegts" {
                format!("timeshift_abs-{}.ts", w.start)
            } else if let Some(stem) = last.strip_suffix(".m3u8") {
                format!("{stem}-{}-{}.m3u8", w.start, (w.end - w.start).max(0))
            } else {
                return Err("err.iptv.replay-format".into());
            };
            url.path_segments_mut().map_err(|_| "invalid address")?.pop().push(&replay);
            Ok(url)
        }
        "xc" => {
            let (server, user, pass, id, ext) = xc_parts(stream).ok_or("err.iptv.replay-format")?;
            xtream(&server, &user, &pass, &id, &ext, w)
        }
        _ => Err("err.iptv.no-replay".into()),
    }
}

/// `%xx` escapes back to text (path segments arrive escaped).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(byte) = text.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-10-03 18:30:00 UTC, one hour long; now is 20:00; local time is UTC+2.
    const W: Window = Window { start: 1_791_052_200, end: 1_791_055_800, now: 1_791_057_600, offset: 7200 };

    #[test]
    fn dates_round_trip() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_729), (2026, 10, 3));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(format_time(W.start, 0, "Y-m-d:H-M"), "2026-10-03:18-30");
        assert_eq!(format_time(W.start, W.offset, "YmdHMS"), "20261003203000");
    }

    #[test]
    fn fills_placeholders() {
        assert_eq!(fill("a?utc={utc}&lutc={lutc}&d={duration}", W), "a?utc=1791052200&lutc=1791057600&d=3600");
        assert_eq!(fill("${start}-${end}/{duration:60}/{offset:60}", W), "1791052200-1791055800/60/90");
        assert_eq!(fill("{Y}/{m}/{d}/{H}{M}/{utc:Y-m-d}", W), "2026/10/03/2030/2026-10-03");
        assert_eq!(fill("{unknown}{utc", W), "{unknown}{utc");
        assert_eq!(fill("{duration:0}", W), "{duration:0}");
    }

    #[test]
    fn builds_each_kind() {
        let at = |stream: &str, kind: &str, source: Option<&str>| address(stream, kind, source, W).map(String::from);
        assert_eq!(at("http://s.example/1.ts", "shift", None).unwrap(), "http://s.example/1.ts?utc=1791052200&lutc=1791057600");
        assert_eq!(at("http://s.example/1.ts?t=x", "shift", None).unwrap(), "http://s.example/1.ts?t=x&utc=1791052200&lutc=1791057600");
        assert_eq!(at("http://s.example/1.m3u8", "append", Some("?start={utc}")).unwrap(), "http://s.example/1.m3u8?start=1791052200");
        assert_eq!(at("http://s.example/1", "default", Some("https://a.example/{utc}/{duration}.m3u8")).unwrap(), "https://a.example/1791052200/3600.m3u8");
        assert!(at("http://s.example/1", "default", Some("file:///C:/x{utc}")).is_err());
        assert_eq!(at("http://f.example/ch1/index.m3u8?token=t", "flussonic", None).unwrap(), "http://f.example/ch1/index-1791052200-3600.m3u8?token=t");
        assert_eq!(at("http://f.example/ch1/mpegts", "flussonic", None).unwrap(), "http://f.example/ch1/timeshift_abs-1791052200.ts");
        assert_eq!(at("http://p.example:8080/live/me%40x/p%2Fw/42.ts", "xc", None).unwrap(), "http://p.example:8080/timeshift/me@x/p%2Fw/60/2026-10-03:20-30/42.ts");
        assert_eq!(at("http://p.example/me/pw/42", "xc", None).unwrap(), "http://p.example/timeshift/me/pw/60/2026-10-03:20-30/42.ts");
        assert!(at("http://p.example/42.ts", "xc", None).is_err());
        assert!(at("http://s.example/1", "vod", None).is_err());
    }
}
