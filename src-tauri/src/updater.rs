//! Orbit's own updates (Settings → General → About Orbit).
//!
//! Rust asks GitHub Releases' `latest.json` (tauri.conf.json `plugins.updater`)
//! at most once a day (unless "Check for updates automatically" is off) and
//! when the person asks, downloads a newer version in
//! the background, and the plugin checks its minisign signature against the
//! public key in tauri.conf.json. Nothing installs without consent: the page
//! shows "Restart to update", or with "Update automatically" on the update
//! installs when Orbit quits. The page gets no updater permissions, only the
//! three commands here, so a compromised page can't point the updater
//! elsewhere or install something.
//!
//! Off entirely (no network calls) in debug builds and while tauri.conf.json
//! still holds the placeholder key, since every download would fail its check.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::db::Db;
use crate::diagnostics;
use crate::library::now_ms;

/// tauri.conf.json starts with this until the release key's public half is pasted in (docs/RELEASING.md).
const PLACEHOLDER: &str = "REPLACE_WITH";
/// Sent with the new version once it's downloaded and verified.
const READY_EVENT: &str = "update-ready";
/// Sent with the version when its download fails, so "Downloading…" doesn't stay up.
const FAILED_EVENT: &str = "update-failed";
/// Settings → General → About Orbit → "Update automatically" (written by the page; off unless true).
const AUTO_SETTING: &str = "updates.auto";
/// Settings → General → About Orbit → "Check for updates automatically" (written by the page; on unless false).
const CHECK_SETTING: &str = "updates.check";
/// When Orbit last reached the update server (ms since the epoch); this computer's only.
const LAST_CHECK_SETTING: &str = "updates.last-check";
/// `{ version, notes }` of the update being installed, for the "What's new" note after the restart.
const WHATS_NEW_SETTING: &str = "updates.whats-new";

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// After startup's own network work (addons, rows, sync) has had its turn.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(60);
/// How often a long-running Orbit looks whether a day has passed.
const RECHECK_EVERY: Duration = Duration::from_secs(60 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Installers carry libmpv, so they're large; this only stops a stalled download from blocking checks forever.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// A download cut off (offline, asleep, a dropped connection) is tried again
/// this long after, rather than a day later.
const RETRY_AFTER_MS: i64 = 3 * 60 * 60 * 1000;
/// The release notes kept for "What's new"; a release body can be long.
const MAX_NOTES_CHARS: usize = 2000;

/// A verified update waiting to be installed. Kept in memory rather than on
/// disk, so nothing can swap the file between the signature check and install.
struct Ready {
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct Updates {
    /// A check or download is running.
    busy: AtomicBool,
    ready: Mutex<Option<Ready>>,
}

impl Updates {
    fn ready_version(&self) -> Option<String> {
        self.ready.lock().ok()?.as_ref().map(|r| r.update.version.clone())
    }

    fn take_ready(&self) -> Option<Ready> {
        self.ready.lock().ok()?.take()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    busy: bool,
    /// The version downloaded and ready to install.
    ready: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Outcome {
    Off,
    UpToDate,
    /// Another check or download is already running.
    Busy,
    Downloading { version: String },
    Ready { version: String },
}

/// Whether the configured key is a real one (not empty, not the placeholder).
fn key_is_set(pubkey: Option<&str>) -> bool {
    pubkey.map(str::trim).is_some_and(|k| !k.is_empty() && !k.starts_with(PLACEHOLDER))
}

/// Whether a scheduled check is due: a day after the last one, or at once if
/// there was none or the clock has gone back since.
fn due(last_check: Option<i64>, now: i64) -> bool {
    last_check.is_none_or(|last| last > now || now - last >= DAY_MS)
}

/// Whether the daily check runs: on unless the person turned it off, so
/// installs from before the setting existed keep checking.
fn auto_check_on(setting: Option<&Value>) -> bool {
    setting != Some(&Value::Bool(false))
}

fn enabled(app: &AppHandle) -> bool {
    let pubkey = app.config().plugins.0.get("updater").and_then(|c| c.get("pubkey")).and_then(Value::as_str);
    !cfg!(debug_assertions) && key_is_set(pubkey)
}

/// Starts the daily check, unless updates are off in this build.
pub fn start(app: &AppHandle) {
    if !enabled(app) {
        diagnostics::info("updates: off in this build");
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            let db = app.state::<Db>();
            // Read each time round, so turning it off or on applies within the hour without a restart.
            let on = auto_check_on(db.setting(CHECK_SETTING).as_ref());
            let last = db.setting(LAST_CHECK_SETTING).and_then(|v| v.as_i64());
            if on && due(last, now_ms()) {
                // Offline or GitHub unreachable: quiet, and tried again within the hour.
                if let Err(e) = check(&app).await {
                    diagnostics::info(&format!("updates: check failed: {e}"));
                }
            }
            tokio::time::sleep(RECHECK_EVERY).await;
        }
    });
}

/// Looks for a newer version; if there is one, downloads it in the background
/// and sends `update-ready` once it's verified.
async fn check(app: &AppHandle) -> Result<Outcome, String> {
    if !enabled(app) {
        return Ok(Outcome::Off);
    }
    let updates = app.state::<Updates>();
    if let Some(version) = updates.ready_version() {
        return Ok(Outcome::Ready { version });
    }
    if updates.busy.swap(true, Ordering::SeqCst) {
        return Ok(Outcome::Busy);
    }
    match find(app).await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            diagnostics::info(&format!("updates: downloading {version}"));
            let app = app.clone();
            tauri::async_runtime::spawn(async move { download(app, update).await });
            Ok(Outcome::Downloading { version })
        }
        Ok(None) => {
            updates.busy.store(false, Ordering::SeqCst);
            Ok(Outcome::UpToDate)
        }
        Err(e) => {
            updates.busy.store(false, Ordering::SeqCst);
            Err(e)
        }
    }
}

