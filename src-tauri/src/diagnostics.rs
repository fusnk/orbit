//! Crash reports, a small rolling log, and startup timings, for bug reports
//! (Settings → Advanced → "Open log folder" / "Copy diagnostics").
//!
//! Hardening, and why:
//! - Everything written passes through `redact`: errors often quote addon
//!   addresses (which embed debrid keys), file paths (which name the person
//!   and what they watch), tokens and emails. URLs keep only scheme and host.
//! - The log is capped at two files of `MAX_LOG_BYTES`, so a loop of errors
//!   can't fill the disk; the page's own reports are length-capped and
//!   rate-limited too, since anything on the page may be driven by addon data.
//! - The panic hook writes with the bare minimum (no locks it might already
//!   hold, no allocation-heavy work beyond formatting), and never panics itself.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::db::Db;

const LOG_FILE: &str = "orbit.log";
const OLD_LOG_FILE: &str = "orbit.log.1";
const CRASH_FILE: &str = "last-crash.txt";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
/// One log line, after redaction.
const MAX_LINE_CHARS: usize = 2000;
/// What the page may send in one report, before redaction.
const MAX_PAGE_BYTES: usize = 4 * 1024;
/// The page may report this many lines a minute; the rest are dropped.
const PAGE_LINES_PER_MINUTE: u32 = 30;
/// Lines of recent warnings and errors in "Copy diagnostics".
const RECENT_LINES: usize = 20;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

struct Log {
    file: Option<File>,
    size: u64,
    page_window: Option<Instant>,
    page_lines: u32,
}

static DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG: Mutex<Log> = Mutex::new(Log { file: None, size: 0, page_window: None, page_lines: 0 });
static LAUNCHED: OnceLock<Instant> = OnceLock::new();
static STARTUP_LOGGED: AtomicBool = AtomicBool::new(false);

/// Call first thing: the clock startup timings are measured from, and the panic hook.
pub fn launched() {
    LAUNCHED.get_or_init(Instant::now);
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write_crash(info);
        default(info);
    }));
}

/// Milliseconds since `launched`.
pub fn since_launch() -> u128 {
    LAUNCHED.get().map_or(0, |at| at.elapsed().as_millis())
}

/// Where logs go (the app's log folder); until this is called nothing is written.
pub fn init(dir: PathBuf) {
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = DIR.set(dir);
    if let Ok(mut log) = LOG.lock() {
        open(&mut log);
    }
}

fn open(log: &mut Log) {
    let Some(dir) = DIR.get() else { return };
    let path = dir.join(LOG_FILE);
    log.size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    log.file = OpenOptions::new().create(true).append(true).open(path).ok();
}

pub fn info(message: &str) {
    write(Level::Info, message);
}

pub fn warn(message: &str) {
    write(Level::Warn, message);
}

pub fn error(message: &str) {
    write(Level::Error, message);
}

fn write(level: Level, message: &str) {
    let line = format!("{} {} {}\n", timestamp(SystemTime::now()), level.as_str(), one_line(&redact(message)));
    if cfg!(debug_assertions) {
        eprint!("{line}");
    }
    let Ok(mut log) = LOG.lock() else { return };
    append(&mut log, &line);
}

fn append(log: &mut Log, line: &str) {
    let Some(dir) = DIR.get() else { return };
    let bytes = line.len() as u64;
    if log.size + bytes > MAX_LOG_BYTES {
        // Two files at most: the current one, and the one before.
        log.file = None;
        let _ = std::fs::rename(dir.join(LOG_FILE), dir.join(OLD_LOG_FILE));
        open(log);
    }
    if let Some(file) = log.file.as_mut()
        && file.write_all(line.as_bytes()).is_ok()
    {
        log.size += bytes;
    }
}

/// Redacted, on one line, and capped.
fn one_line(text: &str) -> String {
    let flat: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    cap(flat.trim(), MAX_LINE_CHARS)
}

