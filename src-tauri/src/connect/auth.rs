//! Orbit Connect's cryptography and the checks every request passes.
//!
//! Pairing is numeric comparison, as Bluetooth pairs: no secret is typed, so
//! nothing a device sends while pairing can be tried offline. Each device has a
//! long-term X25519 key (its identity, kept in the keychain) and makes a fresh
//! one for each pairing. The sender (S) and the receiver (R, which chose "Pair a
//! device") exchange both public keys, then:
//!
//! 1. R answers S's keys with its own and a commitment to a random nonce `Nr`
//!    (`commit`: an HMAC keyed by `Nr` over the transcript: both ids, both
//!    long-term keys, both fresh keys).
//! 2. S sends its random nonce `Ns`; only then does R reveal `Nr`, which S
//!    checks against the commitment.
//! 3. Both show a 6-digit number made from the transcript and both nonces
//!    (`sas`). The person confirms on both devices that they match.
//! 4. Each proves it derived the same secret (`confirm_proof`); R keeps the
//!    pair once its person has confirmed and S's proof checks out, S once R's
//!    proof does.
//!
//! The secret is HKDF over both X25519 results, fresh-fresh (so a later leak of
//! a long-term key doesn't open past pairings) and long-term-long-term (so only
//! the holder of the long-term key a device presented can complete), bound to
//! the transcript and both nonces. Someone in between has to run a key
//! exchange with each side, and the two numbers then match only by chance: R
//! commits to `Nr` before seeing `Ns`, and S reveals `Ns` before seeing `Nr`,
//! so neither end of an attacker can choose its keys or nonce to make them
//! match. One try in a million, with the person watching both screens.
//!
//! Each device keeps the other's long-term key with the pair and holds to it
//! (`devices.rs`): a device announcing a paired id with another key isn't that
//! device, and pairing again under that id with another key is refused.
//!
//! After pairing, every request carries an HMAC-SHA256 over its method, path,
//! both device ids, a timestamp, a random nonce and its body, so a request
//! can't be forged, altered, sent to another device or replayed (`Replay`).
//! Answers are signed too, so a device on the network can't pose as a paired
//! one and feed back a made-up state.
//!
//! aws-lc-rs is already built into Orbit (rustls and the torrent engine use it),
//! so this needs no new cryptography crate.

use std::collections::HashMap;
use std::time::Instant;

use aws_lc_rs::{agreement, hkdf, hmac};

/// Device ids: 16 random bytes, as lowercase hex. Never derived from anything about the device or person.
pub const ID_HEX: usize = 32;
/// A request's nonce: 16 random bytes, as hex.
pub const NONCE_HEX: usize = 32;
/// An HMAC-SHA256 tag, as hex.
pub const TAG_HEX: usize = 64;
/// An X25519 public key, as hex.
pub const KEY_HEX: usize = 64;
/// A pair's shared secret.
pub const SECRET_BYTES: usize = 32;
/// How far a request's clock may be from this device's, in seconds. Devices on
/// a home network keep network time; a minute leaves room for one that drifts.
pub const MAX_SKEW_SECS: u64 = 60;
/// Nonces remembered at once, across every paired device. Each is kept only
/// while its timestamp could still pass (two minutes), and the rate limit
/// holds a device far below this; past it, requests are refused, not let through.
const MAX_NONCES: usize = 8192;
/// Requests a paired device may send in a burst, then per second: far more
/// than pressing buttons makes, few enough that a misbehaving one can't flood Orbit.
const BURST: f64 = 30.0;
const PER_SECOND: f64 = 10.0;

/// A pairing nonce: 32 random bytes, as hex.
pub const PAIR_NONCE_HEX: usize = 64;

/// Versions every signed message, so one kind of message can never pass for another.
/// 2: numeric-comparison pairing with long-term keys (1 paired with a typed code).
const PROTOCOL: &str = "orbit-connect/2";

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Lowercase hex only, of exactly `len` characters.
pub fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !is_hex(s, s.len()) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

pub fn is_id(s: &str) -> bool {
    is_hex(s, ID_HEX)
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|_| "no randomness available".to_string())?;
    Ok(hex(&buf))
}

