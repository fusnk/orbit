//! Downloading a web stream to a file: resuming with HTTP ranges, retrying
//! what's worth retrying, and refusing responses that aren't video.
//!
//! The decisions are plain functions (tested below); `fetch` drives them.

use std::path::Path;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use reqwest::header::{self, HeaderMap};
use reqwest::{Client, Url, redirect};
use tokio::io::AsyncWriteExt;

use super::Failure;
use super::files::{self, PART_SUFFIX};

/// Below this, a response is an error page, not a video (debrid services
/// answer "not cached yet" with a small page and a 200).
pub const MIN_RESPONSE_BYTES: u64 = 64 * 1024;
/// A finished file smaller than this isn't a film or an episode.
pub const MIN_FILE_BYTES: u64 = 512 * 1024;
const MAX_ATTEMPTS: u32 = 6;
const MAX_REDIRECTS: usize = 5;
const WRITE_BUFFER: usize = 1024 * 1024;
/// How often progress reaches the page, and the database.
const EVENT_INTERVAL: Duration = Duration::from_millis(250);
const SAVE_INTERVAL: Duration = Duration::from_secs(3);

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    // A name may lead into the LAN only if the person gave it, and no proxy looks it up instead (see guard_lan): the
    // redirect check below reads the address as text, and `192-168-1-1.nip.io` passes that.
    crate::addons::net::guard_lan(Client::builder())
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        // No overall timeout (a film takes as long as it takes); a stalled body is retried.
        .read_timeout(Duration::from_secs(45))
        .referer(false)
        .redirect(redirect::Policy::custom(|attempt| {
            let allowed = attempt.previous().len() <= MAX_REDIRECTS
                && attempt.previous().last().is_some_and(|from| crate::addons::net::redirect_allowed(from, attempt.url()));
            if allowed { attempt.follow() } else { attempt.error("redirect not allowed") }
        }))
        .build()
        .ok()
});

/// Stream addresses follow the addon rules: `https`, or plain `http` only on 127.0.0.1 (local addons).
pub fn check_url(url: &Url) -> Result<(), Failure> {
    crate::addons::net::check_origin(url).map_err(|_| Failure::Blocked)?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Failure::Blocked);
    }
    Ok(())
}

/// HLS and DASH are playlists of many small files, not one video to save.
pub fn is_playlist(url: &Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    path.ends_with(".m3u8") || path.ends_with(".m3u") || path.ends_with(".mpd")
}

/// The validator to resume with: a strong ETag, else Last-Modified. Weak
/// ETags (`W/"…"`) aren't allowed in If-Range, so they're ignored.
pub fn validator(etag: Option<&str>, last_modified: Option<&str>) -> Option<String> {
    let etag = etag.map(str::trim).filter(|e| e.starts_with('"') && e.ends_with('"') && e.len() >= 2);
    etag.or(last_modified.map(str::trim)).filter(|v| !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control)).map(str::to_string)
}

/// Headers asking for the rest of a file already `offset` bytes in.
pub fn resume_headers(offset: u64, validator: Option<&str>) -> Vec<(header::HeaderName, String)> {
    if offset == 0 {
        return Vec::new();
    }
    let mut headers = vec![(header::RANGE, format!("bytes={offset}-"))];
    // If-Range: the server sends the rest only if the file is unchanged, else all of it (200).
    if let Some(v) = validator {
        headers.push((header::IF_RANGE, v.to_string()));
    }
    headers
}

/// A Content-Range: the inclusive byte range (None for `*`) and the file's size (None for `*`).
pub type ContentRange = (Option<(u64, u64)>, Option<u64>);

/// `bytes start-end/total` (total may be `*`), or `bytes */total` as (None, total).
pub fn parse_content_range(value: &str) -> Option<ContentRange> {
    let rest = value.trim().strip_prefix("bytes")?.trim_start();
    let (range, total) = rest.split_once('/')?;
    let total = match total.trim() {
        "*" => None,
        t => Some(t.parse().ok()?),
    };
    if range.trim() == "*" {
        return Some((None, total));
    }
    let (start, end) = range.trim().split_once('-')?;
    let (start, end): (u64, u64) = (start.parse().ok()?, end.parse().ok()?);
    (start <= end && total.is_none_or(|t| end < t)).then_some((Some((start, end)), total))
}

