//! TorBox (https://api.torbox.app/v1/api, Bearer API key, 300 requests a
//! minute per account). The cloud is three lists: torrents, usenet and web
//! downloads, each item with its files. A file becomes a download address
//! with `requestdl` (asked with `redirect=false`, so the CDN address comes
//! back as data and no player or downloader ever holds the API address).
//!
//! `requestdl` takes the API key only as the `token` query parameter (it
//! ignores the Authorization header). That address is built here, sent only
//! to api.torbox.app over https with redirects off (see net.rs), and never
//! logged, kept or put in an error.

use reqwest::{Method, Url};
use serde_json::{Value, json};

use super::net::{self, Body, Fail};
use super::{Account, Api, Content, Entry, Item, MAX_FILES, MAX_ITEMS, State};

const API: &str = "https://api.torbox.app/v1/api";
const PAGE: usize = 1000;

/// What kind of download an item is. Orbit's ids for TorBox items start with its letter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Torrent,
    Usenet,
    Web,
}

impl Kind {
    pub const ALL: [Self; 3] = [Self::Torrent, Self::Usenet, Self::Web];

    fn letter(self) -> char {
        match self {
            Self::Torrent => 't',
            Self::Usenet => 'u',
            Self::Web => 'w',
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::Torrent => "torrents",
            Self::Usenet => "usenet",
            Self::Web => "webdl",
        }
    }

    /// The id parameter of its `requestdl`.
    fn id_param(self) -> &'static str {
        match self {
            Self::Torrent => "torrent_id",
            Self::Usenet => "usenet_id",
            Self::Web => "web_id",
        }
    }
}

/// Orbit's id for an item: its kind's letter and TorBox's number ("t123").
pub fn item_id(kind: Kind, id: u64) -> String {
    format!("{}{id}", kind.letter())
}

pub fn parse_id(id: &str) -> Option<(Kind, u64)> {
    let mut chars = id.chars();
    let kind = match chars.next()? {
        't' => Kind::Torrent,
        'u' => Kind::Usenet,
        'w' => Kind::Web,
        _ => return None,
    };
    let number = chars.as_str();
    if !(1..=15).contains(&number.len()) || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    number.parse().ok().map(|n| (kind, n))
}

fn url(path: &str, query: &[(&str, &str)]) -> Result<Url, Fail> {
    let mut url = Url::parse(&format!("{API}{path}")).map_err(|_| Fail::Invalid)?;
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(url)
}

/// TorBox answers `{ success, error, detail, data }`; `data` when it worked.
pub fn data(value: &Value) -> Result<&Value, Fail> {
    if value.get("success").and_then(Value::as_bool) == Some(true) {
        return value.get("data").ok_or(Fail::Invalid);
    }
    match value.get("error").and_then(Value::as_str) {
        Some("BAD_TOKEN" | "AUTH_ERROR" | "NO_AUTH") => Err(Fail::Denied),
        Some("ITEM_NOT_FOUND" | "DOWNLOAD_NOT_FOUND") => Err(Fail::Gone),
        // "Limited to users of higher plans" (TorBox's errors table), sometimes with
        // a 200: the same refusal as a 403 naming it (see `net::forbidden`).
        Some("PLAN_RESTRICTED_FEATURE") => Err(Fail::Status(403)),
        _ => Err(Fail::Invalid),
    }
}

/// `/user/me`: TorBox accounts have no user name, so the email is shown
/// (only on this person's own Settings page); premium while on a paid plan.
pub fn parse_user(value: &Value) -> Result<Account, Fail> {
    let user = data(value)?;
    let user_name = user.get("email").and_then(Value::as_str).map(|n| net::clean(n, 120)).filter(|n| !n.is_empty()).ok_or(Fail::Invalid)?;
    let paid = user.get("plan").and_then(Value::as_i64).is_some_and(|p| p > 0);
    let premium_until = if paid { user.get("premium_expires_at").and_then(Value::as_str).and_then(net::iso_ms) } else { None };
    Ok(Account { user_name, premium_until })
}

