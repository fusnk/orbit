//! The receiving side of pairing (auth.rs has the protocol): whether this
//! device is open to pairing (Settings → General → Orbit Connect → Pair a
//! device), for how long, and the one pairing under way with another device.
//!
//! Nothing is guessed any more, so there are no wrong codes to count; what's
//! bounded instead is how many pairings may be started while it's open
//! (`MAX_FAILURES`), so a device on the network can't keep putting new numbers
//! on screen. A person saying the numbers don't match closes pairing: something
//! answered that shouldn't have, so it waits until the person opens it again.

use std::time::{Duration, Instant};

use zeroize::Zeroizing;

use super::Secret;
use super::auth::{self, Key, Transcript};
use super::wire::{Hello, Kind, PairCommit, PairStart};
pub use crate::remote::guard::PairError;
use crate::remote::guard::{MAX_FAILURES, PAIRING_WINDOW};

/// Devices paired at once. A household has a few; a cap bounds what a leak could add.
pub const MAX_PEERS: usize = 8;
/// How long one pairing may take, from the first message to both people confirming.
pub const SESSION_TIME: Duration = Duration::from_secs(2 * 60);

/// A pairing under way, as the device showing "Pair a device" sees it.
pub struct Incoming {
    pub from: String,
    pub name: String,
    pub kind: Kind,
    /// The sender's long-term and fresh public keys.
    pub key: String,
    fresh: String,
    my_fresh: Key,
    my_nonce: String,
    /// Once the sender's nonce is in: the pair's secret and the number shown.
    agreed: Option<(Secret, String)>,
    /// The person here said the numbers match.
    pub confirmed: bool,
    started: Instant,
}

impl Incoming {
    pub fn sas(&self) -> Option<&str> {
        self.agreed.as_ref().map(|(_, sas)| sas.as_str())
    }
}

/// How the sender's confirmation went.
pub enum Confirmed {
    /// The person here hasn't answered yet: ask again.
    Waiting,
    /// Both confirmed: the pair is made. The sender, its secret, and this side's proof.
    Paired(Box<Incoming>, Secret, String),
}

#[derive(Default)]
pub struct PairWindow {
    open: Option<Instant>,
    /// Pairings started since it opened.
    started: u32,
    locked: bool,
    incoming: Option<Incoming>,
}

impl PairWindow {
    /// Opens pairing; anything under way stops. Ends a lockout: the person chose to pair.
    pub fn open(&mut self, now: Instant) {
        *self = Self { open: Some(now), ..Self::default() };
    }

    pub fn close(&mut self) {
        self.open = None;
        self.incoming = None;
    }

    fn expire(&mut self, now: Instant) {
        // No new pairing starts once the window is over, but one under way may finish (within `SESSION_TIME`):
        // dropping it would end a comparison the person may be in the middle of.
        if self.open.is_some_and(|at| now.saturating_duration_since(at) >= PAIRING_WINDOW) {
            self.open = None;
        }
        if self.incoming.as_ref().is_some_and(|i| now.saturating_duration_since(i.started) >= SESSION_TIME) {
            self.incoming = None;
        }
    }

    /// How long pairing stays open, while it is.
    pub fn remaining(&mut self, now: Instant) -> Option<Duration> {
        self.expire(now);
        self.open.map(|at| PAIRING_WINDOW.saturating_sub(now.saturating_duration_since(at)))
    }

    pub fn locked(&self) -> bool {
        self.locked
    }

    /// The pairing under way, once its number is known (for the person here to compare).
    pub fn incoming(&mut self, now: Instant) -> Option<&Incoming> {
        self.expire(now);
        self.incoming.as_ref().filter(|i| i.agreed.is_some())
    }

    /// A sender's first message: answered with this device's keys and its commitment.
    /// `me`/`key` are who this device is and its long-term key. One pairing at a time: a new one replaces
    /// one under way (so a stuck one never blocks), up to `MAX_FAILURES` per opening.
    pub fn start(&mut self, now: Instant, offer: &PairStart, name: String, me: &Hello, key: &Key) -> Result<PairCommit, PairError> {
        self.expire(now);
        if self.locked {
            return Err(PairError::Locked);
        }
        if self.open.is_none() {
            return Err(PairError::Closed);
        }
        self.started += 1;
        if self.started > MAX_FAILURES {
            self.locked = true;
            self.close();
            return Err(PairError::Locked);
        }
        let fail = |_| PairError::Closed;
        let my_fresh = Key::generate().map_err(fail)?;
        let my_nonce = auth::pair_nonce().map_err(fail)?;
        let transcript = Transcript { sender: &offer.id, receiver: &me.id, sender_key: &offer.key, receiver_key: &key.public, sender_fresh: &offer.fresh, receiver_fresh: &my_fresh.public };
        let commit = auth::commit(&my_nonce, &transcript).map_err(fail)?;
        let reply = PairCommit { id: me.id.clone(), name: me.name.clone(), kind: me.kind, key: key.public.clone(), fresh: my_fresh.public.clone(), commit };
        self.incoming = Some(Incoming { from: offer.id.clone(), name, kind: offer.kind, key: offer.key.clone(), fresh: offer.fresh.clone(), my_fresh, my_nonce, agreed: None, confirmed: false, started: now });
        Ok(reply)
    }