/// Error pages, not video: text, HTML, JSON and XML.
pub fn looks_like_page(content_type: Option<&str>) -> bool {
    let Some(t) = content_type.map(str::to_ascii_lowercase) else { return false };
    t.starts_with("text/") || t.contains("html") || t.contains("json") || t.contains("xml")
}

/// What to do with a response, given how much of the file is already here.
#[derive(Debug, PartialEq)]
pub enum Plan {
    /// Write the body from the start (a full 200 reply); `total` when known.
    Restart { total: Option<u64> },
    /// Append the body to what's there.
    Append { total: Option<u64> },
    /// The file was already complete.
    Complete,
    /// Throw away the partial file and ask for all of it.
    StartOver,
    /// The address no longer works; a fresh one is needed.
    Expired,
    /// A passing problem: try again shortly.
    Retry,
    Fail(Failure),
}

pub struct Reply<'a> {
    pub status: u16,
    pub content_type: Option<&'a str>,
    pub content_length: Option<u64>,
    pub content_range: Option<&'a str>,
}

/// Decides how to treat `reply` with `offset` bytes already saved, the
/// file's size as first reported (`known_total`), and whether the resume was
/// asked for with a validator (If-Range).
pub fn plan(reply: &Reply, offset: u64, known_total: Option<u64>, validated: bool) -> Plan {
    // With If-Range, a 206 promises the file is unchanged. Without one, the
    // server sends the requested bytes of whatever it now has at that address
    // (a debrid link may now serve another release), and appending them
    // would quietly splice two files together. The only check left is the
    // size: both the first reply and this one must state it, and agree.
    let same_file = |total: Option<u64>| if validated { known_total.is_none() || total.is_none() || total == known_total } else { total.is_some() && total == known_total };
    // Once some of the file has arrived, an error page instead means the link
    // stopped working (debrid links expire), not that it never was a video.
    let not_video = || if offset > 0 { Plan::Expired } else { Plan::Fail(Failure::NotVideo) };
    match reply.status {
        200 => {
            if looks_like_page(reply.content_type) || reply.content_length.is_some_and(|len| len < MIN_RESPONSE_BYTES) {
                return not_video();
            }
            Plan::Restart { total: reply.content_length }
        }
        206 => {
            if looks_like_page(reply.content_type) {
                return not_video();
            }
            match reply.content_range.and_then(parse_content_range) {
                // The server must continue exactly where the file stops, and it must be the same file.
                Some((Some((start, _)), total)) if start == offset && same_file(total) => {
                    Plan::Append { total: total.or(known_total) }
                }
                _ => Plan::StartOver,
            }
        }
        416 => match reply.content_range.and_then(parse_content_range) {
            Some((_, Some(total))) if total == offset && offset > 0 && same_file(Some(total)) => Plan::Complete,
            _ => Plan::StartOver,
        },
        401 | 403 | 404 | 410 => Plan::Expired,
        408 | 429 | 500..=599 => Plan::Retry,
        status => Plan::Fail(Failure::Http { status }),
    }
}

/// Seconds before retry `attempt` (1, 2, 4… up to a minute).
pub fn backoff(attempt: u32) -> Duration {
    Duration::from_secs(1u64 << attempt.min(6)).min(Duration::from_secs(60))
}

/// Disk errors stop a download at once (retrying won't help); anything else is retried.
pub fn disk_failure(err: &std::io::Error) -> Failure {
    use std::io::ErrorKind;
    match err.kind() {
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded | ErrorKind::FileTooLarge => Failure::DiskFull,
        ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => Failure::Permission,
        // ERROR_DISK_FULL and ERROR_HANDLE_DISK_FULL, should they arrive unmapped.
        _ if matches!(err.raw_os_error(), Some(112 | 39)) && cfg!(windows) => Failure::DiskFull,
        _ => Failure::Disk,
    }
}

