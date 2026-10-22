//! Offline harnesses shared by libFuzzer and bounded stable-Rust property tests.
//! No network, native windows, keychain, or writes to application storage.
pub const TARGETS: &[&str] = &[
    "m3u",
    "xmltv",
    "subtitles",
    "addon_urls",
    "torrents",
    "downloads",
    "xtream",
    "media_servers",
    "anilist",
    "tmdb",
    "imports",
    "debrid",
];
/// Inputs are capped before invoking the real production parsers.
pub fn run(target: &str, data: &[u8]) {
    let data = &data[..data.len().min(64 * 1024)];
    match target {
        "m3u" | "xmltv" | "xtream" => crate::iptv::fuzz_input(target, data),
        "subtitles" => crate::player::fuzz_input(data),
        "addon_urls" => crate::addons::fuzz_input(data),
        "torrents" => crate::torrent::fuzz_input(data),
        "downloads" => crate::downloads::fuzz_input(data),
        "media_servers" => {
            crate::jellyfin::fuzz_input(data);
            crate::plex::fuzz_input(data);
        }
        "anilist" => crate::anilist::fuzz_input(data),
        "tmdb" => crate::tmdb::fuzz_input(data),
        "imports" => {
            crate::import::fuzz_input(data);
            crate::letterboxd::fuzz_input(data);
            crate::backup::fuzz_input(data);
            crate::collections::fuzz_input(data);
            crate::awards::fuzz_input(data);
            crate::stremio::fuzz_input(data);
            crate::theme_images::fuzz_input(data);
            crate::theme_file::fuzz_input(data);
        }
        "debrid" => crate::debrid::fuzz_input(data),
        _ => panic!("unknown fuzz target"),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    proptest! {
        #![proptest_config(ProptestConfig { cases: 128, max_shrink_iters: 2048, ..ProptestConfig::default() })]
        #[test]
        fn production_parsers_survive_bytes(data in prop::collection::vec(any::<u8>(), 0..4096)) {
            for target in TARGETS { run(target,&data); }
        }
        #[test]
        fn structured_json_and_subtitles(text in ".{0,128}", n in any::<u32>(), previous in any::<u32>()) {
            let value = serde_json::json!({"id":n,"title":text,"name":text,"release_date":text,"Items":[{"Id":text,"Name":text,"Type":"Movie"}],"data":[{"id":n,"name":text}],"results":[{"iso_3166_1":"US","release_dates":[{"release_date":text,"type":1}]}]});
            let bytes = serde_json::to_vec(&value).unwrap();
            for target in ["media_servers","tmdb","debrid","xtream","imports"] { run(target,&bytes); }
            let jellyfin = serde_json::json!([{"Id":format!("{n:08x}{previous:08x}{n:08x}{previous:08x}"),"Name":text,"Type":"Movie","ProviderIds":{"Imdb":format!("tt{n}"),"Tmdb":n.to_string()},"UserData":{"PlaybackPositionTicks":i64::from(n)}}]);
            run("media_servers",&serde_json::to_vec(&jellyfin).unwrap());
            let file = serde_json::json!({"id":n,"path":format!("/{text}.mkv"),"name":format!("{text}.mkv"),"selected":1,"bytes":n,"size":n});
            let row = serde_json::json!({"id":n.to_string(),"filename":format!("{text}.mkv"),"name":format!("{text}.mkv"),"status":"downloaded","download_present":true,"progress":n,"files":[file],"links":["https://real-debrid.com/d/synthetic"]});
            run("debrid",&serde_json::to_vec(&serde_json::json!([row.clone()])).unwrap());
            run("debrid",&serde_json::to_vec(&row).unwrap());
            let mut torbox = row; torbox["id"] = serde_json::json!(n);
            run("debrid",&serde_json::to_vec(&serde_json::json!({"success":true,"data":[torbox]})).unwrap());
            let srt = format!("1\n00:00:01,000 --> 00:00:02,000\n{text}\n");
            run("subtitles",srt.as_bytes());
            let ass = format!("[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{text}");
            run("subtitles",ass.as_bytes());
            let uri = format!("https://example.com/{text}"); run("addon_urls",uri.as_bytes());
            let progress = [previous.to_le_bytes(),n.to_le_bytes(),n.to_le_bytes()].concat(); run("anilist",&progress);
        }
        #[test]
        fn production_parsers_survive_unicode(text in ".{0,512}") {
            for target in TARGETS { run(target,text.as_bytes()); }
        }
    }
    #[test]
    fn synthetic_seeds_reach_parser_bodies() {
        for target in TARGETS {
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("fuzz/corpus")
                .join(target);
            for file in std::fs::read_dir(dir).unwrap() {
                run(target, &std::fs::read(file.unwrap().path()).unwrap());
            }
        }
    }
}
