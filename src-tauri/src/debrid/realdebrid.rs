//! Real-Debrid (https://api.real-debrid.com/rest/1.0, Bearer API token,
//! 250 requests a minute). The account's torrents are its cloud: each lists
//! its files, and the selected ones each have a hoster link (in file order)
//! that `/unrestrict/link` turns into a download address at play time.

use reqwest::{Method, Url};
use serde_json::Value;

use super::net::{self, Body, Fail};
use super::{Account, Api, Content, Entry, Item, MAX_FILES, MAX_ITEMS, State};

const API: &str = "https://api.real-debrid.com/rest/1.0";
/// Torrents per page (Real-Debrid allows up to 5000; smaller pages answer faster).
const PAGE: usize = 1000;

fn url(path: &str, query: &[(&str, &str)]) -> Result<Url, Fail> {
    let mut url = Url::parse(&format!("{API}{path}")).map_err(|_| Fail::Invalid)?;
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(url)
}

/// Real-Debrid's torrent ids: short, letters and digits.
pub fn is_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// `/user`: the name, and until when it's premium (`premium` counts the seconds left).
pub fn parse_user(value: &Value, now_ms: i64) -> Result<Account, Fail> {
    let user_name = value.get("username").and_then(Value::as_str).map(|n| net::clean(n, 80)).filter(|n| !n.is_empty()).ok_or(Fail::Invalid)?;
    let premium = value.get("type").and_then(Value::as_str) == Some("premium");
    let left = value.get("premium").and_then(Value::as_i64).filter(|s| *s > 0);
    let premium_until = match (premium, left) {
        (true, Some(seconds)) => Some(now_ms.saturating_add(seconds.saturating_mul(1000))),
        (true, None) => value.get("expiration").and_then(Value::as_str).and_then(net::iso_ms),
        _ => None,
    };
    Ok(Account { user_name, premium_until })
}

/// What a torrent's status means for the person: ready to play, on its way, waiting, or failed.
pub fn state_of(status: &str) -> State {
    match status {
        "downloaded" => State::Ready,
        "downloading" | "compressing" | "uploading" => State::Downloading,
        "queued" | "magnet_conversion" | "waiting_files_selection" => State::Queued,
        _ => State::Error,
    }
}

/// One `/torrents` page; anything that doesn't fit is left out.
pub fn parse_torrents(value: &Value) -> Vec<Item> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_ITEMS)
        .filter_map(|t| {
            let id = t.get("id").and_then(Value::as_str).filter(|id| is_id(id))?;
            let name = t.get("filename").and_then(Value::as_str).map(|n| net::clean(n, 300)).filter(|n| !n.is_empty())?;
            let state = state_of(t.get("status").and_then(Value::as_str).unwrap_or_default());
            let progress = t.get("progress").and_then(Value::as_f64).filter(|p| p.is_finite()).map_or(0.0, |p| p.clamp(0.0, 100.0));
            Some(Item {
                provider: "realdebrid",
                id: id.to_string(),
                name,
                size: t.get("bytes").and_then(Value::as_u64).unwrap_or(0),
                state,
                progress: if state == State::Ready { 100.0 } else { progress },
                added: t.get("added").and_then(Value::as_str).and_then(net::iso_ms),
                deletable: true,
            })
        })
        .collect()
}

/// A hoster link Real-Debrid gave for a file: an https address on its own site.
fn is_hoster_link(link: &str) -> bool {
    link.len() <= 512 && Url::parse(link).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| h == "real-debrid.com" || h.ends_with(".real-debrid.com")))
}

