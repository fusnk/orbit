//! keychain.rs's store on Android: the Kotlin `SecureStorePlugin` (gen/android),
//! which seals each secret under a key held in the Android Keystore.
//!
//! Plugin calls run on Android's main thread and these functions wait for the
//! answer, so they must never be called from it (it would wait on itself):
//! Orbit only reads secrets in async commands and background work, and a call
//! from the main thread fails instead of hanging.

use std::sync::OnceLock;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::Wry;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};

static STORE: OnceLock<PluginHandle<Wry>> = OnceLock::new();

/// Fixed message: nothing from the store (which might echo input) reaches an error.
const UNAVAILABLE: &str = "err.keychain.unavailable";

/// Registers the Kotlin store. Its IPC handler answers every command itself
/// with a refusal, so a WebView call can't fall through to the Kotlin
/// commands (the capabilities grant none of them either): secrets are read by
/// Rust only.
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("secure-store")
        .invoke_handler(|invoke| {
            invoke.resolver.reject("not allowed");
            true
        })
        .setup(|_app, api| {
            let handle = api.register_android_plugin("io.github.fusnk.orbit", "SecureStorePlugin")?;
            let _ = STORE.set(handle);
            Ok(())
        })
        .build()
}

fn store() -> Result<&'static PluginHandle<Wry>, String> {
    // SAFETY: plain syscalls with no arguments. Android's main thread is the one whose id is the process id.
    if unsafe { libc::gettid() == libc::getpid() } {
        return Err(UNAVAILABLE.into());
    }
    STORE.get().ok_or_else(|| UNAVAILABLE.into())
}

#[derive(Deserialize)]
struct Stored {
    value: Option<String>,
}

pub fn get_bytes(name: &str) -> Result<Option<Vec<u8>>, String> {
    let stored: Stored = store()?.run_mobile_plugin("get", json!({ "name": name })).map_err(|_| UNAVAILABLE)?;
    stored.value.map(|value| STANDARD.decode(value).map_err(|_| UNAVAILABLE.into())).transpose()
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    get_bytes(name)?.map(|bytes| String::from_utf8(bytes).map_err(|_| UNAVAILABLE.into())).transpose()
}

pub fn set_bytes(name: &str, value: &[u8]) -> Result<(), String> {
    store()?.run_mobile_plugin::<Value>("set", json!({ "name": name, "value": STANDARD.encode(value) })).map(drop).map_err(|_| UNAVAILABLE.into())
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    set_bytes(name, value.as_bytes())
}

pub fn delete(name: &str) -> Result<(), String> {
    store()?.run_mobile_plugin::<Value>("delete", json!({ "name": name })).map(drop).map_err(|_| UNAVAILABLE.into())
}
