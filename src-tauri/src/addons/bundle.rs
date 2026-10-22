//! Addon bundles: the active profile's addon list as a small JSON file to
//! share (see src/addons/bundle.ts, which reads them).
//!
//! Built here because it needs the sealed transport URLs, which never reach
//! the WebView. A URL is written into a bundle only when it is provably plain:
//! https, a public host, no user info, query or fragment, the path exactly
//! `/manifest.json`, and a manifest that isn't configurable. Configured
//! addons keep their settings (often a debrid key or a token) in the path,
//! and Orbit can't tell a config segment from a harmless sub-path, so any
//! other path counts as configured. Those travel as host + "needs setup" so
//! the friend configures their own.

use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use super::{AddonError, display_host, lock, net, open_url, reading_profile, visible};
use crate::db::Db;
use crate::profiles::ActiveProfile;
use crate::vault;

/// Must match `BUNDLE_FORMAT` in src/addons/bundle.ts.
const BUNDLE_FORMAT: u32 = 1;
/// Must match `MAX_BUNDLE_ADDONS` in src/addons/bundle.ts.
const MAX_BUNDLE_ADDONS: usize = 100;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    orbit_addons: u32,
    addons: Vec<Entry>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Entry {
    Install { name: String, id: String, version: String, url: String },
    #[serde(rename_all = "camelCase")]
    Setup { name: String, id: String, version: String, host: String, needs_setup: bool },
}

fn flag(manifest: &Value, name: &str) -> bool {
    manifest.pointer(&format!("/behaviorHints/{name}")).and_then(Value::as_bool).unwrap_or(false)
}

