//! Opening pages in the person's browser: an addon's configure page, and a
//! few fixed sites. Those pages need a real browser (logins, debrid keys)
//! rather than Orbit's window, and kept apart from it they can't reach Orbit's
//! IPC, storage or keychain.

use reqwest::Url;

/// Opens an https address (an addon's configure page) in the person's browser.
pub fn open_in_browser(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("err.browser.https-only".into());
    }
    // Not explorer.exe: it reads some addresses (e.g. one carrying an encoded
    // return link, like Stremio's sign-in) as a folder path and opens File
    // Explorer instead. This hands the address to the default browser as is,
    // still as one argument with no shell in between.
    #[cfg(windows)]
    let mut cmd = {
        let mut cmd = std::process::Command::new("rundll32.exe");
        cmd.arg("url.dll,FileProtocolHandler");
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    launch(cmd.arg(url.as_str())).map(|_| ()).map_err(|_| "err.browser.open".into())
}

/// Starts a short-lived opener (`xdg-open`, `open`, `explorer.exe`) and reaps
/// it once it exits, returning its process id. A child that's never waited for
/// stays in the process table as a zombie until Orbit quits: one more for
/// every page, folder or file opened.
pub fn launch(cmd: &mut std::process::Command) -> std::io::Result<u32> {
    let mut child = cmd.spawn()?;
    let id = child.id();
    let _ = std::thread::Builder::new().name("opener".into()).spawn(move || child.wait());
    Ok(id)
}

/// Sites the page may send the person to with `open_external`, each with its
/// subdomains: TMDB's API key page (onboarding), Letterboxd reviews, the
/// debrid key pages (Settings → Debrid) and the source code (Settings → About).
/// imdb.com is for a title page's "Open on IMDb": the link is built from a
/// checked IMDb id (`tt` and digits), never from addon text, and IMDb is where
/// those ids point, so it opens nothing an addon could choose.
/// A fixed list, because the page also draws untrusted addon data: if a bug
/// ever let that reach this command, it still couldn't open an arbitrary site
/// (or another scheme) in the person's browser.
const EXTERNAL_HOSTS: &[&str] = &["themoviedb.org", "letterboxd.com", "imdb.com", "real-debrid.com", "torbox.app", "github.com"];

fn allowed_external(url: &Url) -> bool {
    let Some(host) = url.domain() else { return false };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && EXTERNAL_HOSTS.iter().any(|allowed| host == *allowed || host.strip_suffix(allowed).is_some_and(|sub| sub.ends_with('.')))
}

/// An addon's configure page can be on any host (it's wherever the addon
/// lives, taken from its manifest URL), so it can't be on a fixed list. It's
/// untrusted, so it's held to https on a public host, with no user name or
/// password in it: never this machine or the LAN.
fn allowed_configure(url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && !crate::addons::net::is_private_host(url)
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let url = Url::parse(url.trim()).map_err(|_| "err.address.invalid")?;
    if !allowed_external(&url) {
        return Err("err.browser.site-not-allowed".into());
    }
    open_in_browser(&url)
}

/// Opens an addon's configure page in the person's browser (see `allowed_configure`).
#[tauri::command]
pub async fn open_addon_configure(url: String) -> Result<(), String> {
    let url = Url::parse(url.trim()).map_err(|_| "err.address.invalid")?;
    if !allowed_configure(&url) {
        return Err("err.browser.configure-not-allowed".into());
    }
    open_in_browser(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn external_pages_are_the_listed_sites_over_https() {
        for ok in [
            "https://www.themoviedb.org/settings/api",
            "https://letterboxd.com/film/x/reviews/",
            "https://real-debrid.com/apitoken",
            "https://torbox.app/settings",
            "https://github.com/fusnk/orbit",
            "https://www.imdb.com/title/tt0133093/",
            "https://LETTERBOXD.COM./film/x/",
        ] {
            assert!(allowed_external(&url(ok)), "{ok}");
        }
        for bad in [
            "http://letterboxd.com/",
            "https://evil.example/",
            "https://letterboxd.com.evil.example/",
            "https://evilletterboxd.com/",
            "https://imdb.com.evil.example/title/tt0133093/",
            "https://user:pass@letterboxd.com/",
            "https://user@github.com/",
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "https://127.0.0.1/",
            "https://[::1]/",
        ] {
            assert!(!allowed_external(&url(bad)), "{bad}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn an_opener_is_reaped_once_it_exits() {
        let id = launch(&mut std::process::Command::new("true")).unwrap();
        let stat = format!("/proc/{id}/stat");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        // Reaped: gone from the process table, not left there as a zombie (state `Z`).
        while std::fs::read_to_string(&stat).is_ok() {
            assert!(std::time::Instant::now() < deadline, "still in the process table: {:?}", std::fs::read_to_string(&stat));
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    #[test]
    fn configure_pages_are_https_on_a_public_host() {
        assert!(allowed_configure(&url("https://streams.addon-a.example/configure")));
        assert!(allowed_configure(&url("https://addon.example/abc/configure?x=1")));
        for bad in [
            "http://addon.example/configure",
            "https://localhost/configure",
            "https://127.0.0.1/configure",
            "https://192.168.1.1/configure",
            "https://[::1]/configure",
            "https://user:pass@addon.example/configure",
            "file:///etc/passwd",
            "stremio://addon.example/manifest.json",
        ] {
            assert!(!allowed_configure(&url(bad)), "{bad}");
        }
    }
}
