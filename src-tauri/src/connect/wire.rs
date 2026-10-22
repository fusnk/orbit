//! What Orbit Connect sends between devices, and the checks on each message.
//!
//! Every message is read as untrusted, on both sides: fixed fields only
//! (`deny_unknown_fields`), a capped size, and each value checked for shape and
//! range. Playing something sends only what names it (type, id, season and
//! episode), a position and preferred track languages: never a stream's
//! address, an addon's, a key or a token. The receiving Orbit finds the
//! sources itself, with its own addons and ranking.

use serde::{Deserialize, Serialize};

use super::auth::{KEY_HEX, TAG_HEX, is_hex, is_id};

/// A request's body, at most (the longest is a play command).
pub const MAX_BODY_BYTES: usize = 2048;
/// An answer's body, at most (what's playing, with its track lists).
pub const MAX_REPLY_BYTES: usize = 32 * 1024;
/// A device name, in characters.
pub const MAX_NAME_CHARS: usize = 40;
const MAX_TEXT_CHARS: usize = 200;
const MAX_TRACK_TEXT: usize = 100;
const MAX_TRACKS: usize = 64;
const MAX_ID_CHARS: usize = 120;
/// Positions beyond this aren't a real video's (a week), as for the phone remote.
const MAX_POSITION: f64 = 7.0 * 24.0 * 3600.0;

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Pc,
    Tv,
}

impl Kind {
    /// What this build is: Android builds are Orbit for TVs.
    pub const fn this() -> Self {
        if cfg!(target_os = "android") { Self::Tv } else { Self::Pc }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pc => "pc",
            Self::Tv => "tv",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pc" => Some(Self::Pc),
            "tv" => Some(Self::Tv),
            _ => None,
        }
    }
}

/// Text from another device as it may be shown: no control or direction-override
/// characters (which could make one name pose as another), trimmed and capped.
fn clean(text: &str, max: usize) -> String {
    let bidi = |c: char| matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}');
    text.chars().filter(|c| !c.is_control() && !bidi(*c)).take(max).collect::<String>().trim().to_owned()
}

/// A device name as it may be shown and announced, or None if nothing is left of it.
pub fn device_name(name: &str) -> Option<String> {
    Some(clean(name, MAX_NAME_CHARS)).filter(|n| !n.is_empty())
}

/// Pairing's messages (auth.rs has the protocol). 1. The sender: who it is, its long-term and fresh keys.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairStart {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub key: String,
    pub fresh: String,
}

impl PairStart {
    pub fn well_formed(&self) -> bool {
        is_id(&self.id) && device_name(&self.name).is_some() && is_hex(&self.key, KEY_HEX) && is_hex(&self.fresh, KEY_HEX)
    }
}

/// 1'. The receiver: who it is, its keys, and its commitment to its nonce.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairCommit {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub key: String,
    pub fresh: String,
    pub commit: String,
}

impl PairCommit {
    pub fn well_formed(&self) -> bool {
        is_id(&self.id) && device_name(&self.name).is_some() && is_hex(&self.key, KEY_HEX) && is_hex(&self.fresh, KEY_HEX) && is_hex(&self.commit, TAG_HEX)
    }
}

/// 2. The sender's nonce; 2'. the receiver's, revealed (`nonce` only).
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairNonce {
    pub id: String,
    pub nonce: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairReveal {
    pub nonce: String,
}

/// Step 3: the sender's person confirmed the numbers match, with its proof (`auth::confirm_proof`);
/// once the receiver's person has too, the receiver's proof comes back.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairConfirm {
    pub id: String,
    pub proof: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairConfirmed {
    pub proof: String,
}

/// The sender gave up.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PairCancel {
    pub id: String,
}

/// Who a paired device is, from its own signed answer (`/v1/hello`): the name
/// shown for it comes from here, not from the network announcement anyone could make.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Hello {
    pub id: String,
    pub name: String,
    pub kind: Kind,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TitleKind {
    Movie,
    Series,
}

/// Play a title on the receiving device.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Play {
    #[serde(rename = "type")]
    pub kind: TitleKind,
    /// The catalog id (e.g. `tt0111161`, `kitsu:1`), which the receiver's own addons look up.
    pub id: String,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    /// Where to start, in seconds; none: where the receiver's own history says.
    pub position: Option<f64>,
    /// Preferred audio and subtitle languages (Orbit's language keys, e.g. `en`, `pt-BR`).
    pub audio: Option<String>,
    pub subtitle: Option<String>,
    /// Continuing what was playing on the sender (it stops there).
    pub handoff: bool,
}

/// An id as catalogs write them: letters, digits and `:._-` only.
fn title_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_CHARS && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'.' | b'_' | b'-'))
}

/// A language key's shape (`en`, `pt-BR`, `zh-Hant`); the page checks it's one it knows.
fn language_ok(key: &str) -> bool {
    let (base, region) = key.split_once('-').map_or((key, None), |(b, r)| (b, Some(r)));
    (2..=3).contains(&base.len()) && base.bytes().all(|b| b.is_ascii_lowercase()) && region.is_none_or(|r| (2..=4).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_alphanumeric()))
}