fn cap(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

fn write_crash(info: &std::panic::PanicHookInfo<'_>) {
    let Some(dir) = DIR.get() else { return };
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(no message)".into());
    let location = info.location().map(|l| format!("{}:{}:{}", source_location(l.file()), l.line(), l.column())).unwrap_or_else(|| "unknown".into());
    let thread = std::thread::current().name().unwrap_or("unnamed").chars().take(40).collect::<String>();
    let report = format!(
        "Orbit crashed\ntime: {}\nversion: {}\nos: {} {}\nthread: {}\nlocation: {}\nmessage: {}\nuptime: {} ms\n",
        timestamp(SystemTime::now()),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        one_line(&redact(&thread)),
        location,
        one_line(&redact(&message)),
        since_launch(),
    );
    let _ = std::fs::write(dir.join(CRASH_FILE), &report);
    // Never wait here: the panic may have happened while the log was locked.
    if let Ok(mut log) = LOG.try_lock() {
        let line = format!("{} ERROR panic at {location}: {}\n", timestamp(SystemTime::now()), one_line(&redact(&message)));
        append(&mut log, &line);
    }
}

/// A panic's source file without the folders around it: dependencies are
/// built from the person's home folder (e.g. Cargo's registry), so only
/// `crate-1.0/src/file.rs` (or the file's name) is kept.
fn source_location(file: &str) -> String {
    let normal = file.replace('\\', "/");
    let parts: Vec<&str> = normal.split('/').filter(|p| !p.is_empty()).collect();
    match parts.iter().rposition(|p| *p == "src") {
        Some(0) => parts.join("/"),
        Some(i) => parts[i - 1..].join("/"),
        None => parts.last().map_or_else(String::new, |p| (*p).to_string()),
    }
}

/// `2026-10-04T12:34:56Z`, from the system clock (UTC).
fn timestamp(at: SystemTime) -> String {
    let secs = at.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO).as_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(i64::try_from(days).unwrap_or(0));
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Days since 1970-01-01 to a (year, month, day) date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let m = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// Words in a `key=value` pair whose value is a secret.
const SECRET_KEYS: [&str; 12] = ["token", "key", "secret", "password", "passwd", "pass", "auth", "session", "sig", "signature", "credential", "access"];

/// Strips what mustn't reach a log or a bug report: URLs keep only their
/// scheme and host (paths and queries often carry keys), and file paths,
/// emails, magnet links, `key=value` and JSON `"key": "value"` secrets, the
/// word after "Bearer" and long token-like strings are replaced.
pub fn redact(text: &str) -> String {
    let mut r = Redactor { out: String::with_capacity(text.len()), ..Redactor::default() };
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        // Inside a URL only a space, quote or angle bracket ends it: addon URLs put keys after
        // `,` `;` `(`… (`…/qualityfilter=480p,cam|realdebrid=KEY/manifest.json`), and the whole
        // URL has to reach `redact_url` for those to go.
        if !is_delimiter(c) || (r.token.contains("://") && !(c.is_whitespace() || "\"'`<>".contains(c))) {
            r.token.push(c);
            continue;
        }
        r.end_token();
        if r.secret_value && (c == '"' || c == '\'') {
            // A quoted secret goes whole, spaces and all, up to its closing quote.
            r.release();
            r.out.push_str(&r.gap);
            r.gap.clear();
            r.out.push(c);
            r.out.push_str("<redacted>");
            let mut escaped = false;
            for d in chars.by_ref() {
                if escaped {
                    escaped = false;
                } else if d == '\\' {
                    escaped = true;
                } else if d == c {
                    r.gap.push(d);
                    break;
                }
            }
            r.secret_value = false;
            r.after_path = false;
            r.previous.clear();
            continue;
        }
        if !c.is_whitespace() {
            r.secret_value = false;
        }
        r.gap.push(c);
    }
    r.end_token();
    r.release();
    r.out.push_str(&r.gap);
    r.out
}

/// Plain words after a path, waiting to see whether the name goes on (see `Redactor::held`).
const MAX_HELD_WORDS: usize = 8;

#[derive(Default)]
struct Redactor {
    out: String,
    token: String,
    /// Delimiters since the last token, written out with the next one.
    gap: String,
    /// The token before, lowercased.
    previous: String,
    /// The last token written was a path: a name with a space in it carries on in the next.
    after_path: bool,
    /// Plain words after a path, each with the gap before it. A name can have several spaces
    /// ("The Last of Us S01E01.mkv"): if a later word ends it as a file name, they all go with
    /// the path; otherwise they're written out as they were.
    held: Vec<(String, String)>,
    /// Right after a JSON key naming a secret and its colon: the value goes, however short.
    secret_value: bool,
}

impl Redactor {
    /// Writes the token out, leaving a URL's closing `)` `,`… (prose around it, as in
    /// "(https://…)") after what's kept of it.
    fn end_token(&mut self) {
        let tail = if self.token.contains("://") {
            let kept = self.token.trim_end_matches([')', ']', '}', ',', ';']).len();
            self.token.split_off(kept)
        } else {
            String::new()
        };
        self.flush();
        self.gap.push_str(&tail);
    }

