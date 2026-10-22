//! Who may use the phone remote: pairing (the one-time token the QR code
//! carries, or the 6-digit code typed by hand), the sessions paired phones
//! hold, the lockout after wrong guesses, and each session's command rate.
//!
//! Everything here lives in memory only. Turning the remote off or closing
//! Orbit forgets every phone, so a session can never outlive the server or be
//! read back from disk.

use std::time::{Duration, Instant};

/// How long a pairing code (and the QR code's token) works once shown.
pub const PAIRING_WINDOW: Duration = Duration::from_secs(10 * 60);
/// Phones paired at once. A household needs a few; a cap bounds what a leak could add.
pub const MAX_DEVICES: usize = 4;
/// A session unused this long ends (the phone pairs again).
pub const SESSION_IDLE: Duration = Duration::from_secs(12 * 60 * 60);
/// No session lasts longer than this, however often it's used.
pub const SESSION_MAX: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Wrong codes or tokens before pairing closes. With 6 digits that's a 5 in a
/// million chance per pairing window, and the person has to open a new one in
/// Orbit before anyone can try again.
pub const MAX_FAILURES: u32 = 5;
/// Commands a phone may send in a burst, then per second: far more than a
/// thumb can press, few enough that a misbehaving page can't flood Orbit.
const COMMAND_BURST: f64 = 30.0;
const COMMANDS_PER_SECOND: f64 = 15.0;

