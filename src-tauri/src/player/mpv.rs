//! A small binding to libmpv's client API, loaded at runtime.
//!
//! Windows' DLL is loaded by full path from Orbit's resource directory, never
//! by name, so its search order can't be used to slip in another copy. Linux
//! uses the absolute system SONAME path found by pkg-config at build time.
//! Only the handful of functions Orbit needs are bound.

use std::ffi::{CStr, CString, c_char, c_double, c_int, c_ulong, c_void};
use std::path::Path;
use std::ptr::NonNull;

use libloading::Library;

#[repr(C)]
pub struct Handle {
    _private: [u8; 0],
}

/// `mpv_event` from client.h.
#[repr(C)]
pub struct Event {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

/// `mpv_event_property` from client.h.
#[repr(C)]
pub struct EventProperty {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

/// The leading fields of `mpv_event_end_file`; later fields are never read.
#[repr(C)]
pub struct EventEndFile {
    pub reason: c_int,
    pub error: c_int,
    /// The playlist entry that ended (client API 2.x always has it).
    pub playlist_entry_id: i64,
}

/// `mpv_event_start_file` from client.h.
#[repr(C)]
pub struct EventStartFile {
    pub playlist_entry_id: i64,
}

pub mod event {
    pub const NONE: i32 = 0;
    pub const SHUTDOWN: i32 = 1;
    pub const SET_PROPERTY_REPLY: i32 = 4;
    pub const START_FILE: i32 = 6;
    pub const END_FILE: i32 = 7;
    pub const FILE_LOADED: i32 = 8;
    pub const VIDEO_RECONFIG: i32 = 17;
    pub const PLAYBACK_RESTART: i32 = 21;
    pub const PROPERTY_CHANGE: i32 = 22;
}

pub mod format {
    pub const STRING: i32 = 1;
    pub const FLAG: i32 = 3;
    pub const INT64: i32 = 4;
    pub const DOUBLE: i32 = 5;
    pub const NODE: i32 = 6;
    pub const NODE_ARRAY: i32 = 7;
    pub const NODE_MAP: i32 = 8;
}

/// `mpv_node` from client.h: a tagged value, used for structured properties.
#[repr(C)]
pub struct Node {
    pub u: NodeValue,
    pub format: c_int,
}

#[repr(C)]
pub union NodeValue {
    pub string: *mut c_char,
    pub flag: c_int,
    pub int64: i64,
    pub double: f64,
    pub list: *mut NodeList,
}

/// `mpv_node_list`: an array, or a map when `keys` is set.
#[repr(C)]
pub struct NodeList {
    pub num: c_int,
    pub values: *mut Node,
    pub keys: *mut *mut c_char,
}

/// Structured properties are small (a track list); deeper or larger values are cut off.
const MAX_NODE_DEPTH: usize = 6;
const MAX_NODE_ITEMS: usize = 1000;

/// Copies an mpv node into JSON.
///
/// # Safety
/// `node` must point to a valid node owned by mpv for the duration of the call.
pub unsafe fn node_to_json(node: &Node, depth: usize) -> serde_json::Value {
    use serde_json::Value;
    let text = |p: *const c_char| if p.is_null() { String::new() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned() };
    // SAFETY (all union reads): `format` says which field is set.
    match node.format {
        format::STRING => Value::String(text(unsafe { node.u.string })),
        format::FLAG => Value::Bool(unsafe { node.u.flag } != 0),
        format::INT64 => Value::from(unsafe { node.u.int64 }),
        format::DOUBLE => serde_json::Number::from_f64(unsafe { node.u.double }).map_or(Value::Null, Value::Number),
        format::NODE_ARRAY | format::NODE_MAP if depth < MAX_NODE_DEPTH => {
            let list = unsafe { node.u.list };
            if list.is_null() {
                return Value::Null;
            }
            let list = unsafe { &*list };
            let len = usize::try_from(list.num).unwrap_or(0).min(MAX_NODE_ITEMS);
            let values = if len == 0 || list.values.is_null() { &[][..] } else { unsafe { std::slice::from_raw_parts(list.values, len) } };
            if node.format == format::NODE_ARRAY {
                Value::Array(values.iter().map(|v| unsafe { node_to_json(v, depth + 1) }).collect())
            } else {
                let keys = if list.keys.is_null() { &[][..] } else { unsafe { std::slice::from_raw_parts(list.keys, len) } };
                Value::Object(keys.iter().zip(values).map(|(k, v)| (text(*k), unsafe { node_to_json(v, depth + 1) })).collect())
            }
        }
        _ => Value::Null,
    }
}

pub mod end_reason {
    pub const ERROR: i32 = 4;
}

/// The client API major version this binding is written against.
const API_MAJOR: c_ulong = 2;

struct Api {
    client_api_version: unsafe extern "C" fn() -> c_ulong,
    create: unsafe extern "C" fn() -> *mut Handle,
    initialize: unsafe extern "C" fn(*mut Handle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(*mut Handle),
    set_option_string: unsafe extern "C" fn(*mut Handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(*mut Handle, *const c_char, *const c_char) -> c_int,
    set_property_async: unsafe extern "C" fn(*mut Handle, u64, *const c_char, c_int, *mut c_void) -> c_int,
    command: unsafe extern "C" fn(*mut Handle, *mut *const c_char) -> c_int,
    observe_property: unsafe extern "C" fn(*mut Handle, u64, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(*mut Handle, c_double) -> *mut Event,
    wakeup: unsafe extern "C" fn(*mut Handle),
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    get_property_string: unsafe extern "C" fn(*mut Handle, *const c_char) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
}

/// One mpv instance. libmpv's client API is thread-safe, with two exceptions
/// this type upholds: only one thread may call `wait_event`, and
/// `terminate_destroy` (in `Drop`) must not race any other call.
pub struct Mpv {
    api: Api,
    /// The client API's minor version (2.x): which command arguments this libmpv knows.
    api_minor: c_ulong,
    handle: NonNull<Handle>,
    // Keeps the DLL mapped for as long as `api` points into it.
    _lib: Library,
}

// SAFETY: see the type's documentation; the client API may be called from any thread.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn cstring(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| "text contains a NUL byte".to_string())
}

impl Mpv {
    #[cfg(target_os = "linux")]
    pub(super) fn handle(&self) -> *mut Handle {
        self.handle.as_ptr()
    }

    /// Loads libmpv from `path` and creates an (uninitialized) instance.
    pub fn load(path: &Path) -> Result<Self, String> {
        // All Linux instances (including thumbnail workers) use the distribution
        // library selected by pkg-config, never a Windows resource or cwd search.
        #[cfg(target_os = "linux")]
        let path = {
            let _ = path;
            Path::new(env!("ORBIT_SYSTEM_LIBMPV"))
        };
        // SAFETY: loading runs the DLL's initializers; the file is Orbit's own pinned copy.
        let lib = unsafe { load_library(path) }.map_err(|e| format!("couldn't load libmpv: {e}"))?;
        // SAFETY: the symbol types match client.h for API version 2.x, checked below.
        let api = unsafe {
            Api {
                client_api_version: *lib.get(b"mpv_client_api_version\0").map_err(|e| e.to_string())?,
                create: *lib.get(b"mpv_create\0").map_err(|e| e.to_string())?,
                initialize: *lib.get(b"mpv_initialize\0").map_err(|e| e.to_string())?,
                terminate_destroy: *lib.get(b"mpv_terminate_destroy\0").map_err(|e| e.to_string())?,
                set_option_string: *lib.get(b"mpv_set_option_string\0").map_err(|e| e.to_string())?,
                set_property_string: *lib.get(b"mpv_set_property_string\0").map_err(|e| e.to_string())?,
                set_property_async: *lib.get(b"mpv_set_property_async\0").map_err(|e| e.to_string())?,
                command: *lib.get(b"mpv_command\0").map_err(|e| e.to_string())?,
                observe_property: *lib.get(b"mpv_observe_property\0").map_err(|e| e.to_string())?,
                wait_event: *lib.get(b"mpv_wait_event\0").map_err(|e| e.to_string())?,
                wakeup: *lib.get(b"mpv_wakeup\0").map_err(|e| e.to_string())?,
                error_string: *lib.get(b"mpv_error_string\0").map_err(|e| e.to_string())?,
                get_property_string: *lib.get(b"mpv_get_property_string\0").map_err(|e| e.to_string())?,
                free: *lib.get(b"mpv_free\0").map_err(|e| e.to_string())?,
            }
        };
        // SAFETY: takes no arguments.
        let version = unsafe { (api.client_api_version)() };
        if version >> 16 != API_MAJOR {
            eprintln!("unsupported libmpv client API {}.{}", version >> 16, version & 0xffff);
            return Err("err.player.libmpv".into());
        }
        // SAFETY: returns a new handle or null.
        let handle = NonNull::new(unsafe { (api.create)() }).ok_or("err.player.output")?;
        Ok(Self { api, api_minor: version & 0xffff, handle, _lib: lib })
    }

    /// `loadfile` with flags and per-file options, as this libmpv takes them: mpv 0.38 (client
    /// API 2.3) put an index argument before the options; older ones (the system libmpv of most
    /// Linux distributions) would read the index as the options and refuse the extra argument.
    pub fn loadfile(&self, url: &str, flags: &str, options: &str) -> Result<(), String> {
        self.command(&loadfile_args(url, flags, options, self.api_minor >= 3))
    }

    fn check(&self, code: c_int) -> Result<(), String> {
        if code >= 0 {
            return Ok(());
        }
        // SAFETY: returns a static string for any error code.
        let text = unsafe { CStr::from_ptr((self.api.error_string)(code)) };
        Err(text.to_string_lossy().into_owned())
    }

    pub fn set_option(&self, name: &str, value: &str) -> Result<(), String> {
        let (name, value) = (cstring(name)?, cstring(value)?);
        // SAFETY: valid handle and NUL-terminated strings that outlive the call.
        self.check(unsafe { (self.api.set_option_string)(self.handle.as_ptr(), name.as_ptr(), value.as_ptr()) })
    }

    pub fn initialize(&self) -> Result<(), String> {
        // SAFETY: valid handle.
        self.check(unsafe { (self.api.initialize)(self.handle.as_ptr()) })
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let (name, value) = (cstring(name)?, cstring(value)?);
        // SAFETY: as in `set_option`.
        self.check(unsafe { (self.api.set_property_string)(self.handle.as_ptr(), name.as_ptr(), value.as_ptr()) })
    }

    /// Sets a property without waiting for mpv to apply it; the result comes back
    /// as a SET_PROPERTY_REPLY event carrying `reply`. For changes that make mpv
    /// reopen something (the audio output), so the event thread never waits on them.
    pub fn set_property_async(&self, reply: u64, name: &str, value: &str) -> Result<(), String> {
        let (name, value) = (cstring(name)?, cstring(value)?);
        let mut text = value.as_ptr();
        // SAFETY: valid handle; mpv copies the STRING-format value (a `char**`) before returning.
        self.check(unsafe { (self.api.set_property_async)(self.handle.as_ptr(), reply, name.as_ptr(), format::STRING, (&raw mut text).cast()) })
    }

    /// Runs a command. Arguments are passed as a list, never parsed from one
    /// string, so a URL can't smuggle in extra arguments or options.
    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let owned = args.iter().map(|a| cstring(a)).collect::<Result<Vec<_>, _>>()?;
        let mut argv: Vec<*const c_char> = owned.iter().map(|a| a.as_ptr()).collect();
        argv.push(std::ptr::null());
        // SAFETY: NULL-terminated array of strings that outlive the call.
        self.check(unsafe { (self.api.command)(self.handle.as_ptr(), argv.as_mut_ptr()) })
    }

    pub fn observe(&self, id: u64, name: &str, format: i32) -> Result<(), String> {
        let name = cstring(name)?;
        // SAFETY: valid handle and string.
        self.check(unsafe { (self.api.observe_property)(self.handle.as_ptr(), id, name.as_ptr(), format) })
    }

    /// Waits for the next event (`timeout` < 0 waits forever). Only one
    /// thread may call this; the event stays valid until the next call.
    pub fn wait_event(&self, timeout: f64) -> &Event {
        // SAFETY: never returns null; the event lives until the next wait_event.
        unsafe { &*(self.api.wait_event)(self.handle.as_ptr(), timeout) }
    }

    /// Makes a blocked `wait_event` return.
    pub fn wakeup(&self) {
        // SAFETY: valid handle.
        unsafe { (self.api.wakeup)(self.handle.as_ptr()) }
    }

    /// A property's value as text, or None if it's unavailable (e.g. nothing playing).
    pub fn get_string(&self, name: &str) -> Option<String> {
        let name = cstring(name).ok()?;
        // SAFETY: valid handle and string; the result is freed with mpv_free below.
        let raw = unsafe { (self.api.get_property_string)(self.handle.as_ptr(), name.as_ptr()) };
        if raw.is_null() {
            return None;
        }
        // SAFETY: mpv returns a NUL-terminated string it allocated.
        let text = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
        // SAFETY: allocated by mpv, freed once.
        unsafe { (self.api.free)(raw.cast()) };
        Some(text)
    }

    pub fn error_text(&self, code: c_int) -> String {
        self.check(code).err().unwrap_or_default()
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        // SAFETY: the owner guarantees no other thread is still using the handle.
        unsafe { (self.api.terminate_destroy)(self.handle.as_ptr()) }
    }
}

#[cfg(windows)]
unsafe fn load_library(path: &Path) -> Result<Library, libloading::Error> {
    use libloading::os::windows::{LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, Library as WinLibrary};
    // libmpv's own dependencies resolve from its folder and System32 only.
    // SAFETY: forwarded to the caller.
    unsafe { WinLibrary::load_with_flags(path, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS) }.map(Into::into)
}

#[cfg(not(windows))]
unsafe fn load_library(path: &Path) -> Result<Library, libloading::Error> {
    // SAFETY: forwarded to the caller.
    unsafe { Library::new(path) }
}

/// The arguments of a `loadfile` command; `with_index` for mpv 0.38 and later (see `Mpv::loadfile`).
fn loadfile_args<'a>(url: &'a str, flags: &'a str, options: &'a str, with_index: bool) -> Vec<&'a str> {
    if with_index {
        vec!["loadfile", url, flags, "-1", options]
    } else {
        vec!["loadfile", url, flags, options]
    }
}

#[cfg(test)]
mod loadfile_tests {
    use super::loadfile_args;

    #[test]
    fn loadfile_gives_the_index_only_to_an_mpv_that_takes_one() {
        assert_eq!(loadfile_args("u", "replace", "start=5", true), ["loadfile", "u", "replace", "-1", "start=5"]);
        // mpv 0.37 and older: `loadfile <url> [<flags> [<options>]]`.
        assert_eq!(loadfile_args("u", "replace", "start=5", false), ["loadfile", "u", "replace", "start=5"]);
    }
}
