//! Several guides for one source, merged by channel id: the first guide to
//! have programmes for a channel keeps it, and later guides only fill in the
//! channels earlier ones lacked. A guide that fails partway is dropped whole,
//! so the merge never mixes half of one guide into another.

use std::collections::{HashMap, HashSet};

use super::xmltv;

#[derive(Default)]
pub struct GuideMerge {
    /// Normalized display name → guide channel id (the first guide to name it wins).
    pub names: HashMap<String, String>,
    /// Every channel id the kept guides list or have programmes for.
    pub ids: HashSet<String>,
    /// Those ids in lower case → the id (the first guide to have it wins).
    folded: HashMap<String, String>,
    /// Channels that kept guides had programmes for.
    claimed: HashSet<String>,
    /// The guide being read: its channels, names and the channels it has programmes for.
    current_names: HashMap<String, String>,
    current_ids: HashSet<String>,
    current: HashSet<String>,
    current_count: usize,
    /// Programmes kept so far, across guides (capped like one guide).
    pub programmes: usize,
    /// Guides read to the end.
    pub kept: usize,
}

impl GuideMerge {
    /// A `<channel>` of the guide being read; `normalize` is how names are matched.
    pub fn channel(&mut self, channel: xmltv::Channel, normalize: impl Fn(&str) -> String) {
        for name in &channel.names {
            let key = normalize(name);
            if !self.names.contains_key(&key) {
                self.current_names.entry(key).or_insert_with(|| channel.id.clone());
            }
        }
        self.current_ids.insert(channel.id);
    }

    /// Whether to keep a programme of the guide being read: not for a channel
    /// an earlier guide has, and not past the cap.
    pub fn keep(&mut self, programme: &xmltv::Programme) -> bool {
        if self.claimed.contains(&programme.channel) || self.programmes >= xmltv::MAX_PROGRAMMES {
            return false;
        }
        if !self.current.contains(&programme.channel) {
            self.current.insert(programme.channel.clone());
        }
        self.programmes += 1;
        self.current_count += 1;
        true
    }

    /// The guide being read finished: what it had is kept.
    pub fn finish_guide(&mut self) {
        // `<channel>` entries are optional in XMLTV: a channel with programmes is listed too.
        for id in self.current_ids.drain().chain(self.current.iter().cloned()) {
            self.folded.entry(id.to_lowercase()).or_insert_with(|| id.clone());
            self.ids.insert(id);
        }
        self.claimed.extend(self.current.drain());
        self.current_count = 0;
        for (name, id) in self.current_names.drain() {
            self.names.entry(name).or_insert(id);
        }
        self.kept += 1;
    }

    /// The guide's id for a channel's `tvg-id`: the same id, or else one that
    /// differs only in case (as Kodi matches them; playlists and panels often
    /// write a guide's ids in another case).
    pub fn guide_id(&self, tvg_id: &str) -> Option<&str> {
        match self.ids.get(tvg_id) {
            Some(id) => Some(id),
            None => self.folded.get(&tvg_id.to_lowercase()).map(String::as_str),
        }
    }

    /// The guide being read failed: forgets it, and returns the channels whose
    /// programmes from it (already staged) should go.
    pub fn drop_guide(&mut self) -> Vec<String> {
        self.current_ids.clear();
        self.current_names.clear();
        self.programmes -= self.current_count;
        self.current_count = 0;
        self.current.drain().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(channel: &str, start: i64) -> xmltv::Programme {
        xmltv::Programme { channel: channel.into(), start, stop: start + 60, title: "x".into(), description: None }
    }

    fn c(id: &str, name: &str) -> xmltv::Channel {
        xmltv::Channel { id: id.into(), names: vec![name.into()] }
    }

    #[test]
    fn the_first_guide_wins_and_later_ones_fill_gaps() {
        let lower = |s: &str| s.to_lowercase();
        let mut m = GuideMerge::default();
        m.channel(c("bbc1", "BBC One"), lower);
        assert!(m.keep(&p("bbc1", 0)) && m.keep(&p("bbc1", 60)));
        m.finish_guide();
        // The second guide lists BBC One too (same id, and the name under another id) and adds ITV.
        m.channel(c("bbc1", "BBC One"), lower);
        m.channel(c("bbc.one", "BBC One"), lower);
        m.channel(c("itv", "ITV"), lower);
        assert!(!m.keep(&p("bbc1", 0)));
        assert!(m.keep(&p("itv", 0)) && m.keep(&p("bbc.one", 0)));
        m.finish_guide();
        assert_eq!(m.names.get("bbc one").map(String::as_str), Some("bbc1"));
        assert_eq!(m.names.get("itv").map(String::as_str), Some("itv"));
        assert!(m.ids.contains("bbc.one"));
        assert_eq!((m.programmes, m.kept), (4, 2));
    }

    #[test]
    fn a_guide_without_channel_entries_still_matches_by_id() {
        // XMLTV's <channel> entries are optional: programmes alone name the channel ids.
        let mut m = GuideMerge::default();
        assert!(m.keep(&p("bbc1", 0)));
        m.finish_guide();
        assert!(m.ids.contains("bbc1"));
    }

    #[test]
    fn ids_match_ignoring_case_but_exact_first() {
        // Playlists and panels often write a guide's ids in another case ("BBCOne.uk" for "bbcone.uk").
        let mut m = GuideMerge::default();
        m.channel(c("bbcone.uk", "BBC One"), str::to_string);
        m.channel(c("ITV", "ITV"), str::to_string);
        m.channel(c("itv", "itv"), str::to_string);
        m.finish_guide();
        assert_eq!(m.guide_id("BBCOne.UK"), Some("bbcone.uk"));
        assert_eq!((m.guide_id("itv"), m.guide_id("ITV")), (Some("itv"), Some("ITV")));
        assert_eq!(m.guide_id("bbc2"), None);
    }

    #[test]
    fn a_failed_guide_leaves_nothing_behind() {
        let mut m = GuideMerge::default();
        m.channel(c("a", "A"), str::to_string);
        assert!(m.keep(&p("a", 0)));
        m.finish_guide();
        m.channel(c("b", "B"), str::to_string);
        assert!(m.keep(&p("b", 0)) && m.keep(&p("b", 60)));
        let mut dropped = m.drop_guide();
        dropped.sort();
        assert_eq!(dropped, ["b"]);
        assert!(!m.ids.contains("b") && !m.names.contains_key("B"));
        assert_eq!((m.programmes, m.kept), (1, 1));
        // A later guide may still have "b".
        assert!(m.keep(&p("b", 0)));
    }
}