async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        // Windows only: the plugin starts the installer and exits the process,
        // so mpv and the rest are stopped first, as a normal exit would (on the main thread, see `install`).
        .on_before_exit(move || crate::shutdown(&handle))
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    // With an update found, the check counts once its download ends (see
    // `download`): quitting mid-download then checks again at the next start.
    if update.is_none() {
        save_check_time(app, now_ms());
    }
    Ok(update)
}

fn save_check_time(app: &AppHandle, at: i64) {
    if let Err(e) = app.state::<Db>().set_setting(LAST_CHECK_SETTING, &json!(at)) {
        diagnostics::warn(&format!("updates: could not save the check time: {e}"));
    }
}

/// Whether a failed download is worth trying again soon: the connection
/// failed. A file that fails its signature check or can't be used waits for
/// the next day's check, so a bad release isn't downloaded every few hours.
fn retry_soon(err: &tauri_plugin_updater::Error) -> bool {
    use tauri_plugin_updater::Error;
    matches!(err, Error::Reqwest(_) | Error::Network(_) | Error::Io(_))
}

/// When the last check counts as having happened, after a failed download.
fn failed_check_time(now: i64, retry_soon: bool) -> i64 {
    if retry_soon { now - DAY_MS + RETRY_AFTER_MS } else { now }
}

async fn download(app: AppHandle, mut update: Update) {
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    // `download` verifies the signature and fails if it doesn't match.
    let result = update.download(|_, _| {}, || {}).await;
    let updates = app.state::<Updates>();
    let version = update.version.clone();
    match result {
        Ok(bytes) => {
            save_check_time(&app, now_ms());
            if let Ok(mut ready) = updates.ready.lock() {
                *ready = Some(Ready { update, bytes });
                diagnostics::info(&format!("updates: {version} is ready"));
                let _ = app.emit(READY_EVENT, json!({ "version": version }));
            }
        }
        Err(e) => {
            diagnostics::warn(&format!("updates: download failed: {e}"));
            save_check_time(&app, failed_check_time(now_ms(), retry_soon(&e)));
            let _ = app.emit(FAILED_EVENT, json!({ "version": version }));
        }
    }
    updates.busy.store(false, Ordering::SeqCst);
}

/// The release notes for "What's new", saved before installing (the page shows
/// them once, as plain text, when this version starts).
fn remember_whats_new(app: &AppHandle, update: &Update) {
    let notes: String = update.body.as_deref().unwrap_or_default().chars().take(MAX_NOTES_CHARS).collect();
    if let Err(e) = app.state::<Db>().set_setting(WHATS_NEW_SETTING, &json!({ "version": update.version, "notes": notes })) {
        diagnostics::warn(&format!("updates: could not save what's new: {e}"));
    }
}

