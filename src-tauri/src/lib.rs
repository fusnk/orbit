#[cfg(any(test, fuzzing))]
pub mod fuzzing;
mod addons;
mod anilist;
mod avatars;
mod awards;
mod backup;
mod browser;
mod calendar_file;
mod collections;
mod connect;
#[cfg(target_os = "android")]
#[path = "android/connect.rs"]
mod android_connect;
mod db;
mod debrid;
mod deep_link;
mod diagnostics;
mod dialog;
#[cfg(not(target_os = "android"))]
mod discord;
#[cfg(target_os = "android")]
#[path = "android/discord.rs"]
mod discord;
mod downloads;
mod episode_favourites;
mod episode_files;
mod external;
#[cfg(target_os = "linux")]
mod idle_inhibit;
mod iptv;
mod jellyfin;
mod import;
mod keychain;
mod letterboxd;
mod library;
mod licences;
mod lists;
mod local;
mod main_window;
mod media_controls;
mod media_server;
mod notify;
mod pip;
mod player;
mod plex;
mod profiles;
mod quit;
mod ratings;
mod remote;
mod review;
mod rpdb;
mod skip;
mod stremio;
mod theme_file;
mod theme_images;
#[cfg(target_os = "android")]
#[path = "android/tls.rs"]
mod tls;
mod tmdb;
mod torrent;
mod trailer;
mod tvmaze;
#[cfg(not(target_os = "android"))]
mod tray;
#[cfg(target_os = "android")]
#[path = "android/tray.rs"]
mod tray;
#[cfg(not(target_os = "android"))]
mod updater;
#[cfg(target_os = "android")]
#[path = "android/updater.rs"]
mod updater;
mod user_error;
mod voice;
mod watch_next;
mod watch;
mod vault;
mod wallpaper;

use tauri::Manager;

