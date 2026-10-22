//! Handing a stream to another video player on this PC (Settings → Player →
//! External player).
//!
//! Hardening, and why:
//! - The program comes from the saved setting, read here, never from the
//!   call that opens a stream. That setting is written only by
//!   `external_player_set` (a preset) and `external_player_pick` (a custom
//!   program, only ever the file picked in the system's file dialog, never a
//!   path the page sends): `settings_set` refuses the key and backups neither
//!   save nor restore it, because a setting anything else could write would
//!   decide which .exe Orbit starts. A preset is looked up again in its usual
//!   install folders each time, and a custom path is re-checked each time
//!   (an existing regular file; `.exe` on Windows, executable elsewhere).
//!   Requiring `.exe` also keeps `.bat`/`.cmd` files out: Windows would run
//!   those through cmd.exe, which re-parses the arguments.
//! - The program is started directly (no shell), with the stream address as
//!   its one and only argument, so nothing in the address can become a
//!   second argument, an option or a command.
//! - Only http(s) addresses go out: no magnet links, local files or player
//!   protocols. The address is passed in its normalized form, so characters
//!   players parse their own command lines on (spaces, quotes) are escaped.
//! - Stream addresses often carry debrid tokens: they go to the player's
//!   argument list and nowhere else (never logged, never in an error).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::db::Db;

/// The saved choice: `{ "kind": "vlc" }`, or `{ "kind": "custom", "path": "…" }`.
pub const SETTING: &str = "player.external";
const MAX_URL_BYTES: usize = 8192;
const MAX_PATH_BYTES: usize = 4096;

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum Kind {
    Vlc,
    Mpv,
    MpcHc,
    MpcBe,
    Potplayer,
    Custom,
}

#[derive(Deserialize, Serialize)]
struct Choice {
    kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

/// Where each player usually installs itself.
fn candidates(kind: Kind) -> Vec<PathBuf> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let mut found = Vec::new();
    if cfg!(windows) {
        let program_files: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"].iter().filter_map(|n| env(n)).collect();
        let under = |relative: &[&str]| program_files.iter().flat_map(|pf| relative.iter().map(move |r| pf.join(r))).collect::<Vec<_>>();
        match kind {
            Kind::Vlc => found = under(&[r"VideoLAN\VLC\vlc.exe"]),
            Kind::Mpv => {
                found = under(&[r"mpv\mpv.exe"]);
                found.extend(env("LOCALAPPDATA").map(|d| d.join(r"Programs\mpv\mpv.exe")));
                found.extend(env("USERPROFILE").map(|d| d.join(r"scoop\apps\mpv\current\mpv.exe")));
            }
            Kind::MpcHc => found = under(&[r"MPC-HC\mpc-hc64.exe", r"MPC-HC\mpc-hc.exe", r"K-Lite Codec Pack\MPC-HC64\mpc-hc64.exe", r"K-Lite Codec Pack\MPC-HC\mpc-hc.exe"]),
            Kind::MpcBe => found = under(&[r"MPC-BE x64\mpc-be64.exe", r"MPC-BE\mpc-be.exe"]),
            Kind::Potplayer => found = under(&[r"DAUM\PotPlayer\PotPlayerMini64.exe", r"DAUM\PotPlayer\PotPlayerMini.exe", r"PotPlayer\PotPlayerMini64.exe"]),
            Kind::Custom => {}
        }
    } else if cfg!(target_os = "macos") {
        match kind {
            Kind::Vlc => found.push("/Applications/VLC.app/Contents/MacOS/VLC".into()),
            Kind::Mpv => found.extend(["/Applications/mpv.app/Contents/MacOS/mpv", "/opt/homebrew/bin/mpv", "/usr/local/bin/mpv"].map(PathBuf::from)),
            _ => {}
        }
    } else {
        match kind {
            Kind::Vlc => found.extend(["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc"].map(PathBuf::from)),
            Kind::Mpv => found.extend(["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv"].map(PathBuf::from)),
            _ => {}
        }
    }
    found
}

/// Programs (by file name, without extension) never accepted as the player.
const CODE_RUNNERS: &[&str] = &[
    "mshta", "powershell", "powershell_ise", "pwsh", "cmd", "wscript", "cscript", "rundll32", "regsvr32", "msiexec", "conhost", "bash", "sh", "wsl", "explorer", "certutil", "bitsadmin", "msbuild", "installutil", "regasm", "regsvcs", "forfiles", "hh",
];

