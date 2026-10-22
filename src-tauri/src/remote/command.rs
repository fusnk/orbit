//! What a paired phone may ask Orbit to do: a fixed list, each checked here
//! before it reaches the page. Anything else (an unknown command, an extra
//! field, a number out of range, a track that isn't playing) is refused, so
//! the phone can only press the buttons the interface itself has.

use serde::{Deserialize, Serialize};

use super::picker::{Kind, MAX_MOOD_ID, PickAction, ShelfKind};

/// The most a command's body may be (the longest is a search).
pub const MAX_BODY_BYTES: usize = 1024;
/// Search text, in characters.
pub const MAX_QUERY_CHARS: usize = 100;
/// The farthest one relative jump may go, in seconds.
const MAX_JUMP: f64 = 600.0;
/// Positions beyond this aren't a real video's (a week).
const MAX_POSITION: f64 = 7.0 * 24.0 * 3600.0;
/// Volume with "Allow volume above 100%" on; the page holds it to the player's own limit.
const MAX_VOLUME: f64 = 150.0;

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NavKey {
    Up,
    Down,
    Left,
    Right,
    Ok,
    Back,
}

/// A command as the phone sends it.
#[derive(Deserialize, Debug)]
#[serde(tag = "cmd", rename_all = "kebab-case", deny_unknown_fields)]
enum Raw {
    Pause { on: bool },
    SeekBy { seconds: f64 },
    SeekTo { seconds: f64 },
    Volume { level: f64 },
    Mute { on: bool },
    Next,
    Subtitle { id: Option<i64> },
    Audio { id: i64 },
    Stop,
    Nav { key: NavKey },
    Search { query: String },
    Open { index: usize, play: bool },
    // Braces, so an extra field is refused as in the other commands.
    Browse {},
    Mood { mood: String },
    Surprise { kind: Kind },
    /// `shelf` is the request whose answer the phone shows.
    Details { from: ShelfKind, shelf: u64, row: usize, index: usize },
    Pick { from: ShelfKind, shelf: u64, row: usize, index: usize, action: PickAction },
}

/// A checked command, as the page receives it (`remote://command`).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Command {
    Pause { on: bool },
    SeekBy { seconds: f64 },
    SeekTo { seconds: f64 },
    Volume { level: f64 },
    Mute { on: bool },
    Next,
    Subtitle { id: Option<i64> },
    Audio { id: i64 },
    Stop,
    Nav { key: NavKey },
    /// `id` numbers the search, so its results can be told from an older one's.
    Search { id: u64, query: String },
    /// A result of search `search`, by its place in the list.
    Open { search: u64, index: usize, play: bool },
    /// The picker's requests (see picker.rs); `id` numbers each, so its answer can be told from an older one's.
    Browse { id: u64 },
    Mood { id: u64, mood: String },
    /// `media`: the tag is already called `kind`.
    Surprise { id: u64, media: Kind },
    /// A title on shelf `from`, numbered `shelf` (the request that filled it), by its place.
    Details { id: u64, from: ShelfKind, shelf: u64, row: usize, index: usize },
    Pick { from: ShelfKind, shelf: u64, row: usize, index: usize, action: PickAction },
}

/// What the picker holds now (picker.rs `Picker::view`).
pub struct PickerView<'a> {
    /// The latest request's number.
    pub requests: u64,
    /// The mood chips offered.
    pub moods: Vec<&'a str>,
    /// Each shelf's request number and how many titles each of its rows has (none until answered).
    pub shelves: [(u64, Vec<usize>); 3],
}

/// What a command is checked against: what's on screen right now.
pub struct Context<'a> {
    pub playing: bool,
    pub can_next: bool,
    pub audio: &'a [i64],
    pub subtitles: &'a [i64],
    /// The latest search: its number and how many results it has.
    pub search: u64,
    pub results: usize,
    pub picker: PickerView<'a>,
}

