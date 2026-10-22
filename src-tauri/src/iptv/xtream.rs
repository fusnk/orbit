//! Xtream Codes panels (`player_api.php`). Every address carries the
//! username and password, so they're built here and never leave Rust.

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_TEXT: usize = 200;

pub struct Login {
    /// The panel's base, e.g. `http://panel.example:8080`.
    pub server: Url,
    pub username: String,
    pub password: String,
}

/// A panel address as typed: http(s), no path tricks; trailing slashes dropped.
pub fn parse_server(input: &str) -> Result<Url, String> {
    let mut url = Url::parse(input.trim()).map_err(|_| "err.address.invalid")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("err.address.scheme".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("err.iptv.login-in-address".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    // People paste player_api.php or get.php links; keep just the panel.
    let path = url.path().trim_end_matches('/').trim_end_matches("player_api.php").trim_end_matches("get.php").trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url)
}

impl Login {
    fn with_path(&self, path: &str) -> Result<Url, String> {
        let base = self.server.as_str().trim_end_matches('/');
        Url::parse(&format!("{base}/{path}")).map_err(|_| "invalid server address".into())
    }

    /// `player_api.php?username&password[&action=…]`.
    pub fn api(&self, action: Option<&str>) -> Result<Url, String> {
        let mut url = self.with_path("player_api.php")?;
        url.query_pairs_mut().append_pair("username", &self.username).append_pair("password", &self.password);
        if let Some(action) = action {
            url.query_pairs_mut().append_pair("action", action);
        }
        Ok(url)
    }

    /// The panel's XMLTV guide.
    pub fn guide(&self) -> Result<Url, String> {
        let mut url = self.with_path("xmltv.php")?;
        url.query_pairs_mut().append_pair("username", &self.username).append_pair("password", &self.password);
        Ok(url)
    }

    /// A past programme of stream `id` from the archive (`offset`: the server's clock).
    pub fn replay(&self, id: &str, ext: &str, start: i64, end: i64, offset: i64) -> Result<Url, String> {
        super::catchup::xtream(&self.server, &self.username, &self.password, id, ext, super::catchup::Window { start, end, now: start, offset })
    }

    pub fn vod(&self, kind: &str, id: &str, ext: &str) -> Result<Url, String> {
        if !matches!(kind, "movie" | "series") || !id.bytes().all(|b| b.is_ascii_digit()) || id.is_empty() || !matches!(ext, "mp4" | "mkv" | "avi" | "mov" | "ts" | "m3u8" | "webm") {
            return Err("invalid IPTV VOD locator".into());
        }
        let mut url = self.with_path(kind)?;
        url.path_segments_mut().map_err(|_| "invalid server address")?.push(&self.username).push(&self.password).push(&format!("{id}.{ext}"));
        Ok(url)
    }

    /// `live/{user}/{pass}/{id}.{ext}`, with the credentials path-escaped.
    pub fn stream(&self, id: &str, ext: &str) -> Result<Url, String> {
        let mut url = self.with_path("live")?;
        url.path_segments_mut().map_err(|_| "invalid server address")?.push(&self.username).push(&self.password).push(&format!("{id}.{ext}"));
        Ok(url)
    }
}

/// Numbers arrive as numbers or strings depending on the panel.
fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
    .filter(|s: &String| !s.is_empty())
}

#[derive(Deserialize)]
struct Account {
    user_info: Option<Value>,
    server_info: Option<Value>,
}

/// What a good login says about the account.
#[derive(Debug, PartialEq)]
pub struct AccountInfo {
    /// Stream container: "ts" or "m3u8".
    pub ext: &'static str,
    /// The server's clock, in seconds from UTC: archive addresses use its local time.
    pub offset: Option<i64>,
    /// The server's time zone, when it names one that agrees with `offset`: a
    /// programme's local time follows its daylight saving (see `clock_at`).
    pub zone: Option<String>,
}

/// The server's UTC offset from `time_now` ("2026-10-03 20:30:00", its local
/// time) beside `timestamp_now` (Unix seconds), to the nearest quarter hour.
fn server_offset(info: &Value) -> Option<i64> {
    let local = info.get("time_now").and_then(Value::as_str)?;
    let unix = info.get("timestamp_now").and_then(text)?.parse::<i64>().ok()?;
    let stamp: String = local.chars().filter(char::is_ascii_digit).collect();
    let as_utc = super::xmltv::parse_time(&stamp)?;
    // The provider's number can be anything: an overflow is no offset.
    let offset = as_utc.checked_sub(unix)?.checked_add(450)?.div_euclid(900) * 900;
    (offset.abs() <= 14 * 3600).then_some(offset)
}