/// Runs the installer. On Windows this exits Orbit (and, with `restart`, the
/// installer opens the new version); elsewhere the new version runs from the
/// next start. Main thread only: it may stop mpv (see `find`).
fn install(app: &AppHandle, ready: Ready, restart: bool) -> Result<(), String> {
    let Ready { update, bytes } = ready;
    let version = update.version.clone();
    diagnostics::info(&format!("updates: installing {version}"));
    update.restart_after_install(restart).install(&bytes).map_err(|e| e.to_string())?;
    if restart {
        // Restarting skips the exit event, so what it stops is stopped here.
        crate::shutdown(app);
        app.restart();
    }
    Ok(())
}

/// With "Update automatically" on, a downloaded update installs as Orbit quits,
/// without opening Orbit again. Called from the exit event, after playback stopped.
pub fn install_on_exit(app: &AppHandle) {
    if app.state::<Db>().setting(AUTO_SETTING) != Some(Value::Bool(true)) {
        return;
    }
    let Some(ready) = app.state::<Updates>().take_ready() else { return };
    remember_whats_new(app, &ready.update);
    if let Err(e) = install(app, ready, false) {
        diagnostics::warn(&format!("updates: could not install on exit: {e}"));
    }
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    let updates = app.state::<Updates>();
    Status { enabled: enabled(&app), busy: updates.busy.load(Ordering::SeqCst), ready: updates.ready_version() }
}

/// Settings → About → "Check for updates": checks now, whenever the last check was.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Outcome, String> {
    check(&app).await.inspect_err(|e| diagnostics::info(&format!("updates: check failed: {e}")))
}

/// "Restart to update": installs the downloaded update and restarts Orbit.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let ready = app.state::<Updates>().take_ready().ok_or("no update is ready")?;
    remember_whats_new(&app, &ready.update);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(install(&handle, ready, true));
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "the update didn't start".to_string())?.inspect_err(|e| diagnostics::warn(&format!("updates: could not install: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_placeholder_key_turns_updates_off() {
        assert!(!key_is_set(None));
        assert!(!key_is_set(Some("")));
        assert!(!key_is_set(Some("  ")));
        assert!(!key_is_set(Some("REPLACE_WITH_UPDATER_PUBLIC_KEY (see docs/RELEASING.md)")));
        assert!(key_is_set(Some("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk=")));
    }

    #[test]
    fn automatic_checks_are_on_unless_turned_off() {
        assert!(auto_check_on(None));
        assert!(auto_check_on(Some(&Value::Bool(true))));
        assert!(auto_check_on(Some(&Value::Null)));
        assert!(!auto_check_on(Some(&Value::Bool(false))));
    }

    #[test]
    fn checks_at_most_once_a_day() {
        let now = 1_000 * DAY_MS;
        assert!(due(None, now));
        assert!(!due(Some(now), now));
        assert!(!due(Some(now - DAY_MS + 1), now));
        assert!(due(Some(now - DAY_MS), now));
        // The clock went back (or the saved time is from the future): check rather than wait.
        assert!(due(Some(now + 5_000), now));
    }

    #[test]
    fn a_cut_off_download_is_tried_again_within_hours_not_a_day() {
        let now = 1_000 * DAY_MS;
        let retry = failed_check_time(now, true);
        assert!(!due(Some(retry), now));
        assert!(!due(Some(retry), now + RETRY_AFTER_MS - 1));
        assert!(due(Some(retry), now + RETRY_AFTER_MS));
        // One that failed its check waits the whole day.
        let bad = failed_check_time(now, false);
        assert!(!due(Some(bad), now + RETRY_AFTER_MS));
        assert!(due(Some(bad), now + DAY_MS));
    }

    #[test]
    fn only_connection_failures_retry_soon() {
        use tauri_plugin_updater::Error;
        assert!(retry_soon(&Error::Network("Download request failed with status: 503".into())));
        assert!(retry_soon(&Error::Io(std::io::Error::other("reset"))));
        assert!(!retry_soon(&Error::InvalidUpdaterFormat));
        assert!(!retry_soon(&Error::SignatureUtf8("x".into())));
    }
}
