//! Local authenticated VOD relay: upstream addresses and redirects never reach mpv.
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tauri::Manager;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{OnceCell, Semaphore},
};

struct Relay {
    port: u16,
    token: String,
}
static RELAY: OnceCell<Relay> = OnceCell::const_new();
static CONNECTIONS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(8)));

pub async fn address(app: &tauri::AppHandle, profile: &str, source: &str, key: &str) -> Result<String, String> {
    let relay = RELAY
        .get_or_try_init(|| async {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.map_err(|_| "err.iptv.playback-start")?;
            let port = listener.local_addr().map_err(|_| "err.iptv.playback-start")?.port();
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes).map_err(|_| "err.iptv.playback-start")?;
            let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            let check = token.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Ok((mut socket, _)) = listener.accept().await {
                    let Ok(permit) = CONNECTIONS.clone().try_acquire_owned() else {
                        let _ = socket
                            .write_all(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
                            .await;
                        continue;
                    };
                    let app = app.clone();
                    let token = check.clone();
                    tauri::async_runtime::spawn(async move {
                        let _permit = permit;
                        // Error details deliberately never include upstream URLs or credentials.
                        let mut started = false;
                        if serve(&app, &token, port, &mut socket, &mut started).await.is_err() && !started {
                            let _ = socket.write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").await;
                        }
                    });
                }
            });
            Ok::<Relay, String>(Relay { port, token })
        })
        .await?;
    if [profile, source, key]
        .iter()
        .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    {
        return Err("invalid IPTV playback locator".into());
    }
    Ok(format!("http://127.0.0.1:{}/{}/{}/{}/{}", relay.port, relay.token, profile, source, key))
}

fn valid_range(value: &str) -> bool {
    value
        .strip_prefix("bytes=")
        .and_then(|v| v.split_once('-'))
        .is_some_and(|(from, to)| (!from.is_empty() || !to.is_empty()) && from.bytes().all(|b| b.is_ascii_digit()) && to.bytes().all(|b| b.is_ascii_digit()) && value.len() < 80)
}
async fn serve(app: &tauri::AppHandle, token: &str, port: u16, socket: &mut TcpStream, started: &mut bool) -> Result<(), String> {
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !bytes.ends_with(b"\r\n\r\n") {
            let mut b = [0u8; 1];
            if socket.read(&mut b).await.map_err(|_| "request failed")? == 0 || bytes.len() >= 8192 {
                return Err("Invalid request");
            }
            bytes.push(b[0]);
        }
        Ok(())
    })
    .await
    .map_err(|_| "Request timed out")?
    .map_err(String::from)?;
    let request = std::str::from_utf8(&bytes).map_err(|_| "Invalid request")?;
    let mut lines = request.split("\r\n");
    let mut first = lines.next().ok_or("Invalid request")?.split_whitespace();
    let method = first.next().ok_or("Invalid request")?;
    if !matches!(method, "GET" | "HEAD") {
        return Err("Invalid method".into());
    }
    let route: Vec<&str> = first.next().ok_or("Invalid request")?.split('/').collect();
    if route.len() != 5 || !crate::remote::guard::same(route[1], token) {
        return Err("Invalid locator".into());
    }
    let (profile, source, key) = (route[2], route[3], route[4]);
    if app.state::<crate::profiles::ActiveProfile>().id()? != profile {
        return Err("Profile changed".into());
    }
    let lines: Vec<&str> = lines.collect();
    let expected = format!("127.0.0.1:{port}");
    if !lines
        .iter()
        .filter_map(|l| l.split_once(':'))
        .any(|(k, v)| k.eq_ignore_ascii_case("host") && v.trim() == expected)
    {
        return Err("Invalid host".into());
    }
    let range = lines
        .into_iter()
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.eq_ignore_ascii_case("range"))
        .map(|(_, v)| v.trim());
    if range.is_some_and(|r| !valid_range(r)) {
        return Err("Invalid range".into());
    }
    let (url, _, _) = super::vod::resolve(&*app.state::<crate::db::Db>().lock()?, profile, source, key)?;
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid provider address")?;
    let mut response = super::net::vod_response(url, method == "HEAD", range).await?;
    let status = response.status().as_u16();
    let mut headers = format!("HTTP/1.1 {status} OK\r\nConnection: close\r\n");
    for name in ["content-length", "content-range", "accept-ranges"] {
        if let Some(value) = response.headers().get(name).and_then(|v| v.to_str().ok()).filter(|v| !v.chars().any(char::is_control)) {
            headers.push_str(&format!("{name}: {value}\r\n"));
        }
    }
    // Never forward Location, cookies, server messages or content types/filenames.
    headers.push_str("Content-Type: application/octet-stream\r\n\r\n");
    *started = true;
    socket.write_all(headers.as_bytes()).await.map_err(|_| "Playback closed")?;
    if method != "HEAD" {
        while let Some(chunk) = response.chunk().await.map_err(|_| "Provider stream failed")? {
            tokio::time::timeout(Duration::from_secs(30), socket.write_all(&chunk))
                .await
                .map_err(|_| "Playback timed out")?
                .map_err(|_| "Playback closed")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_one_bounded_byte_range() {
        for range in ["bytes=0-", "bytes=5-10", "bytes=-500"] {
            assert!(valid_range(range));
        }
        for range in ["bytes=-", "bytes=0-5,10-20", "bytes=../../-", "bytes=0-1\r\nHost: secret", "items=0-5"] {
            assert!(!valid_range(range));
        }
    }
}