/// The canonical path of a program that can be started directly.
fn check_program(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.as_os_str().len() > MAX_PATH_BYTES {
        return Err("err.external.pick".into());
    }
    // Only a drive letter (`C:\…`, or `\\?\C:\…` as saved choices are kept),
    // never a network share (`\\server\share`, `\\?\UNC\…`) or a device path
    // (`\\.\…`): merely looking one up sends this PC's Windows sign-in to the
    // server, and the program there is whatever the server says it is.
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))) {
            return Err("err.external.network-share".into());
        }
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| "err.external.missing")?;
    let meta = std::fs::metadata(&canonical).map_err(|_| "err.external.missing")?;
    if !meta.is_file() {
        return Err("err.external.not-program".into());
    }
    #[cfg(windows)]
    if !canonical.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        return Err("err.external.exe".into());
    }
    // No video player lives in the Windows folder, but programs that run a
    // web address as code do (mshta.exe runs an .hta page given as its only
    // argument), so a script on the page can't pick one of those.
    #[cfg(windows)]
    if std::env::var_os("SystemRoot").and_then(|root| std::fs::canonicalize(root).ok()).is_some_and(|root| canonical.starts_with(root)) {
        return Err("err.external.system".into());
    }
    // Programs that treat their argument as code or a command line, wherever
    // they were copied to: a page script could otherwise pick one as "the player".
    let stem = canonical.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    if CODE_RUNNERS.contains(&stem.as_str()) {
        return Err("err.external.runs-commands".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Err("err.external.cant-run".into());
        }
    }
    Ok(canonical)
}

fn program_for(choice: &Choice) -> Result<PathBuf, String> {
    match choice.kind {
        Kind::Custom => check_program(Path::new(choice.path.as_deref().unwrap_or_default())),
        kind => candidates(kind).iter().find_map(|p| check_program(p).ok()).ok_or_else(|| "that player isn't installed in its usual place".into()),
    }
}

/// The normalized web address a player is given (see the module docs).
fn check_url(url: &str) -> Result<String, String> {
    if url.len() > MAX_URL_BYTES {
        return Err("err.player.link".into());
    }
    let parsed = tauri::Url::parse(url).map_err(|_| "err.player.link")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("err.external.web-only".into());
    }
    Ok(parsed.into())
}

/// The program, with the address as its single argument; nothing else.
fn command_for(program: &Path, url: &str) -> Command {
    let mut command = Command::new(program);
    command.arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: the player lives on its own, closing Orbit doesn't close it.
        command.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    command
}

fn saved(db: &Db) -> Option<Choice> {
    db.setting(SETTING).and_then(|v| serde_json::from_value(v).ok())
}

/// Where a player would be started from, for Settings to show; an error if it
/// can't be. A custom player is the one saved (picked in the file dialog),
/// never a path the page names, so this can't probe the disk for the page.
#[tauri::command]
pub async fn external_player_find(db: State<'_, Db>, kind: String) -> Result<String, String> {
    let kind: Kind = serde_json::from_value(serde_json::Value::String(kind)).map_err(|_| "unknown player")?;
    let path = if kind == Kind::Custom { saved(&db).filter(|c| c.kind == Kind::Custom).and_then(|c| c.path) } else { None };
    let program = program_for(&Choice { kind, path })?;
    Ok(program.to_string_lossy().into_owned())
}

/// What `external_player_set` saves for a choice: a preset as is (it's found
/// again at each launch). None clears the choice. A custom program can't be
/// named here: it's only ever the file the person picked in the system's file
/// dialog (`external_player_pick`). Checking a page-sent path wasn't enough,
/// since a script on the page could still pick any other local program that
/// passes the checks and have Orbit start it with a URL it controls.
fn saved_choice(kind: Option<&str>) -> Result<Option<Choice>, String> {
    let Some(kind) = kind else { return Ok(None) };
    let kind: Kind = serde_json::from_value(serde_json::Value::String(kind.into())).map_err(|_| "unknown player")?;
    if kind == Kind::Custom {
        return Err("err.external.pick".into());
    }
    Ok(Some(Choice { kind, path: None }))
}

/// A picked program as it's saved: once it checks out (an existing file, see
/// `check_program`), by its canonical path.
fn custom_choice(picked: &Path) -> Result<Choice, String> {
    let program = check_program(picked)?;
    Ok(Choice { kind: Kind::Custom, path: Some(program.to_string_lossy().into_owned()) })
}

fn save(db: &Db, choice: Option<&Choice>) -> Result<(), String> {
    let conn = db.lock()?;
    match choice {
        Some(choice) => {
            let value = serde_json::to_string(choice).map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [SETTING, &value])
        }
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [SETTING]),
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Saves a preset external player (`kind` None for no external player).
#[tauri::command]
pub async fn external_player_set(db: State<'_, Db>, kind: Option<String>) -> Result<(), String> {
    save(&db, saved_choice(kind.as_deref())?.as_ref())
}

/// Opens the system's file dialog for a custom player and saves the program
/// picked there; the path it was saved under, or None when cancelled.
#[tauri::command]
pub async fn external_player_pick(app: AppHandle, db: State<'_, Db>) -> Result<Option<String>, String> {
    let Some(picked) = crate::dialog::pick_program(&app).await else { return Ok(None) };
    let choice = custom_choice(&picked)?;
    save(&db, Some(&choice))?;
    Ok(choice.path)
}