    fn flush(&mut self) {
        if self.token.is_empty() {
            return;
        }
        let token = std::mem::take(&mut self.token);
        let follows = self.after_path && self.gap == " ";
        // Another path or a URL after the words starts something new: they were prose.
        let fresh = !self.held.is_empty() && (is_path(&token) || token.contains("://"));
        if follows && !fresh && continues_path(&token) {
            // The rest of the path's name, and the words held before it.
            self.held.clear();
        } else if follows && !self.secret_value && !token.starts_with(':') && self.held.len() < MAX_HELD_WORDS && redact_token(&token, &self.previous) == token {
            self.held.push((std::mem::take(&mut self.gap), token.clone()));
        } else {
            self.release();
            self.out.push_str(&self.gap);
            let redacted = if self.secret_value {
                "<redacted>".to_string()
            } else if token.len() > 1 && token.starts_with(':') && is_secret_name(&self.previous) {
                // `"token":123`: nothing between the colon and the value.
                ":<redacted>".to_string()
            } else {
                redact_token(&token, &self.previous)
            };
            self.after_path = redacted == "<path>";
            self.out.push_str(&redacted);
        }
        self.gap.clear();
        self.secret_value = token == ":" && is_secret_name(&self.previous);
        self.previous = token.to_ascii_lowercase();
    }

    /// Writes out the words held after a path: the name didn't go on.
    fn release(&mut self) {
        for (gap, word) in self.held.drain(..) {
            self.out.push_str(&gap);
            self.out.push_str(&word);
        }
    }
}

fn is_delimiter(c: char) -> bool {
    c.is_whitespace() || "\"'`<>()[]{},;".contains(c)
}

/// A key whose value is a secret (`apiKey`, `session_token`…).
fn is_secret_name(name: &str) -> bool {
    let name = name.trim_start_matches(['?', '&']).to_ascii_lowercase();
    SECRET_KEYS.iter().any(|k| name.contains(k))
}

/// After a path and one space, the rest of a name with a space in it: more
/// folders ("My Videos/Film.mkv") or a file's name ("Star Wars.mkv").
fn continues_path(token: &str) -> bool {
    if token.contains(['/', '\\']) {
        return true;
    }
    let name = token.trim_end_matches(['.', ':', ',']);
    name.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty() && (1..=5).contains(&ext.len()) && ext.starts_with(|c: char| c.is_ascii_alphabetic()) && ext.chars().all(|c| c.is_ascii_alphanumeric())
    })
}

fn redact_token(token: &str, previous: &str) -> String {
    if previous == "bearer" || previous == "basic" {
        return "<redacted>".into();
    }
    if token.to_ascii_lowercase().starts_with("magnet:") {
        return "magnet:<redacted>".into();
    }
    if let Some(at) = token.find("://") {
        return redact_url(token, at);
    }
    if is_path(token) {
        return "<path>".into();
    }
    // Each `&`-joined pair on its own: a query string copied outside a URL
    // (`a=1&api_key=X`) would otherwise be judged by its first key only and
    // keep the secret.
    if token.contains('=') {
        let mut found = false;
        let pairs: Vec<String> = token
            .split('&')
            .map(|pair| match pair.split_once('=') {
                Some((key, _)) if is_secret_name(key) => {
                    found = true;
                    format!("{key}=<redacted>")
                }
                _ => pair.to_string(),
            })
            .collect();
        if found {
            return pairs.join("&");
        }
    }
    if is_email(token) {
        return "<email>".into();
    }
    let core = token.trim_end_matches(['.', ':']);
    if looks_like_secret(core) {
        return format!("<token>{}", &token[core.len()..]);
    }
    token.to_string()
}

/// `https://user:pass@host:443/path?q#f` → `https://host:443/…`.
fn redact_url(token: &str, at: usize) -> String {
    // The scheme is the letters right before "://" (the token may start with e.g. "url=").
    // Past the whole character before it, which may be more than one byte.
    let scheme_start = token[..at].char_indices().rev().find(|&(_, c)| !(c.is_ascii_alphanumeric() || "+.-".contains(c))).map_or(0, |(i, c)| i + c.len_utf8());
    let (prefix, scheme) = (&token[..scheme_start], &token[scheme_start..at]);
    let rest = &token[at + 3..];
    let end = rest.find(['/', '?', '#', '\\']).unwrap_or(rest.len());
    let host = rest[..end].rsplit('@').next().unwrap_or("");
    let more = if rest[end..].trim_matches(['/', '.', ':']).is_empty() { "" } else { "/…" };
    let prefix = if prefix.contains('=') { redact_token(prefix, "") } else { prefix.to_string() };
    format!("{prefix}{scheme}://{host}{more}")
}

