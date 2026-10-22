//! OS keychain wrapper (Credential Manager / Keychain / Secret Service; on Android, a Keystore-sealed store).
//!
//! The WebView has no command here at all. Every secret is written by the Rust
//! feature that owns it (after checking it, e.g. once TMDB or a debrid provider
//! accepted a key) and read back only in Rust, so a script injection in the UI
//! can't exfiltrate stored keys or tokens. Generic `secret_set`/`secret_delete`/
//! `secret_exists` commands used to exist but nothing on the page called them;
//! they were removed because they let a compromised page write unlimited
//! keychain entries under any unreserved name (filling or polluting the OS
//! store) for no feature's benefit.

use crate::check_name;

/// The OS keychain on desktop.
#[cfg(not(target_os = "android"))]
mod backend {
    use keyring::{Entry, Error};

    const SERVICE: &str = "io.github.fusnk.orbit";

    fn entry(name: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, name).map_err(describe)
    }

    /// Some keyring errors carry the secret's bytes (e.g. `BadEncoding`), so errors
    /// are reduced to a fixed message and never formatted with `{:?}` or `{}`.
    fn describe(err: Error) -> String {
        match err {
            Error::TooLong(..) => "err.keychain.too-long".into(),
            Error::NoDefaultStore => "err.keychain.unavailable".into(),
            _ => "err.keychain.failed".into(),
        }
    }

    pub fn get(name: &str) -> Result<Option<String>, String> {
        match entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(err) => Err(describe(err)),
        }
    }

    pub fn get_bytes(name: &str) -> Result<Option<Vec<u8>>, String> {
        match entry(name)?.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(err) => Err(describe(err)),
        }
    }

    pub fn set_bytes(name: &str, value: &[u8]) -> Result<(), String> {
        entry(name)?.set_secret(value).map_err(describe)
    }

    pub fn set(name: &str, value: &str) -> Result<(), String> {
        entry(name)?.set_password(value).map_err(describe)
    }

    pub fn delete(name: &str) -> Result<(), String> {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(err) => Err(describe(err)),
        }
    }
}

/// Android has no OS keychain for apps: secrets are sealed under an Android Keystore key instead.
#[cfg(target_os = "android")]
#[path = "android/secure_store.rs"]
mod backend;

#[cfg(target_os = "android")]
pub use backend::plugin as android_plugin;

/// Rust-side read used by native features that need a secret.
pub fn get(name: &str) -> Result<Option<String>, String> {
    check_name(name)?;
    backend::get(name)
}

/// Rust-side binary read. `Ok(None)` means the entry is confirmed missing, which
/// callers must distinguish from an unavailable keychain (`Err`).
pub fn get_bytes(name: &str) -> Result<Option<Vec<u8>>, String> {
    check_name(name)?;
    backend::get_bytes(name)
}

pub fn set_bytes(name: &str, value: &[u8]) -> Result<(), String> {
    check_name(name)?;
    backend::set_bytes(name, value)
}

/// Rust-side write of a small text secret.
pub fn set(name: &str, value: &str) -> Result<(), String> {
    check_name(name)?;
    backend::set(name, value)
}

/// Removes a secret; a missing one counts as removed.
pub fn delete(name: &str) -> Result<(), String> {
    check_name(name)?;
    backend::delete(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names_are_short_lowercase_and_plain() {
        assert!(check_name("profile-pin.main").is_ok() && check_name("data-key").is_ok() && check_name(&"a".repeat(64)).is_ok());
        for bad in ["", &"a".repeat(65), "Data-Key", "a b", "a/b", "a\\b", "a:b", "a\0b", "a\nb", "é", "key*"] {
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
    }

    /// Every entry point refuses a bad name itself, before the OS store is
    /// asked anything (so this test never touches the real keychain).
    #[test]
    fn bad_names_never_reach_the_os_store() {
        for bad in ["", "Bad Name", "../data-key", "x\u{0}"] {
            assert_eq!(get(bad), Err("invalid name".into()), "{bad:?}");
            assert_eq!(get_bytes(bad), Err("invalid name".into()), "{bad:?}");
            assert_eq!(set(bad, "v"), Err("invalid name".into()), "{bad:?}");
            assert_eq!(set_bytes(bad, b"v"), Err("invalid name".into()), "{bad:?}");
            assert_eq!(delete(bad), Err("invalid name".into()), "{bad:?}");
        }
    }
}