/// A new device id (see `ID_HEX`).
pub fn random_id() -> Result<String, String> {
    random_hex(ID_HEX / 2)
}

pub fn random_nonce() -> Result<String, String> {
    random_hex(NONCE_HEX / 2)
}

fn tag(key: &[u8], message: &[u8]) -> String {
    hex(hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), message).as_ref())
}

/// Checks a hex tag in constant time (aws-lc-rs compares it), so how long the
/// answer takes says nothing about how much of a forged tag was right.
fn tag_ok(key: &[u8], message: &[u8], tag_hex: &str) -> bool {
    if !is_hex(tag_hex, TAG_HEX) {
        return false;
    }
    unhex(tag_hex).is_some_and(|tag| hmac::verify(&hmac::Key::new(hmac::HMAC_SHA256, key), message, &tag).is_ok())
}

/// What a request's signature covers.
pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    /// The receiving device's id: a request meant for one device can't be replayed to another.
    pub to: &'a str,
    pub from: &'a str,
    /// Seconds since 1970, by the sender's clock.
    pub time: u64,
    pub nonce: &'a str,
    pub body: &'a [u8],
}

impl Request<'_> {
    fn message(&self) -> Vec<u8> {
        // Each field is fixed in shape (no newline can appear in one), and the body comes last.
        let head = format!("{PROTOCOL}\nrequest\n{}\n{}\n{}\n{}\n{}\n{}\n", self.method, self.path, self.to, self.from, self.time, self.nonce);
        [head.as_bytes(), self.body].concat()
    }

    pub fn sign(&self, secret: &[u8]) -> String {
        tag(secret, &self.message())
    }

    pub fn verify(&self, secret: &[u8], signature: &str) -> bool {
        tag_ok(secret, &self.message(), signature)
    }
}

/// An answer's signature: over the request's nonce (so it answers that request
/// and no other), its status and its body.
fn reply_message(nonce: &str, status: u16, body: &[u8]) -> Vec<u8> {
    [format!("{PROTOCOL}\nreply\n{nonce}\n{status}\n").as_bytes(), body].concat()
}

pub fn sign_reply(secret: &[u8], nonce: &str, status: u16, body: &[u8]) -> String {
    tag(secret, &reply_message(nonce, status, body))
}

pub fn verify_reply(secret: &[u8], nonce: &str, status: u16, body: &[u8], signature: &str) -> bool {
    tag_ok(secret, &reply_message(nonce, status, body), signature)
}

/// Why a signed request was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    /// Its time is too far from this device's clock.
    Stale,
    /// Seen before: a copy of an earlier request.
    Replayed,
    /// Too many nonces remembered (see `MAX_NONCES`).
    Busy,
}

/// The nonces of recent requests, per device, so each request is accepted once.
/// A request's timestamp must be within `MAX_SKEW_SECS`, so a nonce only has
/// to be remembered while a copy could still pass that check.
#[derive(Default)]
pub struct Replay {
    seen: HashMap<(String, String), u64>,
}

impl Replay {
    /// Whether `nonce` from `from` may pass: within the clock window, not seen before, and with room
    /// to remember it. Nothing is remembered until `remember`, so a request refused for another
    /// reason (too fast) takes no room and can be sent again.
    pub fn check(&mut self, from: &str, nonce: &str, time: u64, now: u64) -> Result<(), Rejected> {
        if time.abs_diff(now) > MAX_SKEW_SECS {
            return Err(Rejected::Stale);
        }
        // A nonce whose time is past the window can't pass again: forgotten.
        self.seen.retain(|_, t| t.saturating_add(MAX_SKEW_SECS) >= now);
        if self.seen.contains_key(&(from.to_owned(), nonce.to_owned())) {
            return Err(Rejected::Replayed);
        }
        if self.seen.len() >= MAX_NONCES {
            return Err(Rejected::Busy);
        }
        Ok(())
    }

    /// Keeps a checked request's nonce, so it's accepted once. Only call it for a request whose
    /// signature checked out and that is let through, so made-up or refused requests can't fill the list.
    pub fn remember(&mut self, from: &str, nonce: &str, time: u64) {
        self.seen.insert((from.to_owned(), nonce.to_owned()), time);
    }