fn is_path(token: &str) -> bool {
    let b = token.as_bytes();
    token.contains('\\')
        || (token.starts_with('/') && token.len() > 1)
        || token.starts_with("~/")
        || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\'))
}

fn is_email(token: &str) -> bool {
    let Some((user, domain)) = token.split_once('@') else { return false };
    !user.is_empty() && domain.contains('.') && !domain.starts_with('.')
}

/// API keys, session tokens, info hashes: long runs of letters and digits mixed.
fn looks_like_secret(token: &str) -> bool {
    token.len() >= 24
        && token.chars().all(|c| c.is_ascii_alphanumeric() || "_-+/=.~".contains(c))
        && token.chars().any(|c| c.is_ascii_digit())
        && token.chars().any(|c| c.is_ascii_alphabetic())
}

/// Logs Rust's and the page's timings once per run, for cold-start numbers.
pub fn log_startup(page: &str) {
    if STARTUP_LOGGED.swap(true, Ordering::SeqCst) {
        return;
    }
    info(&format!("startup: first page painted {} ms after launch; page: {page}", since_launch()));
}

fn tail(path: &Path, lines: usize, filter: impl Fn(&str) -> bool) -> Vec<String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let found: Vec<&str> = text.lines().filter(|l| filter(l)).collect();
    found[found.len().saturating_sub(lines)..].iter().map(|l| (*l).to_string()).collect()
}

