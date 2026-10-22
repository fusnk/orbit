//! Orbit Connect on Android: Wi-Fi's multicast lock (the Kotlin `ConnectPlugin`
//! in gen/android). Android drops incoming multicast packets to save power
//! unless an app holds this lock, and mDNS (connect/discovery.rs) is multicast:
//! without it the TV could announce itself but never hear other devices, or
//! their questions about it. The lock is held only while Connect is on.
//!
//! Plugin calls run on Android's main thread and wait for the answer, so this
//! must only be called from async commands or other threads (Connect's are).

use std::sync::OnceLock;

use serde_json::{Value, json};
use tauri::Wry;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};

static PLUGIN: OnceLock<PluginHandle<Wry>> = OnceLock::new();

/// Registers the Kotlin side. Its IPC handler refuses every command: only Rust holds or releases the lock.
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("orbit-connect")
        .invoke_handler(|invoke| {
            invoke.resolver.reject("not allowed");
            true
        })
        .setup(|_app, api| {
            let _ = PLUGIN.set(api.register_android_plugin("io.github.fusnk.orbit", "ConnectPlugin")?);
            Ok(())
        })
        .build()
}

/// Holds (or lets go of) Wi-Fi's multicast lock. Without it discovery may find nothing, so a failure is only logged.
pub fn multicast(on: bool) {
    let held = PLUGIN.get().map(|plugin| plugin.run_mobile_plugin::<Value>("multicast", json!({ "on": on })));
    if !matches!(held, Some(Ok(_))) {
        crate::diagnostics::warn("Orbit Connect: couldn't change Wi-Fi's multicast lock");
    }
}
