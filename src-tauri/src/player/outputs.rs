//! Settings → Audio → Output device, and the player's Audio view: which of the
//! outputs mpv lists (`audio-device-list`) the sound goes to.
//!
//! The person's choice is kept as `wanted`, and mpv is told it only while it's
//! in mpv's list; otherwise `auto` (the system default). So unplugging the
//! chosen headphones moves the sound to the default instead of leaving mpv on
//! a device that's gone (silence), and plugging them back in returns it there.
//! mpv refreshes the list itself on hotplug while it's observed, and with
//! `auto` it follows the system's default device when that changes mid-play.
//!
//! Only names mpv listed (or `auto`) ever reach mpv: a device name can select
//! more than a speaker on some systems (ALSA plugins), so the page's text alone
//! is never used.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::mpv::Mpv;
use super::{PlayerState, STREAM_HARDENING};

pub const AUTO: &str = "auto";
/// More than any real machine has; the rest are ignored.
const MAX_DEVICES: usize = 64;
const MAX_NAME_BYTES: usize = 512;
const MAX_DESCRIPTION_CHARS: usize = 200;
/// `audio-device-list` read as text is a few KB; anything far larger isn't parsed.
const MAX_LIST_BYTES: usize = 256 * 1024;
/// The reply id of `audio-device` changes (see `Outputs::refused`).
pub const REPLY: u64 = 1001;

/// One output mpv can play sound on.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Device {
    /// mpv's name for it ("wasapi/{…}", "pipewire/…").
    pub name: String,
    /// What the system calls it ("Speakers (Realtek Audio)").
    pub description: String,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= MAX_NAME_BYTES && !name.chars().any(char::is_control)
}

/// The devices in mpv's `audio-device-list`, without its own `auto` entry (the page offers that).
pub fn devices_from(list: &serde_json::Value) -> Vec<Device> {
    let mut devices: Vec<Device> = Vec::new();
    for entry in list.as_array().into_iter().flatten() {
        let Some(name) = entry.get("name").and_then(|n| n.as_str()).filter(|n| valid_name(n) && *n != AUTO) else { continue };
        if devices.iter().any(|d| d.name == name) {
            continue;
        }
        let description: String = entry.get("description").and_then(|d| d.as_str()).unwrap_or_default().chars().filter(|c| !c.is_control()).take(MAX_DESCRIPTION_CHARS).collect();
        let description = if description.trim().is_empty() { name.to_owned() } else { description.trim().to_owned() };
        devices.push(Device { name: name.to_owned(), description });
        if devices.len() == MAX_DEVICES {
            break;
        }
    }
    devices
}

/// What mpv should play on: the device wanted while it's connected, else the system default.
pub fn device_to_use<'a>(wanted: &'a str, available: &[Device]) -> &'a str {
    if wanted != AUTO && available.iter().any(|d| d.name == wanted) { wanted } else { AUTO }
}

/// The output chosen, the one mpv was last told, and mpv's list (None until first read).
#[derive(Default)]
pub struct Outputs {
    wanted: String,
    applied: Option<String>,
    list: Option<Vec<Device>>,
}

impl Outputs {
    /// Tells mpv the device to use, if that changed. Never waits for mpv to
    /// reopen its output: this runs on the event thread too.
    fn apply(&mut self, mpv: &Mpv) {
        let Some(list) = &self.list else { return };
        let target = device_to_use(&self.wanted, list);
        if self.applied.as_deref() == Some(target) {
            return;
        }
        let target = target.to_owned();
        if mpv.set_property_async(REPLY, "audio-device", &target).is_ok() {
            self.applied = Some(target);
        }
    }

    /// mpv listed its outputs: at start, and whenever one is plugged in or removed.
    pub fn listed(&mut self, mpv: &Mpv, list: Vec<Device>) {
        self.list = Some(list);
        self.apply(mpv);
    }

    /// mpv turned a change down: forgotten, so the next list tries again.
    pub fn refused(&mut self) {
        self.applied = None;
    }

    pub fn devices(&self) -> Vec<Device> {
        self.list.clone().unwrap_or_default()
    }
}

/// mpv's list as it is now (it's read as JSON text: mpv writes structured properties that way).
fn read_list(mpv: &Mpv) -> Option<Vec<Device>> {
    let text = mpv.get_string("audio-device-list").filter(|t| t.len() <= MAX_LIST_BYTES)?;
    serde_json::from_str(&text).ok().map(|list| devices_from(&list))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    devices: Vec<Device>,
    /// The device sound goes to now, as mpv has it.
    active: String,
}

