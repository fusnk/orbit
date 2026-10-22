//! The phone's picker: Home's rows, a mood's picks, a surprise, and one
//! title's details. The page works them out (through the same row loaders
//! and content-limit filter as Home, see src/app/remote-picker.ts) and hands
//! them over here, where they're checked and capped; the phone reads them
//! from `/api/picker`. Like search results, a title is only ever named by
//! its place (shelf, row, index), and its poster's address stays here.

use serde::{Deserialize, Serialize};

use super::command::PickerView;
use super::{MAX_TEXT_CHARS, art_url, clean};

/// Home rows the phone gets, and titles in each.
pub const MAX_ROWS: usize = 12;
pub const MAX_ROW_TITLES: usize = 20;
/// Mood chips.
pub const MAX_MOODS: usize = 16;
/// A mood's id ("feel-good"), in bytes.
pub const MAX_MOOD_ID: usize = 32;
const MAX_LABEL_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 1000;
const MAX_SEASONS: usize = 60;
/// Episodes across all seasons.
const MAX_EPISODES: usize = 1000;
const MAX_EPISODE_CHARS: usize = 120;

/// Where a title the phone names is: Home's rows, the open mood's row, or the surprise.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ShelfKind {
    Home,
    Mood,
    Surprise,
}

impl ShelfKind {
    pub const fn index(self) -> usize {
        match self {
            Self::Home => 0,
            Self::Mood => 1,
            Self::Surprise => 2,
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::Mood => "mood",
            Self::Surprise => "surprise",
        }
    }
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Movie,
    Series,
}

impl Kind {
    const fn name(self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Series => "series",
        }
    }
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PickAction {
    Play,
    Add,
}