/// Where an item is: on TorBox's servers (ready), on its way, waiting, or failed.
pub fn state_of(present: bool, download_state: &str) -> State {
    let s = download_state.to_ascii_lowercase();
    if present {
        State::Ready
    } else if s.contains("error") || s.contains("failed") || s.starts_with("stalled") {
        State::Error
    } else if s.starts_with("queued") || s == "metadl" || s == "checkingresumedata" || s == "paused" {
        State::Queued
    } else {
        State::Downloading
    }
}

/// One `mylist` page: the items, and each one's files (TorBox lists them together).
pub fn parse_list(value: &Value, kind: Kind) -> Result<Vec<(Item, Content)>, Fail> {
    let list = data(value)?;
    Ok(list
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_ITEMS)
        .filter_map(|t| {
            let id = item_id(kind, t.get("id").and_then(Value::as_u64)?);
            let name = t.get("name").and_then(Value::as_str).map(|n| net::clean(n, 300)).filter(|n| !n.is_empty())?;
            let present = t.get("download_present").and_then(Value::as_bool).unwrap_or(false);
            let state = state_of(present, t.get("download_state").and_then(Value::as_str).unwrap_or_default());
            let progress = t.get("progress").and_then(Value::as_f64).filter(|p| p.is_finite()).map_or(0.0, |p| (p * 100.0).clamp(0.0, 100.0));
            let entries = t
                .get("files")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .take(MAX_FILES)
                .filter_map(|f| {
                    let path = net::clean(f.get("name").or_else(|| f.get("short_name")).and_then(Value::as_str)?, 500);
                    (!path.is_empty()).then(|| Entry { id: f.get("id").and_then(Value::as_u64).unwrap_or(0), path, size: f.get("size").and_then(Value::as_u64).unwrap_or(0), playable: true, link: None })
                })
                .collect();
            let item = Item {
                provider: "torbox",
                id,
                name: name.clone(),
                size: t.get("size").and_then(Value::as_u64).unwrap_or(0),
                state,
                progress: if state == State::Ready { 100.0 } else { progress },
                added: t.get("created_at").and_then(Value::as_str).and_then(net::iso_ms),
                // Only torrents: the other lists' delete calls aren't documented clearly enough to trust.
                deletable: kind == Kind::Torrent,
            };
            Some((item, Content { name, ready: state == State::Ready, entries }))
        })
        .collect())
}

/// `requestdl`'s answer: the CDN address, checked before anything plays it.
pub fn parse_link(value: &Value) -> Result<Url, Fail> {
    net::check_link(data(value)?.as_str().ok_or(Fail::Invalid)?)
}

pub async fn user(api: &Api<'_>) -> Result<Account, Fail> {
    parse_user(&api.call(Method::GET, url("/user/me", &[])?, Body::None, 256 * 1024).await?)
}

impl Kind {
    /// The section's name for a problem the page words ("usenet", "web").
    pub fn section(self) -> &'static str {
        match self {
            Self::Torrent => "torrents",
            Self::Usenet => "usenet",
            Self::Web => "web",
        }
    }
}

/// Whether a failure listing `kind` means the account's plan leaves that
/// section out (Usenet is Pro only), rather than the account or TorBox
/// failing: then the other sections are still listed.
pub fn refused(kind: Kind, fail: &Fail) -> bool {
    kind != Kind::Torrent && *fail == Fail::Status(403)
}

/// The account's items, and the sections its plan leaves out.
pub struct Listed {
    pub items: Vec<(Item, Content)>,
    pub refused: Vec<Kind>,
}

/// Every item of every kind with its files, up to `MAX_ITEMS` of each. `fresh`
/// asks TorBox to skip its own short cache (the person pressed Refresh).
pub async fn list(api: &Api<'_>, fresh: bool) -> Result<Listed, Fail> {
    let mut listed = Listed { items: Vec::new(), refused: Vec::new() };
    for kind in Kind::ALL {
        match list_kind(api, kind, fresh).await {
            Ok(items) => listed.items.extend(items),
            Err(fail) if refused(kind, &fail) => listed.refused.push(kind),
            Err(fail) => return Err(fail),
        }
    }
    Ok(listed)
}

