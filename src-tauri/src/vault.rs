//! Encryption for secrets stored in SQLite (see docs/DEVELOPMENT.md → Security Rules).
//!
//! One random AES-256 data key lives in the OS keychain. Sealed values are
//! `nonce (12 bytes) || ciphertext || tag`, and callers pass associated data
//! that names the owning row, so a sealed value copied onto another row fails
//! to open instead of being silently accepted.

use std::sync::Mutex;

use aes_gcm::Aes256Gcm;
use aes_gcm::aead::{Aead, KeyInit, Nonce, Payload};
use zeroize::Zeroize;

use crate::keychain;

pub(crate) const KEY_ENTRY: &str = "data-key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

static CIPHER: Mutex<Option<Aes256Gcm>> = Mutex::new(None);

#[derive(Debug, PartialEq, Eq)]
pub enum VaultError {
    /// The keychain (or the OS RNG) couldn't be used; nothing was changed.
    Unavailable,
    /// Wrong key, wrong row, or tampered/corrupt data.
    Undecryptable,
}

/// Returns the cipher for the data key, creating the key on first use.
pub fn cipher() -> Result<Aes256Gcm, VaultError> {
    // The lock is held across load-or-create so two concurrent first calls
    // can't each generate a key and have one overwrite the other.
    let mut slot = CIPHER.lock().map_err(|_| VaultError::Unavailable)?;
    if let Some(cipher) = slot.as_ref() {
        return Ok(cipher.clone());
    }

    let mut key = match keychain::get_bytes(KEY_ENTRY).map_err(|_| VaultError::Unavailable)? {
        Some(key) => key,
        // Only a confirmed-missing entry creates a key. A locked or unreachable
        // keychain returns `Err` above instead, because generating a new key
        // then would orphan every value sealed under the existing one.
        None => {
            let mut key = vec![0u8; KEY_LEN];
            getrandom::fill(&mut key).map_err(|_| VaultError::Unavailable)?;
            keychain::set_bytes(KEY_ENTRY, &key).map_err(|_| VaultError::Unavailable)?;
            key
        }
    };
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| VaultError::Unavailable);
    key.zeroize();

    let cipher = cipher?;
    *slot = Some(cipher.clone());
    Ok(cipher)
}

pub fn seal(cipher: &Aes256Gcm, aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
    // A fresh random nonce per message: reusing a nonce under the same key
    // breaks GCM's confidentiality and authenticity.
    let mut nonce = Nonce::<Aes256Gcm>::default();
    getrandom::fill(nonce.as_mut_slice()).map_err(|_| VaultError::Unavailable)?;
    let ciphertext = cipher
        .encrypt(&nonce, Payload { msg: plaintext, aad })
        .map_err(|_| VaultError::Unavailable)?;

    let mut sealed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&ciphertext);
    Ok(sealed)
}

pub fn open(cipher: &Aes256Gcm, aad: &[u8], sealed: &[u8]) -> Result<Vec<u8>, VaultError> {
    if sealed.len() < NONCE_LEN {
        return Err(VaultError::Undecryptable);
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    let nonce = Nonce::<Aes256Gcm>::try_from(nonce).map_err(|_| VaultError::Undecryptable)?;
    cipher
        .decrypt(&nonce, Payload { msg: ciphertext, aad })
        .map_err(|_| VaultError::Undecryptable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cipher(byte: u8) -> Aes256Gcm {
        Aes256Gcm::new_from_slice(&[byte; KEY_LEN]).unwrap()
    }

    #[test]
    fn round_trips() {
        let cipher = test_cipher(1);
        let sealed = seal(&cipher, b"row-1", b"https://example.com/manifest.json").unwrap();
        assert_eq!(open(&cipher, b"row-1", &sealed).unwrap(), b"https://example.com/manifest.json");
    }

    #[test]
    fn uses_a_fresh_nonce_each_time() {
        let cipher = test_cipher(1);
        let a = seal(&cipher, b"row", b"same").unwrap();
        let b = seal(&cipher, b"row", b"same").unwrap();
        assert_ne!(a[..NONCE_LEN], b[..NONCE_LEN]);
    }

    #[test]
    fn rejects_other_rows_keys_and_tampering() {
        let cipher = test_cipher(1);
        let sealed = seal(&cipher, b"row-1", b"secret").unwrap();

        assert_eq!(open(&cipher, b"row-2", &sealed), Err(VaultError::Undecryptable));
        assert_eq!(open(&test_cipher(2), b"row-1", &sealed), Err(VaultError::Undecryptable));

        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(open(&cipher, b"row-1", &tampered), Err(VaultError::Undecryptable));
        assert_eq!(open(&cipher, b"row-1", &sealed[..5]), Err(VaultError::Undecryptable));
    }

    #[test]
    fn sealed_values_are_nonce_then_ciphertext_and_tag_with_no_plaintext() {
        let cipher = test_cipher(1);
        let secret = b"https://user:token@debrid.example/manifest.json";
        let sealed = seal(&cipher, b"row", secret).unwrap();
        // 12-byte nonce, the ciphertext (as long as the plaintext), a 16-byte tag.
        assert_eq!(sealed.len(), NONCE_LEN + secret.len() + 16);
        assert!(!sealed.windows(5).any(|w| w == b"token"));
        // Flipping any byte, the nonce's included, makes it unopenable.
        for i in [0, NONCE_LEN - 1, NONCE_LEN, sealed.len() / 2] {
            let mut tampered = sealed.clone();
            tampered[i] ^= 0x80;
            assert_eq!(open(&cipher, b"row", &tampered), Err(VaultError::Undecryptable), "byte {i}");
        }
    }

    #[test]
    fn swapping_two_rows_values_opens_neither() {
        let cipher = test_cipher(3);
        let a = seal(&cipher, b"addon-url:v2:aa:main", b"https://a.example/manifest.json").unwrap();
        let b = seal(&cipher, b"addon-url:v2:bb:kid", b"https://b.example/manifest.json").unwrap();
        assert_eq!(open(&cipher, b"addon-url:v2:aa:main", &b), Err(VaultError::Undecryptable));
        assert_eq!(open(&cipher, b"addon-url:v2:bb:kid", &a), Err(VaultError::Undecryptable));
        // Associated data is compared whole: a prefix or an empty one doesn't do.
        assert_eq!(open(&cipher, b"addon-url:v2:aa:", &a), Err(VaultError::Undecryptable));
        assert_eq!(open(&cipher, b"", &a), Err(VaultError::Undecryptable));
    }

    #[test]
    fn empty_values_round_trip_and_bare_nonces_do_not_open() {
        let cipher = test_cipher(1);
        let sealed = seal(&cipher, b"row", b"").unwrap();
        assert_eq!(sealed.len(), NONCE_LEN + 16);
        assert_eq!(open(&cipher, b"row", &sealed).unwrap(), b"");
        // Just a nonce (no tag), or nothing at all, is corrupt rather than empty.
        assert_eq!(open(&cipher, b"row", &sealed[..NONCE_LEN]), Err(VaultError::Undecryptable));
        assert_eq!(open(&cipher, b"row", &[]), Err(VaultError::Undecryptable));
    }

    #[test]
    fn nonces_do_not_repeat_across_many_seals() {
        let cipher = test_cipher(1);
        let nonces: std::collections::HashSet<Vec<u8>> = (0..2000).map(|_| seal(&cipher, b"row", b"x").unwrap()[..NONCE_LEN].to_vec()).collect();
        assert_eq!(nonces.len(), 2000);
    }
}