/// The server's time zone (`timezone`, e.g. "Europe/London"), if it's one
/// Orbit knows and it agrees with the clock measured beside it (a panel's
/// setting can be stale or wrong; its clock is what the archive follows).
fn server_zone(info: &Value, offset: i64) -> Option<String> {
    let name = info.get("timezone").and_then(Value::as_str)?;
    if name.is_empty() || name.len() > 64 || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"/_+-".contains(&b)) {
        return None;
    }
    let unix = info.get("timestamp_now").and_then(text)?.parse::<i64>().ok()?;
    (zone_offset(name, unix)? == offset).then(|| name.to_string())
}

/// Zone `name`'s offset from UTC (seconds) at `at` (Unix seconds).
fn zone_offset(name: &str, at: i64) -> Option<i64> {
    let zone = jiff::tz::TimeZone::get(name).ok()?;
    Some(i64::from(zone.to_offset(jiff::Timestamp::from_second(at).ok()?).seconds()))
}

/// The server's clock at `at` (Unix seconds), in seconds from UTC: its zone's
/// offset at that moment, so a programme from before a daylight-saving change
/// gets the clock it aired under; else the offset measured at the last refresh.
pub fn clock_at(offset: Option<i64>, zone: Option<&str>, at: i64) -> Option<i64> {
    zone.and_then(|z| zone_offset(z, at)).or(offset)
}

/// Checks the login; Ok(what it says) or a message saying what's wrong.
pub fn check_account(body: &str) -> Result<AccountInfo, String> {
    let account: Account = serde_json::from_str(body).map_err(|_| "err.iptv.not-xtream")?;
    let info = account.user_info.ok_or("err.iptv.wrong-login")?;
    // Some panels answer an expired or banned account with `auth: 0` and its
    // status: that's what to say, not "wrong login".
    if let Some(status) = info.get("status").and_then(text)
        && !status.eq_ignore_ascii_case("active")
    {
        return Err(crate::user_error::coded("iptv.account", &[("status", &status.to_lowercase())]));
    }
    // `1`, `"1"`, or (some panels) `true`.
    let auth = info.get("auth").is_some_and(|a| a.as_bool() == Some(true) || text(a).is_some_and(|a| a == "1"));
    if !auth {
        return Err("err.iptv.wrong-login".into());
    }
    // Prefer MPEG-TS; some panels only allow HLS.
    let formats = info.get("allowed_output_formats").and_then(Value::as_array).cloned().unwrap_or_default();
    let allows = |f: &str| formats.iter().any(|v| v.as_str() == Some(f));
    let ext = if formats.is_empty() || allows("ts") { "ts" } else { "m3u8" };
    let offset = account.server_info.as_ref().and_then(server_offset);
    let zone = account.server_info.as_ref().zip(offset).and_then(|(info, offset)| server_zone(info, offset));
    Ok(AccountInfo { ext, offset, zone })
}

/// What the panel says about the account, for Settings → Live TV. No login:
/// just its state, when it ends and how many streams it allows.
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountDetails {
    /// "active", "expired", "banned", "disabled"… (lower case), if given.
    pub status: Option<String>,
    /// Unix seconds; None for an account that doesn't expire.
    pub expires: Option<i64>,
    pub max_connections: Option<i64>,
    pub active_connections: Option<i64>,
    pub trial: bool,
    /// When Orbit asked (Unix ms).
    pub checked_at: i64,
}

/// A count or a time as panels send them: a number, or digits in a string.
fn number(value: Option<&Value>) -> Option<i64> {
    value.and_then(text).and_then(|t| t.parse::<i64>().ok()).filter(|n| *n >= 0)
}

/// The account's details from `player_api.php`'s answer, whether or not the
/// login is still good (an expired account is exactly what to show).
pub fn account_details(body: &str, now_ms: i64) -> Option<AccountDetails> {
    let account: Account = serde_json::from_str(body).ok()?;
    let info = account.user_info?;
    let status = info.get("status").and_then(text).map(|s| s.to_lowercase().chars().take(40).collect());
    // 0 is how some panels say "never".
    let expires = number(info.get("exp_date")).filter(|t| *t > 0);
    Some(AccountDetails {
        status,
        expires,
        max_connections: number(info.get("max_connections")),
        active_connections: number(info.get("active_cons")),
        trial: info.get("is_trial").and_then(text).is_some_and(|t| t == "1"),
        checked_at: now_ms,
    })
}