/// Whether the rest of a file (`total` bytes, `done` of them here) fits in
/// `free` with the headroom to spare. An unknown size still keeps the
/// headroom, so a download never fills the drive to the last byte (which
/// would leave nothing for Orbit's own database, or anything else, there).
pub fn room_for_rest(free: Option<u64>, total: Option<u64>, done: u64) -> bool {
    files::has_room(free, Some(total.map_or(0, |t| t.saturating_sub(done))))
}

/// What the transfer learned about the file, for the next resume.
#[derive(Default, Clone, Debug, PartialEq)]
pub struct Known {
    pub total: Option<u64>,
    pub validator: Option<String>,
    pub ext: Option<String>,
}

/// Progress callbacks; `save` persists what's needed to resume.
pub trait Sink: Send {
    fn progress(&mut self, done: u64, total: Option<u64>, speed: f64);
    fn save(&mut self, done: u64, known: &Known);
}

/// Downloads `url` into `<dir>/<base>.part`, resuming what's there. Returns
/// the extension to finish with once the whole file is in.
pub async fn fetch(url: &Url, dir: &Path, base: &str, mut known: Known, sink: &mut dyn Sink) -> Result<Known, Failure> {
    check_url(url)?;
    let client = CLIENT.as_ref().ok_or(Failure::Network)?;
    let part = dir.join(format!("{base}{PART_SUFFIX}"));
    let mut attempt = 0u32;
    let mut started_over = false;

    loop {
        let offset = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let mut request = client.get(url.clone());
        for (name, value) in resume_headers(offset, known.validator.as_deref()) {
            request = request.header(name, value);
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(err) if err.is_redirect() => return Err(Failure::Blocked),
            Err(_) if attempt < MAX_ATTEMPTS => {
                attempt += 1;
                tokio::time::sleep(backoff(attempt)).await;
                continue;
            }
            Err(_) => return Err(Failure::Network),
        };
        let headers = response.headers().clone();
        let text = |name: header::HeaderName| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
        let (content_type, content_range) = (text(header::CONTENT_TYPE), text(header::CONTENT_RANGE));
        let reply = Reply {
            status: response.status().as_u16(),
            content_type: content_type.as_deref(),
            content_length: response.content_length(),
            content_range: content_range.as_deref(),
        };
        let (append, total) = match plan(&reply, offset, known.total, known.validator.is_some()) {
            Plan::Restart { total } => (false, total),
            Plan::Append { total } => (true, total),
            Plan::Complete => return finish(&part, known),
            Plan::StartOver if !started_over => {
                started_over = true;
                known.validator = None;
                std::fs::remove_file(&part).or_else(ignore_missing).map_err(|e| disk_failure(&e))?;
                continue;
            }
            Plan::StartOver => return Err(Failure::Http { status: reply.status }),
            Plan::Expired => return Err(Failure::Expired),
            Plan::Retry if attempt < MAX_ATTEMPTS => {
                attempt += 1;
                tokio::time::sleep(retry_after(&headers).unwrap_or_else(|| backoff(attempt))).await;
                continue;
            }
            Plan::Retry => return Err(Failure::Http { status: reply.status }),
            Plan::Fail(failure) => return Err(failure),
        };

        let start = if append { offset } else { 0 };
        if !append || known.ext.is_none() {
            known.ext = Some(files::choose_extension(text(header::CONTENT_DISPOSITION).as_deref(), url.path(), reply.content_type).to_string());
        }
        if !append {
            known.validator = validator(text(header::ETAG).as_deref(), text(header::LAST_MODIFIED).as_deref());
            known.total = total;
        }
        if !room_for_rest(files::free_space(dir), total, start) {
            return Err(Failure::NoSpace);
        }
        sink.save(start, &known);

        match write_body(response, &part, append, start, &known, sink).await {
            Ok(()) => return finish(&part, known),
            Err(Interrupted::Disk(failure)) => return Err(failure),
            // A dropped connection resumes from what's saved; progress made resets the count.
            Err(Interrupted::Network { progressed }) => {
                attempt = if progressed { 1 } else { attempt + 1 };
                if attempt > MAX_ATTEMPTS {
                    return Err(Failure::Network);
                }
                tokio::time::sleep(backoff(attempt)).await;
            }
        }
    }
}