/// `/torrents/info/{id}`: its name, whether it's ready, and its files. The
/// selected files (in id order) line up with `links`; when they don't (the
/// files were packed into one archive), none of them can be played alone.
pub fn parse_info(value: &Value) -> Result<Content, Fail> {
    let name = value.get("filename").and_then(Value::as_str).map(|n| net::clean(n, 300)).unwrap_or_default();
    let ready = state_of(value.get("status").and_then(Value::as_str).unwrap_or_default()) == State::Ready;
    let mut files: Vec<(u64, String, u64, bool)> = value
        .get("files")
        .and_then(Value::as_array)
        .ok_or(Fail::Invalid)?
        .iter()
        .take(MAX_FILES)
        .filter_map(|f| {
            let id = f.get("id").and_then(Value::as_u64)?;
            let path = f.get("path").and_then(Value::as_str)?;
            let path = net::clean(path.trim_start_matches('/'), 500);
            (!path.is_empty()).then(|| (id, path, f.get("bytes").and_then(Value::as_u64).unwrap_or(0), f.get("selected").and_then(Value::as_i64) == Some(1)))
        })
        .collect();
    files.sort_by_key(|f| f.0);
    let links: Vec<&str> = value.get("links").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
    let selected = files.iter().filter(|f| f.3).count();
    let lined_up = selected == links.len() && links.iter().all(|l| is_hoster_link(l));
    let mut next = links.into_iter();
    let entries = files
        .into_iter()
        .map(|(id, path, size, picked)| {
            let link = if picked && lined_up { next.next().map(str::to_string) } else { None };
            Entry { id, path, size, playable: link.is_some(), link }
        })
        .collect();
    Ok(Content { name, ready, entries })
}

/// `/unrestrict/link`'s download address, checked before anything plays it.
pub fn parse_unrestricted(value: &Value) -> Result<Url, Fail> {
    net::check_link(value.get("download").and_then(Value::as_str).ok_or(Fail::Invalid)?)
}

pub async fn user(api: &Api<'_>, now_ms: i64) -> Result<Account, Fail> {
    parse_user(&api.call(Method::GET, url("/user", &[])?, Body::None, 64 * 1024).await?, now_ms)
}

/// Every torrent in the account, newest first (as Real-Debrid lists them), up to `MAX_ITEMS`.
pub async fn list(api: &Api<'_>) -> Result<Vec<Item>, Fail> {
    let mut items = Vec::new();
    for page in 1.. {
        let (page_s, limit_s) = (page.to_string(), PAGE.to_string());
        let value = api.call(Method::GET, url("/torrents", &[("page", &page_s), ("limit", &limit_s)])?, Body::None, net::JSON_LIMIT).await?;
        let count = value.as_array().map_or(0, Vec::len);
        items.extend(parse_torrents(&value));
        if count < PAGE || items.len() >= MAX_ITEMS {
            break;
        }
    }
    items.truncate(MAX_ITEMS);
    Ok(items)
}

pub async fn files(api: &Api<'_>, id: &str) -> Result<Content, Fail> {
    if !is_id(id) {
        return Err(Fail::Invalid);
    }
    parse_info(&api.call(Method::GET, url(&format!("/torrents/info/{id}"), &[])?, Body::None, net::JSON_LIMIT).await?)
}

/// A fresh download address for a file's hoster link. Never kept: it's made at play time.
pub async fn unrestrict(api: &Api<'_>, link: &str) -> Result<Url, Fail> {
    if !is_hoster_link(link) {
        return Err(Fail::Invalid);
    }
    parse_unrestricted(&api.call(Method::POST, url("/unrestrict/link", &[])?, Body::Form(&[("link", link)]), 256 * 1024).await?)
}

