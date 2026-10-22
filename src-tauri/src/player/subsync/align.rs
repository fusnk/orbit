//! Lines up a subtitle's timing with a reference (another subtitle for the
//! same video, or the stretches of speech found in its audio) using alass,
//! the approach of the `alass` tool: first the frame rate, by trying the
//! usual conversions with one fixed shift each; then the shift itself,
//! allowing a few changes along the way (a release with an extra or missing
//! scene, or an ad break, is off by different amounts in different parts).

use alass_core::{NoProgressHandler, TimePoint, TimeSpan};

/// alass works in whole units; 10 ms is finer than anyone can see and keeps it fast.
const UNIT_MS: i64 = 10;
/// How strongly alass avoids changing the shift partway (its recommended 7).
const SPLIT_PENALTY: f64 = 7.0;
/// alass's speed-up; 1 keeps it accurate and still takes about a second for a film.
const SPEED_OPTIMIZATION: f64 = 1.0;
/// Frame rates releases get converted between (film, PAL, NTSC), as the alass tool tries them.
const FRAME_RATES: [f64; 5] = [23.976, 24.0, 25.0, 29.97, 30.0];
/// A frame-rate change must score clearly better than none, so chance doesn't pick one.
const RATE_MARGIN: f64 = 1.1;
/// Below this many lines (or stretches of speech) there's too little to line up.
pub const MIN_SPANS: usize = 10;
/// alass's work and memory grow with lines × lines and with the time covered; a film
/// has 1,000–2,000 lines and a few thousand stretches of speech, so these are generous.
const MAX_SPANS: usize = 8000;
const MAX_TIME_MS: i64 = 12 * 3_600_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Alignment {
    /// Each line's new (start, end), in milliseconds, in the order given.
    pub spans: Vec<(i64, i64)>,
    /// How much the lines moved, typically (the median), in milliseconds; positive is later.
    pub shift_ms: i64,
    /// The frame-rate conversion applied (1.0 for none).
    pub scale: f64,
    /// Whether different parts moved by different amounts.
    pub split: bool,
    /// How much of the subtitle's time overlaps the reference, before and after (0 to 1).
    pub overlap_before: f64,
    pub overlap_after: f64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AlignError {
    /// Too little to go on, on either side.
    TooShort,
    /// More than any video has: not worth the time and memory.
    TooLong,
}

fn to_spans(list: &[(i64, i64)]) -> Vec<TimeSpan> {
    list.iter()
        .map(|&(s, e)| {
            let s = s.clamp(0, MAX_TIME_MS) / UNIT_MS;
            // alass needs end >= start (it asserts, and a panic would end the app).
            TimeSpan::new(TimePoint::from(s), TimePoint::from((e.clamp(0, MAX_TIME_MS) / UNIT_MS).max(s)))
        })
        .collect()
}

fn scaled(list: &[TimeSpan], factor: f64) -> Vec<TimeSpan> {
    if factor == 1.0 { list.to_vec() } else { list.iter().map(|s| s.scaled(factor)).collect() }
}

/// Aligns `subtitle` (each line's start and end, in ms) to `reference`.
pub fn align(reference: &[(i64, i64)], subtitle: &[(i64, i64)]) -> Result<Alignment, AlignError> {
    if reference.len() > MAX_SPANS || subtitle.len() > MAX_SPANS {
        return Err(AlignError::TooLong);
    }
    let ref_spans: Vec<TimeSpan> = to_spans(reference).into_iter().filter(|s| !s.is_empty()).collect();
    let in_spans = to_spans(subtitle);
    if ref_spans.len() < MIN_SPANS || in_spans.iter().filter(|s| !s.is_empty()).count() < MIN_SPANS {
        return Err(AlignError::TooShort);
    }

    // The frame rate: the conversion whose best single shift scores highest.
    let rate_score = |factor: f64| alass_core::align_nosplit(&ref_spans, &scaled(&in_spans, factor), alass_core::overlap_scoring, NoProgressHandler).1;
    let unscaled = rate_score(1.0);
    let mut scale = 1.0;
    let mut best = unscaled;
    for from in FRAME_RATES {
        for to in FRAME_RATES {
            let factor = from / to;
            if (factor - 1.0).abs() < 1e-3 {
                continue;
            }
            let score = rate_score(factor);
            if score > best && score > unscaled * RATE_MARGIN {
                (best, scale) = (score, factor);
            }
        }
    }

    let list = scaled(&in_spans, scale);
    let (deltas, _) = alass_core::align(&ref_spans, &list, SPLIT_PENALTY, Some(SPEED_OPTIMIZATION), alass_core::standard_scoring, NoProgressHandler);
    let spans: Vec<(i64, i64)> = subtitle
        .iter()
        .zip(&deltas)
        .map(|(&(s, e), d)| {
            let shift = d.as_i64() * UNIT_MS;
            ((s as f64 * scale).round() as i64 + shift, (e as f64 * scale).round() as i64 + shift)
        })
        .collect();
    let mut moves: Vec<i64> = spans.iter().zip(subtitle).map(|(n, o)| n.0 - o.0).collect();
    moves.sort_unstable();
    let shift_ms = moves[moves.len() / 2];
    let split = deltas.windows(2).any(|w| w[0] != w[1]);
    Ok(Alignment { overlap_before: overlap(reference, subtitle), overlap_after: overlap(reference, &spans), spans, shift_ms, scale, split })
}

/// Merged, sorted, non-empty spans.
fn merged(list: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut sorted: Vec<(i64, i64)> = list.iter().copied().filter(|(s, e)| e > s).collect();
    sorted.sort_unstable();
    let mut out: Vec<(i64, i64)> = Vec::with_capacity(sorted.len());
    for (s, e) in sorted {
        match out.last_mut() {
            Some(last) if s <= last.1 => last.1 = last.1.max(e),
            _ => out.push((s, e)),
        }
    }
    out
}

/// The share of `list`'s time that `reference` also covers.
pub fn overlap(reference: &[(i64, i64)], list: &[(i64, i64)]) -> f64 {
    let (a, b) = (merged(reference), merged(list));
    let total: i64 = b.iter().map(|(s, e)| e - s).sum();
    if total == 0 {
        return 0.0;
    }
    let (mut i, mut j, mut shared) = (0, 0, 0i64);
    while i < a.len() && j < b.len() {
        let (s, e) = (a[i].0.max(b[j].0), a[i].1.min(b[j].1));
        if e > s {
            shared += e - s;
        }
        if a[i].1 < b[j].1 { i += 1 } else { j += 1 }
    }
    shared as f64 / total as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A film-like list of lines: irregular lengths and gaps, from a fixed seed.
    fn lines(count: usize) -> Vec<(i64, i64)> {
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut next = move |n: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % n) as i64
        };
        let mut at = 30_000;
        (0..count)
            .map(|_| {
                at += 400 + next(6000);
                let span = (at, at + 900 + next(3500));
                at = span.1;
                span
            })
            .collect()
    }

    #[test]
    fn finds_a_fixed_shift() {
        let reference = lines(400);
        let late: Vec<_> = reference.iter().map(|(s, e)| (s + 2300, e + 2300)).collect();
        let result = align(&reference, &late).unwrap();
        assert_eq!(result.shift_ms, -2300);
        assert_eq!(result.scale, 1.0);
        assert!(!result.split);
        assert!(result.overlap_after > 0.99 && result.overlap_before < result.overlap_after, "{result:?}");
        assert_eq!(result.spans, reference);
    }

    #[test]
    fn matches_a_subtitle_split_into_lines_differently() {
        // Another language's subtitle: some lines merged, the rest trimmed, all 3 s late.
        let reference = lines(400);
        let other: Vec<_> = reference
            .chunks(3)
            .flat_map(|c| match c {
                [a, b, rest @ ..] => [vec![(a.0 + 3000, b.1 + 3000 - 200)], rest.iter().map(|r| (r.0 + 3150, r.1 + 2800)).collect()].concat(),
                _ => c.iter().map(|r| (r.0 + 3000, r.1 + 3000)).collect(),
            })
            .collect();
        let result = align(&reference, &other).unwrap();
        // Lines start 3.0–3.15 s late and end 2.8 s late: anything in that range lines them up.
        assert!((-3150..=-2800).contains(&result.shift_ms), "{}", result.shift_ms);
        // Merged lines also cover the pauses between them, so the overlap can't be complete.
        assert!(result.overlap_after > 0.6 && result.overlap_before < 0.4, "{} {}", result.overlap_before, result.overlap_after);
    }

    #[test]
    fn corrects_a_frame_rate_conversion() {
        let reference = lines(400);
        // Timed for 25 fps (PAL speed-up) while the video runs at 23.976.
        let pal: Vec<_> = reference.iter().map(|&(s, e)| ((s as f64 * 23.976 / 25.0) as i64, (e as f64 * 23.976 / 25.0) as i64)).collect();
        let result = align(&reference, &pal).unwrap();
        assert!((result.scale - 25.0 / 23.976).abs() < 1e-9, "{result:?}");
        let worst = result.spans.iter().zip(&reference).map(|(a, b)| (a.0 - b.0).abs()).max().unwrap();
        assert!(worst <= 60, "{worst}");
    }

    #[test]
    fn follows_a_shift_that_changes_partway() {
        let reference = lines(400);
        // An extra scene in this release: the second half is 4 s later than the first.
        let cut: Vec<_> = reference.iter().enumerate().map(|(i, &(s, e))| if i < 200 { (s + 1000, e + 1000) } else { (s + 5000, e + 5000) }).collect();
        let result = align(&reference, &cut).unwrap();
        assert!(result.split);
        let right = result.spans.iter().zip(&reference).filter(|(a, b)| (a.0 - b.0).abs() <= 20).count();
        assert!(right >= 390, "{right}");
    }

    #[test]
    fn needs_enough_lines() {
        let reference = lines(50);
        assert_eq!(align(&reference, &reference[..5]), Err(AlignError::TooShort));
        assert_eq!(align(&reference[..3], &reference), Err(AlignError::TooShort));
        // Backwards or negative spans are made safe rather than passed to alass.
        let mut odd = lines(20);
        odd[3] = (5000, 1000);
        odd[4] = (-500, -100);
        assert!(align(&reference, &odd).is_ok());
        assert_eq!(align(&lines(MAX_SPANS + 1), &reference), Err(AlignError::TooLong));
    }

    #[test]
    fn measures_overlap() {
        assert_eq!(overlap(&[(0, 10)], &[(5, 15)]), 0.5);
        assert_eq!(overlap(&[(0, 10), (20, 30)], &[(0, 30)]), 20.0 / 30.0);
        assert_eq!(overlap(&[], &[(0, 10)]), 0.0);
        assert_eq!(overlap(&[(0, 10)], &[]), 0.0);
    }
}