    /// `check`, then `remember` if it passes.
    #[cfg(test)]
    fn accept(&mut self, from: &str, nonce: &str, time: u64, now: u64) -> Result<(), Rejected> {
        self.check(from, nonce, time, now)?;
        self.remember(from, nonce, time);
        Ok(())
    }

    /// A device that's no longer paired.
    pub fn forget(&mut self, from: &str) {
        self.seen.retain(|(f, _), _| f != from);
    }
}

/// Each paired device's request rate: a burst, then a steady rate (a token bucket).
#[derive(Default)]
pub struct Rate {
    buckets: HashMap<String, (f64, Instant)>,
}

impl Rate {
    pub fn allow(&mut self, from: &str, now: Instant) -> bool {
        let (left, at) = self.buckets.entry(from.to_owned()).or_insert((BURST, now));
        *left = (*left + now.saturating_duration_since(*at).as_secs_f64() * PER_SECOND).min(BURST);
        *at = now;
        if *left < 1.0 {
            return false;
        }
        *left -= 1.0;
        true
    }

    pub fn forget(&mut self, from: &str) {
        self.buckets.remove(from);
    }
}

/// An X25519 key: a device's long-term one (its identity, `connect-key` in the
/// keychain) or the fresh one each side makes for one pairing.
pub struct Key {
    private: agreement::PrivateKey,
    /// The public key, as hex.
    pub public: String,
}

impl Key {
    pub fn generate() -> Result<Self, String> {
        Self::from_private(agreement::PrivateKey::generate(&agreement::X25519).map_err(|_| "couldn’t make a key")?)
    }

    /// The long-term key kept as `seed` (see `seed`).
    pub fn from_seed(seed: &[u8]) -> Result<Self, String> {
        Self::from_private(agreement::PrivateKey::from_private_key(&agreement::X25519, seed).map_err(|_| "invalid key")?)
    }

    fn from_private(private: agreement::PrivateKey) -> Result<Self, String> {
        let public = hex(private.compute_public_key().map_err(|_| "couldn’t make a key")?.as_ref());
        Ok(Self { private, public })
    }

    /// The private key's 32 bytes, to keep in the keychain.
    pub fn seed(&self) -> Result<zeroize::Zeroizing<Vec<u8>>, String> {
        use aws_lc_rs::encoding::{AsBigEndian, Curve25519SeedBin};
        let seed: Curve25519SeedBin<'_> = self.private.as_be_bytes().map_err(|_| "couldn’t read the key")?;
        Ok(zeroize::Zeroizing::new(seed.as_ref().to_vec()))
    }

    /// X25519 with another device's public key (hex).
    fn agree(&self, theirs: &str) -> Result<zeroize::Zeroizing<Vec<u8>>, String> {
        let theirs = Some(theirs).filter(|k| is_hex(k, KEY_HEX)).and_then(unhex).ok_or("invalid key")?;
        let peer = agreement::UnparsedPublicKey::new(&agreement::X25519, theirs);
        agreement::agree(&self.private, &peer, "invalid key".to_string(), |shared| Ok(zeroize::Zeroizing::new(shared.to_vec())))
    }
}

/// Everything both devices said while pairing, before the nonces: what the
/// commitment, the number shown and the secret are all bound to, so changing
/// any of it in transit gives each side something different.
pub struct Transcript<'a> {
    /// The device that chose the other one in its list.
    pub sender: &'a str,
    /// The device that chose "Pair a device".
    pub receiver: &'a str,
    /// Long-term keys.
    pub sender_key: &'a str,
    pub receiver_key: &'a str,
    /// Fresh keys, for this pairing only.
    pub sender_fresh: &'a str,
    pub receiver_fresh: &'a str,
}

impl Transcript<'_> {
    fn bytes(&self, purpose: &str) -> Vec<u8> {
        // Every field is fixed in shape (hex, no newline).
        format!("{PROTOCOL}\npair-{purpose}\n{}\n{}\n{}\n{}\n{}\n{}", self.sender, self.receiver, self.sender_key, self.receiver_key, self.sender_fresh, self.receiver_fresh).into_bytes()
    }
}

