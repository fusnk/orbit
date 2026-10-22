//! Discord Rich Presence (Settings → Integrations, off by default): shows
//! "Watching <title>" on the person's Discord profile while Orbit plays, and
//! "Watching Orbit" with what they're doing (browsing movies, a title's page…)
//! the rest of the time.
//! It talks only to the Discord app on this PC, over its local pipe; Discord
//! then shares it with the person's friends. Discord being closed is normal,
//! so failures stay quiet.

use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};

use discord_rich_presence::activity::{Activity, ActivityType, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use tauri::State;

/// Orbit's application on the Discord Developer Portal. Public, not a secret:
/// it only names the app (and "Orbit" in "Watching Orbit").
const APP_ID: &str = "1555736136205344880";
/// The Orbit logo, uploaded to that application as a Rich Presence asset.
const LOGO: &str = "orbit";
/// Discord's limits: text fields take 2–128 characters, image URLs up to 256.
const MAX_TEXT: usize = 128;
const MAX_IMAGE_URL: usize = 256;

/// What's happening, as the page describes it.
#[derive(serde::Deserialize)]
pub struct Presence {
    /// Browsing rather than watching: shown as "Watching Orbit".
    #[serde(default)]
    browsing: bool,
    /// The movie or show, or what they're doing ("Browsing movies").
    title: String,
    /// E.g. "S1 · E2 · Pilot", "Paused", or the title whose page is open.
    state: String,
    /// The poster, if it's an https image.
    image: Option<String>,
    /// Unix seconds: when playback (as if from the start) or browsing began, and when playback will end.
    start: Option<i64>,
    end: Option<i64>,
}

enum Message {
    Set(Presence),
    Clear,
}

pub struct Discord(Mutex<Sender<Message>>);

impl Discord {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        // Pipe I/O blocks, so it gets its own thread and commands return at once.
        if let Err(e) = std::thread::Builder::new().name("discord".into()).spawn(move || run(&rx)) {
            eprintln!("discord: {e}");
        }
        Self(Mutex::new(tx))
    }

    fn send(&self, message: Message) -> Result<(), String> {
        self.0.lock().map_err(|_| "Discord unavailable")?.send(message).map_err(|_| "Discord unavailable".into())
    }
}

fn run(rx: &Receiver<Message>) {
    let mut client: Option<DiscordIpcClient> = None;
    while let Ok(mut message) = rx.recv() {
        // Only the newest matters, and Discord rate-limits updates.
        while let Ok(newer) = rx.try_recv() {
            message = newer;
        }
        // One retry: the first failure may just mean Discord restarted since the last update.
        for _ in 0..2 {
            if client.is_none() {
                // Nothing to clear if we aren't connected.
                if matches!(message, Message::Clear) {
                    break;
                }
                let mut fresh = DiscordIpcClient::new(APP_ID);
                if fresh.connect().is_err() {
                    break; // Discord isn't running.
                }
                client = Some(fresh);
            }
            let Some(connected) = client.as_mut() else { break };
            let sent = match &message {
                Message::Set(presence) => connected.set_activity(activity(presence)),
                Message::Clear => connected.clear_activity(),
            };
            if sent.is_ok() {
                break;
            }
            let _ = connected.close();
            client = None;
        }
    }
}

fn activity(p: &Presence) -> Activity<'_> {
    let title = text(&p.title);
    let image = p.image.as_deref().filter(|url| poster_ok(url)).unwrap_or(LOGO);
    let mut assets = Assets::new().large_image(image);
    if let Some(title) = title.clone() {
        assets = assets.large_text(title);
    }
    // Discord's only fitting verb is "Watching": while browsing the member list
    // reads "Watching Orbit", while playing "Watching <title>".
    let mut activity = Activity::new()
        .activity_type(ActivityType::Watching)
        .status_display_type(if p.browsing { StatusDisplayType::Name } else { StatusDisplayType::Details })
        .assets(assets);
    if let Some(title) = title {
        activity = activity.details(title);
    }
    if let Some(state) = text(&p.state) {
        activity = activity.state(state);
    }
    if p.start.is_some() || p.end.is_some() {
        let mut times = Timestamps::new();
        if let Some(start) = p.start {
            times = times.start(start);
        }
        if let Some(end) = p.end {
            times = times.end(end);
        }
        activity = activity.timestamps(times);
    }
    activity
}

/// Text Discord will accept: trimmed, at least 2 and at most 128 characters.
fn text(value: &str) -> Option<String> {
    let value = value.trim();
    (value.chars().count() >= 2).then(|| value.chars().take(MAX_TEXT).collect())
}

/// Posters come from addons: only plain https URLs Discord can fetch go through.
/// Discord passes the address on to everyone who sees the presence, so one
/// that may carry a secret stays home (the Orbit logo shows instead): a login,
/// a query (where tokens and keys usually sit), RPDB's (its key is in the
/// path, and catalog addons hand such posters out), or a host on this machine
/// or the LAN (a media server's address).
fn poster_ok(url: &str) -> bool {
    if !url.starts_with("https://") || url.len() > MAX_IMAGE_URL || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && !u.host_str().is_some_and(|h| h.eq_ignore_ascii_case(crate::rpdb::HOST))
            && !crate::addons::net::is_private_host(&u)
    })
}


#[tauri::command]
pub fn discord_set_activity(discord: State<'_, Discord>, presence: Presence) -> Result<(), String> {
    discord.send(Message::Set(presence))
}

#[tauri::command]
pub fn discord_clear(discord: State<'_, Discord>) -> Result<(), String> {
    discord.send(Message::Clear)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_fits_discord_limits() {
        assert_eq!(text(" x "), None);
        assert_eq!(text("Up").as_deref(), Some("Up"));
        assert_eq!(text(&"é".repeat(200)).map(|t| t.chars().count()), Some(MAX_TEXT));
    }

    #[test]
    fn only_plain_https_posters() {
        assert!(poster_ok("https://images.metahub.space/poster/medium/tt0903747/img"));
        assert!(!poster_ok("http://example.com/a.jpg"));
        assert!(!poster_ok("https://example.com/a b.jpg"));
        assert!(!poster_ok(&format!("https://example.com/{}", "a".repeat(300))));
    }

    #[test]
    fn posters_that_carry_secrets_or_private_hosts_stay_home() {
        // Discord shows the address to everyone who sees the presence: no keys, logins, tokens or LAN hosts.
        assert!(!poster_ok("https://api.ratingposterdb.com/t1-SECRETkey/imdb/poster-default/tt0903747.jpg"));
        assert!(!poster_ok("https://user:pw@posters.example.com/a.jpg"));
        assert!(!poster_ok("https://posters.example.com/a.jpg?api_key=SECRET"));
        assert!(!poster_ok("https://192.168.1.20:8096/Items/1/Images/Primary"));
        assert!(!poster_ok("https://localhost/a.jpg"));
        assert!(poster_ok("https://image.tmdb.org/t/p/w500/abc.jpg"));
    }
}