impl Context<'_> {
    /// Whether shelf `from` still holds request `shelf`'s titles (the phone may not have seen a newer
    /// answer yet: its row and index would then name another title), with title `index` in row `row`.
    fn has_title(&self, from: ShelfKind, shelf: u64, row: usize, index: usize) -> bool {
        let (id, rows) = &self.picker.shelves[from.index()];
        *id == shelf && rows.get(row).is_some_and(|&n| index < n)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Not a command, or not a valid one.
    Invalid,
    /// Fine in itself, but not now (a player command with nothing playing, say).
    NotNow,
}

/// Reads and checks a command. A search gets the next search number.
pub fn parse(body: &[u8], ctx: &Context<'_>) -> Result<Command, Refusal> {
    if body.len() > MAX_BODY_BYTES {
        return Err(Refusal::Invalid);
    }
    let raw: Raw = serde_json::from_slice(body).map_err(|_| Refusal::Invalid)?;
    let finite = |n: f64| n.is_finite();
    let player = |c: Command| if ctx.playing { Ok(c) } else { Err(Refusal::NotNow) };
    match raw {
        Raw::Pause { on } => player(Command::Pause { on }),
        Raw::SeekBy { seconds } if finite(seconds) && seconds != 0.0 && seconds.abs() <= MAX_JUMP => player(Command::SeekBy { seconds }),
        Raw::SeekTo { seconds } if finite(seconds) && (0.0..=MAX_POSITION).contains(&seconds) => player(Command::SeekTo { seconds }),
        Raw::Volume { level } if finite(level) && (0.0..=MAX_VOLUME).contains(&level) => player(Command::Volume { level: level.round() }),
        Raw::Mute { on } => player(Command::Mute { on }),
        Raw::Next if ctx.can_next => player(Command::Next),
        Raw::Next => Err(Refusal::NotNow),
        // Only tracks the file has (mpv's own list): the phone can't make up an id.
        Raw::Subtitle { id: None } => player(Command::Subtitle { id: None }),
        Raw::Subtitle { id: Some(id) } if ctx.subtitles.contains(&id) => player(Command::Subtitle { id: Some(id) }),
        Raw::Audio { id } if ctx.audio.contains(&id) => player(Command::Audio { id }),
        Raw::Stop => player(Command::Stop),
        Raw::Nav { key } => Ok(Command::Nav { key }),
        Raw::Search { query } => {
            let query = query.trim();
            let ok = !query.is_empty() && query.chars().count() <= MAX_QUERY_CHARS && !query.chars().any(char::is_control);
            if ok { Ok(Command::Search { id: ctx.search + 1, query: query.to_owned() }) } else { Err(Refusal::Invalid) }
        }
        Raw::Open { index, play } if index < ctx.results => Ok(Command::Open { search: ctx.search, index, play }),
        Raw::Open { .. } => Err(Refusal::NotNow),
        Raw::Browse {} => Ok(Command::Browse { id: ctx.picker.requests + 1 }),
        Raw::Mood { mood } if mood.len() > MAX_MOOD_ID => Err(Refusal::Invalid),
        // Only a chip the page offered.
        Raw::Mood { mood } if ctx.picker.moods.contains(&mood.as_str()) => Ok(Command::Mood { id: ctx.picker.requests + 1, mood }),
        Raw::Mood { .. } => Err(Refusal::NotNow),
        Raw::Surprise { kind } => Ok(Command::Surprise { id: ctx.picker.requests + 1, media: kind }),
        Raw::Details { from, shelf, row, index } if ctx.has_title(from, shelf, row, index) => Ok(Command::Details { id: ctx.picker.requests + 1, from, shelf, row, index }),
        Raw::Pick { from, shelf, row, index, action } if ctx.has_title(from, shelf, row, index) => Ok(Command::Pick { from, shelf, row, index, action }),
        Raw::Details { .. } | Raw::Pick { .. } => Err(Refusal::NotNow),
        // A number out of range, or a track that isn't there.
        Raw::SeekBy { .. } | Raw::SeekTo { .. } | Raw::Volume { .. } | Raw::Subtitle { .. } | Raw::Audio { .. } => Err(Refusal::Invalid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_picks() -> PickerView<'static> {
        PickerView { requests: 0, moods: vec![], shelves: [(0, vec![]), (0, vec![]), (0, vec![])] }
    }

    fn playing() -> Context<'static> {
        Context { playing: true, can_next: true, audio: &[1, 2], subtitles: &[3], search: 7, results: 2, picker: no_picks() }
    }

    fn idle() -> Context<'static> {
        Context { playing: false, can_next: false, audio: &[], subtitles: &[], search: 0, results: 0, picker: no_picks() }
    }

    /// Home answered request 4 with rows of 3 and 1 titles, mood request 5 with 2, and the surprise (6) with none.
    fn picking() -> Context<'static> {
        let picker = PickerView { requests: 6, moods: vec!["feel-good", "scare"], shelves: [(4, vec![3, 1]), (5, vec![2]), (6, vec![0])] };
        Context { picker, ..idle() }
    }

    #[test]
    fn picker_requests_get_the_next_number() {
        let ctx = picking();
        assert_eq!(parse_str(r#"{"cmd":"browse"}"#, &ctx), Ok(Command::Browse { id: 7 }));
        assert_eq!(parse_str(r#"{"cmd":"mood","mood":"scare"}"#, &ctx), Ok(Command::Mood { id: 7, mood: "scare".into() }));
        assert_eq!(parse_str(r#"{"cmd":"surprise","kind":"series"}"#, &ctx), Ok(Command::Surprise { id: 7, media: Kind::Series }));
        assert_eq!(parse_str(r#"{"cmd":"details","from":"home","shelf":4,"row":1,"index":0}"#, &ctx), Ok(Command::Details { id: 7, from: ShelfKind::Home, shelf: 4, row: 1, index: 0 }));
        assert_eq!(
            parse_str(r#"{"cmd":"pick","from":"mood","shelf":5,"row":0,"index":1,"action":"add"}"#, &ctx),
            Ok(Command::Pick { from: ShelfKind::Mood, shelf: 5, row: 0, index: 1, action: PickAction::Add })
        );
        assert_eq!(
            parse_str(r#"{"cmd":"pick","from":"home","shelf":4,"row":0,"index":2,"action":"play"}"#, &ctx),
            Ok(Command::Pick { from: ShelfKind::Home, shelf: 4, row: 0, index: 2, action: PickAction::Play })
        );
    }

    #[test]
    fn picker_titles_must_be_on_a_shelf() {
        let ctx = picking();
        for body in [
            r#"{"cmd":"details","from":"home","shelf":4,"row":0,"index":3}"#,
            r#"{"cmd":"details","from":"home","shelf":4,"row":2,"index":0}"#,
            r#"{"cmd":"details","from":"mood","shelf":5,"row":1,"index":0}"#,
            r#"{"cmd":"details","from":"surprise","shelf":6,"row":0,"index":0}"#,
            r#"{"cmd":"pick","from":"mood","shelf":5,"row":0,"index":2,"action":"play"}"#,
            // An older answer than the shelf holds now.
            r#"{"cmd":"details","from":"home","shelf":3,"row":0,"index":0}"#,
            r#"{"cmd":"pick","from":"home","shelf":3,"row":0,"index":0,"action":"play"}"#,
            // A chip the page didn't offer.
            r#"{"cmd":"mood","mood":"funny"}"#,
        ] {
            assert_eq!(parse_str(body, &ctx), Err(Refusal::NotNow), "{body}");
        }
        // Nothing answered yet: nothing to pick.
        assert_eq!(parse_str(r#"{"cmd":"pick","from":"home","shelf":4,"row":0,"index":0,"action":"play"}"#, &idle()), Err(Refusal::NotNow));
    }

    #[test]
    fn picker_commands_refuse_anything_odd() {
        let ctx = picking();
        let long = format!(r#"{{"cmd":"mood","mood":"{}"}}"#, "a".repeat(MAX_MOOD_ID + 1));
        for body in [
            r#"{"cmd":"browse","all":true}"#,
            r#"{"cmd":"surprise","kind":"episode"}"#,
            r#"{"cmd":"surprise"}"#,
            r#"{"cmd":"mood","mood":1}"#,
            r#"{"cmd":"details","from":"library","shelf":4,"row":0,"index":0}"#,
            r#"{"cmd":"details","from":"home","shelf":4,"row":-1,"index":0}"#,
            r#"{"cmd":"details","from":"home","shelf":4,"row":0,"index":0,"id":"tt0133093"}"#,
            r#"{"cmd":"pick","from":"home","shelf":4,"row":0,"index":0,"action":"delete"}"#,
            r#"{"cmd":"pick","from":"home","shelf":4,"row":0,"index":0}"#,
            long.as_str(),
        ] {
            assert_eq!(parse_str(body, &ctx), Err(Refusal::Invalid), "{body}");
        }
    }

    fn parse_str(body: &str, ctx: &Context<'_>) -> Result<Command, Refusal> {
        parse(body.as_bytes(), ctx)
    }

    #[test]
    fn reads_every_player_command() {
        let ctx = playing();
        assert_eq!(parse_str(r#"{"cmd":"pause","on":true}"#, &ctx), Ok(Command::Pause { on: true }));
        assert_eq!(parse_str(r#"{"cmd":"seek-by","seconds":-10}"#, &ctx), Ok(Command::SeekBy { seconds: -10.0 }));
        assert_eq!(parse_str(r#"{"cmd":"seek-to","seconds":61.5}"#, &ctx), Ok(Command::SeekTo { seconds: 61.5 }));
        assert_eq!(parse_str(r#"{"cmd":"volume","level":42.4}"#, &ctx), Ok(Command::Volume { level: 42.0 }));
        assert_eq!(parse_str(r#"{"cmd":"mute","on":false}"#, &ctx), Ok(Command::Mute { on: false }));
        assert_eq!(parse_str(r#"{"cmd":"next"}"#, &ctx), Ok(Command::Next));
        assert_eq!(parse_str(r#"{"cmd":"subtitle","id":null}"#, &ctx), Ok(Command::Subtitle { id: None }));
        assert_eq!(parse_str(r#"{"cmd":"subtitle","id":3}"#, &ctx), Ok(Command::Subtitle { id: Some(3) }));
        assert_eq!(parse_str(r#"{"cmd":"audio","id":2}"#, &ctx), Ok(Command::Audio { id: 2 }));
        assert_eq!(parse_str(r#"{"cmd":"stop"}"#, &ctx), Ok(Command::Stop));
    }

    #[test]
    fn player_commands_need_something_playing() {
        let ctx = idle();
        for body in [r#"{"cmd":"pause","on":true}"#, r#"{"cmd":"seek-by","seconds":10}"#, r#"{"cmd":"stop"}"#, r#"{"cmd":"next"}"#, r#"{"cmd":"subtitle","id":null}"#] {
            assert_eq!(parse_str(body, &ctx), Err(Refusal::NotNow), "{body}");
        }
        let mut ctx = playing();
        ctx.can_next = false;
        assert_eq!(parse_str(r#"{"cmd":"next"}"#, &ctx), Err(Refusal::NotNow));
    }

    #[test]
    fn navigation_and_search_work_any_time() {
        let ctx = idle();
        assert_eq!(parse_str(r#"{"cmd":"nav","key":"ok"}"#, &ctx), Ok(Command::Nav { key: NavKey::Ok }));
        assert_eq!(parse_str(r#"{"cmd":"nav","key":"back"}"#, &ctx), Ok(Command::Nav { key: NavKey::Back }));
        assert_eq!(parse_str(r#"{"cmd":"search","query":"  the matrix "}"#, &ctx), Ok(Command::Search { id: 1, query: "the matrix".into() }));
        assert_eq!(parse_str(r#"{"cmd":"search","query":"x"}"#, &playing()), Ok(Command::Search { id: 8, query: "x".into() }));
    }

    #[test]
    fn opening_needs_a_result_of_the_latest_search() {
        assert_eq!(parse_str(r#"{"cmd":"open","index":1,"play":true}"#, &playing()), Ok(Command::Open { search: 7, index: 1, play: true }));
        assert_eq!(parse_str(r#"{"cmd":"open","index":2,"play":true}"#, &playing()), Err(Refusal::NotNow));
        assert_eq!(parse_str(r#"{"cmd":"open","index":0,"play":false}"#, &idle()), Err(Refusal::NotNow));
        assert_eq!(parse_str(r#"{"cmd":"open","index":-1,"play":false}"#, &playing()), Err(Refusal::Invalid));
    }

    #[test]
    fn refuses_numbers_out_of_range() {
        let ctx = playing();
        for body in [
            r#"{"cmd":"seek-by","seconds":0}"#,
            r#"{"cmd":"seek-by","seconds":601}"#,
            r#"{"cmd":"seek-by","seconds":1e400}"#,
            r#"{"cmd":"seek-to","seconds":-1}"#,
            r#"{"cmd":"seek-to","seconds":99999999}"#,
            r#"{"cmd":"volume","level":151}"#,
            r#"{"cmd":"volume","level":-1}"#,
        ] {
            assert_eq!(parse_str(body, &ctx), Err(Refusal::Invalid), "{body}");
        }
    }

    #[test]
    fn refuses_tracks_the_file_lacks() {
        let ctx = playing();
        assert_eq!(parse_str(r#"{"cmd":"audio","id":3}"#, &ctx), Err(Refusal::Invalid));
        assert_eq!(parse_str(r#"{"cmd":"subtitle","id":1}"#, &ctx), Err(Refusal::Invalid));
    }

    #[test]
    fn refuses_anything_else() {
        let ctx = playing();
        for body in [
            "",
            "null",
            "[]",
            r#"{}"#,
            r#"{"cmd":"eval","code":"1"}"#,
            r#"{"cmd":"open-url","url":"https://example.com"}"#,
            r#"{"cmd":"pause"}"#,
            r#"{"cmd":"pause","on":"yes"}"#,
            r#"{"cmd":"pause","on":true,"extra":1}"#,
            r#"{"cmd":"nav","key":"home"}"#,
            r#"{"cmd":"search","query":""}"#,
            r#"{"cmd":"search","query":"   "}"#,
            "{\"cmd\":\"search\",\"query\":\"a\\u0000b\"}",
        ] {
            assert_eq!(parse_str(body, &ctx), Err(Refusal::Invalid), "{body}");
        }
        let long = format!(r#"{{"cmd":"search","query":"{}"}}"#, "a".repeat(MAX_QUERY_CHARS + 1));
        assert_eq!(parse_str(&long, &ctx), Err(Refusal::Invalid));
        let huge = format!(r#"{{"cmd":"stop","pad":"{}"}}"#, " ".repeat(MAX_BODY_BYTES));
        assert_eq!(parse_str(&huge, &ctx), Err(Refusal::Invalid));
    }

    #[test]
    fn the_page_gets_tagged_camel_case() {
        let json = serde_json::to_value(Command::Open { search: 2, index: 0, play: true }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "open", "search": 2, "index": 0, "play": true }));
        let json = serde_json::to_value(Command::SeekBy { seconds: 10.0 }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "seek-by", "seconds": 10.0 }));
        let json = serde_json::to_value(Command::Nav { key: NavKey::Left }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "nav", "key": "left" }));
        let json = serde_json::to_value(Command::Pick { from: ShelfKind::Surprise, shelf: 3, row: 0, index: 0, action: PickAction::Play }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "pick", "from": "surprise", "shelf": 3, "row": 0, "index": 0, "action": "play" }));
    }
}