    /// The sender's nonce: the pair's secret and number are worked out, and this side's nonce is
    /// revealed. Only once per pairing (a second nonce would let the sender pick its number).
    pub fn reveal(&mut self, now: Instant, from: &str, nonce: &str, me: &str, key: &Key) -> Result<String, PairError> {
        self.expire(now);
        let Some(incoming) = self.incoming.as_mut().filter(|i| i.from == from && i.agreed.is_none()) else { return Err(PairError::Closed) };
        if !auth::is_pair_nonce(nonce) {
            return Err(PairError::Wrong);
        }
        let transcript = Transcript { sender: from, receiver: me, sender_key: &incoming.key, receiver_key: &key.public, sender_fresh: &incoming.fresh, receiver_fresh: &incoming.my_fresh.public };
        let secret = auth::pair_secret(key, &incoming.my_fresh, &incoming.key, &incoming.fresh, &transcript, nonce, &incoming.my_nonce).map_err(|_| PairError::Wrong)?;
        let sas = auth::sas(&transcript, nonce, &incoming.my_nonce).ok_or(PairError::Wrong)?;
        incoming.agreed = Some((Zeroizing::new(secret), sas));
        Ok(incoming.my_nonce.clone())
    }

    /// The person here compared the numbers: matching, it waits for the sender's confirmation;
    /// not matching, pairing closes. False if there's no such pairing.
    pub fn answer(&mut self, now: Instant, from: &str, matches: bool) -> bool {
        self.expire(now);
        let Some(incoming) = self.incoming.as_mut().filter(|i| i.from == from && i.agreed.is_some()) else { return false };
        if matches {
            incoming.confirmed = true;
        } else {
            self.close();
        }
        true
    }

    /// The sender's confirmation (its person confirmed, and here's its proof). A wrong proof ends the
    /// pairing: the two didn't derive the same secret, so something sat in between.
    pub fn confirm(&mut self, now: Instant, from: &str, proof: &str) -> Result<Confirmed, PairError> {
        self.expire(now);
        let Some(incoming) = self.incoming.as_ref().filter(|i| i.from == from) else { return Err(PairError::Closed) };
        let Some((secret, _)) = &incoming.agreed else { return Err(PairError::Closed) };
        if !auth::confirm_ok(&secret[..], true, proof) {
            self.close();
            return Err(PairError::Wrong);
        }
        if !incoming.confirmed {
            return Ok(Confirmed::Waiting);
        }
        let incoming = self.incoming.take().ok_or(PairError::Closed)?;
        let secret: Secret = incoming.agreed.as_ref().map(|(s, _)| s.clone()).ok_or(PairError::Closed)?;
        let proof = auth::confirm_proof(&secret[..], false);
        // The pairing is done: it closes, as a code once did after one use.
        self.open = None;
        Ok(Confirmed::Paired(Box::new(incoming), secret, proof))
    }

    /// The sender gave up (its person said the numbers don't match, or it stopped waiting).
    pub fn cancel(&mut self, from: &str) -> bool {
        if self.incoming.as_ref().is_some_and(|i| i.from == from) {
            self.incoming = None;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::auth::SECRET_BYTES;

    const ME: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const THEM: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    struct Sender {
        key: Key,
        fresh: Key,
    }

    fn offer(sender: &Sender) -> PairStart {
        PairStart { id: THEM.into(), name: "PC".into(), kind: Kind::Pc, key: sender.key.public.clone(), fresh: sender.fresh.public.clone() }
    }

    fn hello() -> Hello {
        Hello { id: ME.into(), name: "TV".into(), kind: Kind::Tv }
    }

    fn sender() -> Sender {
        Sender { key: Key::generate().unwrap(), fresh: Key::generate().unwrap() }
    }

    /// Runs the sender's side up to the number: its secret and number, and its proof.
    fn exchange(w: &mut PairWindow, now: Instant, me: &Key, s: &Sender) -> (Secret, String, String) {
        let reply = w.start(now, &offer(s), "PC".into(), &hello(), me).unwrap();
        let ns = auth::pair_nonce().unwrap();
        let nr = w.reveal(now, THEM, &ns, ME, me).unwrap();
        let t = Transcript { sender: THEM, receiver: ME, sender_key: &s.key.public, receiver_key: &reply.key, sender_fresh: &s.fresh.public, receiver_fresh: &reply.fresh };
        assert!(auth::commit_ok(&nr, &t, &reply.commit));
        let secret = Zeroizing::new(auth::pair_secret(&s.key, &s.fresh, &reply.key, &reply.fresh, &t, &ns, &nr).unwrap());
        let sas = auth::sas(&t, &ns, &nr).unwrap();
        let proof = auth::confirm_proof(&secret[..], true);
        (secret, sas, proof)
    }

    #[test]
    fn pairs_once_both_people_confirm() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        w.open(now);
        let s = sender();
        let (secret, sas, proof) = exchange(&mut w, now, &me, &s);
        // Both show the same number.
        assert_eq!(w.incoming(now).and_then(Incoming::sas), Some(sas.as_str()));
        // The sender's person confirmed first: it waits for the one here.
        assert!(matches!(w.confirm(now, THEM, &proof), Ok(Confirmed::Waiting)));
        assert!(w.answer(now, THEM, true));
        let Ok(Confirmed::Paired(incoming, theirs, their_proof)) = w.confirm(now, THEM, &proof) else { panic!("not paired") };
        assert_eq!(theirs[..], secret[..]);
        assert_eq!(incoming.key, s.key.public);
        assert!(auth::confirm_ok(&secret[..], false, &their_proof));
        // Done: pairing closed.
        assert!(w.remaining(now).is_none());
        assert!(matches!(w.start(now, &offer(&sender()), "PC".into(), &hello(), &me), Err(PairError::Closed)));
    }

    #[test]
    fn numbers_that_dont_match_close_pairing() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        w.open(now);
        let (_, _, proof) = exchange(&mut w, now, &me, &sender());
        assert!(w.answer(now, THEM, false));
        assert!(w.remaining(now).is_none());
        assert!(matches!(w.confirm(now, THEM, &proof), Err(PairError::Closed)));
    }