/// Lists the outputs with a short-lived mpv that has no window, no file and no
/// event thread, closed again right after: Settings asks before anything has
/// played, and starting the player itself for that would open its video
/// surface and keep an engine running for nothing.
fn list_without_player(app: &AppHandle) -> Result<Vec<Device>, String> {
    let mpv = Mpv::load(&super::libmpv(app)?)?;
    for (name, value) in STREAM_HARDENING.iter().copied().chain([("vo", "null"), ("idle", "yes"), ("terminal", "no")]) {
        mpv.set_option(name, value).map_err(|e| format!("mpv option {name}: {e}"))?;
    }
    mpv.initialize()?;
    read_list(&mpv).ok_or_else(|| "couldn't list sound outputs".into())
}

/// The outputs to pick from, for Settings and the player's Audio view.
#[tauri::command]
pub async fn player_audio_devices(app: AppHandle, state: State<'_, PlayerState>) -> Result<Listing, String> {
    let Some(mpv) = state.running() else {
        let devices = tauri::async_runtime::spawn_blocking(move || list_without_player(&app)).await.map_err(|e| e.to_string())??;
        return Ok(Listing { devices, active: AUTO.into() });
    };
    let fresh = read_list(&mpv);
    let mut outputs = state.outputs.lock().map_err(|_| "player unavailable")?;
    if let Some(list) = fresh {
        outputs.listed(&mpv, list);
    }
    let active = mpv.get_string("audio-device").unwrap_or_else(|| AUTO.into());
    Ok(Listing { devices: outputs.devices(), active })
}

/// The person's choice (per profile, saved by the page): `auto` or a name from the list.
#[tauri::command]
pub async fn player_set_audio_device(state: State<'_, PlayerState>, device: String) -> Result<(), String> {
    if !valid_name(&device) {
        return Err("invalid audio device".into());
    }
    // Not playing (Settings): kept for when the player starts, which applies it once mpv lists its outputs.
    let Some(mpv) = state.running() else {
        state.outputs.lock().map_err(|_| "player unavailable")?.wanted = device;
        return Ok(());
    };
    let fresh = read_list(&mpv);
    let mut outputs = state.outputs.lock().map_err(|_| "player unavailable")?;
    outputs.wanted = device;
    match fresh {
        Some(list) => outputs.listed(&mpv, list),
        None => outputs.apply(&mpv),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AUTO, Device, device_to_use, devices_from, valid_name};
    use serde_json::json;

    fn device(name: &str) -> Device {
        Device { name: name.into(), description: name.into() }
    }

    #[test]
    fn plays_on_the_chosen_device_only_while_it_is_connected() {
        let both = [device("wasapi/{headphones}"), device("wasapi/{speakers}")];
        assert_eq!(device_to_use("wasapi/{headphones}", &both), "wasapi/{headphones}");
        // Unplugged: the system default, never a device that's gone (silence).
        assert_eq!(device_to_use("wasapi/{headphones}", &both[1..]), AUTO);
        assert_eq!(device_to_use("wasapi/{headphones}", &[]), AUTO);
        assert_eq!(device_to_use(AUTO, &both), AUTO);
        assert_eq!(device_to_use("", &both), AUTO);
    }

    #[test]
    fn reads_mpv_device_list() {
        let list = json!([
            {"name": "auto", "description": "Autoselect device"},
            {"name": "wasapi/{a}", "description": "Speakers (Realtek)\n"},
            {"name": "wasapi/{a}", "description": "duplicate"},
            {"name": "wasapi/{b}", "description": "  "},
            {"name": "", "description": "no name"},
            {"description": "missing name"},
            {"name": "bad\u{0}name", "description": "control"},
        ]);
        assert_eq!(devices_from(&list), vec![Device { name: "wasapi/{a}".into(), description: "Speakers (Realtek)".into() }, Device { name: "wasapi/{b}".into(), description: "wasapi/{b}".into() }]);
        assert!(devices_from(&json!({"name": "x"})).is_empty());
        let many: Vec<_> = (0..100).map(|i| json!({"name": format!("d{i}"), "description": ""})).collect();
        assert_eq!(devices_from(&json!(many)).len(), 64);
    }

    #[test]
    fn device_names_from_the_page_are_bounded() {
        assert!(valid_name(AUTO));
        assert!(!valid_name(""));
        assert!(!valid_name("a\nb"));
        assert!(!valid_name(&"x".repeat(513)));
    }
}