impl Play {
    /// Reads and checks a play command (sent by another device, or by this page to send on).
    pub fn parse(body: &[u8]) -> Option<Self> {
        if body.len() > MAX_BODY_BYTES {
            return None;
        }
        serde_json::from_slice::<Self>(body).ok().filter(Self::valid)
    }

    pub fn valid(&self) -> bool {
        // A series' episode is named by both numbers, or neither (then the receiver plays what's next there).
        let episode_ok = match (self.kind, self.season, self.episode) {
            (TitleKind::Movie, None, None) => true,
            (TitleKind::Series, None, None) => true,
            (TitleKind::Series, Some(s), Some(e)) => s <= 9999 && e <= 99_999,
            _ => false,
        };
        title_id_ok(&self.id)
            && episode_ok
            && self.position.is_none_or(|p| p.is_finite() && (0.0..=MAX_POSITION).contains(&p))
            && self.audio.as_deref().is_none_or(language_ok)
            && self.subtitle.as_deref().is_none_or(language_ok)
    }
}

/// The player commands one device may send another: remote/command.rs's, as
/// a phone sends them. The receiver checks them against what it's playing; the
/// sender only checks their size and kind before signing them.
pub fn control_ok(body: &[u8]) -> bool {
    const PLAYER: [&str; 9] = ["pause", "seek-by", "seek-to", "volume", "mute", "next", "subtitle", "audio", "stop"];
    body.len() <= crate::remote::command::MAX_BODY_BYTES && serde_json::from_slice::<serde_json::Value>(body).ok().and_then(|v| v.get("cmd")?.as_str().map(|c| PLAYER.contains(&c))).unwrap_or(false)
}

