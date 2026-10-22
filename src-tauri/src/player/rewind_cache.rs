//! Settings → Playback → Rewind cache: how much of the video mpv keeps in
//! memory, behind and ahead of the playhead. Rewinding within what's kept
//! is instant (no new request to the server); keeping more costs RAM while
//! a video plays.
//!
//! The setting is a preset name per profile (`playback.rewind-cache.<id>`,
//! written by rooms/settings/player.ts); only these fixed values ever reach
//! mpv, so a hand-edited setting can't pass anything else.

/// mpv's own defaults: 150 MiB ahead, 50 MiB behind (about 40 s of a 10 Mb/s stream behind).
const STANDARD: &[(&str, &str)] = &[];
/// Up to about 600 MiB: about 5 minutes of 1080p behind, or 30 s of a 4K remux.
const MORE: &[(&str, &str)] = &[("demuxer-max-bytes", "300MiB"), ("demuxer-max-back-bytes", "300MiB")];
/// Up to about 1.5 GiB: around 15 minutes of 1080p behind, or 100 s of a 4K remux.
const MOST: &[(&str, &str)] = &[("demuxer-max-bytes", "500MiB"), ("demuxer-max-back-bytes", "1000MiB")];

/// The per-file mpv options for a saved preset; anything unknown is Standard.
/// A live channel has nothing to rewind into and plays at the broadcast's
/// pace, so it gets mpv's defaults whatever the preset (no RAM held for it).
pub(crate) fn options(preset: Option<&serde_json::Value>, live: bool) -> &'static [(&'static str, &'static str)] {
    if live {
        return STANDARD;
    }
    match preset.and_then(serde_json::Value::as_str) {
        Some("more") => MORE,
        Some("most") => MOST,
        _ => STANDARD,
    }
}

/// The settings key holding `profile`'s preset.
pub(crate) fn key(profile: &str) -> String {
    format!("playback.rewind-cache.{profile}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_presets_to_fixed_mpv_options() {
        assert!(options(None, false).is_empty());
        assert!(options(Some(&json!("standard")), false).is_empty());
        assert_eq!(options(Some(&json!("more")), false), [("demuxer-max-bytes", "300MiB"), ("demuxer-max-back-bytes", "300MiB")]);
        assert_eq!(options(Some(&json!("most")), false), [("demuxer-max-bytes", "500MiB"), ("demuxer-max-back-bytes", "1000MiB")]);
        // Anything else, even an mpv-looking value, is the default.
        for other in [json!("2GiB"), json!("most,cache=no"), json!(3), json!(null), json!({ "preset": "most" })] {
            assert!(options(Some(&other), false).is_empty());
        }
        assert_eq!(key("main"), "playback.rewind-cache.main");
    }

    #[test]
    fn live_channels_keep_mpvs_defaults() {
        for preset in ["standard", "more", "most"] {
            assert!(options(Some(&json!(preset)), true).is_empty());
        }
    }

    #[test]
    fn each_preset_keeps_at_least_mpvs_default() {
        // mpv's defaults: 150 MiB ahead, 50 MiB behind. A preset never lowers them.
        for preset in [MORE, MOST] {
            let mib = |name: &str| preset.iter().find(|(n, _)| *n == name).and_then(|(_, v)| v.strip_suffix("MiB")?.parse::<u32>().ok()).unwrap();
            assert!(mib("demuxer-max-bytes") >= 150 && mib("demuxer-max-back-bytes") >= 50);
        }
    }
}
