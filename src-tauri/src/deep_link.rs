//! `stremio://` and `orbit://` install links. An addon website's "Install"
//! button opens Orbit on the addon review (the page's install-by-link panel),
//! where nothing is added until the person confirms.
//!
//! The link reaches Orbit as a launch argument on Windows and Linux (from a
//! second launch, through the single-instance plugin, when Orbit already runs)
//! and as an "open URLs" event on macOS. The installers register both schemes
//! from `plugins > deep-link > desktop` in tauri.conf.json.
//!
//! A link is untrusted: any web page can produce one. It is checked here like a
//! pasted URL and only ever becomes `https` (as `stremio://` means in the
//! protocol), so a page can't make Orbit fetch plain `http` from this machine.
//! The URL is never logged: an install link often carries the addon's keys.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::addons::net::parse_transport_url;

/// Tells the page a link is waiting; it takes it with `deep_link_take`.
const EVENT: &str = "deep-link";
/// Longer than any real install link; anything past it isn't read.
const MAX_LEN: usize = 4096;

/// What a link asked for, as the page gets it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Link {
    /// An addon's manifest URL, for the install review.
    Addon { url: String },
    /// A `stremio://` or `orbit://` link Orbit can't use (another kind of link, or not a valid addon URL).
    Unusable,
}

/// The latest link the page hasn't taken yet (one from the launch waits here
/// until the page has started).
pub struct Pending(Mutex<Option<Link>>);

/// A link that came before setup made `Pending` (macOS can send "open URLs"
/// that early): kept here until setup starts `Pending` with it, as a launch
/// argument waits for setup on Windows and Linux.
static EARLY: Mutex<Option<Link>> = Mutex::new(None);

impl Pending {
    /// What setup manages: with any link that came before it.
    pub fn starting() -> Self {
        Pending(Mutex::new(EARLY.lock().unwrap_or_else(|e| e.into_inner()).take()))
    }
}

/// What `arg` asks for, or None if it isn't a `stremio://` or `orbit://` link.
pub fn parse(arg: &str) -> Option<Link> {
    let arg = arg.trim();
    let (scheme, rest) = arg.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("stremio") && !scheme.eq_ignore_ascii_case("orbit") {
        return None;
    }
    if arg.len() > MAX_LEN {
        return Some(Link::Unusable);
    }
    Some(match parse_transport_url(&format!("https://{rest}")) {
        Ok(url) => Link::Addon { url: url.into() },
        Err(_) => Link::Unusable,
    })
}

/// Keeps the first link among `args` for the page and tells it. True if there was one.
pub fn offer<S: AsRef<str>>(app: &AppHandle, args: impl IntoIterator<Item = S>) -> bool {
    let Some(link) = args.into_iter().find_map(|a| parse(a.as_ref())) else { return false };
    if keep(app.try_state::<Pending>().as_deref(), link) {
        let _ = app.emit(EVENT, ());
    }
    true
}

/// Puts `link` where the page will take it: `pending` once set up, else `EARLY`.
/// True if the page is there to be told.
fn keep(pending: Option<&Pending>, link: Link) -> bool {
    let slot = pending.map_or(&EARLY, |p| &p.0);
    *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(link);
    pending.is_some()
}

#[tauri::command]
pub fn deep_link_take(pending: State<'_, Pending>) -> Option<Link> {
    pending.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(test)]
mod tests {
    use super::{keep, parse, Link, Pending};

    fn addon(url: &str) -> Option<Link> {
        Some(Link::Addon { url: url.into() })
    }

    #[test]
    fn maps_install_links_to_https() {
        assert_eq!(parse("stremio://a.example/path/manifest.json"), addon("https://a.example/path/manifest.json"));
        assert_eq!(parse("orbit://a.example/manifest.json"), addon("https://a.example/manifest.json"));
        assert_eq!(parse("STREMIO://a.example/manifest.json"), addon("https://a.example/manifest.json"));
        // Never plain http, even for this machine.
        assert_eq!(parse("stremio://127.0.0.1:7000/manifest.json"), addon("https://127.0.0.1:7000/manifest.json"));
    }

    #[test]
    fn ignores_other_arguments() {
        for arg in ["C:\\Program Files\\Orbit\\orbit.exe", "--flag", "https://a.example/manifest.json", "http://a.example/manifest.json", "file:///etc/manifest.json"] {
            assert_eq!(parse(arg), None, "{arg}");
        }
    }

    #[test]
    fn a_link_before_setup_waits_for_it() {
        let link = addon("https://a.example/manifest.json").unwrap();
        // No `Pending` yet (macOS's "open URLs" can come first): kept, not dropped, and nothing to tell.
        assert!(!keep(None, link.clone()));
        let pending = Pending::starting();
        assert_eq!(pending.0.lock().unwrap().clone(), Some(link.clone()));
        // Taken once: the next start has nothing waiting.
        assert_eq!(Pending::starting().0.lock().unwrap().clone(), None);
        // Once set up, a link goes straight to the page's slot.
        let other = addon("https://b.example/manifest.json").unwrap();
        assert!(keep(Some(&pending), other.clone()));
        assert_eq!(pending.0.lock().unwrap().clone(), Some(other));
    }

    #[test]
    fn unusable_links_say_so() {
        for arg in [
            "stremio://a.example/configure",
            "stremio://a.example/manifest.json?x=1",
            "stremio://user:pw@a.example/manifest.json",
            "stremio:///manifest.json",
            "stremio://",
            "stremio://detail/movie/tt0111161",
        ] {
            assert_eq!(parse(arg), Some(Link::Unusable), "{arg}");
        }
        assert_eq!(parse(&format!("stremio://a.example/{}/manifest.json", "a".repeat(5000))), Some(Link::Unusable));
    }
}