/// What a phone offers to pair with.
pub enum Offer<'a> {
    /// From the QR code's link.
    Token(&'a str),
    /// Typed by hand.
    Code(&'a str),
}

#[derive(Debug, PartialEq, Eq)]
pub enum PairError {
    /// No pairing is open (none was asked for, it expired, or a phone used it).
    Closed,
    /// Too many wrong tries: pairing stays closed until opened again in Orbit.
    Locked,
    Wrong,
    /// The most phones allowed are paired already.
    Full,
}

pub struct Pairing {
    pub token: String,
    pub code: String,
    opened: Instant,
}

impl Pairing {
    pub fn remaining(&self, now: Instant) -> Duration {
        PAIRING_WINDOW.saturating_sub(now.saturating_duration_since(self.opened))
    }
}

struct Session {
    token: String,
    created: Instant,
    seen: Instant,
    /// Commands left in the bucket, and when it was last topped up.
    allowance: f64,
    topped_up: Instant,
}

#[derive(Default)]
pub struct Guard {
    pairing: Option<Pairing>,
    sessions: Vec<Session>,
    failures: u32,
    locked: bool,
}

/// Compares two secrets without stopping at the first difference, so the
/// time an answer takes says nothing about how much of a guess was right.
pub(crate) fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

impl Guard {
    /// Opens a pairing window with fresh secrets (from "Pair a phone" in
    /// Orbit). A wrong-guess lockout ends here: the person chose to pair.
    pub fn open_pairing(&mut self, token: String, code: String, now: Instant) {
        self.pairing = Some(Pairing { token, code, opened: now });
        self.failures = 0;
        self.locked = false;
    }

    /// The open pairing window, if it hasn't expired.
    pub fn pairing(&mut self, now: Instant) -> Option<&Pairing> {
        if self.pairing.as_ref().is_some_and(|p| p.remaining(now).is_zero()) {
            self.pairing = None;
        }
        self.pairing.as_ref()
    }

    pub fn locked(&self) -> bool {
        self.locked
    }

    /// Pairs a phone, which then holds `session` (a fresh random token). The
    /// pairing secrets work once: a phone that pairs closes the window.
    pub fn pair(&mut self, offer: Offer<'_>, session: String, now: Instant) -> Result<(), PairError> {
        self.expire(now);
        if self.locked {
            return Err(PairError::Locked);
        }
        let Some(pairing) = self.pairing(now) else { return Err(PairError::Closed) };
        let right = match offer {
            Offer::Token(token) => same(token, &pairing.token),
            Offer::Code(code) => same(code, &pairing.code),
        };
        if !right {
            self.failures += 1;
            if self.failures >= MAX_FAILURES {
                self.locked = true;
                self.pairing = None;
                return Err(PairError::Locked);
            }
            return Err(PairError::Wrong);
        }
        if self.sessions.len() >= MAX_DEVICES {
            return Err(PairError::Full);
        }
        self.pairing = None;
        self.sessions.push(Session { token: session, created: now, seen: now, allowance: COMMAND_BURST, topped_up: now });
        Ok(())
    }

    fn expire(&mut self, now: Instant) {
        self.sessions.retain(|s| now.saturating_duration_since(s.seen) < SESSION_IDLE && now.saturating_duration_since(s.created) < SESSION_MAX);
    }

    /// The live session `token` names, which counts as using it.
    fn find(&mut self, token: &str, now: Instant) -> Option<&mut Session> {
        self.expire(now);
        // Every session is compared (no early exit), as in `same`.
        let mut found = None;
        for (i, s) in self.sessions.iter().enumerate() {
            if same(&s.token, token) {
                found = Some(i);
            }
        }
        let session = &mut self.sessions[found?];
        session.seen = now;
        Some(session)
    }

    /// Whether `token` is a paired phone's session.
    pub fn session(&mut self, token: &str, now: Instant) -> bool {
        self.find(token, now).is_some()
    }

    /// Whether the phone holding `token` may send a command now (a token
    /// bucket: a burst, then a steady rate). False for no session.
    pub fn allow_command(&mut self, token: &str, now: Instant) -> bool {
        let Some(s) = self.find(token, now) else { return false };
        let elapsed = now.saturating_duration_since(s.topped_up).as_secs_f64();
        s.allowance = (s.allowance + elapsed * COMMANDS_PER_SECOND).min(COMMAND_BURST);
        s.topped_up = now;
        if s.allowance < 1.0 {
            return false;
        }
        s.allowance -= 1.0;
        true
    }

    /// Ends one phone's session (its own "Disconnect").
    /// Whether there was such a session.
    pub fn forget(&mut self, token: &str) -> bool {
        let before = self.sessions.len();
        self.sessions.retain(|s| !same(&s.token, token));
        self.sessions.len() < before
    }

    /// "Disconnect all".
    pub fn clear(&mut self) {
        self.sessions.clear();
    }

    pub fn devices(&mut self, now: Instant) -> usize {
        self.expire(now);
        self.sessions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    fn open(now: Instant) -> Guard {
        let mut g = Guard::default();
        g.open_pairing(TOKEN.into(), "123456".into(), now);
        g
    }

    fn session(n: usize) -> String {
        format!("{n:064}")
    }

    #[test]
    fn pairs_with_the_token_or_the_code_once() {
        let now = Instant::now();
        let mut g = open(now);
        assert_eq!(g.pair(Offer::Token(TOKEN), session(1), now), Ok(()));
        assert!(g.session(&session(1), now));
        // One-time: the window closed with the first phone.
        assert_eq!(g.pair(Offer::Token(TOKEN), session(2), now), Err(PairError::Closed));
        g.open_pairing(TOKEN.into(), "654321".into(), now);
        assert_eq!(g.pair(Offer::Code("654321"), session(2), now), Ok(()));
        assert_eq!(g.devices(now), 2);
    }

    #[test]
    fn nothing_pairs_without_an_open_window() {
        let now = Instant::now();
        let mut g = Guard::default();
        assert_eq!(g.pair(Offer::Code("123456"), session(1), now), Err(PairError::Closed));
        assert_eq!(g.devices(now), 0);
    }

    #[test]
    fn the_window_expires() {
        let now = Instant::now();
        let mut g = open(now);
        let later = now + PAIRING_WINDOW;
        assert!(g.pairing(later).is_none());
        assert_eq!(g.pair(Offer::Code("123456"), session(1), later), Err(PairError::Closed));
        assert!(open(now).pairing(now + PAIRING_WINDOW - Duration::from_secs(1)).is_some());
    }

    #[test]
    fn wrong_guesses_lock_pairing_until_opened_again() {
        let now = Instant::now();
        let mut g = open(now);
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(g.pair(Offer::Code("000000"), session(1), now), Err(PairError::Wrong));
        }
        assert_eq!(g.pair(Offer::Token("nope"), session(1), now), Err(PairError::Locked));
        assert!(g.locked());
        // Even the right code no longer works: the secrets are gone.
        assert_eq!(g.pair(Offer::Code("123456"), session(1), now), Err(PairError::Locked));
        assert!(g.pairing(now).is_none());
        // Opening pairing again (in Orbit) starts over.
        g.open_pairing(TOKEN.into(), "222222".into(), now);
        assert!(!g.locked());
        assert_eq!(g.pair(Offer::Code("222222"), session(1), now), Ok(()));
    }

    #[test]
    fn codes_must_match_exactly() {
        let now = Instant::now();
        let mut g = open(now);
        assert_eq!(g.pair(Offer::Code("12345"), session(1), now), Err(PairError::Wrong));
        assert_eq!(g.pair(Offer::Code("1234567"), session(1), now), Err(PairError::Wrong));
        assert_eq!(g.pair(Offer::Code(""), session(1), now), Err(PairError::Wrong));
        assert_eq!(g.pair(Offer::Token(&TOKEN[..63]), session(1), now), Err(PairError::Wrong));
    }

    #[test]
    fn at_most_max_devices() {
        let now = Instant::now();
        let mut g = Guard::default();
        for n in 0..MAX_DEVICES {
            g.open_pairing(TOKEN.into(), "123456".into(), now);
            assert_eq!(g.pair(Offer::Code("123456"), session(n), now), Ok(()));
        }
        g.open_pairing(TOKEN.into(), "123456".into(), now);
        assert_eq!(g.pair(Offer::Code("123456"), session(99), now), Err(PairError::Full));
        assert!(!g.session(&session(99), now));
        g.clear();
        assert_eq!(g.devices(now), 0);
        assert!(!g.session(&session(0), now));
    }

    #[test]
    fn sessions_expire_when_idle_or_old() {
        let now = Instant::now();
        let mut g = open(now);
        g.pair(Offer::Code("123456"), session(1), now).unwrap();
        assert!(!g.session(&session(1), now + SESSION_IDLE));

        let mut g = open(now);
        g.pair(Offer::Code("123456"), session(1), now).unwrap();
        // Used often, but never past the absolute limit.
        let mut t = now;
        while t < now + SESSION_MAX - SESSION_IDLE {
            t += SESSION_IDLE / 2;
            assert!(g.session(&session(1), t));
        }
        assert!(!g.session(&session(1), now + SESSION_MAX));
    }

    #[test]
    fn unknown_or_forgotten_sessions_are_refused() {
        let now = Instant::now();
        let mut g = open(now);
        g.pair(Offer::Code("123456"), session(1), now).unwrap();
        assert!(!g.session(&session(2), now));
        assert!(!g.session("", now));
        // Only a session that existed counts as forgotten (and is announced).
        assert!(!g.forget(&session(2)));
        assert!(g.forget(&session(1)));
        assert!(!g.forget(&session(1)));
        assert!(!g.session(&session(1), now));
    }

    #[test]
    fn commands_are_rate_limited_per_session() {
        let now = Instant::now();
        let mut g = open(now);
        g.pair(Offer::Code("123456"), session(1), now).unwrap();
        let allowed = (0..100).filter(|_| g.allow_command(&session(1), now)).count();
        assert_eq!(allowed, COMMAND_BURST as usize);
        // A second later, about a second's worth more.
        let later = now + Duration::from_secs(1);
        let more = (0..100).filter(|_| g.allow_command(&session(1), later)).count();
        assert_eq!(more, COMMANDS_PER_SECOND as usize);
        assert!(!g.allow_command(&session(2), now));
    }

    #[test]
    fn same_compares_whole_strings() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "ab"));
        assert!(same("", ""));
    }
}