/// A report for "Copy diagnostics". Everything in it was redacted when written.
fn report(db: &Db) -> String {
    let mut out = format!("Orbit {}\nOS: {} {}\n", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH);
    let setting = |key: &str| db.setting(key).and_then(|v| v.as_str().map(str::to_string));
    out.push_str(&format!("Hardware decoding: {}\n", setting("video.hwdec").filter(|v| v == "off").unwrap_or_else(|| "auto".into())));
    out.push_str(&format!("HDR: {}\n", setting("video.hdr").map_or_else(|| "default".into(), |v| cap(&v, 20))));
    let Some(dir) = DIR.get() else {
        out.push_str("Log: unavailable\n");
        return out;
    };
    let startup = tail(&dir.join(LOG_FILE), 1, |l| l.contains(" INFO startup:"));
    out.push_str(&format!("Last startup: {}\n", startup.first().map_or("not recorded", |l| l.as_str())));
    match std::fs::read_to_string(dir.join(CRASH_FILE)) {
        Ok(crash) => {
            out.push_str("\nLast crash:\n");
            out.push_str(&cap(&crash, 4000));
        }
        Err(_) => out.push_str("Last crash: none\n"),
    }
    let mut recent = tail(&dir.join(OLD_LOG_FILE), RECENT_LINES, |l| !l.contains(" INFO "));
    recent.extend(tail(&dir.join(LOG_FILE), RECENT_LINES, |l| !l.contains(" INFO ")));
    let recent = &recent[recent.len().saturating_sub(RECENT_LINES)..];
    out.push_str(&format!("\nRecent warnings and errors ({}):\n", recent.len()));
    for line in recent {
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// A warning or error from the page (an uncaught error, a room that failed to draw).
#[tauri::command]
pub async fn diagnostics_log(level: String, message: String) -> Result<(), String> {
    let level = match level.as_str() {
        "warn" => Level::Warn,
        "error" => Level::Error,
        _ => return Err("invalid level".into()),
    };
    let mut end = message.len().min(MAX_PAGE_BYTES);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    {
        let Ok(mut log) = LOG.lock() else { return Ok(()) };
        let now = Instant::now();
        if log.page_window.is_none_or(|start| now.duration_since(start) > Duration::from_secs(60)) {
            log.page_window = Some(now);
            log.page_lines = 0;
        }
        if log.page_lines >= PAGE_LINES_PER_MINUTE {
            return Ok(());
        }
        log.page_lines += 1;
    }
    write(level, &format!("page: {}", &message[..end]));
    Ok(())
}

/// Text the page offers to copy for a bug report (the player's error details),
/// cut to the same size as a page's log line and redacted as the log is: no
/// paths, queries, keys or tokens leave through the clipboard either.
#[tauri::command]
pub async fn diagnostics_redact(text: String) -> Result<String, String> {
    Ok(redact(cut(&text, MAX_PAGE_BYTES)))
}

/// `text` cut to at most `max` bytes, on a character boundary.
fn cut(text: &str, max: usize) -> &str {
    let mut end = text.len().min(max);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// The page's startup timings (name → ms since the page started loading), logged once.
#[tauri::command]
pub async fn diagnostics_startup(marks: Vec<(String, f64)>) -> Result<(), String> {
    let page = marks
        .iter()
        .take(20)
        .filter(|(name, ms)| (1..=32).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') && ms.is_finite())
        .map(|(name, ms)| format!("{name} {ms:.0} ms"))
        .collect::<Vec<_>>()
        .join(", ");
    log_startup(&page);
    Ok(())
}

#[tauri::command]
pub async fn diagnostics_report(db: State<'_, Db>) -> Result<String, String> {
    Ok(report(&db))
}

/// Opens the log folder in the system's file manager.
#[tauri::command]
pub async fn diagnostics_open_folder() -> Result<(), String> {
    let dir = DIR.get().ok_or("err.logs.unavailable")?;
    #[cfg(windows)]
    let mut cmd = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    crate::browser::launch(cmd.arg(dir)).map(|_| ()).map_err(|_| "err.logs.open".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copied_details_are_redacted_and_cut() {
        let text = "Error: https://debrid.example/dl/abc?token=SECRET failed";
        let copied = tauri::async_runtime::block_on(diagnostics_redact(text.into())).unwrap();
        assert!(!copied.contains("SECRET") && !copied.contains("/dl/"));
        assert_eq!(cut("aé", 2), "a");
        assert_eq!(cut(&"x".repeat(MAX_PAGE_BYTES + 9), MAX_PAGE_BYTES).len(), MAX_PAGE_BYTES);
    }

    #[test]
    fn urls_keep_only_scheme_and_host() {
        assert_eq!(redact("GET https://user:pw@addon-a.example/realdebrid=ABC123/manifest.json?x=1 failed"), "GET https://addon-a.example/… failed");
        assert_eq!(redact("error sending request for url (http://127.0.0.1:11470/stream?token=abc)"), "error sending request for url (http://127.0.0.1:11470/…)");
        assert_eq!(redact("see https://example.com/"), "see https://example.com");
        assert_eq!(redact("\"stremio://addon.example/manifest.json\""), "\"stremio://addon.example/…\"");
        assert_eq!(redact("url=https://h.example/a"), "url=https://h.example/…");
        // Keys after `,` `;` `(`… in an addon URL go with the rest of it.
        let torrentio = redact("fetch https://addon.example/qualityfilter=480p,scr,cam|realdebrid=KEY123/manifest.json failed");
        assert_eq!(torrentio, "fetch https://addon.example/… failed");
        assert!(!redact("x https://a.example/a;b=KEY123(c)[d]{e} y").contains("KEY123"));
        assert_eq!(redact("(see https://example.com/a,b), then"), "(see https://example.com/…), then");
    }

    #[test]
    fn a_url_after_non_ascii_text_doesnt_panic() {
        // Release builds abort on a panic, and the page sends this text (diagnostics_log, diagnostics_redact).
        assert_eq!(redact("éhttps://debrid.example/dl/SECRET"), "éhttps://debrid.example/…");
        assert_eq!(redact("Fehler:→https://a.example/x?token=1"), "Fehler:→https://a.example/…");
    }

    #[test]
    fn paths_emails_and_magnets_go() {
        assert_eq!(redact("open C:\\Users\\sam\\Videos\\Film.mkv: denied"), "open <path> denied");
        assert_eq!(redact("read /home/sam/.config/x failed"), "read <path> failed");
        assert_eq!(redact("at C:/Users/sam/x"), "at <path>");
        assert_eq!(redact("signed in as someone@example.com"), "signed in as <email>");
        assert_eq!(redact("magnet:?xt=urn:btih:abc&tr=udp://t"), "magnet:<redacted>");
    }

    #[test]
    fn secrets_and_tokens_go() {
        assert_eq!(redact("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer <redacted>");
        assert_eq!(redact("apikey=12345 token=xyz"), "apikey=<redacted> token=<redacted>");
        // Query-style pairs outside a URL: every secret one goes, not just a leading one.
        assert_eq!(redact("query a=1&api_key=X sent"), "query a=1&api_key=<redacted> sent");
        assert_eq!(redact("?page=2&access_token=abc&lang=en"), "?page=2&access_token=<redacted>&lang=en");
        assert_eq!(redact("id=5&key=k&password=p&auth=z"), "id=5&key=<redacted>&password=<redacted>&auth=<redacted>");
        assert_eq!(redact("page=2&lang=en"), "page=2&lang=en");
        assert_eq!(redact("key 0123456789abcdef0123456789abcdef01234567."), "key <token>.");
        // Ordinary words, numbers and short ids stay.
        assert_eq!(redact("HTTP 503 from tt0903747 after 30 s"), "HTTP 503 from tt0903747 after 30 s");
        assert_eq!(redact("TypeError: x is undefined"), "TypeError: x is undefined");
    }

    #[test]
    fn short_secrets_written_as_json_go() {
        assert_eq!(redact(r#"{"token":"abc","name":"Film"}"#), r#"{"token":"<redacted>","name":"Film"}"#);
        assert_eq!(redact(r#"{"password": "two words", "user": "sam"}"#), r#"{"password": "<redacted>", "user": "sam"}"#);
        assert_eq!(redact(r#"{'apiKey': 'x\'y'}"#), r#"{'apiKey': '<redacted>'}"#);
        assert_eq!(redact(r#"{"pin":1234,"session":42}"#), r#"{"pin":1234,"session":<redacted>}"#);
        assert_eq!(redact(r#"{"session": 42}"#), r#"{"session": <redacted>}"#);
        // Other keys, and a secret word that isn't a key, stay.
        assert_eq!(redact(r#"{"status":"ok"} token: fine"#), r#"{"status":"ok"} token: fine"#);
    }

    #[test]
    fn paths_with_spaces_go_whole() {
        assert_eq!(redact("read /home/sam/My Videos/Film.mkv failed"), "read <path> failed");
        assert_eq!(redact("open /home/sam/Star Wars.mkv: denied"), "open <path> denied");
        assert_eq!(redact("open C:\\Users\\sam\\My Videos\\Film.mkv: denied"), "open <path> denied");
        assert_eq!(redact("read /home/sam/x failed."), "read <path> failed.");
        // A file name with several spaces goes whole too, however many words it has.
        assert_eq!(redact("open /home/sam/The Last of Us S01E01.mkv: denied"), "open <path> denied");
        assert_eq!(redact("open /Users/Sam Smith/Movies/Film Name 2019.mkv failed"), "open <path> failed");
        assert_eq!(redact("open C:\\Users\\sam\\Videos\\The Office S01E01.mkv: denied"), "open <path> denied");
        // Words after a path that no file name ends are written out as they were.
        assert_eq!(redact("read /home/sam/x failed with code 2"), "read <path> failed with code 2");
        assert_eq!(redact("copy /a/b to /c/d failed"), "copy <path> to <path> failed");
        assert_eq!(redact("read /a/b see https://x.example/y?token=1 now"), "read <path> see https://x.example/… now");
        // A secret among them is still redacted.
        assert_eq!(redact("read /a/b with Bearer abc def"), "read <path> with Bearer <redacted> def");
    }

    #[test]
    fn lines_are_flat_and_capped() {
        assert_eq!(one_line("a\nb\r\tc "), "a b  c");
        let long = "x ".repeat(MAX_LINE_CHARS);
        assert_eq!(one_line(&long).chars().count(), MAX_LINE_CHARS + 1);
    }

    #[test]
    fn panic_locations_lose_the_home_folder() {
        assert_eq!(source_location("src\\downloads\\mod.rs"), "src/downloads/mod.rs");
        assert_eq!(source_location("C:\\Users\\sam\\.cargo\\registry\\src\\index.crates.io-1\\librqbit-9.0.0\\src\\lib.rs"), "librqbit-9.0.0/src/lib.rs");
        assert_eq!(source_location("/home/sam/build/main.rs"), "main.rs");
    }

    #[test]
    fn timestamps_are_utc_dates() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(timestamp(UNIX_EPOCH + Duration::from_secs(1_791_072_000 + 46_923)), "2026-10-04T13:02:03Z");
        assert_eq!(timestamp(UNIX_EPOCH + Duration::from_secs(951_782_400)), "2000-02-29T00:00:00Z");
    }
}