/// A new pairing nonce (`PAIR_NONCE_HEX`).
pub fn pair_nonce() -> Result<String, String> {
    random_hex(PAIR_NONCE_HEX / 2)
}

pub fn is_pair_nonce(s: &str) -> bool {
    is_hex(s, PAIR_NONCE_HEX)
}

/// The receiver's commitment to its nonce: an HMAC keyed by the nonce (32 random bytes, so it hides
/// it) over the transcript (so it's bound to this pairing). Sent before the sender reveals its own.
pub fn commit(nonce: &str, transcript: &Transcript<'_>) -> Result<String, String> {
    let key = Some(nonce).filter(|n| is_pair_nonce(n)).and_then(unhex).ok_or("invalid nonce")?;
    Ok(tag(&key, &transcript.bytes("commit")))
}

/// Whether a revealed nonce is the one committed to, for this transcript (in constant time).
pub fn commit_ok(nonce: &str, transcript: &Transcript<'_>, commitment: &str) -> bool {
    Some(nonce).filter(|n| is_pair_nonce(n)).and_then(unhex).is_some_and(|key| tag_ok(&key, &transcript.bytes("commit"), commitment))
}

fn nonces(sender_nonce: &str, receiver_nonce: &str) -> Option<Vec<u8>> {
    if !is_pair_nonce(sender_nonce) || !is_pair_nonce(receiver_nonce) {
        return None;
    }
    Some([unhex(sender_nonce)?, unhex(receiver_nonce)?].concat())
}

/// The 6-digit number both devices show: from the transcript and both nonces, so neither side alone chose it.
pub fn sas(transcript: &Transcript<'_>, sender_nonce: &str, receiver_nonce: &str) -> Option<String> {
    let key = nonces(sender_nonce, receiver_nonce)?;
    let mac = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, &key), &transcript.bytes("sas"));
    let n = u32::from_be_bytes(mac.as_ref()[..4].try_into().ok()?);
    Some(format!("{:06}", n % 1_000_000))
}

/// The pair's secret: HKDF-SHA256 over both X25519 results (fresh with fresh, long-term with
/// long-term), bound to the transcript and both nonces. `mine`/`my_fresh` are this device's keys;
/// `theirs`/`their_fresh` the other's public ones.
pub fn pair_secret(mine: &Key, my_fresh: &Key, theirs: &str, their_fresh: &str, transcript: &Transcript<'_>, sender_nonce: &str, receiver_nonce: &str) -> Result<[u8; SECRET_BYTES], String> {
    let fresh = my_fresh.agree(their_fresh)?;
    let lasting = mine.agree(theirs)?;
    let nonces = nonces(sender_nonce, receiver_nonce).ok_or("invalid nonce")?;
    let ikm = zeroize::Zeroizing::new([&fresh[..], &lasting[..]].concat());
    let info = [&transcript.bytes("secret")[..], &nonces[..]].concat();
    let mut out = [0u8; SECRET_BYTES];
    hkdf::Salt::new(hkdf::HKDF_SHA256, PROTOCOL.as_bytes())
        .extract(&ikm)
        .expand(&[&info], hkdf::HKDF_SHA256)
        .and_then(|okm| okm.fill(&mut out))
        .map_err(|_| "invalid key".to_string())?;
    Ok(out)
}

fn confirm_message(sender: bool) -> String {
    format!("{PROTOCOL}\nconfirm\n{}", if sender { "sender" } else { "receiver" })
}

/// A side's proof that it derived the pair's secret (and, for the sender, that its person confirmed).
pub fn confirm_proof(secret: &[u8], sender: bool) -> String {
    tag(secret, confirm_message(sender).as_bytes())
}