async fn list_kind(api: &Api<'_>, kind: Kind, fresh: bool) -> Result<Vec<(Item, Content)>, Fail> {
    let mut all = Vec::new();
    let mut offset = 0;
    loop {
        let (offset_s, limit_s) = (offset.to_string(), PAGE.to_string());
        let mut query = vec![("offset", offset_s.as_str()), ("limit", limit_s.as_str())];
        if fresh {
            query.push(("bypass_cache", "true"));
        }
        let value = api.call(Method::GET, url(&format!("/{}/mylist", kind.path()), &query)?, Body::None, net::JSON_LIMIT).await?;
        let count = data(&value)?.as_array().map_or(0, Vec::len);
        let page = parse_list(&value, kind)?;
        offset += count;
        all.extend(page);
        if count < PAGE || offset >= MAX_ITEMS {
            break;
        }
    }
    Ok(all)
}

/// A fresh CDN address for one file. Never kept: it's made at play time.
pub async fn request_link(api: &Api<'_>, item: &str, file: u64) -> Result<Url, Fail> {
    let (kind, id) = parse_id(item).ok_or(Fail::Invalid)?;
    let (id, file) = (id.to_string(), file.to_string());
    let address = url(&format!("/{}/requestdl", kind.path()), &[("token", api.key()), (kind.id_param(), &id), ("file_id", &file), ("redirect", "false")])?;
    parse_link(&api.call(Method::GET, address, Body::None, 64 * 1024).await?)
}