/// Desktop calls this from main.rs; on Android the Activity calls it through the JNI entry point the attribute generates.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::launched();
    let builder = tauri::Builder::default();
    // First, so a second desktop launch hands over before anything else starts.
    #[cfg(not(target_os = "android"))]
    // Its arguments can carry an addon install link (see deep_link.rs).
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        deep_link::offer(app, args);
        tray::show_main(app);
    }));
    // Driven from Rust only (see updater.rs); the capabilities grant the page none of its commands.
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    // Android's secret store (see keychain.rs), video player (see player/android.rs) and Orbit Connect's
    // multicast lock (see android/connect.rs); their commands answer Rust only.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(keychain::android_plugin()).plugin(player::android::plugin()).plugin(android_connect::plugin());
    builder
        .plugin(tauri_plugin_notification::init())
        // Opened from Rust only (see dialog.rs); the capabilities grant the page none of its commands.
        .plugin(tauri_plugin_dialog::init())
        // Jellyfin posters and backdrops, fetched by Rust (see jellyfin/art.rs).
        // Each image protocol answers Orbit's own webview only (see media_server::is_main_webview).
        .register_asynchronous_uri_scheme_protocol(jellyfin::ART_SCHEME, |ctx, request, responder| {
            if !media_server::is_main_webview(ctx.webview_label()) {
                return media_server::refuse(responder);
            }
            jellyfin::serve_art(ctx.app_handle().clone(), request.uri().path().to_string(), responder);
        })
        // Plex posters, backdrops and logos, likewise (see plex/art.rs).
        .register_asynchronous_uri_scheme_protocol(plex::ART_SCHEME, |ctx, request, responder| {
            if !media_server::is_main_webview(ctx.webview_label()) {
                return media_server::refuse(responder);
            }
            plex::serve_art(ctx.app_handle().clone(), request.uri().path().to_string(), responder);
        })
        // RPDB posters for people with a key, fetched by Rust so the key never reaches the page (see rpdb.rs).
        .register_asynchronous_uri_scheme_protocol(rpdb::SCHEME, |ctx, request, responder| {
            if !media_server::is_main_webview(ctx.webview_label()) {
                return media_server::refuse(responder);
            }
            rpdb::serve(ctx.app_handle().clone(), request.uri().path().to_string(), responder);
        })
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "android"))]
            tray::on_window_event(window, event);
            local::on_window_event(window, event);
        })
        // Everything here runs before the window can draw, so it stays local and
        // quick: slow clean-up moves to a background thread, and only the
        // database is required (without it there is nothing to show).
        .setup(|app| {
            if let Ok(logs) = app.path().app_log_dir() {
                diagnostics::init(logs);
            }
            let started = std::time::Instant::now();
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("orbit.db");
            let new_database = !path.exists();
            let db = db::Db::open(&path).inspect_err(|e| {
                diagnostics::error(&format!("could not open the database: {e}"));
                startup_failed(&db::open_failure_message(e.as_ref(), &path));
            })?;
            app.manage(db);
            if new_database {
                profiles::forget_previous_main_pin();
            }
            let db_ms = started.elapsed().as_millis();
            app.manage(profiles::ActiveProfile::default());
            app.manage(quit::Quit::default());
            #[cfg(target_os = "macos")]
            if let Err(e) = quit::menu_quit(app) {
                diagnostics::warn(&format!("menu: Cmd+Q quits without the last saves: {e}"));
            }
            // PINs saved before PINs were hashed: hashed now, off the main thread (each takes a moment on purpose).
            let pins = app.handle().clone();
            if let Err(e) = std::thread::Builder::new().name("pin-upgrade".into()).spawn(move || profiles::upgrade_plain_pins(&pins.state::<db::Db>())) {
                diagnostics::warn(&format!("profiles: could not start the PIN upgrade: {e}"));
            }
            app.manage(discord::Discord::new());
            let cache = app.path().app_cache_dir()?;
            app.manage(torrent::Torrents::new(cache.join("torrents")));
            app.manage(downloads::Downloads::new(cache.join("download-torrents")));
            app.manage(rpdb::Posters::new(cache.join("rpdb-posters")));
            if let Err(e) = downloads::init(app.handle()) {
                diagnostics::warn(&format!("downloads: could not prepare: {e}"));
            }
            app.manage(iptv::Refreshing::new());
            iptv::sweep_orphans_later(app.handle());
            app.manage(jellyfin::Jellyfin::default());
            app.manage(plex::Plex::default());
            app.manage(debrid::Debrid::default());
            app.manage(addons::Fetched::default());
            app.manage(player::thumbs::Thumbs::default());
            app.manage(pip::Pip::default());
            app.manage(trailer::Trailers::default());
            app.manage(import::Pending::default());
            app.manage(stremio::Offered::default());
            app.manage(anilist::AniList::default());
            app.manage(skip::AniSkipCache::default());
            app.manage(local::LocalFiles::default());
            app.manage(updater::Updates::default());
            // With any link macOS handed over before this point.
            app.manage(deep_link::Pending::starting());
            // An install link Orbit was started with waits until the page asks.
            deep_link::offer(app.handle(), std::env::args().skip(1));
            // Off until turned on in Settings; the player's events reach it from the start.
            app.manage(remote::Remote::default());
            // Off until turned on (the page turns it back on at start if it was left on).
            app.manage(connect::Connect::default());
            discard_leftovers(&cache);
            // After every state its events may reach is managed; Settings → General →
            // "When Orbit opens" comes from the database.
            let window_started = std::time::Instant::now();
            main_window::create(app)?;
            // Mostly the WebView's own start (WebView2 on Windows): the main cost here on a cold start.
            let window_ms = window_started.elapsed().as_millis();
            // Needs the main window (Windows ties its media controls to it).
            app.manage(media_controls::MediaControls::new(app.handle()));
            let player = player::PlayerState::new(create_video_surface(app));
            #[cfg(target_os = "linux")]
            if let Err(error) = player.initialize_linux(app.handle()) {
                diagnostics::warn(&format!("Linux playback initialization: {error}"));
            }
            app.manage(player);
            #[cfg(feature = "smoke-test")]
            player::smoke::start(app.handle());
            // The tray only matters for "Minimize to tray"; Orbit runs without it.
            #[cfg(not(target_os = "android"))]
            if let Err(e) = tray::install(app) {
                diagnostics::warn(&format!("tray: could not install: {e}"));
            }
            // Waits a minute before its first request; off in debug builds and without a release key.
            updater::start(app.handle());
            diagnostics::info(&format!(
                "startup: native setup took {} ms (database {db_ms} ms, window {window_ms} ms; {} ms after launch)",
                started.elapsed().as_millis(),
                diagnostics::since_launch()
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::settings_get,
            db::settings_set,
            notify::alerts_notify,
            profiles::profile_list,
            profiles::profile_active,
            profiles::profile_select,
            profiles::profile_create,
            profiles::profile_update,
            profiles::profile_set_pin,
            profiles::profile_set_addons_from,
            profiles::profile_set_limit,
            profiles::profile_check_parent,
            profiles::profile_delete,
            library::library_list,
            library::library_add,
            library::library_remove,
            watch::watch_list,
            watch::watch_put_title,
            watch::watch_put_progress,
            watch::watch_remove,
            addons::addon_fetch_manifest,
            addons::addon_install,
            addons::addon_list,
            addons::addon_set_enabled,
            addons::addon_move,
            addons::addon_remove,
            addons::addon_set_shared,
            addons::addon_set_all_shared,
            addons::addon_removed_list,
            addons::addon_restore,
            addons::addon_refresh_fetch,
            addons::addon_refresh_apply,
            addons::bundle::addon_bundle_text,
            addons::bundle::addon_bundle_save,
            skip::skip_segments,
            skip::aniskip_segments,
            tvmaze::tvmaze_air_times,
            tmdb::tmdb_set_token,
            tmdb::tmdb_token_saved,
            tmdb::tmdb_clear_token,
            tmdb::tmdb_set_region,
            rpdb::rpdb_set_key,
            rpdb::rpdb_key_saved,
            rpdb::rpdb_clear_key,
            tmdb::tmdb_recommendations,
            tmdb::tmdb_list,
            tmdb::tmdb_services,
            tmdb::tmdb_streaming,
            tmdb::tmdb_service_page,
            tmdb::tmdb_cast,
            tmdb::tmdb_cast_by_id,
            tmdb::tmdb_search_titles,
            tmdb::tmdb_trending_shows,
            tmdb::tmdb_person,
            tmdb::tmdb_search_people,
            tmdb::tmdb_certifications,
            tmdb::tmdb_title_collection,
            tmdb::tmdb_collection,
            tmdb::tmdb_source_page,
            tmdb::tmdb_season_ratings,
            tmdb::tmdb_story_arcs,
            tmdb::tmdb_movie_certifications,
            tmdb::tmdb_release_dates,
            tmdb::tmdb_title_topics,
            tmdb::tmdb_find_title,
            tmdb::tmdb_title_by_id,
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_get,
            wallpaper::wallpaper_clear,
            avatars::avatar_save,
            avatars::avatar_save_url,
            avatars::avatar_get,
            lists::list_all,
            lists::list_create,
            lists::list_rename,
            lists::list_describe,
            lists::list_import,
            lists::list_export_save,
            lists::list_delete,
            lists::list_add,
            lists::list_remove,
            ratings::rating_all,
            ratings::rating_set,
            episode_favourites::favourite_episode_all,
            episode_favourites::favourite_episode_add,
            episode_favourites::favourite_episode_remove,
            collections::collection_all,
            collections::collection_create,
            collections::collection_update,
            collections::collection_delete,
            collections::collection_move,
            collections::collection_add,
            collections::collection_remove,
            collections::collection_import,
            collections::collection_export_save,
            calendar_file::calendar_export_save,
            backup::backup_export,
            backup::backup_import,
            theme_file::theme_export,
            theme_images::theme_image_save,
            theme_images::theme_image_get,
            theme_images::theme_image_prune,
            review::review_save,
            addons::addon_request,
            addons::art_fetch,
            player::player_open,
            player::player_set_paused,
            player::player_seek,
            player::player_set_volume,
            player::player_set_muted,
            player::player_set_speed,
            player::player_set_subtitle_style,
            player::player_set_subtitle_override,
            player::player_set_audio,
            player::player_set_delay,
            player::player_set_picture,
            player::player_set_equalizer,
            player::player_set_quality,
            player::player_chapter,
            player::player_frame_step,
            player::player_lift_subtitles,
            player::player_set_corner,
            player::player_set_hwdec,
            player::player_set_volume_boost,
            player::player_set_volume_boost_level,
            player::player_set_hdr,
            main_window::window_buttons,
            player::player_set_smooth_motion,
            player::player_set_hdr_subtitles,
            player::player_set_passthrough,
            player::outputs::player_audio_devices,
            player::outputs::player_set_audio_device,
            player::dip::player_audio_dip,
            player::subsync::player_sync_subtitle,
            player::transcript::player_transcript,
            player::subsync::player_sync_cancel,
            player::subtrans::player_translate_subtitle,
            player::subtrans::player_translate_cancel,
            player::subtrans::subtrans_set_key,
            player::subtrans::subtrans_forget_key,
            player::subtrans::subtrans_key_saved,
            player::subtrans::subtrans_models,
            player::player_toggle_subtitles,
            player::player_set_subtitles_visible,
            player::player_set_languages,
            player::player_screenshot,
            player::thumbs::thumbs_start,
            trailer::trailer_preview,
            trailer::trailer_open_youtube,
            player::player_next_up,
            player::player_skip_button,
            player::player_device_support,
            voice::search_listen,
            watch_next::watch_next_publish,
            letterboxd::letterboxd_profile,
            letterboxd::letterboxd_diary,
            letterboxd::letterboxd_watchlist,
            letterboxd::letterboxd_rating,
            letterboxd::letterboxd_reviews,
            letterboxd::letterboxd_list_info,
            letterboxd::letterboxd_list,
            letterboxd::letterboxd_film_imdb,
            awards::explore_award,
            tmdb::tmdb_genre_art,
            tmdb::tmdb_extras,
            tmdb::tmdb_set_language,
            tray::tray_labels,
            quit::quit_ready,
            import::import_read,
            import::import_apply,
            import::import_cancel,
            anilist::anilist_status,
            anilist::anilist_authorize,
            anilist::anilist_connect,
            anilist::anilist_disconnect,
            anilist::anilist_set_enabled,
            anilist::anilist_scrobble,
            anilist::anilist_import_candidates,
            anilist::anilist_characters,
            stremio::stremio_account,
            stremio::stremio_signed_in,
            stremio::stremio_login,
            stremio::stremio_browser_login,
            stremio::stremio_logout,
            stremio::stremio_addons,
            stremio::stremio_install_addon,
            stremio::stremio_library_pull,
            stremio::stremio_library_push,
            stremio::stremio_library_watched,
            browser::open_external,
            browser::open_addon_configure,
            player::thumbs::thumbs_at,
            player::thumbs::thumbs_stop,
            pip::window_pip,
            discord::discord_set_activity,
            media_controls::media_controls_set,
            media_controls::media_controls_clear,
            discord::discord_clear,
            torrent::torrent_open,
            torrent::torrent_stop,
            torrent::torrent_files,
            torrent::torrent_status,
            iptv::iptv_sources,
            iptv::vod::iptv_vod_sources,
            iptv::vod::iptv_vod_enable,
            iptv::vod::iptv_vod_prepare,
            iptv::iptv_add,
            iptv::iptv_remove,
            iptv::iptv_refresh,
            iptv::iptv_refresh_stale,
            iptv::iptv_channels,
            iptv::iptv_guide,
            iptv::iptv_schedule,
            iptv::iptv_favourite,
            iptv::iptv_favourites_order,
            iptv::iptv_account,
            iptv::iptv_guides,
            iptv::iptv_guides_change,
            iptv::groups::iptv_groups,
            iptv::groups::iptv_group_set,
            iptv::groups::iptv_groups_order,
            iptv::groups::iptv_groups_unlock,
            iptv::groups::iptv_groups_lock,
            player::player_select_track,
            player::player_add_subtitle,
            player::player_set_sdh_filter,
            player::player_set_caps_fix,
            player::player_paste_subtitle,
            player::player_upload_subtitle,
            player::player_info,
            player::player_stop,
            downloads::download_start,
            downloads::download_list,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_refresh,
            downloads::download_remove,
            downloads::download_reveal,
            downloads::download_art,
            downloads::download_storage,
            downloads::download_folder_set,
            downloads::download_folder_pick,
            downloads::download_schedule_set,
            downloads::download_now,
            local::local_video,
            local::local_add_subtitle,
            external::external_player_find,
            external::external_player_open,
            external::external_player_set,
            external::external_player_pick,
            jellyfin::jellyfin_status,
            jellyfin::jellyfin_connect,
            jellyfin::jellyfin_disconnect,
            jellyfin::jellyfin_libraries,
            jellyfin::jellyfin_items,
            jellyfin::jellyfin_meta,
            jellyfin::jellyfin_find,
            jellyfin::jellyfin_report,
            plex::plex_status,
            plex::plex_link_start,
            plex::plex_link_open,
            plex::plex_link_cancel,
            plex::plex_link_wait,
            plex::plex_choose,
            plex::plex_disconnect,
            plex::plex_libraries,
            plex::plex_items,
            plex::plex_meta,
            plex::plex_find,
            plex::plex_report,
            debrid::debrid_accounts,
            debrid::debrid_connect,
            debrid::debrid_check,
            debrid::debrid_disconnect,
            debrid::debrid_items,
            debrid::debrid_files,
            debrid::debrid_delete,
            diagnostics::diagnostics_log,
            diagnostics::diagnostics_startup,
            diagnostics::diagnostics_report,
            diagnostics::diagnostics_redact,
            diagnostics::diagnostics_open_folder,
            licences::licences_open,
            updater::update_status,
            deep_link::deep_link_take,
            updater::update_check,
            updater::update_install,
            remote::remote_start,
            remote::remote_stop,
            remote::remote_status,
            remote::remote_pair,
            remote::remote_disconnect_all,
            remote::remote_now_playing,
            remote::remote_search_results,
            remote::remote_picker_home,
            remote::remote_picker_titles,
            remote::remote_picker_details,
            connect::connect_start,
            connect::connect_stop,
            connect::connect_status,
            connect::connect_open_pairing,
            connect::connect_close_pairing,
            connect::connect_pair,
            connect::connect_answer_pairing,
            connect::connect_forget,
            connect::connect_play,
            connect::connect_control,
            connect::connect_remote_status,
        ])
        .build(tauri::generate_context!())
        .inspect_err(|e| diagnostics::error(&format!("could not start: {e}")))
        .expect("error while building Orbit")
        .run(|app, event| {
            // macOS hands install links over as an event, to a running Orbit too.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event
                && deep_link::offer(app, urls.iter().map(|u| u.as_str()))
            {
                tray::show_main(app);
            }
            // Clicking the Dock icon with the window in the tray ("Minimize to tray") brings it back,
            // as the tray icon does; otherwise the Dock click did nothing.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = &event {
                tray::show_main(app);
            }
            if let tauri::RunEvent::Exit = event {
                shutdown(app);
                updater::install_on_exit(app);
            }
        });
}