pub struct Stream {
    pub id: String,
    pub name: String,
    pub logo: Option<String>,
    pub group: Option<String>,
    pub epg_id: Option<String>,
    /// Days of archive (catch-up), 0 if none.
    pub archive_days: i64,
}

/// `get_live_categories` + `get_live_streams` into channels with group names.
pub fn streams(categories: &str, streams: &str, limit: usize) -> Result<Vec<Stream>, String> {
    let categories: Vec<Value> = serde_json::from_str(categories).unwrap_or_default();
    let names: std::collections::HashMap<String, String> = categories
        .iter()
        .filter_map(|c| Some((c.get("category_id").and_then(text)?, c.get("category_name").and_then(text)?)))
        .collect();
    let list: Vec<Value> = serde_json::from_str(streams).map_err(|_| "err.iptv.channels-unreadable")?;
    Ok(list
        .iter()
        .filter_map(|s| {
            let id = s.get("stream_id").and_then(text).filter(|id| id.bytes().all(|b| b.is_ascii_alphanumeric()))?;
            Some(Stream {
                id,
                name: s.get("name").and_then(text)?,
                logo: s.get("stream_icon").and_then(text).filter(|l| l.starts_with("http://") || l.starts_with("https://")),
                group: s.get("category_id").and_then(text).and_then(|c| names.get(&c).cloned()),
                epg_id: s.get("epg_channel_id").and_then(text),
                archive_days: if s.get("tv_archive").and_then(text).is_some_and(|a| a == "1") {
                    s.get("tv_archive_duration").and_then(text).and_then(|d| d.parse::<i64>().ok()).unwrap_or(0).clamp(0, super::m3u::MAX_ARCHIVE_DAYS)
                } else {
                    0
                },
            })
        })
        .take(limit)
        .collect())
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    let text = String::from_utf8_lossy(data);
    let _ = check_account(&text);
    let _ = account_details(&text, 0);
    if let Ok(items) = streams(&text, &text, 256) {
        assert!(items.len() <= 256);
    }
    let _ = parse_server(&text);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login() -> Login {
        Login { server: parse_server("http://panel.example:8080/player_api.php?username=x").unwrap(), username: "me@x".into(), password: "p/ss w".into() }
    }

    #[test]
    fn builds_addresses_with_escaped_credentials() {
        let l = login();
        assert_eq!(l.server.as_str(), "http://panel.example:8080/");
        assert_eq!(l.api(Some("get_live_streams")).unwrap().as_str(), "http://panel.example:8080/player_api.php?username=me%40x&password=p%2Fss+w&action=get_live_streams");
        assert_eq!(l.stream("123", "ts").unwrap().as_str(), "http://panel.example:8080/live/me@x/p%2Fss%20w/123.ts");
        assert!(parse_server("ftp://panel.example").is_err());
        assert!(parse_server("http://u:p@panel.example").is_err());
    }

    #[test]
    fn the_servers_clock_follows_daylight_saving() {
        // Measured on 3 October, in British Summer Time (UTC+1); British clocks go back on 25 October.
        let body = r#"{"user_info":{"auth":1},"server_info":{"timestamp_now":1791052200,"time_now":"2026-10-03 19:30:00","timezone":"Europe/London"}}"#;
        let account = check_account(body).unwrap();
        assert_eq!((account.offset, account.zone.as_deref()), (Some(3600), Some("Europe/London")));
        let (summer, winter) = (1_791_052_200, 1_791_052_200 + 27 * 86_400);
        assert_eq!(clock_at(account.offset, account.zone.as_deref(), summer), Some(3600));
        assert_eq!(clock_at(account.offset, account.zone.as_deref(), winter), Some(0));
        // A zone that disagrees with the panel's own clock, or isn't one, is ignored: the measured offset stays.
        for zone in ["America/New_York", "Not/A_Zone", "../../etc/passwd"] {
            let body = format!(r#"{{"user_info":{{"auth":1}},"server_info":{{"timestamp_now":1791052200,"time_now":"2026-10-03 19:30:00","timezone":"{zone}"}}}}"#);
            let account = check_account(&body).unwrap();
            assert_eq!((account.offset, account.zone), (Some(3600), None));
            assert_eq!(clock_at(account.offset, None, winter), Some(3600));
        }
    }

    #[test]
    fn checks_accounts() {
        assert_eq!(check_account(r#"{"user_info":{"auth":1,"status":"Active","allowed_output_formats":["m3u8"]}}"#), Ok(AccountInfo { ext: "m3u8", offset: None, zone: None }));
        assert_eq!(
            check_account(r#"{"user_info":{"auth":"1","status":"Active"},"server_info":{"timestamp_now":1791052190,"time_now":"2026-10-03 20:30:00"}}"#),
            Ok(AccountInfo { ext: "ts", offset: Some(7200), zone: None })
        );
        assert_eq!(check_account(r#"{"user_info":{"auth":1},"server_info":{"timestamp_now":"1791052200","time_now":"2026-10-03 13:30:00"}}"#).unwrap().offset, Some(-5 * 3600));
        assert_eq!(check_account(r#"{"user_info":{"auth":1},"server_info":{"timestamp_now":1,"time_now":"2026-10-03 13:30:00"}}"#).unwrap().offset, None);
        // A clock at the end of the range is no clock, not an overflow.
        for extreme in ["-9223372036854775808", "9223372036854775807"] {
            let body = format!(r#"{{"user_info":{{"auth":1}},"server_info":{{"timestamp_now":"{extreme}","time_now":"2026-10-03 13:30:00"}}}}"#);
            assert_eq!(check_account(&body).unwrap().offset, None);
        }
        assert_eq!(check_account(r#"{"user_info":{"auth":0}}"#).unwrap_err(), "err.iptv.wrong-login");
        assert!(check_account(r#"{"user_info":{"auth":0,"status":"Expired"}}"#).unwrap_err().contains("expired"));
        assert!(check_account(r#"{"user_info":{"auth":true,"status":"Active"}}"#).is_ok());
        assert!(check_account(r#"{"user_info":{"auth":false}}"#).is_err());
        assert!(check_account(r#"{"user_info":{"auth":1,"status":"Expired"}}"#).unwrap_err().contains("expired"));
        assert!(check_account("<html>nope</html>").is_err());
    }

    #[test]
    fn reads_account_details() {
        // As panels send it: numbers as strings, nulls for "unlimited".
        let body = r#"{"user_info":{"username":"me","password":"pw","message":"","auth":1,"status":"Active","exp_date":"1792000000","is_trial":"0","active_cons":"1","created_at":"1700000000","max_connections":"2","allowed_output_formats":["m3u8","ts"]},
                      "server_info":{"url":"panel.example","port":"8080","timezone":"Europe/London"}}"#;
        let d = account_details(body, 5).unwrap();
        assert_eq!(d, AccountDetails { status: Some("active".into()), expires: Some(1_792_000_000), max_connections: Some(2), active_connections: Some(1), trial: false, checked_at: 5 });
        let d = account_details(r#"{"user_info":{"auth":1,"status":"Active","exp_date":null,"max_connections":1,"active_cons":0,"is_trial":"1"}}"#, 0).unwrap();
        assert_eq!((d.expires, d.max_connections, d.active_connections, d.trial), (None, Some(1), Some(0), true));
        // An expired account still says so (the login check refuses it).
        let d = account_details(r#"{"user_info":{"auth":0,"status":"Expired","exp_date":"0"}}"#, 0).unwrap();
        assert_eq!((d.status.as_deref(), d.expires), (Some("expired"), None));
        assert!(account_details("<html/>", 0).is_none() && account_details("{}", 0).is_none());
        assert_eq!(account_details(r#"{"user_info":{"max_connections":"-3"}}"#, 0).unwrap().max_connections, None);
    }

    #[test]
    fn reads_streams_with_groups() {
        let cats = r#"[{"category_id":"1","category_name":"News"}]"#;
        let list = r#"[{"stream_id":10,"name":"News One","stream_icon":"https://l.example/a.png","category_id":"1","epg_channel_id":"news.one","tv_archive":1,"tv_archive_duration":"7"},
                       {"stream_id":"../x","name":"Bad id"},{"stream_id":11,"name":"","category_id":1},{"stream_id":12,"name":"Two","stream_icon":"data:x"}]"#;
        let s = streams(cats, list, 100).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].id.as_str(), s[0].group.as_deref(), s[0].epg_id.as_deref()), ("10", Some("News"), Some("news.one")));
        assert_eq!((s[0].archive_days, s[1].archive_days), (7, 0));
        assert_eq!(s[1].logo, None);
        assert_eq!(
            login().replay("10", "ts", 1_791_052_200, 1_791_055_800, 7200).unwrap().as_str(),
            "http://panel.example:8080/timeshift/me@x/p%2Fss%20w/60/2026-10-03:20-30/10.ts"
        );
    }
}