    #[test]
    fn a_wrong_proof_ends_the_pairing() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        w.open(now);
        exchange(&mut w, now, &me, &sender());
        w.answer(now, THEM, true);
        let forged = auth::confirm_proof(&[9u8; SECRET_BYTES], true);
        assert!(matches!(w.confirm(now, THEM, &forged), Err(PairError::Wrong)));
        assert!(w.incoming(now).is_none());
    }

    #[test]
    fn the_nonce_is_taken_once_and_only_from_the_sender() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        w.open(now);
        w.start(now, &offer(&sender()), "PC".into(), &hello(), &me).unwrap();
        let ns = auth::pair_nonce().unwrap();
        assert!(matches!(w.reveal(now, ME, &ns, ME, &me), Err(PairError::Closed)));
        assert!(matches!(w.reveal(now, THEM, "00", ME, &me), Err(PairError::Wrong)));
        assert!(w.reveal(now, THEM, &ns, ME, &me).is_ok());
        // A second nonce, to try for another number: refused.
        assert!(matches!(w.reveal(now, THEM, &auth::pair_nonce().unwrap(), ME, &me), Err(PairError::Closed)));
    }

    #[test]
    fn nothing_pairs_without_pairing_open() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        assert!(matches!(w.start(now, &offer(&sender()), "PC".into(), &hello(), &me), Err(PairError::Closed)));
        w.open(now);
        assert!(matches!(w.start(now + PAIRING_WINDOW, &offer(&sender()), "PC".into(), &hello(), &me), Err(PairError::Closed)));
        // A pairing left unfinished lapses.
        w.open(now);
        exchange(&mut w, now, &me, &sender());
        assert!(w.incoming(now + SESSION_TIME).is_none());
    }

    #[test]
    fn a_pairing_started_near_the_end_of_the_window_may_finish() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        w.open(now);
        let started = now + PAIRING_WINDOW - Duration::from_secs(10);
        let (_, sas, proof) = exchange(&mut w, started, &me, &sender());
        // The window is over: nothing new starts, but the comparison under way is still on screen and can finish.
        let later = now + PAIRING_WINDOW + Duration::from_secs(30);
        assert!(w.remaining(later).is_none());
        assert!(matches!(w.start(later, &offer(&sender()), "PC".into(), &hello(), &me), Err(PairError::Closed)));
        assert_eq!(w.incoming(later).and_then(Incoming::sas), Some(sas.as_str()));
        assert!(w.answer(later, THEM, true));
        assert!(matches!(w.confirm(later, THEM, &proof), Ok(Confirmed::Paired(..))));
    }

    #[test]
    fn too_many_pairings_started_lock_it_until_opened_again() {
        let now = Instant::now();
        let me = Key::generate().unwrap();
        let mut w = PairWindow::default();
        w.open(now);
        for _ in 0..MAX_FAILURES {
            assert!(w.start(now, &offer(&sender()), "PC".into(), &hello(), &me).is_ok());
        }
        assert!(matches!(w.start(now, &offer(&sender()), "PC".into(), &hello(), &me), Err(PairError::Locked)));
        assert!(w.locked());
        w.open(now);
        assert!(!w.locked());
        assert!(w.start(now, &offer(&sender()), "PC".into(), &hello(), &me).is_ok());
    }
}