pub async fn delete(api: &Api<'_>, id: &str) -> Result<(), Fail> {
    if !is_id(id) {
        return Err(Fail::Invalid);
    }
    api.call(Method::DELETE, url(&format!("/torrents/delete/{id}"), &[])?, Body::None, 64 * 1024).await.map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn users() {
        let now = 1_000_000;
        let account = parse_user(&json!({ "id": 1, "username": "sam\u{7}", "email": "s@x", "type": "premium", "premium": 86_400, "expiration": "2026-11-01T00:00:00.000Z" }), now).unwrap();
        assert_eq!(account.user_name, "sam");
        assert_eq!(account.premium_until, Some(now + 86_400_000));
        let free = parse_user(&json!({ "username": "sam", "type": "free", "premium": 0 }), now).unwrap();
        assert_eq!(free.premium_until, None);
        let dated = parse_user(&json!({ "username": "sam", "type": "premium", "expiration": "1970-01-02T00:00:00Z" }), now).unwrap();
        assert_eq!(dated.premium_until, Some(86_400_000));
        assert!(parse_user(&json!({ "error": "bad_token" }), now).is_err());
    }

    #[test]
    fn statuses() {
        assert_eq!(state_of("downloaded"), State::Ready);
        assert_eq!(state_of("downloading"), State::Downloading);
        assert_eq!(state_of("compressing"), State::Downloading);
        assert_eq!(state_of("waiting_files_selection"), State::Queued);
        assert_eq!(state_of("magnet_conversion"), State::Queued);
        for bad in ["magnet_error", "error", "virus", "dead", "something new"] {
            assert_eq!(state_of(bad), State::Error, "{bad}");
        }
    }

    #[test]
    fn torrent_lists() {
        let value = json!([
            { "id": "ABC123", "filename": "Show.S01.1080p.WEB", "hash": "x", "bytes": 5_000_000_000u64, "status": "downloaded", "progress": 100, "added": "2026-10-01T10:00:00.000Z", "links": ["https://real-debrid.com/d/AAA"] },
            { "id": "DEF456", "filename": "Movie.2024.2160p", "bytes": 20, "status": "downloading", "progress": 42.5, "added": "2026-10-02T10:00:00.000Z" },
            { "id": "../x", "filename": "Bad", "status": "downloaded" },
            { "id": "GHI789", "status": "downloaded" },
            7
        ]);
        let items = parse_torrents(&value);
        assert_eq!(items.len(), 2);
        assert_eq!((items[0].id.as_str(), items[0].state, items[0].progress), ("ABC123", State::Ready, 100.0));
        assert_eq!((items[1].state, items[1].progress, items[1].size), (State::Downloading, 42.5, 20));
        assert!(items[1].added > items[0].added);
        assert!(parse_torrents(&json!({ "error": "x" })).is_empty());
    }

    #[test]
    fn files_line_up_with_links() {
        let value = json!({
            "id": "ABC123", "filename": "Show.S01", "status": "downloaded",
            "files": [
                { "id": 3, "path": "/Show.S01/Show.S01E02.mkv", "bytes": 200, "selected": 1 },
                { "id": 1, "path": "/Show.S01/Show.S01E01.mkv", "bytes": 100, "selected": 1 },
                { "id": 2, "path": "/Show.S01/info.nfo", "bytes": 1, "selected": 0 }
            ],
            "links": ["https://real-debrid.com/d/ONE", "https://real-debrid.com/d/TWO"]
        });
        let content = parse_info(&value).unwrap();
        assert!(content.ready);
        assert_eq!(content.name, "Show.S01");
        let ids: Vec<(u64, Option<&str>)> = content.entries.iter().map(|e| (e.id, e.link.as_deref())).collect();
        assert_eq!(ids, [(1, Some("https://real-debrid.com/d/ONE")), (2, None), (3, Some("https://real-debrid.com/d/TWO"))]);
        assert_eq!(content.entries[0].path, "Show.S01/Show.S01E01.mkv");
        // Packed into one archive: one link for two files, so neither plays alone.
        let packed = parse_info(&json!({ "status": "downloaded", "files": [{ "id": 1, "path": "/a.mkv", "selected": 1 }, { "id": 2, "path": "/b.mkv", "selected": 1 }], "links": ["https://real-debrid.com/d/ONE"] })).unwrap();
        assert!(packed.entries.iter().all(|e| !e.playable && e.link.is_none()));
        // A link elsewhere than Real-Debrid is never followed.
        let odd = parse_info(&json!({ "status": "downloaded", "files": [{ "id": 1, "path": "/a.mkv", "selected": 1 }], "links": ["https://evil.example/d/ONE"] })).unwrap();
        assert!(!odd.entries[0].playable);
        assert!(parse_info(&json!({})).is_err());
    }

    #[test]
    fn unrestricted_links_are_checked() {
        let url = parse_unrestricted(&json!({ "id": "X", "filename": "a.mkv", "download": "https://abc.download.real-debrid.com/d/XYZ/a.mkv", "streamable": 1 })).unwrap();
        assert_eq!(url.host_str(), Some("abc.download.real-debrid.com"));
        assert!(parse_unrestricted(&json!({ "download": "http://abc.download.real-debrid.com/d/XYZ/a.mkv" })).is_err());
        assert!(parse_unrestricted(&json!({ "download": "https://10.0.0.1/a.mkv" })).is_err());
        assert!(parse_unrestricted(&json!({ "error": "hoster_unavailable" })).is_err());
    }

    #[test]
    fn ids() {
        assert!(is_id("ABCDEF123") && !is_id("") && !is_id("a/b") && !is_id(&"A".repeat(41)));
        assert!(is_hoster_link("https://real-debrid.com/d/ABC") && !is_hoster_link("https://real-debrid.com.evil/d") && !is_hoster_link("http://real-debrid.com/d/A"));
    }
}
