//! Finds the stretches of a soundtrack where someone is probably talking, to
//! line subtitles up with (voice activity detection).
//!
//! Energy-based, with no new dependency: the audio arrives as 8 kHz mono with
//! the rumble below 150 Hz filtered out (by mpv, see audio.rs), so what's left
//! is mostly the speech band; a frame is "voice" when it's clearly louder than
//! the quiet parts around it. The threshold adapts every 30 seconds, so quiet
//! and loud scenes both work. It can't tell speech from music or effects as
//! a trained detector (WebRTC's, which alass and ffsubsync use) can, and it
//! doesn't need to: alignment looks for the shift that lines up the most
//! subtitle time with the most voice time, so stray noise mostly averages
//! out, while the onsets and pauses of dialogue, which energy shows well,
//! decide it. ffsubsync's energy-based mode (auditok) works the same way.
//! Long unbroken loud stretches (music, action) aren't dialogue-shaped and
//! are dropped.

pub const SAMPLE_RATE: usize = 8000;
pub const FRAME_MS: i64 = 10;
const FRAME_SAMPLES: usize = SAMPLE_RATE * FRAME_MS as usize / 1000;
/// Frames per threshold window (30 s).
const WINDOW: usize = 3000;
/// Quieter than this (dBFS) is silence, whatever the window looks like.
const SILENCE_DB: f32 = -55.0;
/// Voice must be at least this far above the window's quiet level (dB) ...
const MIN_RISE_DB: f32 = 6.0;
/// ... and this far from it towards the window's loud level.
const RISE_SHARE: f32 = 0.4;
/// Pauses shorter than this join the voice around them; bursts shorter than this are dropped.
const BRIDGE_FRAMES: usize = 30;
const MIN_FRAMES: usize = 15;
/// Longer unbroken stretches aren't dialogue.
const MAX_FRAMES: usize = 3000;

/// Collects 16-bit samples into the mean square energy of each 10 ms frame.
#[derive(Default)]
pub struct Framer {
    sum: f64,
    count: usize,
    /// The first byte of a sample split between two pieces.
    pending: Option<u8>,
    pub frames: Vec<f32>,
}

impl Framer {
    /// Little-endian 16-bit samples, in pieces of any length.
    pub fn push_bytes(&mut self, mut bytes: &[u8]) {
        if let (Some(low), Some(&high)) = (self.pending, bytes.first()) {
            self.pending = None;
            self.sample(i16::from_le_bytes([low, high]));
            bytes = &bytes[1..];
        }
        let (pairs, rest) = bytes.as_chunks::<2>();
        self.pending = rest.first().copied().or(self.pending);
        for pair in pairs {
            self.sample(i16::from_le_bytes([pair[0], pair[1]]));
        }
    }

    fn sample(&mut self, sample: i16) {
        let s = f64::from(sample) / 32768.0;
        self.sum += s * s;
        self.count += 1;
        if self.count == FRAME_SAMPLES {
            self.frames.push((self.sum / FRAME_SAMPLES as f64) as f32);
            self.sum = 0.0;
            self.count = 0;
        }
    }
}

fn percentile(sorted: &[f32], p: f32) -> f32 {
    sorted[((sorted.len() - 1) as f32 * p) as usize]
}

/// Voice stretches as (start, end) in ms, from each frame's mean square energy.
pub fn speech_spans(energies: &[f32]) -> Vec<(i64, i64)> {
    let db: Vec<f32> = energies.iter().map(|e| 10.0 * (e.max(0.0) + 1e-10).log10()).collect();
    let mut voice = vec![false; db.len()];
    for (w, window) in db.chunks(WINDOW).enumerate() {
        let mut sorted = window.to_vec();
        sorted.sort_unstable_by(f32::total_cmp);
        let (quiet, loud) = (percentile(&sorted, 0.2), percentile(&sorted, 0.95));
        let threshold = (quiet + RISE_SHARE * (loud - quiet)).max(quiet + MIN_RISE_DB).max(SILENCE_DB);
        for (i, &d) in window.iter().enumerate() {
            voice[w * WINDOW + i] = d > threshold;
        }
    }

    // Runs of voice, with short pauses bridged.
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < voice.len() {
        if !voice[i] {
            i += 1;
            continue;
        }
        let start = i;
        while i < voice.len() && voice[i] {
            i += 1;
        }
        match runs.last_mut() {
            Some(last) if start - last.1 < BRIDGE_FRAMES => last.1 = i,
            _ => runs.push((start, i)),
        }
    }
    runs.into_iter()
        .filter(|(s, e)| (MIN_FRAMES..=MAX_FRAMES).contains(&(e - s)))
        .map(|(s, e)| (s as i64 * FRAME_MS, e as i64 * FRAME_MS))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `seconds` of 8 kHz audio: faint noise, plus a 400 Hz tone at `level` during each (start, end) ms.
    fn audio(seconds: usize, bursts: &[(i64, i64)], level: f64) -> Vec<u8> {
        let mut seed = 12345u32;
        (0..seconds * SAMPLE_RATE)
            .flat_map(|n| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let noise = (f64::from(seed >> 16) / 65536.0 - 0.5) * 0.004;
                let ms = (n * 1000 / SAMPLE_RATE) as i64;
                let on = bursts.iter().any(|&(s, e)| (s..e).contains(&ms));
                let tone = if on { level * (n as f64 * 400.0 * std::f64::consts::TAU / SAMPLE_RATE as f64).sin() } else { 0.0 };
                (((noise + tone) * 32767.0) as i16).to_le_bytes()
            })
            .collect()
    }

    fn detect(bytes: &[u8]) -> Vec<(i64, i64)> {
        let mut framer = Framer::default();
        // In uneven pieces, as a file is read.
        for piece in bytes.chunks(4097) {
            framer.push_bytes(piece);
        }
        speech_spans(&framer.frames)
    }

    #[test]
    fn finds_speech_in_quiet_and_loud_scenes() {
        let bursts = [(2000, 3500), (5000, 5800), (40_000, 42_000), (50_000, 51_200)];
        let found = detect(&audio(60, &bursts[..2], 0.3).into_iter().take(35 * SAMPLE_RATE * 2).chain(audio(25, &[(5000, 7000), (15_000, 16_200)], 0.05)).collect::<Vec<u8>>());
        assert_eq!(found.len(), 4, "{found:?}");
        for (f, b) in found.iter().zip(bursts) {
            assert!((f.0 - b.0).abs() <= 20 && (f.1 - b.1).abs() <= 20, "{f:?} vs {b:?}");
        }
    }

    #[test]
    fn bridges_short_pauses_and_drops_blips_and_long_noise() {
        let found = detect(&audio(80, &[(1000, 2000), (2150, 3000), (6000, 6080), (10_000, 45_000), (60_000, 61_000)], 0.3));
        assert_eq!(found.len(), 2, "{found:?}");
        assert!((found[0].0 - 1000).abs() <= 20 && (found[0].1 - 3000).abs() <= 20, "{found:?}");
        assert!((found[1].0 - 60_000).abs() <= 20, "{found:?}");
    }

    #[test]
    fn silence_has_no_speech() {
        assert!(detect(&audio(40, &[], 0.0)).is_empty());
        assert!(detect(&[]).is_empty());
        assert!(speech_spans(&[0.0; 10]).is_empty());
    }
}