fn text(manifest: &Value, field: &str, max: usize) -> String {
    let value = manifest.get(field).and_then(Value::as_str).unwrap_or_default();
    value.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

/// The URL a friend can install as is, rebuilt from scratch so nothing but
/// scheme, host and port can come along; `None` when the addon is configured
/// (or might be).
fn public_url(url: &Url, manifest: &Value) -> Option<String> {
    let plain = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == "/manifest.json"
        && !net::is_private_host(url)
        && !flag(manifest, "configurable")
        && !flag(manifest, "configurationRequired");
    plain.then(|| format!("https://{}/manifest.json", display_host(url)))
}

fn entry(url: Option<&Url>, stored_host: &str, manifest: &Value) -> Option<Entry> {
    let name = text(manifest, "name", 100);
    let id = text(manifest, "id", 512);
    if name.is_empty() || id.is_empty() {
        return None;
    }
    let version = text(manifest, "version", 64);
    Some(match url.and_then(|u| public_url(u, manifest)) {
        Some(url) => Entry::Install { name, id, version, url },
        None => Entry::Setup { name, id, version, host: url.map_or_else(|| stored_host.to_string(), display_host), needs_setup: true },
    })
}

/// The bundle for `profile`'s list, in its order. Built-ins are skipped
/// (everyone has them); an addon whose URL can't be opened still goes in as
/// "needs setup" under the host stored for it.
fn build(conn: &rusqlite::Connection, profile: &str, cipher: Option<&aes_gcm::Aes256Gcm>) -> rusqlite::Result<Bundle> {
    let addons = visible(conn, profile)?
        .into_iter()
        .filter(|a| !a.built_in)
        .filter_map(|a| {
            let manifest: Value = serde_json::from_str(&a.manifest).ok()?;
            let url = cipher.and_then(|c| open_url(c, &a.key, a.owner.as_deref(), &a.sealed).ok());
            entry(url.as_ref(), &a.display_host, &manifest)
        })
        .take(MAX_BUNDLE_ADDONS)
        .collect();
    Ok(Bundle { orbit_addons: BUNDLE_FORMAT, addons })
}

fn bundle_text(db: &Db, active: &ActiveProfile) -> Result<String, AddonError> {
    let cipher = vault::cipher().ok();
    let conn = lock(db)?;
    let profile = reading_profile(&conn, active)?;
    let bundle = build(&conn, &profile, cipher.as_ref())?;
    serde_json::to_string_pretty(&bundle).map_err(|e| AddonError::Storage { message: e.to_string() })
}

/// The bundle as text, to copy. It holds no secret by construction (see the module docs).
#[tauri::command]
pub async fn addon_bundle_text(db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<String, AddonError> {
    bundle_text(&db, &active)
}

/// Saves the bundle where the person picks (`orbit-addons.json` in Downloads
/// suggested), like backups; returns the path, or `None` if they cancelled.
#[tauri::command]
pub async fn addon_bundle_save(app: AppHandle, db: State<'_, Db>, active: State<'_, ActiveProfile>) -> Result<Option<String>, AddonError> {
    let text = bundle_text(&db, &active)?;
    let Some(path) = crate::dialog::save_json(&app, "orbit-addons").await else { return Ok(None) };
    std::fs::write(&path, text).map_err(|_| AddonError::Storage { message: "err.file.save".into() })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::KeyInit;
    use rusqlite::{Connection, params};
    use serde_json::json;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_plain_unconfigured_urls_are_exported() {
        let plain = json!({ "id": "a", "name": "A", "version": "1.0.0" });
        assert_eq!(public_url(&url("https://a.example/manifest.json"), &plain).as_deref(), Some("https://a.example/manifest.json"));
        assert_eq!(public_url(&url("https://a.example:8443/manifest.json"), &plain).as_deref(), Some("https://a.example:8443/manifest.json"));

        for configured in [
            "https://a.example/eyJkZWJyaWQiOiJzZWNyZXQifQ/manifest.json",
            "https://a.example/providers=x|realdebrid=SECRET/manifest.json",
            "https://a.example/manifest.json?token=SECRET",
            "https://user:SECRET@a.example/manifest.json",
            "https://a.example/manifest.json#SECRET",
            "http://127.0.0.1:7000/manifest.json",
            "https://192.168.1.5/manifest.json",
        ] {
            assert_eq!(public_url(&url(configured), &plain), None, "{configured}");
        }
        for hints in [json!({ "configurable": true }), json!({ "configurationRequired": true })] {
            let manifest = json!({ "id": "a", "name": "A", "version": "1.0.0", "behaviorHints": hints });
            assert_eq!(public_url(&url("https://a.example/manifest.json"), &manifest), None);
        }
    }

    #[test]
    fn exported_bundles_never_carry_configuration() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&[9u8; 32]).unwrap();
        let add = |key: &str, at: i64, builtin: bool, transport: &str, manifest: Value| {
            let owner = if builtin { None } else { Some("main") };
            let sealed = vault::seal(&cipher, &super::super::aad(key, owner), transport.as_bytes()).unwrap();
            let host = display_host(&url(transport));
            conn.execute(
                "INSERT INTO addons (key, installed_at, display_host, manifest, transport_url, builtin, owner, shared) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                params![key, at, host, manifest.to_string(), sealed, builtin, owner],
            )
            .unwrap();
        };
        let m = |id: &str, hints: Value| json!({ "id": id, "name": format!("Addon {id}"), "version": "1.0.0", "behaviorHints": hints });
        add("cinemeta", 1, true, "https://v3-cinemeta.strem.io/manifest.json", m("cinemeta", json!({})));
        add("plain", 2, false, "https://plain.example/manifest.json", m("plain", json!({})));
        add("path", 3, false, "https://debrid.example/eyJrZXkiOiJTRUNSRVQxIn0/manifest.json", m("path", json!({})));
        add("query", 4, false, "https://q.example/manifest.json?token=SECRET2", m("query", json!({})));
        add("userinfo", 5, false, "https://me:SECRET3@u.example/manifest.json", m("userinfo", json!({})));
        add("hinted", 6, false, "https://hinted.example/manifest.json", m("hinted", json!({ "configurable": true })));
        add("local", 7, false, "http://127.0.0.1:7000/SECRET4/manifest.json", m("local", json!({})));

        let bundle = build(&conn, "main", Some(&cipher)).unwrap();
        let text = serde_json::to_string(&bundle).unwrap();
        for secret in ["SECRET", "eyJ", "token", "me:", "@"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["orbitAddons"], 1);
        let addons = value["addons"].as_array().unwrap();
        // Built-ins are left out; the order is the profile's.
        let ids: Vec<&str> = addons.iter().map(|a| a["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["plain", "path", "query", "userinfo", "hinted", "local"]);
        assert_eq!(addons[0]["url"], "https://plain.example/manifest.json");
        for a in &addons[1..] {
            assert!(a.get("url").is_none(), "{a}");
            assert_eq!(a["needsSetup"], true);
        }
        assert_eq!(addons[1]["host"], "debrid.example");
        assert_eq!(addons[3]["host"], "u.example");
        assert_eq!(addons[5]["host"], "127.0.0.1:7000");

        // Without the data key nothing can be checked, so nothing is exported as installable.
        let locked = serde_json::to_string(&build(&conn, "main", None).unwrap()).unwrap();
        assert!(!locked.contains("\"url\""), "{locked}");
    }
}