/// What another device says is playing there (`/v1/status`), checked before the page sees it.
#[derive(Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Status {
    pub playing: Option<Playing>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Playing {
    title: String,
    detail: Option<String>,
    live: bool,
    can_next: bool,
    max_volume: f64,
    /// Always null: a poster's address never leaves the device playing it.
    #[serde(default, skip_serializing, rename = "art")]
    _art: Option<()>,
    playback: Playback,
    audio: Vec<Track>,
    subtitles: Vec<Track>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Playback {
    position: Option<f64>,
    duration: Option<f64>,
    paused: bool,
    buffering: bool,
    volume: Option<f64>,
    muted: bool,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
struct Track {
    id: i64,
    title: Option<String>,
    lang: Option<String>,
    selected: bool,
}

impl Status {
    /// Reads another device's answer, its text cleaned and its numbers and lists held to sane ranges.
    pub fn parse(body: &[u8]) -> Option<Self> {
        if body.len() > MAX_REPLY_BYTES {
            return None;
        }
        let mut status: Self = serde_json::from_slice(body).ok()?;
        if let Some(p) = &mut status.playing {
            let finite = |n: Option<f64>| n.filter(|n| n.is_finite() && (0.0..=MAX_POSITION).contains(n));
            if p.audio.len() > MAX_TRACKS || p.subtitles.len() > MAX_TRACKS || !p.max_volume.is_finite() {
                return None;
            }
            p.title = clean(&p.title, MAX_TEXT_CHARS);
            p.detail = p.detail.as_deref().map(|d| clean(d, MAX_TEXT_CHARS)).filter(|d| !d.is_empty());
            p.max_volume = p.max_volume.clamp(0.0, 150.0);
            p.playback.position = finite(p.playback.position);
            p.playback.duration = finite(p.playback.duration);
            p.playback.volume = p.playback.volume.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 150.0));
            for track in p.audio.iter_mut().chain(p.subtitles.iter_mut()) {
                track.title = track.title.as_deref().map(|t| clean(t, MAX_TRACK_TEXT)).filter(|t| !t.is_empty());
                track.lang = track.lang.as_deref().map(|t| clean(t, MAX_TRACK_TEXT)).filter(|t| !t.is_empty());
            }
        }
        Some(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(json: &str) -> Option<Play> {
        Play::parse(json.as_bytes())
    }

    #[test]
    fn reads_play_commands() {
        let movie = play(r#"{"type":"movie","id":"tt0111161","season":null,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false}"#).unwrap();
        assert_eq!(movie.kind, TitleKind::Movie);
        let handoff = play(r#"{"type":"series","id":"kitsu:1","season":1,"episode":3,"position":1234.5,"audio":"ja","subtitle":"pt-BR","handoff":true}"#).unwrap();
        assert_eq!((handoff.season, handoff.episode, handoff.position), (Some(1), Some(3), Some(1234.5)));
        assert!(play(r#"{"type":"series","id":"tt0944947","season":null,"episode":null,"position":null,"audio":null,"subtitle":"zh-Hant","handoff":false}"#).is_some());
    }

    #[test]
    fn refuses_anything_that_is_not_a_title() {
        for body in [
            "",
            "null",
            "{}",
            // A stream's or addon's address has no place in the message.
            r#"{"type":"movie","id":"tt1","season":null,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false,"url":"https://x.example/a.mkv"}"#,
            r#"{"type":"movie","id":"https://x.example/a.mkv","season":null,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"movie","id":"","season":null,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"tv","id":"tt1","season":null,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false}"#,
            // A movie has no episodes; an episode needs both numbers.
            r#"{"type":"movie","id":"tt1","season":1,"episode":1,"position":null,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"series","id":"tt1","season":1,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"series","id":"tt1","season":-1,"episode":2,"position":null,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"movie","id":"tt1","season":null,"episode":null,"position":-5,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"movie","id":"tt1","season":null,"episode":null,"position":1e300,"audio":null,"subtitle":null,"handoff":false}"#,
            r#"{"type":"movie","id":"tt1","season":null,"episode":null,"position":null,"audio":"english please","subtitle":null,"handoff":false}"#,
            r#"{"type":"movie","id":"tt1","season":null,"episode":null,"position":null,"audio":null,"subtitle":"EN","handoff":false}"#,
            r#"{"type":"movie","id":"tt1"}"#,
        ] {
            assert!(play(body).is_none(), "{body}");
        }
        let huge = format!(r#"{{"type":"movie","id":"{}","season":null,"episode":null,"position":null,"audio":null,"subtitle":null,"handoff":false}}"#, "a".repeat(MAX_BODY_BYTES));
        assert!(play(&huge).is_none());
    }

    #[test]
    fn only_player_commands_are_sent_on() {
        assert!(control_ok(br#"{"cmd":"pause","on":true}"#));
        assert!(control_ok(br#"{"cmd":"stop"}"#));
        assert!(!control_ok(br#"{"cmd":"search","query":"x"}"#));
        assert!(!control_ok(br#"{"cmd":"nav","key":"ok"}"#));
        assert!(!control_ok(br#"{"cmd":"open","index":0,"play":true}"#));
        assert!(!control_ok(b"[]"));
        assert!(!control_ok(&[b' '; 2000]));
    }

    #[test]
    fn names_lose_control_and_direction_characters() {
        assert_eq!(device_name("  Living room\u{0007} TV "), Some("Living room TV".into()));
        assert_eq!(device_name("\u{202e}VT moor"), Some("VT moor".into()));
        assert_eq!(device_name(" \n "), None);
        assert_eq!(device_name(&"x".repeat(100)).map(|n| n.chars().count()), Some(MAX_NAME_CHARS));
    }

    #[test]
    fn pairing_messages_must_be_well_formed() {
        let ok = || PairStart { id: "0".repeat(32), name: "PC".into(), kind: Kind::Pc, key: "a".repeat(64), fresh: "b".repeat(64) };
        assert!(ok().well_formed());
        assert!(!PairStart { id: "0".repeat(31), ..ok() }.well_formed());
        assert!(!PairStart { name: " ".into(), ..ok() }.well_formed());
        assert!(!PairStart { key: "A".repeat(64), ..ok() }.well_formed());
        assert!(!PairStart { fresh: "b".repeat(63), ..ok() }.well_formed());
        assert!(serde_json::from_str::<PairStart>(r#"{"id":"","name":"","kind":"pc","key":"","fresh":"","code":"123456"}"#).is_err());
        let commit = || PairCommit { id: "0".repeat(32), name: "TV".into(), kind: Kind::Tv, key: "a".repeat(64), fresh: "b".repeat(64), commit: "c".repeat(64) };
        assert!(commit().well_formed());
        assert!(!PairCommit { commit: "c".repeat(32), ..commit() }.well_formed());
    }

    #[test]
    fn another_devices_status_is_checked_and_cleaned() {
        let body = br#"{"playing":{"title":"Film\u0007","detail":null,"live":false,"canNext":true,"maxVolume":100,"art":null,
            "playback":{"position":12.5,"duration":-3,"paused":false,"buffering":false,"volume":400,"muted":false},
            "audio":[{"id":1,"title":"English","lang":"eng","selected":true}],"subtitles":[]}}"#;
        let status = Status::parse(body).unwrap();
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["playing"]["title"], "Film");
        assert_eq!(json["playing"]["playback"]["duration"], serde_json::Value::Null);
        assert_eq!(json["playing"]["playback"]["volume"], 150.0);
        assert!(json["playing"].get("art").is_none());
        assert!(Status::parse(br#"{"playing":null}"#).unwrap().playing.is_none());
        // An address where the poster would be, or anything extra, and it's refused.
        assert!(Status::parse(br#"{"playing":{"title":"F","detail":null,"live":false,"canNext":false,"maxVolume":100,"art":"https://x/p.jpg","playback":{"position":null,"duration":null,"paused":false,"buffering":false,"volume":null,"muted":false},"audio":[],"subtitles":[]}}"#).is_none());
        assert!(Status::parse(br#"{"playing":null,"stream":"https://x"}"#).is_none());
    }
}