pub async fn delete(api: &Api<'_>, item: &str) -> Result<(), Fail> {
    let (Kind::Torrent, id) = parse_id(item).ok_or(Fail::Invalid)? else { return Err(Fail::Invalid) };
    let body = json!({ "torrent_id": id, "operation": "delete" });
    let value = api.call(Method::POST, url("/torrents/controltorrent", &[])?, Body::Json(&body), 64 * 1024).await?;
    data(&value).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(data: Value) -> Value {
        json!({ "success": true, "error": null, "detail": "Done.", "data": data })
    }

    #[test]
    fn envelopes() {
        assert_eq!(data(&ok(json!(5))).unwrap(), &json!(5));
        assert_eq!(data(&json!({ "success": false, "error": "BAD_TOKEN", "detail": "x" })), Err(Fail::Denied));
        assert_eq!(data(&json!({ "success": false, "error": "ITEM_NOT_FOUND" })), Err(Fail::Gone));
        assert_eq!(data(&json!({ "success": false, "error": "UNKNOWN" })), Err(Fail::Invalid));
        assert_eq!(data(&json!("x")), Err(Fail::Invalid));
    }

    #[test]
    fn a_section_the_plan_leaves_out_is_refused_not_broken() {
        // TorBox's documented answer for a feature above the account's plan (Usenet is Pro only).
        let restricted = json!({ "success": false, "error": "PLAN_RESTRICTED_FEATURE", "detail": "Upgrade your plan." });
        assert_eq!(data(&restricted), Err(Fail::Status(403)));
        // Usenet or web downloads refused (in the body, or as a 403): the rest of the cloud still lists.
        for kind in [Kind::Usenet, Kind::Web] {
            assert!(refused(kind, &Fail::Status(403)));
            for fail in [Fail::Denied, Fail::RateLimited(std::time::Duration::from_secs(5)), Fail::Network, Fail::Timeout, Fail::Invalid, Fail::Status(500)] {
                assert!(!refused(kind, &fail), "{fail:?}");
            }
        }
        // Torrents are TorBox's core: a refusal there is the account's problem, not a missing section.
        assert!(!refused(Kind::Torrent, &Fail::Status(403)));
        assert_eq!((Kind::Usenet.section(), Kind::Web.section()), ("usenet", "web"));
    }

    #[test]
    fn users() {
        let account = parse_user(&ok(json!({ "email": "sam@example.com", "plan": 2, "premium_expires_at": "1970-01-02T00:00:00Z" }))).unwrap();
        assert_eq!((account.user_name.as_str(), account.premium_until), ("sam@example.com", Some(86_400_000)));
        assert_eq!(parse_user(&ok(json!({ "email": "sam@example.com", "plan": 0, "premium_expires_at": "2030-01-01T00:00:00Z" }))).unwrap().premium_until, None);
        assert!(parse_user(&ok(json!({ "plan": 2 }))).is_err());
    }

    #[test]
    fn statuses() {
        assert_eq!(state_of(true, "completed"), State::Ready);
        assert_eq!(state_of(true, "uploading"), State::Ready);
        assert_eq!(state_of(false, "downloading"), State::Downloading);
        assert_eq!(state_of(false, "stalled (no seeds)"), State::Error);
        assert_eq!(state_of(false, "error"), State::Error);
        assert_eq!(state_of(false, "metaDL"), State::Queued);
        assert_eq!(state_of(false, "queued"), State::Queued);
    }

    #[test]
    fn lists_with_their_files() {
        let value = ok(json!([
            { "id": 42, "name": "Show.S01.1080p", "size": 3000, "created_at": "2026-10-01T10:00:00Z", "download_state": "cached", "download_present": true, "download_finished": true, "progress": 1,
              "files": [
                { "id": 0, "name": "Show.S01.1080p/Show.S01E01.mkv", "short_name": "Show.S01E01.mkv", "size": 1000, "mimetype": "video/x-matroska" },
                { "id": 1, "short_name": "Show.S01E02.mkv", "size": 1000 },
                { "id": 2 }
              ] },
            { "id": 43, "name": "Movie.2024", "size": 10, "download_state": "downloading", "download_present": false, "progress": 0.25, "files": [] },
            { "id": "44", "name": "Bad id" },
            { "id": 45 }
        ]));
        let list = parse_list(&value, Kind::Torrent).unwrap();
        assert_eq!(list.len(), 2);
        let (item, content) = &list[0];
        assert_eq!((item.id.as_str(), item.state, item.progress, item.deletable), ("t42", State::Ready, 100.0, true));
        assert_eq!(content.entries.iter().map(|e| (e.id, e.path.as_str())).collect::<Vec<_>>(), [(0, "Show.S01.1080p/Show.S01E01.mkv"), (1, "Show.S01E02.mkv")]);
        assert_eq!((list[1].0.state, list[1].0.progress), (State::Downloading, 25.0));
        let usenet = parse_list(&ok(json!([{ "id": 7, "name": "N", "download_present": true }])), Kind::Usenet).unwrap();
        assert_eq!((usenet[0].0.id.as_str(), usenet[0].0.deletable), ("u7", false));
        assert!(parse_list(&json!({ "success": false, "error": "BAD_TOKEN" }), Kind::Web).is_err());
    }

    #[test]
    fn links_are_checked() {
        assert!(parse_link(&ok(json!("https://store-031.weur.tb-cdn.st/dld/abc?token=def"))).is_ok());
        assert!(parse_link(&ok(json!("http://store-031.weur.tb-cdn.st/dld/abc"))).is_err());
        assert!(parse_link(&ok(json!({ "url": "https://x" }))).is_err());
        assert!(parse_link(&json!({ "success": false, "error": "DOWNLOAD_NOT_FOUND" })).is_err());
    }

    #[test]
    fn ids() {
        assert_eq!(parse_id("t123"), Some((Kind::Torrent, 123)));
        assert_eq!(parse_id("u1"), Some((Kind::Usenet, 1)));
        assert_eq!(parse_id("w9"), Some((Kind::Web, 9)));
        for bad in ["", "t", "x1", "t-1", "t1/2", "t1234567890123456", "T1"] {
            assert_eq!(parse_id(bad), None, "{bad}");
        }
        assert_eq!(item_id(Kind::Web, 5), "w5");
    }

    #[test]
    fn the_link_request_is_torbox_only() {
        let address = url("/torrents/requestdl", &[("token", "KEY"), ("torrent_id", "1"), ("file_id", "2"), ("redirect", "false")]).unwrap();
        assert_eq!(address.host_str(), Some("api.torbox.app"));
        assert_eq!(address.scheme(), "https");
    }
}