/// Stops what must not outlive Orbit. On the exit event, and before the
/// updater ends or restarts Orbit, which skips that event.
pub(crate) fn shutdown(app: &tauri::AppHandle) {
    // Where the window was, for the next start (see main_window.rs).
    #[cfg(not(target_os = "android"))]
    main_window::save_placement(app);
    // The phone remote stops listening with Orbit.
    app.state::<remote::Remote>().shutdown();
    // So does Orbit Connect, withdrawing its announcement.
    app.state::<connect::Connect>().shutdown();
    app.state::<player::PlayerState>().shutdown();
    // yt-dlp lookups still running would outlive Orbit.
    app.state::<trailer::Trailers>().shutdown();
}

/// Says why Orbit can't start. Release builds on Windows have no console, so
/// without this a database that won't open would just make Orbit not appear.
fn startup_failed(message: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let (text, title) = (wide(message), wide("Orbit"));
        // SAFETY: both strings are NUL-terminated and outlive the call; no owner window.
        unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR) };
    }
    #[cfg(not(windows))]
    eprintln!("Orbit: {message}");
}

/// The window video plays in. The window is created transparent so video can
/// show beneath the WebView, but the WebView itself stays opaque until the
/// player opens. Playback is unavailable (with a message) if this fails.
fn create_video_surface(app: &tauri::App) -> Option<player::Surface> {
    let window = app.get_webview_window("main")?;
    let _ = window.set_background_color(Some(player::OPAQUE));
    #[cfg(target_os = "linux")]
    return player::Surface::new_linux(&window).map_err(|e| diagnostics::warn(&format!("video surface: {e}"))).ok();
    #[cfg(target_os = "macos")]
    return player::Surface::new_macos(&window).map_err(|e| diagnostics::warn(&format!("video surface: {e}"))).ok();
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
    #[cfg(windows)]
    let parent = window.hwnd().ok()?.0;
    #[cfg(not(windows))]
    let parent = std::ptr::null_mut();
    player::Surface::new(parent).map_err(|e| diagnostics::warn(&format!("video surface: {e}"))).ok()
    }
}