pub fn confirm_ok(secret: &[u8], sender: bool, proof: &str) -> bool {
    tag_ok(secret, confirm_message(sender).as_bytes(), proof)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const A: &str = "0123456789abcdef0123456789abcdef";
    const B: &str = "fedcba9876543210fedcba9876543210";

    fn request<'a>(body: &'a [u8], nonce: &'a str, time: u64) -> Request<'a> {
        Request { method: "POST", path: "/v1/play", to: B, from: A, time, nonce, body }
    }

    /// One device's side of a pairing: its long-term and fresh keys.
    struct Side {
        id: &'static str,
        key: Key,
        fresh: Key,
    }

    fn side(id: &'static str) -> Side {
        Side { id, key: Key::generate().unwrap(), fresh: Key::generate().unwrap() }
    }

    /// The transcript as `s` (sender) and `r` (receiver) see it: `s_sees` is the receiver S talked to.
    fn transcript<'a>(s: &'a Side, r: &'a Side) -> Transcript<'a> {
        Transcript { sender: s.id, receiver: r.id, sender_key: &s.key.public, receiver_key: &r.key.public, sender_fresh: &s.fresh.public, receiver_fresh: &r.fresh.public }
    }

    /// What each side derives (secret, number) after an honest exchange.
    fn honest(s: &Side, r: &Side, ns: &str, nr: &str) -> (([u8; SECRET_BYTES], String), ([u8; SECRET_BYTES], String)) {
        let t = transcript(s, r);
        let on_s = (pair_secret(&s.key, &s.fresh, &r.key.public, &r.fresh.public, &t, ns, nr).unwrap(), sas(&t, ns, nr).unwrap());
        let on_r = (pair_secret(&r.key, &r.fresh, &s.key.public, &s.fresh.public, &t, ns, nr).unwrap(), sas(&t, ns, nr).unwrap());
        (on_s, on_r)
    }

    #[test]
    fn both_sides_agree_on_the_secret_and_the_number() {
        let (s, r) = (side(A), side(B));
        let (ns, nr) = (pair_nonce().unwrap(), pair_nonce().unwrap());
        let (on_s, on_r) = honest(&s, &r, &ns, &nr);
        assert_eq!(on_s, on_r);
        assert_ne!(on_s.0, [0u8; SECRET_BYTES]);
        assert!(on_s.1.len() == 6 && on_s.1.bytes().all(|b| b.is_ascii_digit()));
        // Each side's proof checks out on the other, and isn't the other's.
        assert!(confirm_ok(&on_r.0, true, &confirm_proof(&on_s.0, true)));
        assert!(confirm_ok(&on_s.0, false, &confirm_proof(&on_r.0, false)));
        assert!(!confirm_ok(&on_s.0, false, &confirm_proof(&on_r.0, true)));
        // A new pairing of the same two devices has another secret.
        let (again, _) = honest(&s, &r, &pair_nonce().unwrap(), &pair_nonce().unwrap());
        assert_ne!(again.0, on_s.0);
    }

    #[test]
    fn everything_is_bound_to_the_transcript() {
        let (s, r) = (side(A), side(B));
        let (ns, nr) = (pair_nonce().unwrap(), pair_nonce().unwrap());
        let t = transcript(&s, &r);
        let commitment = commit(&nr, &t).unwrap();
        let other_key = Key::generate().unwrap();
        // Any field changed: another commitment, number and secret.
        for changed in [
            Transcript { sender: "11111111111111111111111111111111", ..transcript(&s, &r) },
            Transcript { receiver: "11111111111111111111111111111111", ..transcript(&s, &r) },
            Transcript { sender_key: &other_key.public, ..transcript(&s, &r) },
            Transcript { receiver_key: &other_key.public, ..transcript(&s, &r) },
            Transcript { sender_fresh: &other_key.public, ..transcript(&s, &r) },
            Transcript { receiver_fresh: &other_key.public, ..transcript(&s, &r) },
        ] {
            assert!(!commit_ok(&nr, &changed, &commitment));
            // (Equal by chance one time in a million.)
            assert_ne!(sas(&changed, &ns, &nr), sas(&t, &ns, &nr));
            assert_ne!(pair_secret(&s.key, &s.fresh, &r.key.public, &r.fresh.public, &changed, &ns, &nr).unwrap(), pair_secret(&s.key, &s.fresh, &r.key.public, &r.fresh.public, &t, &ns, &nr).unwrap());
        }
        // Another nonce: another secret.
        assert_ne!(
            pair_secret(&s.key, &s.fresh, &r.key.public, &r.fresh.public, &t, &pair_nonce().unwrap(), &nr).unwrap(),
            pair_secret(&s.key, &s.fresh, &r.key.public, &r.fresh.public, &t, &ns, &nr).unwrap()
        );
    }

    #[test]
    fn a_commitment_holds_only_its_own_nonce() {
        let (s, r) = (side(A), side(B));
        let t = transcript(&s, &r);
        let nr = pair_nonce().unwrap();
        let commitment = commit(&nr, &t).unwrap();
        assert!(commit_ok(&nr, &t, &commitment));
        assert!(!commit_ok(&pair_nonce().unwrap(), &t, &commitment));
        assert!(!commit_ok(&nr, &t, &commitment.to_uppercase()));
        assert!(!commit_ok("00", &t, &commitment));
        assert!(commit("00", &t).is_err());
        // It says nothing about the nonce: another nonce, an unrelated commitment.
        assert_ne!(commit(&pair_nonce().unwrap(), &t).unwrap(), commitment);
    }

    #[test]
    fn someone_in_between_gets_two_different_numbers() {
        // M runs one exchange with S (posing as R) and another with R (posing as S). It must commit
        // to S before seeing S's nonce, and reveal its nonce to R before seeing R's: the numbers then
        // match only by chance, one in a million. Here it simply picks fresh values on each side.
        let (s, r, m) = (side(A), side(B), side(B));
        let m_as_s = Side { id: A, key: Key::generate().unwrap(), fresh: Key::generate().unwrap() };
        let (ns, nr, nm1, nm2) = (pair_nonce().unwrap(), pair_nonce().unwrap(), pair_nonce().unwrap(), pair_nonce().unwrap());
        let ((on_s, _), _) = honest(&s, &m, &ns, &nm1);
        let (_, (on_r, _)) = honest(&m_as_s, &r, &nm2, &nr);
        let (s_sas, r_sas) = (sas(&transcript(&s, &m), &ns, &nm1).unwrap(), sas(&transcript(&m_as_s, &r), &nm2, &nr).unwrap());
        assert_ne!(on_s, on_r);
        assert!(!confirm_ok(&on_r, true, &confirm_proof(&on_s, true)));
        // The numbers: different with overwhelming likelihood (equal one time in a million).
        if s_sas == r_sas {
            eprintln!("numbers matched by chance");
        }
        // Without R's long-term private key, M posing as R under R's key can't reach R's secret.
        let fake = Side { id: B, key: Key::generate().unwrap(), fresh: Key::generate().unwrap() };
        let t = Transcript { receiver_key: &r.key.public, ..transcript(&s, &fake) };
        let on_s = pair_secret(&s.key, &s.fresh, &r.key.public, &fake.fresh.public, &t, &ns, &nr).unwrap();
        let on_fake = pair_secret(&fake.key, &fake.fresh, &s.key.public, &s.fresh.public, &t, &ns, &nr).unwrap();
        assert_ne!(on_s, on_fake);
    }

    #[test]
    fn a_long_term_key_survives_the_keychain() {
        let key = Key::generate().unwrap();
        let back = Key::from_seed(&key.seed().unwrap()).unwrap();
        assert_eq!(back.public, key.public);
        assert!(Key::from_seed(&[1u8; 5]).is_err());
        assert!(key.agree("zz").is_err());
    }

    #[test]
    fn signed_requests_verify_and_any_change_breaks_them() {
        let secret = [7u8; SECRET_BYTES];
        let nonce = "00112233445566778899aabbccddeeff";
        let signed = request(br#"{"cmd":"stop"}"#, nonce, 1000);
        let signature = signed.sign(&secret);
        assert!(signed.verify(&secret, &signature));
        assert!(!signed.verify(&[8u8; SECRET_BYTES], &signature));
        assert!(!request(br#"{"cmd":"next"}"#, nonce, 1000).verify(&secret, &signature));
        assert!(!request(br#"{"cmd":"stop"}"#, nonce, 1001).verify(&secret, &signature));
        assert!(!request(br#"{"cmd":"stop"}"#, "ffeeddccbbaa99887766554433221100", 1000).verify(&secret, &signature));
        let other_path = Request { path: "/v1/control", ..request(br#"{"cmd":"stop"}"#, nonce, 1000) };
        assert!(!other_path.verify(&secret, &signature));
        let other_device = Request { to: A, ..request(br#"{"cmd":"stop"}"#, nonce, 1000) };
        assert!(!other_device.verify(&secret, &signature));
        // Not a tag at all.
        assert!(!signed.verify(&secret, ""));
        assert!(!signed.verify(&secret, &signature.to_uppercase()));
        assert!(!signed.verify(&secret, &signature[..62]));
    }

    #[test]
    fn replies_are_tied_to_their_request() {
        let secret = [9u8; SECRET_BYTES];
        let signature = sign_reply(&secret, "aa", 200, b"{}");
        assert!(verify_reply(&secret, "aa", 200, b"{}", &signature));
        assert!(!verify_reply(&secret, "bb", 200, b"{}", &signature));
        assert!(!verify_reply(&secret, "aa", 409, b"{}", &signature));
        assert!(!verify_reply(&secret, "aa", 200, b"{ }", &signature));
    }

    #[test]
    fn a_request_is_accepted_once() {
        let mut replay = Replay::default();
        let nonce = "00112233445566778899aabbccddeeff";
        assert_eq!(replay.accept(A, nonce, 1000, 1000), Ok(()));
        assert_eq!(replay.accept(A, nonce, 1000, 1001), Err(Rejected::Replayed));
        // The same nonce from another device is another request.
        assert_eq!(replay.accept(B, nonce, 1000, 1001), Ok(()));
        // Once its time is past the window, it would be refused as stale anyway.
        assert_eq!(replay.accept(A, nonce, 1000, 1000 + MAX_SKEW_SECS + 1), Err(Rejected::Stale));
        replay.forget(A);
        assert_eq!(replay.accept(A, nonce, 1000, 1000), Ok(()));
    }

    #[test]
    fn requests_outside_the_clock_window_are_refused() {
        let mut replay = Replay::default();
        let nonce = "00112233445566778899aabbccddeeff";
        assert_eq!(replay.accept(A, nonce, 1000 - MAX_SKEW_SECS - 1, 1000), Err(Rejected::Stale));
        assert_eq!(replay.accept(A, nonce, 1000 + MAX_SKEW_SECS + 1, 1000), Err(Rejected::Stale));
        assert_eq!(replay.accept(A, nonce, 1000 + MAX_SKEW_SECS, 1000), Ok(()));
    }

    #[test]
    fn a_full_nonce_list_refuses_rather_than_forgets() {
        let mut replay = Replay::default();
        for n in 0..MAX_NONCES {
            replay.accept(A, &format!("{n:032x}"), 1000, 1000).unwrap();
        }
        assert_eq!(replay.accept(A, &format!("{:032x}", MAX_NONCES), 1000, 1000), Err(Rejected::Busy));
        // Once those are too old to pass, there's room again.
        assert_eq!(replay.accept(A, &format!("{:032x}", MAX_NONCES), 1000 + MAX_SKEW_SECS + 1, 1000 + MAX_SKEW_SECS + 1), Ok(()));
    }

    #[test]
    fn requests_are_rate_limited_per_device() {
        let mut rate = Rate::default();
        let now = Instant::now();
        assert_eq!((0..100).filter(|_| rate.allow(A, now)).count(), BURST as usize);
        assert!(rate.allow(B, now));
        let later = now + Duration::from_secs(1);
        assert_eq!((0..100).filter(|_| rate.allow(A, later)).count(), PER_SECOND as usize);
    }

    #[test]
    fn ids_and_nonces_are_random_hex() {
        let id = random_id().unwrap();
        assert!(is_id(&id));
        assert_ne!(id, random_id().unwrap());
        assert!(is_hex(&random_nonce().unwrap(), NONCE_HEX));
        assert!(!is_id("0123456789ABCDEF0123456789ABCDEF"));
        assert!(!is_id("0123"));
        assert_eq!(unhex("0aff"), Some(vec![10, 255]));
        assert_eq!(unhex("0af"), None);
    }
}