/// Opens `url` in the external player chosen in Settings, and returns once it has started.
#[tauri::command]
pub async fn external_player_open(db: State<'_, Db>, url: String) -> Result<(), String> {
    let url = check_url(&url)?;
    let choice = saved(&db).ok_or("no external player is chosen in Settings")?;
    let program = program_for(&choice)?;
    let mut child = command_for(&program, &url).spawn().map_err(|_| "the external player didn't start")?;
    // Reaped when it exits, so it never lingers as a zombie process.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_addresses_go_out() {
        assert!(check_url("https://cdn.example/video.mkv?token=abc").is_ok());
        assert!(check_url("http://debrid.example/d/123").is_ok());
        for bad in ["magnet:?xt=urn:btih:abc", "file:///C:/Windows/win.ini", "orbit-local://00", "C:\\video.mkv", "--help", "-o", "javascript:alert(1)", "smb://x/y"] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
        assert!(check_url(&format!("https://x/{}", "a".repeat(9000))).is_err());
    }

    #[test]
    fn addresses_are_normalized_so_they_stay_one_argument() {
        let url = check_url("https://cdn.example/a b\"c.mkv").unwrap();
        assert!(!url.contains(' ') && !url.contains('"'), "{url}");
        assert!(url.starts_with("https://"));
    }

    #[test]
    fn the_address_is_the_only_argument() {
        let url = "https://cdn.example/x.mkv?a=1&b=2;calc|whoami";
        let command = command_for(Path::new("/opt/player"), url);
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, [std::ffi::OsStr::new(url)]);
        assert_eq!(command.get_program(), std::ffi::OsStr::new("/opt/player"));
    }

    #[test]
    fn programs_must_exist_and_be_runnable() {
        let dir = std::env::temp_dir().join(format!("orbit-external-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(check_program(Path::new("player.exe")).is_err(), "relative");
        assert!(check_program(&dir.join("missing.exe")).is_err());
        assert!(check_program(&dir).is_err(), "a directory");
        let script = dir.join("player.bat");
        std::fs::write(&script, b"@echo off").unwrap();
        let program = dir.join(if cfg!(windows) { "player.exe" } else { "player" });
        std::fs::write(&program, b"x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert!(check_program(&program).is_err(), "not executable");
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(windows)]
        assert!(check_program(&script).is_err(), "a .bat would run through cmd.exe");
        #[cfg(windows)]
        {
            let root = PathBuf::from(std::env::var_os("SystemRoot").unwrap());
            assert!(check_program(&root.join(r"System32\mshta.exe")).is_err(), "runs a web page as code");
            assert!(check_program(&root.join(r"System32\cmd.exe")).is_err());
        }
        assert!(check_program(&program).is_ok());
        // Saved choices are canonical paths (`\\?\C:\…` on Windows); they still check out.
        assert!(check_program(&check_program(&program).unwrap()).is_ok());
        // A code runner copied anywhere is still one.
        let copied = dir.join(if cfg!(windows) { "MSHTA.exe" } else { "bash" });
        std::fs::copy(&program, &copied).unwrap();
        assert!(check_program(&copied).is_err(), "a renamed copy of a code runner");
        #[cfg(windows)]
        for share in [r"\\server\share\player.exe", r"\\?\UNC\server\share\player.exe", r"\\.\C:\player.exe", r"//server/share/player.exe"] {
            assert!(check_program(Path::new(share)).is_err(), "{share}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_checked_programs_are_saved() {
        assert!(saved_choice(None).unwrap().is_none(), "no external player");
        let preset = saved_choice(Some("vlc")).unwrap().unwrap();
        assert_eq!((preset.kind, preset.path), (Kind::Vlc, None), "a preset never keeps a path");
        assert!(saved_choice(Some("cmd")).is_err());
        // A custom program only comes from the file dialog, never from the page.
        assert!(saved_choice(Some("custom")).is_err());
        assert!(custom_choice(Path::new("player.exe")).is_err(), "relative");
        let dir = std::env::temp_dir().join(format!("orbit-external-set-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(custom_choice(&dir).is_err(), "a folder");
        assert!(custom_choice(&dir.join("missing.exe")).is_err(), "missing");
        let script = dir.join("player.bat");
        std::fs::write(&script, b"@echo off").unwrap();
        #[cfg(windows)]
        assert!(custom_choice(&script).is_err(), "a .bat");
        let program = dir.join(if cfg!(windows) { "player.exe" } else { "player" });
        std::fs::write(&program, b"x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let custom = custom_choice(&program).unwrap();
        assert_eq!(custom.kind, Kind::Custom);
        assert_eq!(custom.path.as_deref(), Some(&*std::fs::canonicalize(&program).unwrap().to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn choices_parse_from_settings() {
        let choice: Choice = serde_json::from_value(serde_json::json!({ "kind": "mpc-hc" })).unwrap();
        assert_eq!(choice.kind, Kind::MpcHc);
        let choice: Choice = serde_json::from_value(serde_json::json!({ "kind": "custom", "path": "/x" })).unwrap();
        assert_eq!((choice.kind, choice.path.as_deref()), (Kind::Custom, Some("/x")));
        assert!(serde_json::from_value::<Choice>(serde_json::json!({ "kind": "cmd" })).is_err());
        assert!(program_for(&Choice { kind: Kind::Custom, path: None }).is_err());
    }
}
