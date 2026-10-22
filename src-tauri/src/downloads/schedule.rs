//! Settings → Downloads: a speed limit and the hours downloads may run.
//!
//! The speed limit is one token bucket shared by every web download (so two
//! running at once share the limit rather than each getting it). Torrent
//! downloads use the torrent engine's own limit (see `torrent::Swarm`).
//!
//! The window is whole hours of local time. Rust has no time zone database
//! without a new dependency, so the page sends its offset from UTC along
//! with the settings (and again from time to time, for daylight saving).

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

const MINUTES_PER_DAY: i64 = 24 * 60;

/// Bytes a second, refilled continuously; at most one second's worth saved up.
/// Takers may run into debt (a chunk bigger than what's there): they wait
/// until it's paid off, and the next taker waits behind them.
#[derive(Debug)]
pub struct TokenBucket {
    /// Bytes a second; 0 is no limit.
    rate: u64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new(now: Instant) -> Self {
        Self { rate: 0, tokens: 0.0, last: now }
    }

    /// A new limit starts from an empty bucket, so it applies at once.
    pub fn set_rate(&mut self, rate: u64, now: Instant) {
        self.rate = rate;
        self.tokens = 0.0;
        self.last = now;
    }

    /// Takes `bytes`; returns how long to wait before they count as received.
    pub fn take(&mut self, bytes: u64, now: Instant) -> Duration {
        if self.rate == 0 {
            return Duration::ZERO;
        }
        let rate = self.rate as f64;
        if now > self.last {
            self.tokens = (self.tokens + now.duration_since(self.last).as_secs_f64() * rate).min(rate);
            self.last = now;
        }
        self.tokens -= bytes as f64;
        if self.tokens >= 0.0 { Duration::ZERO } else { Duration::from_secs_f64(-self.tokens / rate) }
    }
}

static BUCKET: LazyLock<Mutex<TokenBucket>> = LazyLock::new(|| Mutex::new(TokenBucket::new(Instant::now())));

/// Sets the web downloads' limit in bytes a second (0 for none).
pub fn set_http_limit(bytes_per_second: u64) {
    if let Ok(mut bucket) = BUCKET.lock() {
        bucket.set_rate(bytes_per_second, Instant::now());
    }
}

/// Waits as long as the limit asks after receiving `bytes`.
pub async fn throttle(bytes: usize) {
    let wait = BUCKET.lock().map(|mut b| b.take(bytes as u64, Instant::now())).unwrap_or_default();
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
}

/// Offered limits in MB/s (0 is off); anything else is refused.
pub const LIMITS_MB: [u32; 7] = [0, 1, 2, 5, 10, 20, 50];

pub fn limit_bytes(megabytes: u32) -> Option<u64> {
    LIMITS_MB.contains(&megabytes).then_some(u64::from(megabytes) * 1024 * 1024)
}

/// "Only download between": from `start` up to (not including) `end`, whole
/// hours 0–23. An end before the start runs past midnight; equal hours mean
/// all day.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub start: u8,
    pub end: u8,
}

impl Window {
    pub fn valid(&self) -> bool {
        self.start < 24 && self.end < 24
    }

    /// Whether `minute` (of the day, 0–1439) is inside the window.
    pub fn contains(&self, minute: i64) -> bool {
        let (start, end) = (i64::from(self.start) * 60, i64::from(self.end) * 60);
        match start.cmp(&end) {
            std::cmp::Ordering::Equal => true,
            std::cmp::Ordering::Less => (start..end).contains(&minute),
            std::cmp::Ordering::Greater => minute >= start || minute < end,
        }
    }
}

/// The local minute of the day at `utc_ms`, for a page whose
/// `Date.getTimezoneOffset()` is `offset` (minutes behind UTC; -120 in UTC+2).
pub fn local_minute(utc_ms: i64, offset: i32) -> i64 {
    (utc_ms.div_euclid(60_000) - i64::from(offset)).rem_euclid(MINUTES_PER_DAY)
}

/// What the page last set, and whether the window was open when last looked at.
#[derive(Debug, Default)]
pub struct Schedule {
    pub window: Option<Window>,
    pub offset: i32,
    pub was_open: Option<bool>,
}

impl Schedule {
    pub fn open_at(&self, utc_ms: i64) -> bool {
        self.window.is_none_or(|w| w.contains(local_minute(utc_ms, self.offset)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_within_a_day() {
        let w = Window { start: 9, end: 17 };
        assert!(!w.contains(8 * 60 + 59));
        assert!(w.contains(9 * 60));
        assert!(w.contains(16 * 60 + 59));
        assert!(!w.contains(17 * 60));
    }

    #[test]
    fn a_window_across_midnight() {
        let w = Window { start: 23, end: 7 };
        assert!(w.contains(23 * 60));
        assert!(w.contains(0));
        assert!(w.contains(6 * 60 + 59));
        assert!(!w.contains(7 * 60));
        assert!(!w.contains(12 * 60));
        assert!(!w.contains(22 * 60 + 59));
        // Equal hours: all day.
        assert!(Window { start: 3, end: 3 }.contains(12 * 60));
        assert!(!Window { start: 24, end: 3 }.valid());
    }

    #[test]
    fn local_time_follows_the_pages_offset() {
        // 2026-01-01 00:30 UTC.
        let utc = 1_767_227_400_000;
        assert_eq!(local_minute(utc, 0), 30);
        // UTC+2 (offset -120): 02:30.
        assert_eq!(local_minute(utc, -120), 150);
        // UTC-5 (offset 300): 19:30 the day before.
        assert_eq!(local_minute(utc, 300), 19 * 60 + 30);
        let schedule = Schedule { window: Some(Window { start: 1, end: 7 }), offset: -120, was_open: None };
        assert!(schedule.open_at(utc));
        assert!(!Schedule { offset: 0, ..schedule }.open_at(utc));
        assert!(Schedule::default().open_at(utc));
    }

    #[test]
    fn the_bucket_paces_to_the_limit() {
        let t0 = Instant::now();
        let mut bucket = TokenBucket::new(t0);
        // No limit: never waits.
        assert_eq!(bucket.take(10_000_000, t0), Duration::ZERO);
        bucket.set_rate(1000, t0);
        // An empty bucket: 500 bytes cost half a second.
        assert_eq!(bucket.take(500, t0), Duration::from_millis(500));
        // A second taker at once queues behind the first.
        assert_eq!(bucket.take(500, t0), Duration::from_secs(1));
        // Two seconds on, the debt is paid and one second's worth (no more) has built up.
        let t2 = t0 + Duration::from_secs(3);
        assert_eq!(bucket.take(1000, t2), Duration::ZERO);
        assert_eq!(bucket.take(250, t2), Duration::from_millis(250));
        // Over time, the average is the rate: 10 000 bytes take about 10 s.
        let mut bucket = TokenBucket::new(t0);
        bucket.set_rate(1000, t0);
        let mut at = t0;
        for _ in 0..10 {
            at += bucket.take(1000, at);
        }
        assert_eq!(at.duration_since(t0), Duration::from_secs(10));
    }

    #[test]
    fn only_offered_limits() {
        assert_eq!(limit_bytes(0), Some(0));
        assert_eq!(limit_bytes(5), Some(5 * 1024 * 1024));
        assert_eq!(limit_bytes(3), None);
    }
}