/// A title as the page hands it over.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PickTitle {
    name: String,
    year: Option<String>,
    /// "movie" or "series" (anything else shows without a kind).
    kind: String,
    /// IMDb's, e.g. "7.8".
    rating: Option<String>,
    /// An addon's https address: fetched here, never sent to the phone.
    poster: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PickRow {
    title: String,
    titles: Vec<PickTitle>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Mood {
    id: String,
    label: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PickEpisode {
    number: u32,
    name: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PickSeason {
    number: u32,
    episodes: Vec<PickEpisode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PickDetails {
    name: String,
    year: Option<String>,
    kind: String,
    rating: Option<String>,
    poster: Option<String>,
    /// In the interface's words ("111 min").
    runtime: Option<String>,
    description: Option<String>,
    in_library: bool,
    seasons: Vec<PickSeason>,
}

/// A rating worth showing: a number from 0 to 10, as text.
fn rating(value: Option<String>) -> Option<String> {
    let value = clean(&value?, 8);
    value.parse::<f64>().ok().filter(|n| n.is_finite() && (0.0..=10.0).contains(n)).map(|_| value)
}

fn checked_kind(kind: String) -> String {
    if kind == "movie" || kind == "series" { kind } else { String::new() }
}

fn short(value: Option<String>, max: usize) -> Option<String> {
    value.map(|v| clean(&v, max)).filter(|v| !v.is_empty())
}

impl PickTitle {
    fn checked(self) -> Self {
        Self { name: clean(&self.name, MAX_TEXT_CHARS), year: short(self.year, 20), kind: checked_kind(self.kind), rating: rating(self.rating), poster: art_url(self.poster) }
    }
}

impl PickDetails {
    fn checked(self) -> Self {
        let mut budget = MAX_EPISODES;
        let seasons = self
            .seasons
            .into_iter()
            .take(MAX_SEASONS)
            .map(|season| {
                let episodes: Vec<_> = season.episodes.into_iter().take(budget).map(|e| PickEpisode { number: e.number, name: clean(&e.name, MAX_EPISODE_CHARS) }).collect();
                budget -= episodes.len();
                PickSeason { number: season.number, episodes }
            })
            .collect();
        Self {
            name: clean(&self.name, MAX_TEXT_CHARS),
            year: short(self.year, 20),
            kind: checked_kind(self.kind),
            rating: rating(self.rating),
            poster: art_url(self.poster),
            runtime: short(self.runtime, 40),
            description: short(self.description, MAX_DESCRIPTION_CHARS),
            in_library: self.in_library,
            seasons,
        }
    }
}

/// One answered (or awaited) request's titles.
#[derive(Default)]
struct Shelf {
    /// The request it answers; 0 if none was made.
    id: u64,
    /// The mood's id, or "movie"/"series" for a surprise.
    key: String,
    done: bool,
    failed: bool,
    rows: Vec<(String, Vec<PickTitle>)>,
}

struct DetailsState {
    id: u64,
    from: ShelfKind,
    shelf: u64,
    row: usize,
    index: usize,
    done: bool,
    failed: bool,
    details: Option<PickDetails>,
}

#[derive(Default)]
pub struct Picker {
    /// Numbers every request, so an answer can be told from an older one's. Kept when cleared.
    requests: u64,
    /// Bumped with every change; the phone fetches `/api/picker` when it moves. Kept when cleared.
    pub serial: u64,
    shelves: [Shelf; 3],
    moods: Vec<Mood>,
    details: Option<DetailsState>,
}

impl Picker {
    fn changed(&mut self) {
        self.serial = self.serial.wrapping_add(1);
    }

    /// What commands are checked against: the latest request and what each shelf holds now.
    pub fn view(&self) -> PickerView<'_> {
        PickerView {
            requests: self.requests,
            moods: self.moods.iter().map(|m| m.id.as_str()).collect(),
            shelves: self.shelves.each_ref().map(|s| (s.id, if s.done { s.rows.iter().map(|(_, titles)| titles.len()).collect() } else { Vec::new() })),
        }
    }

    /// A checked request starts waiting for its answer.
    pub fn begin_shelf(&mut self, kind: ShelfKind, id: u64, key: String) {
        self.requests = id;
        self.shelves[kind.index()] = Shelf { id, key, ..Default::default() };
        self.changed();
    }

    pub fn begin_details(&mut self, id: u64, from: ShelfKind, shelf: u64, row: usize, index: usize) {
        self.requests = id;
        self.details = Some(DetailsState { id, from, shelf, row, index, done: false, failed: false, details: None });
        self.changed();
    }

    /// Home's rows and the mood chips for request `id`; false (nothing changes) for an older request.
    pub fn set_home(&mut self, id: u64, rows: Vec<PickRow>, moods: Vec<Mood>, failed: bool) -> Result<bool, String> {
        if rows.len() > MAX_ROWS || rows.iter().any(|r| r.titles.len() > MAX_ROW_TITLES) || moods.len() > MAX_MOODS {
            return Err("too many titles".into());
        }
        let moods_ok = moods.iter().all(|m| !m.id.is_empty() && m.id.len() <= MAX_MOOD_ID && m.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
        if !moods_ok {
            return Err("invalid mood".into());
        }
        let shelf = &mut self.shelves[ShelfKind::Home.index()];
        if shelf.id != id || shelf.done {
            return Ok(false);
        }
        shelf.rows = rows
            .into_iter()
            .map(|r| (clean(&r.title, MAX_LABEL_CHARS), r.titles.into_iter().map(PickTitle::checked).collect::<Vec<_>>()))
            .filter(|(_, titles)| !titles.is_empty())
            .collect();
        shelf.done = true;
        shelf.failed = failed;
        self.moods = moods.into_iter().map(|m| Mood { label: clean(&m.label, MAX_LABEL_CHARS), id: m.id }).collect();
        self.changed();
        Ok(true)
    }

    /// A mood's picks or the surprise (one title, or none) for request `id`.
    pub fn set_titles(&mut self, kind: ShelfKind, id: u64, titles: Vec<PickTitle>, failed: bool) -> Result<bool, String> {
        let max = match kind {
            ShelfKind::Home => return Err("not a single row".into()),
            ShelfKind::Mood => MAX_ROW_TITLES,
            ShelfKind::Surprise => 1,
        };
        if titles.len() > max {
            return Err("too many titles".into());
        }
        let shelf = &mut self.shelves[kind.index()];
        if shelf.id != id || shelf.done {
            return Ok(false);
        }
        shelf.rows = vec![(String::new(), titles.into_iter().map(PickTitle::checked).collect())];
        shelf.done = true;
        shelf.failed = failed;
        self.changed();
        Ok(true)
    }

    /// Details for request `id`, again after "Add to library" (the same id).
    pub fn set_details(&mut self, id: u64, details: Option<PickDetails>, failed: bool) -> bool {
        let Some(state) = self.details.as_mut().filter(|d| d.id == id) else { return false };
        state.details = details.map(PickDetails::checked);
        state.done = true;
        state.failed = failed;
        self.changed();
        true
    }

    /// Forgets every title (a profile switch, or the remote turned off); the counters go on.
    pub fn clear(&mut self) {
        *self = Self { requests: self.requests, serial: self.serial, ..Default::default() };
        self.changed();
    }

    /// The poster address for `/art/pick/<shelf>/<row>/<index>` or `/art/pick/details`.
    pub fn art_for(&self, path: &str) -> Option<String> {
        let rest = path.strip_prefix("/art/pick/")?;
        if rest == "details" {
            return self.details.as_ref()?.details.as_ref()?.poster.clone();
        }
        let mut parts = rest.split('/');
        let kind = [ShelfKind::Home, ShelfKind::Mood, ShelfKind::Surprise].into_iter().find(|k| Some(k.name()) == parts.next())?;
        let row: usize = parts.next()?.parse().ok()?;
        let index: usize = parts.next()?.parse().ok()?;
        if parts.next().is_some() {
            return None;
        }
        self.shelves[kind.index()].rows.get(row)?.1.get(index)?.poster.clone()
    }

    /// What `/api/picker` answers: titles and `/art/pick/…` paths, never an address.
    pub fn json(&self) -> String {
        let title = |t: &PickTitle, art: Option<String>| serde_json::json!({ "name": t.name, "year": t.year, "kind": t.kind, "rating": t.rating, "art": art });
        let shelf = |kind: ShelfKind| {
            let s = &self.shelves[kind.index()];
            (s.id != 0).then(|| {
                let rows: Vec<_> = s
                    .rows
                    .iter()
                    .enumerate()
                    .map(|(r, (heading, titles))| {
                        let titles: Vec<_> = titles.iter().enumerate().map(|(i, t)| title(t, t.poster.as_ref().map(|_| format!("/art/pick/{}/{r}/{i}?v={}", kind.name(), s.id)))).collect();
                        serde_json::json!({ "title": heading, "titles": titles })
                    })
                    .collect();
                // `id` is what the phone names when it picks from this answer.
                serde_json::json!({ "id": s.id, "key": s.key, "loading": !s.done, "failed": s.failed, "rows": rows })
            })
        };
        let details = self.details.as_ref().map(|d| {
            let shown = d.details.as_ref().map(|x| {
                serde_json::json!({
                    "name": x.name, "year": x.year, "kind": x.kind, "rating": x.rating,
                    "art": x.poster.as_ref().map(|_| format!("/art/pick/details?v={}", d.id)),
                    "runtime": x.runtime, "description": x.description, "inLibrary": x.in_library, "seasons": x.seasons,
                })
            });
            serde_json::json!({ "from": d.from, "shelf": d.shelf, "row": d.row, "index": d.index, "loading": !d.done, "failed": d.failed, "title": shown })
        });
        serde_json::json!({
            "home": shelf(ShelfKind::Home),
            "moods": self.moods,
            "mood": shelf(ShelfKind::Mood),
            "surprise": shelf(ShelfKind::Surprise),
            "details": details,
        })
        .to_string()
    }
}

/// "movie" or "series", for a surprise's shelf key.
pub fn kind_key(kind: Kind) -> String {
    kind.name().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn title(name: &str, poster: Option<&str>) -> PickTitle {
        PickTitle { name: name.into(), year: Some("2021".into()), kind: "movie".into(), rating: Some("7.8".into()), poster: poster.map(Into::into) }
    }

    fn row(name: &str, n: usize) -> PickRow {
        PickRow { title: name.into(), titles: (0..n).map(|i| title(&format!("T{i}"), Some("https://secret.example/p.jpg"))).collect() }
    }

    #[test]
    fn answers_land_only_on_their_own_request() {
        let mut p = Picker::default();
        assert!(!p.set_home(1, vec![row("A", 1)], vec![], false).unwrap(), "nothing was asked");
        p.begin_shelf(ShelfKind::Home, 4, String::new());
        assert!(!p.set_home(3, vec![row("A", 1)], vec![], false).unwrap(), "an older request");
        assert!(p.set_home(4, vec![row("A", 2), row("Empty", 0)], vec![Mood { id: "feel-good".into(), label: "Feel-good".into() }], false).unwrap());
        // Empty rows are left out.
        assert_eq!(p.view().shelves[0], (4, vec![2]));
        assert_eq!(p.view().moods, vec!["feel-good"]);
        assert!(!p.set_home(4, vec![], vec![], false).unwrap(), "answered already");
    }

    #[test]
    fn too_much_is_refused() {
        let mut p = Picker::default();
        p.begin_shelf(ShelfKind::Home, 1, String::new());
        assert!(p.set_home(1, (0..=MAX_ROWS).map(|_| row("A", 1)).collect(), vec![], false).is_err());
        assert!(p.set_home(1, vec![row("A", MAX_ROW_TITLES + 1)], vec![], false).is_err());
        assert!(p.set_home(1, vec![], vec![Mood { id: "Bad Id".into(), label: "x".into() }], false).is_err());
        p.begin_shelf(ShelfKind::Surprise, 2, "movie".into());
        assert!(p.set_titles(ShelfKind::Surprise, 2, vec![title("A", None), title("B", None)], false).is_err());
        assert!(p.set_titles(ShelfKind::Home, 2, vec![], false).is_err());
        assert!(p.set_titles(ShelfKind::Surprise, 2, vec![title("A", None)], false).unwrap());
    }

    #[test]
    fn text_is_cleaned_and_odd_values_dropped() {
        let mut p = Picker::default();
        p.begin_shelf(ShelfKind::Mood, 1, "funny".into());
        let odd = PickTitle { name: " Film\u{0007} ".into(), year: Some(" ".into()), kind: "channel".into(), rating: Some("NaN".into()), poster: Some("http://plain.example/p.jpg".into()) };
        assert!(p.set_titles(ShelfKind::Mood, 1, vec![odd], false).unwrap());
        let json: serde_json::Value = serde_json::from_str(&p.json()).unwrap();
        let shown = &json["mood"]["rows"][0]["titles"][0];
        assert_eq!(shown["name"], "Film");
        assert_eq!(shown["kind"], "");
        assert!(shown["year"].is_null() && shown["rating"].is_null() && shown["art"].is_null());
        assert_eq!(rating(Some("11".into())), None);
        assert_eq!(rating(Some("8.1".into())).as_deref(), Some("8.1"));
    }

    #[test]
    fn the_phone_never_gets_poster_addresses() {
        let mut p = Picker::default();
        p.begin_shelf(ShelfKind::Home, 1, String::new());
        p.set_home(1, vec![row("A", 2)], vec![], false).unwrap();
        p.begin_details(2, ShelfKind::Home, 1, 0, 1);
        let details = PickDetails {
            name: "T1".into(),
            year: None,
            kind: "series".into(),
            rating: None,
            poster: Some("https://secret.example/d.jpg".into()),
            runtime: Some("45 min".into()),
            description: Some("x".repeat(5000)),
            in_library: false,
            seasons: (1..=100).map(|n| PickSeason { number: n, episodes: (1..=50).map(|e| PickEpisode { number: e, name: format!("E{e}") }).collect() }).collect(),
        };
        assert!(!p.set_details(1, None, false), "an older request");
        assert!(p.set_details(2, Some(details), false));
        let json = p.json();
        assert!(!json.contains("secret.example"), "{json}");
        assert!(json.contains("/art/pick/home/0/1?v=1"));
        assert!(json.contains("/art/pick/details?v=2"));
        assert_eq!(p.art_for("/art/pick/home/0/1").as_deref(), Some("https://secret.example/p.jpg"));
        assert_eq!(p.art_for("/art/pick/details").as_deref(), Some("https://secret.example/d.jpg"));
        assert_eq!(p.art_for("/art/pick/home/0/2"), None);
        assert_eq!(p.art_for("/art/pick/home/0/1/x"), None);
        assert_eq!(p.art_for("/art/pick/other/0/0"), None);
        // Capped: seasons, episodes across them, and the description.
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let seasons = parsed["details"]["title"]["seasons"].as_array().unwrap();
        assert_eq!(seasons.len(), MAX_SEASONS);
        assert_eq!(seasons.iter().map(|s| s["episodes"].as_array().unwrap().len()).sum::<usize>(), MAX_EPISODES);
        assert_eq!(parsed["details"]["title"]["description"].as_str().unwrap().chars().count(), MAX_DESCRIPTION_CHARS);
    }

    #[test]
    fn clearing_keeps_the_counters() {
        let mut p = Picker::default();
        p.begin_shelf(ShelfKind::Home, 5, String::new());
        p.set_home(5, vec![row("A", 1)], vec![], false).unwrap();
        let serial = p.serial;
        p.clear();
        assert!(p.serial > serial);
        assert_eq!(p.view().requests, 5);
        assert_eq!(p.view().shelves[0], (0, vec![]));
        assert!(p.json().contains(r#""home":null"#));
    }
}