fn ignore_missing(err: std::io::Error) -> std::io::Result<()> {
    if err.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(err) }
}

/// A server's Retry-After in seconds, capped at five minutes.
fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let secs: u64 = headers.get(header::RETRY_AFTER)?.to_str().ok()?.trim().parse().ok()?;
    Some(Duration::from_secs(secs.min(300)))
}

enum Interrupted {
    Disk(Failure),
    Network { progressed: bool },
}

async fn write_body(mut response: reqwest::Response, part: &Path, append: bool, start: u64, known: &Known, sink: &mut dyn Sink) -> Result<(), Interrupted> {
    let disk = |e: std::io::Error| Interrupted::Disk(disk_failure(&e));
    let file = tokio::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(part).await.map_err(disk)?;
    let mut out = tokio::io::BufWriter::with_capacity(WRITE_BUFFER, file);
    let mut done = start;
    let (mut last_event, mut last_save) = (Instant::now(), Instant::now());
    let mut bytes_since = 0u64;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => {
                out.flush().await.map_err(disk)?;
                return Err(Interrupted::Network { progressed: done > start });
            }
        };
        out.write_all(&chunk).await.map_err(disk)?;
        // Settings → Downloads → speed limit (shared by every web download).
        super::schedule::throttle(chunk.len()).await;
        done += chunk.len() as u64;
        bytes_since += chunk.len() as u64;
        if last_event.elapsed() >= EVENT_INTERVAL {
            sink.progress(done, known.total, bytes_since as f64 / last_event.elapsed().as_secs_f64());
            (last_event, bytes_since) = (Instant::now(), 0);
        }
        if last_save.elapsed() >= SAVE_INTERVAL {
            out.flush().await.map_err(disk)?;
            sink.save(done, known);
            last_save = Instant::now();
            // Other downloads (or anything else) can fill the drive meanwhile: stop before it's full, as at the start.
            if !room_for_rest(part.parent().and_then(files::free_space), known.total, done) {
                return Err(Interrupted::Disk(Failure::DiskFull));
            }
        }
    }
    out.flush().await.map_err(disk)?;
    out.into_inner().sync_all().await.map_err(disk)?;
    sink.save(done, known);
    // A body that ended early (the connection closed cleanly mid-file) resumes like a dropped one.
    if known.total.is_some_and(|total| done < total) {
        return Err(Interrupted::Network { progressed: done > start });
    }
    Ok(())
}

