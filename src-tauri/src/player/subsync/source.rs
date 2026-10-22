//! Reading parts of the video playing: a range of a web stream (HTTP Range
//! requests) or of a file on this PC.
//!
//! Web streams follow the addon network rules (https, or http on 127.0.0.1
//! for Orbit's own torrent server; no redirects from a public host into this
//! machine or the LAN). Stream addresses often hold a debrid token, so
//! errors never include the address.

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::{Client, Url, header, redirect};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const TIMEOUT: Duration = Duration::from_secs(12);

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    // A name may lead into the LAN only if the person gave it, and no proxy looks it up instead (see guard_lan), as for addon requests.
    crate::addons::net::guard_lan(Client::builder())
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(6))
        .referer(false)
        .redirect(redirect::Policy::custom(|attempt| {
            let allowed = attempt.previous().len() <= 3 && attempt.previous().last().is_some_and(|from| crate::addons::net::redirect_allowed(from, attempt.url()));
            if allowed { attempt.follow() } else { attempt.error("redirect not allowed") }
        }))
        .build()
        .ok()
});

#[derive(Debug, PartialEq, Eq)]
pub enum SourceError {
    /// The address isn't one Orbit reads from (scheme or host rules).
    Blocked,
    /// The server doesn't serve parts of the file.
    NoRanges,
    /// Network failure, timeout or an error status.
    Failed,
}

pub trait Source {
    /// Up to `len` bytes from `offset` (fewer at the end of the file).
    async fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, SourceError>;
}

pub struct Web(Url);

impl Web {
    pub fn new(url: &str) -> Result<Self, SourceError> {
        let url = Url::parse(url).map_err(|_| SourceError::Blocked)?;
        crate::addons::net::check_origin(&url).map_err(|_| SourceError::Blocked)?;
        Ok(Self(url))
    }
}

impl Source for Web {
    async fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, SourceError> {
        if len == 0 {
            return Ok(Vec::new());
        }
        let client = CLIENT.as_ref().ok_or(SourceError::Failed)?;
        let last = offset.checked_add(len as u64 - 1).ok_or(SourceError::Failed)?;
        let range = format!("bytes={offset}-{last}");
        let mut response = client.get(self.0.clone()).header(header::RANGE, range).timeout(TIMEOUT).send().await.map_err(|_| SourceError::Failed)?;
        match response.status().as_u16() {
            206 => {}
            // The whole file: fine for its start, useless (and huge) for anything else.
            200 if offset == 0 => {}
            200 => return Err(SourceError::NoRanges),
            416 => return Ok(Vec::new()),
            _ => return Err(SourceError::Failed),
        }
        let mut body = Vec::with_capacity(len.min(1 << 20));
        while let Some(chunk) = response.chunk().await.map_err(|_| SourceError::Failed)? {
            let room = len - body.len();
            body.extend_from_slice(&chunk[..chunk.len().min(room)]);
            if body.len() == len {
                break;
            }
        }
        Ok(body)
    }
}

pub struct File(pub PathBuf);

impl Source for File {
    async fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, SourceError> {
        let mut file = tokio::fs::File::open(&self.0).await.map_err(|_| SourceError::Failed)?;
        file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|_| SourceError::Failed)?;
        let mut body = Vec::with_capacity(len.min(1 << 20));
        file.take(len as u64).read_to_end(&mut body).await.map_err(|_| SourceError::Failed)?;
        Ok(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_reads_refuse_names_that_lead_into_the_lan() {
        let url = Url::parse(&format!("https://{}:1/movie.mkv", crate::addons::net::tests::LAN_NAME)).unwrap();
        let err = tauri::async_runtime::block_on(CLIENT.as_ref().unwrap().get(url).send()).unwrap_err();
        let mut causes = std::iter::successors(Some(&err as &dyn std::error::Error), |e| e.source());
        assert!(causes.any(|e| e.to_string().contains("leads into the local network")), "{err:?}");
    }

    #[test]
    fn web_reads_follow_the_addon_rules() {
        assert!(Web::new("https://debrid.example/dl/abc/movie.mkv").is_ok());
        assert!(Web::new("http://127.0.0.1:11470/stream/0").is_ok());
        for bad in ["http://debrid.example/movie.mkv", "file:///C:/movie.mkv", "ftp://x/y", "nonsense"] {
            assert_eq!(Web::new(bad).err(), Some(SourceError::Blocked), "{bad}");
        }
    }

    #[test]
    fn web_reads_use_ranges() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(&stream);
                let (mut line, mut range) = (String::new(), String::new());
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    if let Some(r) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = r.trim().to_string();
                    }
                    line.clear();
                }
                let (from, to) = range.split_once('-').map(|(a, b)| (a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap())).unwrap();
                let file: Vec<u8> = (0..=255u8).collect();
                let reply = if from == 7 {
                    // A server that ignores ranges.
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", file.len()).into_bytes().into_iter().chain(file.clone()).collect::<Vec<u8>>()
                } else {
                    let part = &file[from..=to.min(255)];
                    format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len()).into_bytes().into_iter().chain(part.iter().copied()).collect()
                };
                let _ = (&stream).write_all(&reply);
            }
        });
        let mut web = Web::new(&format!("http://127.0.0.1:{port}/v")).unwrap();
        let read = |web: &mut Web, offset, len| tauri::async_runtime::block_on(web.read(offset, len));
        assert_eq!(read(&mut web, 10, 4), Ok(vec![10, 11, 12, 13]));
        assert_eq!(read(&mut web, 7, 4), Err(SourceError::NoRanges));
    }

    #[test]
    fn file_reads_stop_at_the_end() {
        let path = std::env::temp_dir().join(format!("orbit-subsync-{}.bin", std::process::id()));
        std::fs::write(&path, [1, 2, 3, 4, 5]).unwrap();
        let mut file = File(path.clone());
        assert_eq!(tauri::async_runtime::block_on(file.read(3, 10)), Ok(vec![4, 5]));
        assert_eq!(tauri::async_runtime::block_on(file.read(9, 10)), Ok(vec![]));
        let _ = std::fs::remove_file(path);
    }
}