/// Cache folders a previous run leaves behind (torrent pieces can be gigabytes,
/// e.g. after a crash) are never needed again. Deleting them can take seconds,
/// so each is renamed out of the way now (quick, and the name is free for this
/// run at once) and deleted on a background thread, along with any a previous
/// run renamed but didn't finish deleting.
fn discard_leftovers(cache: &std::path::Path) {
    const STALE: &str = "stale-";
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    // The folders torrent.rs, iptv/ and player/thumbs.rs use under the cache.
    for name in ["torrents", "iptv", "thumbs"] {
        let _ = std::fs::rename(cache.join(name), cache.join(format!("{STALE}{stamp}-{name}")));
    }
    let cache = cache.to_path_buf();
    let spawned = std::thread::Builder::new().name("cache-cleanup".into()).spawn(move || {
        let Ok(entries) = std::fs::read_dir(&cache) else { return };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(STALE) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    });
    if let Err(e) = spawned {
        diagnostics::warn(&format!("cache clean-up: {e}"));
    }
}

/// Names for settings keys and keychain entries come from the WebView, which we
/// treat as a less-trusted boundary: a narrow charset keeps them from smuggling
/// separators or control characters into storage or OS keychain listings.
pub(crate) fn check_name(name: &str) -> Result<(), String> {
    let ok = (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b));
    if ok { Ok(()) } else { Err("invalid name".into()) }
}