/// Checks the finished `.part` and reports it complete (the caller renames it).
fn finish(part: &Path, known: Known) -> Result<Known, Failure> {
    let size = std::fs::metadata(part).map_err(|e| disk_failure(&e))?.len();
    if size < MIN_FILE_BYTES {
        let _ = std::fs::remove_file(part);
        return Err(Failure::TooSmall);
    }
    if known.total.is_some_and(|total| total != size) {
        return Err(Failure::Incomplete);
    }
    Ok(Known { total: Some(size), ..known })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloads_refuse_names_that_lead_into_the_lan() {
        // An addon's stream (or its redirect) naming a host that resolves into the LAN (`192-168-1-1.nip.io`).
        let url = Url::parse(&format!("https://{}:1/film.mkv", crate::addons::net::tests::LAN_NAME)).unwrap();
        let err = tauri::async_runtime::block_on(async { CLIENT.as_ref().unwrap().get(url).send().await }).unwrap_err();
        let mut causes = std::iter::successors(Some(&err as &dyn std::error::Error), |e| e.source());
        assert!(causes.any(|e| e.to_string().contains("leads into the local network")), "{err:?}");
    }

    fn reply<'a>(status: u16, content_type: Option<&'a str>, content_length: Option<u64>, content_range: Option<&'a str>) -> Reply<'a> {
        Reply { status, content_type, content_length, content_range }
    }

    #[test]
    fn resume_headers_use_strong_validators_only() {
        assert!(resume_headers(0, Some("\"abc\"")).is_empty());
        let h = resume_headers(500, Some("\"abc\""));
        assert_eq!(h[0], (header::RANGE, "bytes=500-".to_string()));
        assert_eq!(h[1], (header::IF_RANGE, "\"abc\"".to_string()));
        assert_eq!(resume_headers(500, None).len(), 1);

        assert_eq!(validator(Some("\"abc\""), Some("Wed, 21 Oct 2015 07:28:00 GMT")).as_deref(), Some("\"abc\""));
        // Weak ETags can't be used with If-Range: Last-Modified instead, or nothing.
        assert_eq!(validator(Some("W/\"abc\""), Some("Wed, 21 Oct 2015 07:28:00 GMT")).as_deref(), Some("Wed, 21 Oct 2015 07:28:00 GMT"));
        assert_eq!(validator(Some("W/\"abc\""), None), None);
        assert_eq!(validator(Some("abc"), None), None);
        assert_eq!(validator(None, Some("bad\nvalue")), None);
    }

    #[test]
    fn parses_content_range() {
        assert_eq!(parse_content_range("bytes 100-199/1000"), Some((Some((100, 199)), Some(1000))));
        assert_eq!(parse_content_range("bytes 0-0/*"), Some((Some((0, 0)), None)));
        assert_eq!(parse_content_range("bytes */1000"), Some((None, Some(1000))));
        assert_eq!(parse_content_range("bytes 200-100/1000"), None);
        assert_eq!(parse_content_range("bytes 100-1000/1000"), None);
        assert_eq!(parse_content_range("items 1-2/3"), None);
        assert_eq!(parse_content_range("bytes x-y/z"), None);
    }

    #[test]
    fn plans_resumes() {
        let video = Some("video/x-matroska");
        // A 206 that continues where the file stops is appended.
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-999/1000")), 100, Some(1000), true), Plan::Append { total: Some(1000) });
        // …but one starting elsewhere, or for a file of another size, starts over.
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 0-999/1000")), 100, Some(1000), true), Plan::StartOver);
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-1999/2000")), 100, Some(1000), true), Plan::StartOver);
        assert_eq!(plan(&reply(206, video, Some(900), None), 100, Some(1000), true), Plan::StartOver);
        // A 200 (the validator didn't match, or no ranges) restarts from zero.
        assert_eq!(plan(&reply(200, video, Some(5_000_000), None), 100, Some(1000), true), Plan::Restart { total: Some(5_000_000) });
        // 416: complete when the size matches, else start over.
        assert_eq!(plan(&reply(416, None, None, Some("bytes */1000")), 1000, Some(1000), true), Plan::Complete);
        assert_eq!(plan(&reply(416, None, None, Some("bytes */1000")), 400, Some(1000), true), Plan::StartOver);
        assert_eq!(plan(&reply(416, None, None, None), 400, None, true), Plan::StartOver);
    }

    #[test]
    fn resumes_without_a_validator_only_when_the_size_matches() {
        let video = Some("video/x-matroska");
        // No ETag or Last-Modified: a 206 is appended only for a file of the size first reported…
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-999/1000")), 100, Some(1000), false), Plan::Append { total: Some(1000) });
        // …not when either size is unknown, or they differ: start over rather than splice two files.
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-999/*")), 100, Some(1000), false), Plan::StartOver);
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-999/1000")), 100, None, false), Plan::StartOver);
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-1999/2000")), 100, Some(1000), false), Plan::StartOver);
        // With a validator, the server vouches for the file: an unstated size is fine.
        assert_eq!(plan(&reply(206, video, Some(900), Some("bytes 100-999/*")), 100, Some(1000), true), Plan::Append { total: Some(1000) });
        // 416 at the end counts as complete only for the size first reported.
        assert_eq!(plan(&reply(416, None, None, Some("bytes */1000")), 1000, Some(1000), false), Plan::Complete);
        assert_eq!(plan(&reply(416, None, None, Some("bytes */1000")), 1000, None, false), Plan::StartOver);
    }

    #[test]
    fn rejects_pages_that_are_not_video() {
        for page in ["text/html; charset=utf-8", "application/json", "text/plain", "application/xhtml+xml"] {
            assert_eq!(plan(&reply(200, Some(page), Some(10_000_000), None), 0, None, true), Plan::Fail(Failure::NotVideo), "{page}");
        }
        // Tiny "not cached" replies, even typed as video.
        assert_eq!(plan(&reply(200, Some("video/mp4"), Some(2_000), None), 0, None, true), Plan::Fail(Failure::NotVideo));
        // Partway through, an error page means the link expired.
        assert_eq!(plan(&reply(200, Some("text/html"), Some(500), None), 1_000_000, Some(9_000_000), true), Plan::Expired);
        assert_eq!(plan(&reply(206, Some("text/html"), Some(500), Some("bytes 1-2/3")), 1, Some(3), true), Plan::Expired);
        assert_eq!(plan(&reply(200, Some("application/octet-stream"), None, None), 0, None, true), Plan::Restart { total: None });
    }

    #[test]
    fn classifies_failures_for_retry() {
        for status in [408, 429, 500, 502, 503, 504] {
            assert_eq!(plan(&reply(status, None, None, None), 0, None, true), Plan::Retry, "{status}");
        }
        for status in [401, 403, 404, 410] {
            assert_eq!(plan(&reply(status, None, None, None), 0, None, true), Plan::Expired, "{status}");
        }
        assert_eq!(plan(&reply(400, None, None, None), 0, None, true), Plan::Fail(Failure::Http { status: 400 }));
        assert_eq!(backoff(1), Duration::from_secs(2));
        assert_eq!(backoff(20), Duration::from_secs(60));

        use std::io::{Error, ErrorKind};
        assert_eq!(disk_failure(&Error::from(ErrorKind::StorageFull)), Failure::DiskFull);
        assert_eq!(disk_failure(&Error::from(ErrorKind::PermissionDenied)), Failure::Permission);
        assert_eq!(disk_failure(&Error::from(ErrorKind::Other)), Failure::Disk);
    }

    #[test]
    fn keeps_the_headroom_while_downloading() {
        let mb = 1024 * 1024;
        // The rest of a file of known size, plus the headroom.
        assert!(room_for_rest(Some(2000 * mb), Some(1000 * mb), 0));
        assert!(room_for_rest(Some(300 * mb), Some(1000 * mb), 990 * mb));
        assert!(!room_for_rest(Some(300 * mb), Some(1000 * mb), 500 * mb));
        // A file of unknown size still leaves the headroom: it never fills the drive to the last byte.
        assert!(room_for_rest(Some(1000 * mb), None, 500 * mb));
        assert!(!room_for_rest(Some(10 * mb), None, 500 * mb));
        // Free space the OS won't tell doesn't stop a download.
        assert!(room_for_rest(None, None, 0));
    }

    #[test]
    fn address_policy() {
        let ok = |s: &str| check_url(&Url::parse(s).unwrap()).is_ok();
        assert!(ok("https://debrid.example/dl/file.mkv"));
        assert!(ok("http://127.0.0.1:11470/file.mkv"));
        assert!(!ok("http://debrid.example/file.mkv"));
        assert!(!ok("file:///C:/Windows/win.ini"));
        assert!(!ok("https://user:pass@debrid.example/file.mkv"));
        assert!(is_playlist(&Url::parse("https://x/live/index.M3U8?token=1").unwrap()));
        assert!(is_playlist(&Url::parse("https://x/manifest.mpd").unwrap()));
        assert!(!is_playlist(&Url::parse("https://x/movie.mkv").unwrap()));
    }

    /// Serves canned raw HTTP responses on 127.0.0.1, chosen by the request's Range header.
    fn serve(respond: fn(Option<&str>) -> Vec<u8>) -> u16 {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(&stream);
                let mut range = None;
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range:") {
                        range = Some(v.trim().to_string());
                    }
                    line.clear();
                }
                let _ = (&stream).write_all(&respond(range.as_deref()));
            }
        });
        port
    }

    struct Quiet;
    impl Sink for Quiet {
        fn progress(&mut self, _: u64, _: Option<u64>, _: f64) {}
        fn save(&mut self, _: u64, _: &Known) {}
    }

    const SIZE: usize = 600 * 1024;

    fn body() -> Vec<u8> {
        (0..SIZE).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn resumes_a_partial_file() {
        let port = serve(|range| {
            let body = body();
            let start: usize = range.and_then(|r| r.strip_prefix("bytes=")?.strip_suffix('-')?.parse().ok()).unwrap_or(0);
            let mut out = if start > 0 {
                format!("HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{SIZE}\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n", SIZE - start, SIZE - 1)
            } else {
                format!("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {SIZE}\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n")
            }
            .into_bytes();
            out.extend_from_slice(&body[start..]);
            out
        });
        let dir = std::env::temp_dir().join(format!("orbit-http-test-{port}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("film.part"), &body()[..1000]).unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{port}/dl/film.mp4")).unwrap();
        let known = Known { total: Some(SIZE as u64), validator: Some("\"v1\"".into()), ext: None };
        let done = tauri::async_runtime::block_on(fetch(&url, &dir, "film", known, &mut Quiet)).unwrap();
        assert_eq!(done.ext.as_deref(), Some("mp4"));
        assert_eq!(std::fs::read(dir.join("film.part")).unwrap(), body());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn starts_over_when_an_unvalidated_resume_is_another_file() {
        // The address now serves a different, longer file and no validator was ever given.
        let port = serve(|range| {
            let other: Vec<u8> = (0..SIZE * 2).map(|i| (i % 13) as u8).collect();
            let start: usize = range.and_then(|r| r.strip_prefix("bytes=")?.strip_suffix('-')?.parse().ok()).unwrap_or(0);
            let total = other.len();
            let mut out = if start > 0 {
                format!("HTTP/1.1 206 Partial Content
Content-Type: video/mp4
Content-Length: {}
Content-Range: bytes {start}-{}/{total}
Connection: close

", total - start, total - 1)
            } else {
                format!("HTTP/1.1 200 OK
Content-Type: video/mp4
Content-Length: {total}
Connection: close

")
            }
            .into_bytes();
            out.extend_from_slice(&other[start..]);
            out
        });
        let dir = std::env::temp_dir().join(format!("orbit-http-test-{port}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("film.part"), &body()[..1000]).unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{port}/dl/film.mp4")).unwrap();
        // Nor a size: the first reply didn't say how big the file was.
        let known = Known { total: None, validator: None, ext: None };
        let done = tauri::async_runtime::block_on(fetch(&url, &dir, "film", known, &mut Quiet)).unwrap();
        // The old bytes were thrown away and the new file fetched whole.
        let other: Vec<u8> = (0..SIZE * 2).map(|i| (i % 13) as u8).collect();
        assert_eq!(done.total, Some(other.len() as u64));
        assert_eq!(std::fs::read(dir.join("film.part")).unwrap(), other);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_not_cached_pages() {
        let port = serve(|_| b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 12\r\nConnection: close\r\n\r\nnot cached!!".to_vec());
        let dir = std::env::temp_dir().join(format!("orbit-http-test-{port}"));
        std::fs::create_dir_all(&dir).unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{port}/dl/film.mkv")).unwrap();
        let result = tauri::async_runtime::block_on(fetch(&url, &dir, "film", Known::default(), &mut Quiet));
        assert_eq!(result, Err(Failure::NotVideo));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
