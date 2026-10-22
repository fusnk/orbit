//! The timing of a Matroska (MKV/WebM) file's own text subtitles, read from
//! its index without downloading the video, the way Nuvio's AutoSync does it.
//!
//! mkvmerge (what nearly every MKV release is muxed with) indexes every
//! subtitle line in the file's Cues, with its start and duration, so a few
//! small reads give the full timing of each embedded subtitle track: the
//! file's start (header, SeekHead, track list) and the Cues element (a few
//! hundred KB, usually at the end). Those timings belong to this exact video,
//! so they're a correctly timed reference for any other subtitle, in any
//! language. Files muxed without such an index (ffmpeg's default) just have
//! no reference here.
//!
//! The file is untrusted: every size is checked against what's been read and
//! against caps before it's used, and the number and size of reads is limited.

use super::source::{Source, SourceError};

/// The file's start: EBML header, Segment header, and usually SeekHead, Info and Tracks.
const HEAD_BYTES: usize = 256 * 1024;
const MAX_TRACKS_BYTES: u64 = 1024 * 1024;
const MAX_CUES_BYTES: u64 = 16 * 1024 * 1024;
/// Reads of the file, and bytes read, at most (Nuvio's limits are similar).
const MAX_READS: usize = 8;
const MAX_TOTAL_BYTES: usize = 24 * 1024 * 1024;
/// Lines in one track at most (as for subtitle files).
const MAX_LINES: usize = super::subs::MAX_CUES;
/// A line without a recorded duration is assumed to last this long (or until the next).
const DEFAULT_LINE_MS: i64 = 2500;

const EBML: u32 = 0x1A45_DFA3;
const DOC_TYPE: u32 = 0x4282;
const SEGMENT: u32 = 0x1853_8067;
const SEEK_HEAD: u32 = 0x114D_9B74;
const SEEK: u32 = 0x4DBB;
const SEEK_ID: u32 = 0x53AB;
const SEEK_POSITION: u32 = 0x53AC;
const INFO: u32 = 0x1549_A966;
const TIMESTAMP_SCALE: u32 = 0x2AD7B1;
const TRACKS: u32 = 0x1654_AE6B;
const TRACK_ENTRY: u32 = 0xAE;
const TRACK_NUMBER: u32 = 0xD7;
const TRACK_TYPE: u32 = 0x83;
const CODEC_ID: u32 = 0x86;
const FLAG_FORCED: u32 = 0x55AA;
const CUES: u32 = 0x1C53_BB6B;
const CUE_POINT: u32 = 0xBB;
const CUE_TIME: u32 = 0xB3;
const CUE_TRACK_POSITIONS: u32 = 0xB7;
const CUE_TRACK: u32 = 0xF7;
const CUE_DURATION: u32 = 0xB2;
const CLUSTER: u32 = 0x1F43_B675;
const SUBTITLE_TRACK: u64 = 0x11;

#[derive(Debug, PartialEq, Eq)]
pub enum MkvError {
    /// Not Matroska, or damaged.
    NotMatroska,
    /// No text subtitles, or none indexed line by line.
    NoTimings,
    Read(SourceError),
    /// The file needed more reads or bytes than allowed.
    TooBig,
}

impl From<SourceError> for MkvError {
    fn from(e: SourceError) -> Self {
        Self::Read(e)
    }
}

/// An element's id, its content's size (None: unknown, as streamed files may
/// have for the Segment), and the header's length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Header {
    id: u32,
    size: Option<u64>,
    len: usize,
}

/// An EBML variable-length number: (value without the length marker, all-ones?, length).
fn vint(buf: &[u8], max_len: usize) -> Option<(u64, bool, usize)> {
    let first = *buf.first()?;
    let len = first.leading_zeros() as usize + 1;
    if len > max_len || buf.len() < len {
        return None;
    }
    let mut value = u64::from(first) & (0xff >> len);
    for &b in &buf[1..len] {
        value = (value << 8) | u64::from(b);
    }
    let all_ones = value == (1u64 << (7 * len)) - 1;
    Some((value, all_ones, len))
}

fn header(buf: &[u8]) -> Option<Header> {
    let (_, _, id_len) = vint(buf, 4)?;
    let id = buf[..id_len].iter().fold(0u32, |n, &b| (n << 8) | u32::from(b));
    let (size, unknown, size_len) = vint(&buf[id_len..], 8)?;
    Some(Header { id, size: (!unknown).then_some(size), len: id_len + size_len })
}

/// The child elements of `data` as (id, content); stops at anything truncated or of unknown size.
fn children(data: &[u8]) -> impl Iterator<Item = (u32, &[u8])> {
    let mut at = 0;
    std::iter::from_fn(move || {
        let h = header(data.get(at..)?)?;
        let start = at + h.len;
        let end = start.checked_add(usize::try_from(h.size?).ok()?)?;
        let content = data.get(start..end)?;
        at = end;
        Some((h.id, content))
    })
}

fn uint(data: &[u8]) -> Option<u64> {
    (data.len() <= 8).then(|| data.iter().fold(0u64, |n, &b| (n << 8) | u64::from(b)))
}

fn child(data: &[u8], id: u32) -> Option<&[u8]> {
    children(data).find(|(i, _)| *i == id).map(|(_, c)| c)
}

/// Where SeekHead says each top-level element is, relative to the Segment's content.
fn seeks(data: &[u8]) -> Vec<(u32, u64)> {
    children(data)
        .filter(|(id, _)| *id == SEEK)
        .filter_map(|(_, seek)| {
            let id = child(seek, SEEK_ID).filter(|i| (1..=4).contains(&i.len()))?;
            let id = id.iter().fold(0u32, |n, &b| (n << 8) | u32::from(b));
            Some((id, uint(child(seek, SEEK_POSITION)?)?))
        })
        .collect()
}

/// Text subtitle tracks: (track number, forced). Image subtitles (PGS, VobSub) are
/// left out: their index marks when pictures appear and clear, not lines with lengths.
fn text_tracks(tracks: &[u8]) -> Vec<(u64, bool)> {
    children(tracks)
        .filter(|(id, _)| *id == TRACK_ENTRY)
        .filter_map(|(_, entry)| {
            let kind = uint(child(entry, TRACK_TYPE)?)?;
            let codec = child(entry, CODEC_ID)?;
            let text = codec.starts_with(b"S_TEXT/") || codec == b"S_SSA" || codec == b"S_ASS";
            if kind != SUBTITLE_TRACK || !text {
                return None;
            }
            let forced = child(entry, FLAG_FORCED).and_then(uint).is_some_and(|f| f != 0);
            Some((uint(child(entry, TRACK_NUMBER)?)?, forced))
        })
        .collect()
}

/// Each wanted track's indexed lines: (start, duration) in the file's ticks.
/// A track's indexed lines: (start, duration) in the file's ticks.
type Lines = Vec<(u64, Option<u64>)>;

fn cue_lines(cues: &[u8], wanted: &[u64]) -> Vec<(u64, Lines)> {
    let mut out: Vec<(u64, Lines)> = wanted.iter().map(|&t| (t, Vec::new())).collect();
    for (_, point) in children(cues).filter(|(id, _)| *id == CUE_POINT) {
        let Some(time) = child(point, CUE_TIME).and_then(uint) else { continue };
        for (_, position) in children(point).filter(|(id, _)| *id == CUE_TRACK_POSITIONS) {
            let Some(track) = child(position, CUE_TRACK).and_then(uint) else { continue };
            if let Some((_, lines)) = out.iter_mut().find(|(t, _)| *t == track)
                && lines.len() < MAX_LINES
            {
                lines.push((time, child(position, CUE_DURATION).and_then(uint)));
            }
        }
    }
    out
}

/// Ticks to milliseconds; `scale` is nanoseconds per tick.
fn ms(ticks: u64, scale: u64) -> i64 {
    i64::try_from(u128::from(ticks) * u128::from(scale) / 1_000_000).unwrap_or(i64::MAX).min(100 * 3_600_000)
}

/// One track's lines as (start, end) in ms, sorted. Lines without a recorded duration
/// last `DEFAULT_LINE_MS` or until the next one starts.
fn spans(lines: &[(u64, Option<u64>)], scale: u64) -> Vec<(i64, i64)> {
    let mut sorted: Vec<(i64, Option<i64>)> = lines.iter().map(|&(t, d)| (ms(t, scale), d.map(|d| ms(d, scale)))).collect();
    sorted.sort_unstable_by_key(|(t, _)| *t);
    sorted.dedup_by_key(|(t, _)| *t);
    (0..sorted.len())
        .map(|i| {
            let (start, duration) = sorted[i];
            let end = match duration {
                Some(d) if d > 0 => start + d,
                _ => (start + DEFAULT_LINE_MS).min(sorted.get(i + 1).map_or(i64::MAX, |n| n.0)),
            };
            (start, end)
        })
        .collect()
}

/// Counts reads and bytes against the limits.
struct Budget<'a, S: Source> {
    source: &'a mut S,
    reads: usize,
    bytes: usize,
}

impl<S: Source> Budget<'_, S> {
    async fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, MkvError> {
        if self.reads == MAX_READS || self.bytes + len > MAX_TOTAL_BYTES {
            return Err(MkvError::TooBig);
        }
        self.reads += 1;
        let data = self.source.read(offset, len).await?;
        self.bytes += data.len();
        Ok(data)
    }

    /// The content of the element `id` at `offset`, if it's at most `cap` bytes.
    async fn element(&mut self, offset: u64, id: u32, cap: u64) -> Result<Vec<u8>, MkvError> {
        let head = self.read(offset, 12).await?;
        let h = header(&head).filter(|h| h.id == id).ok_or(MkvError::NotMatroska)?;
        let size = h.size.ok_or(MkvError::NotMatroska)?;
        if size > cap {
            return Err(MkvError::TooBig);
        }
        let body = self.read(offset.checked_add(h.len as u64).ok_or(MkvError::NotMatroska)?, size as usize).await?;
        if body.len() as u64 != size {
            return Err(MkvError::NotMatroska);
        }
        Ok(body)
    }
}

/// The lines of the file's best-indexed text subtitle track (the most lines,
/// a full track before a forced one), as (start, end) in ms.
pub async fn subtitle_timings(source: &mut impl Source) -> Result<Vec<(i64, i64)>, MkvError> {
    let mut budget = Budget { source, reads: 0, bytes: 0 };
    let head = budget.read(0, HEAD_BYTES).await?;

    let ebml = header(&head).filter(|h| h.id == EBML).ok_or(MkvError::NotMatroska)?;
    let ebml_end = ebml.len + usize::try_from(ebml.size.ok_or(MkvError::NotMatroska)?).map_err(|_| MkvError::NotMatroska)?;
    let doc_type = head.get(ebml.len..ebml_end).and_then(|h| child(h, DOC_TYPE)).ok_or(MkvError::NotMatroska)?;
    if doc_type != b"matroska" && doc_type != b"webm" {
        return Err(MkvError::NotMatroska);
    }
    let segment = head.get(ebml_end..).and_then(header).filter(|h| h.id == SEGMENT).ok_or(MkvError::NotMatroska)?;
    let base = ebml_end + segment.len;

    // The Segment's first elements, as far as the head reaches.
    let (mut info, mut tracks, mut cues, mut sought) = (None, None, None, Vec::new());
    let mut at = base;
    while let Some(h) = head.get(at..).and_then(header) {
        if h.id == CLUSTER {
            break;
        }
        let Some(size) = h.size.and_then(|s| usize::try_from(s).ok()) else { break };
        let content = head.get(at + h.len..).and_then(|c| c.get(..size));
        match (h.id, content) {
            (SEEK_HEAD, Some(c)) => sought.extend(seeks(c)),
            (INFO, Some(c)) => info = Some(c.to_vec()),
            (TRACKS, Some(c)) => tracks = Some(c.to_vec()),
            (CUES, Some(c)) => cues = Some(c.to_vec()),
            _ => {}
        }
        let Some(next) = (at + h.len).checked_add(size) else { break };
        at = next;
    }
    // A SeekPosition is the file's word: one near u64::MAX must not wrap (or panic) into another offset.
    let position = |id: u32| sought.iter().find(|(i, _)| *i == id).and_then(|(_, p)| (base as u64).checked_add(*p));

    if tracks.is_none() {
        let offset = position(TRACKS).ok_or(MkvError::NoTimings)?;
        tracks = Some(budget.element(offset, TRACKS, MAX_TRACKS_BYTES).await?);
    }
    // Checked before the (larger) index is read: no text subtitles, nothing to read.
    let mut wanted = text_tracks(tracks.as_deref().unwrap_or_default());
    if wanted.is_empty() {
        return Err(MkvError::NoTimings);
    }
    if info.is_none()
        && let Some(offset) = position(INFO)
    {
        info = Some(budget.element(offset, INFO, MAX_TRACKS_BYTES).await?);
    }
    let scale = info.as_deref().and_then(|i| child(i, TIMESTAMP_SCALE)).and_then(uint).filter(|s| *s > 0).unwrap_or(1_000_000);
    if cues.is_none() {
        let offset = position(CUES).ok_or(MkvError::NoTimings)?;
        cues = Some(budget.element(offset, CUES, MAX_CUES_BYTES).await?);
    }

    // Full tracks before forced ones (which only translate signs), then the most lines.
    wanted.sort_by_key(|(_, forced)| *forced);
    let numbers: Vec<u64> = wanted.iter().map(|(n, _)| *n).collect();
    let mut found = cue_lines(cues.as_deref().unwrap_or_default(), &numbers);
    found.retain(|(_, lines)| lines.len() >= super::align::MIN_SPANS);
    let forced = |n: u64| wanted.iter().any(|(t, f)| *t == n && *f);
    let best = found.into_iter().max_by_key(|(n, lines)| (!forced(*n), lines.len())).ok_or(MkvError::NoTimings)?;
    Ok(spans(&best.1, scale))
}

#[cfg(any(test, fuzzing))]
pub(crate) fn fuzz_input(data: &[u8]) {
    struct Memory<'a>(&'a [u8]);
    impl Source for Memory<'_> {
        async fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, SourceError> {
            let start = usize::try_from(offset)
                .unwrap_or(usize::MAX)
                .min(self.0.len());
            Ok(self.0[start..start.saturating_add(len).min(self.0.len())].to_vec())
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    if let Ok(spans) = runtime.block_on(subtitle_timings(&mut Memory(data))) {
        assert!(spans.len() <= MAX_LINES);
        assert!(spans.iter().all(|(s, e)| *s >= 0 && e >= s));
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// An EBML element: id bytes, an 8-byte size, content.
    pub fn el(id: u32, content: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = id.to_be_bytes().into_iter().skip_while(|&b| b == 0).collect();
        out.push(0x01);
        out.extend_from_slice(&(content.len() as u64).to_be_bytes()[1..]);
        out.extend_from_slice(content);
        out
    }

    fn uint_el(id: u32, v: u64) -> Vec<u8> {
        el(id, &v.to_be_bytes())
    }

    struct Memory(Vec<u8>, usize);

    impl Source for Memory {
        async fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, SourceError> {
            self.1 += 1;
            let start = (offset as usize).min(self.0.len());
            Ok(self.0[start..(start + len).min(self.0.len())].to_vec())
        }
    }

    fn track(number: u64, kind: u64, codec: &str, forced: bool) -> Vec<u8> {
        el(TRACK_ENTRY, &[uint_el(TRACK_NUMBER, number), uint_el(TRACK_TYPE, kind), el(CODEC_ID, codec.as_bytes()), uint_el(FLAG_FORCED, u64::from(forced))].concat())
    }

    /// A file with video (1), a forced text track (2, 12 lines), a full one (3, 40 lines)
    /// and PGS (4); Cues after a big Cluster, found through SeekHead.
    pub fn sample(with_durations: bool) -> Vec<u8> {
        let tracks = el(TRACKS, &[track(1, 1, "V_MPEG4/ISO/AVC", false), track(2, 0x11, "S_TEXT/UTF8", true), track(3, 0x11, "S_TEXT/ASS", false), track(4, 0x11, "S_HDMV/PGS", false)].concat());
        let info = el(INFO, &uint_el(TIMESTAMP_SCALE, 1_000_000));
        let mut points = Vec::new();
        for i in 0..40u64 {
            let mut pos = [uint_el(CUE_TRACK, 3), uint_el(0xF1, 0)].concat();
            if with_durations {
                pos.extend(uint_el(CUE_DURATION, 1500));
            }
            points.extend(el(CUE_POINT, &[uint_el(CUE_TIME, 10_000 + i * 4000), el(CUE_TRACK_POSITIONS, &pos)].concat()));
        }
        for i in 0..12u64 {
            points.extend(el(CUE_POINT, &[uint_el(CUE_TIME, 5_000 + i * 9000), el(CUE_TRACK_POSITIONS, &[uint_el(CUE_TRACK, 2), uint_el(CUE_DURATION, 800)].concat())].concat()));
        }
        let cues = el(CUES, &points);
        let cluster = el(CLUSTER, &vec![0u8; HEAD_BYTES]);
        // SeekHead positions are relative to the Segment content; its own size is fixed.
        let seek = |id: u32, pos: u64| el(SEEK, &[el(SEEK_ID, &id.to_be_bytes()), uint_el(SEEK_POSITION, pos)].concat());
        let seek_len = el(SEEK_HEAD, &[seek(INFO, 0), seek(TRACKS, 0), seek(CUES, 0)].concat()).len() as u64;
        let info_at = seek_len;
        let tracks_at = info_at + info.len() as u64;
        let cues_at = tracks_at + tracks.len() as u64 + cluster.len() as u64;
        let seek_head = el(SEEK_HEAD, &[seek(INFO, info_at), seek(TRACKS, tracks_at), seek(CUES, cues_at)].concat());
        let segment = el(SEGMENT, &[seek_head, info, tracks, cluster, cues].concat());
        [el(EBML, &el(DOC_TYPE, b"matroska")), segment].concat()
    }

    fn run(file: Vec<u8>) -> (Result<Vec<(i64, i64)>, MkvError>, usize) {
        let mut source = Memory(file, 0);
        let result = tauri::async_runtime::block_on(subtitle_timings(&mut source));
        (result, source.1)
    }

    #[test]
    fn reads_the_full_text_track_from_the_index() {
        let (result, reads) = run(sample(true));
        let lines = result.unwrap();
        assert_eq!(lines.len(), 40);
        assert_eq!(lines[0], (10_000, 11_500));
        assert_eq!(lines[39], (10_000 + 39 * 4000, 10_000 + 39 * 4000 + 1500));
        // The head, then the Cues element's header and content.
        assert_eq!(reads, 3);
    }

    #[test]
    fn lines_without_durations_get_a_default_length() {
        let lines = run(sample(false)).0.unwrap();
        assert_eq!(lines[0], (10_000, 10_000 + DEFAULT_LINE_MS));
        assert_eq!(spans(&[(0, None), (1000, None), (2000, Some(0))], 1_000_000), vec![(0, 1000), (1000, 2000), (2000, 2000 + DEFAULT_LINE_MS)]);
    }

    #[test]
    fn rejects_other_files_and_damage() {
        assert_eq!(run(b"RIFF....AVI LIST".to_vec()).0, Err(MkvError::NotMatroska));
        assert_eq!(run(Vec::new()).0, Err(MkvError::NotMatroska));
        let mut webm_doc = sample(true);
        let at = webm_doc.windows(8).position(|w| w == b"matroska").unwrap();
        webm_doc[at..at + 8].copy_from_slice(b"mp4mp4mp");
        assert_eq!(run(webm_doc).0, Err(MkvError::NotMatroska));
        // Cut off before the index: its content can't be read in full.
        let mut cut = sample(true);
        cut.truncate(cut.len() - 100);
        assert_eq!(run(cut).0, Err(MkvError::NotMatroska));
    }

    #[test]
    fn no_text_subtitles_means_no_index_read() {
        let tracks = el(TRACKS, &[track(1, 1, "V_MPEGH/ISO/HEVC", false), track(2, 0x11, "S_HDMV/PGS", false)].concat());
        let file = [el(EBML, &el(DOC_TYPE, b"webm")), el(SEGMENT, &tracks)].concat();
        let (result, reads) = run(file);
        assert_eq!(result, Err(MkvError::NoTimings));
        assert_eq!(reads, 1);
    }

    #[test]
    fn numbers_and_sizes_are_checked() {
        assert_eq!(vint(&[0x81], 8), Some((1, false, 1)));
        assert_eq!(vint(&[0xFF], 8), Some((127, true, 1)));
        assert_eq!(vint(&[0x40, 0x02], 8), Some((2, false, 2)));
        assert_eq!(vint(&[0x00], 8), None);
        assert_eq!(vint(&[0x10, 0, 0], 4), None);
        // A child claiming more than its parent holds ends the list.
        let parent = [el(0xD7, &[1]), vec![0x86, 0x88]].concat();
        assert_eq!(children(&parent).count(), 1);
        assert_eq!(uint(&[1; 9]), None);
        assert_eq!(ms(u64::MAX, u64::MAX), 100 * 3_600_000);
    }

    /// A SeekHead entry near u64::MAX: the file is refused, it doesn't overflow.
    #[test]
    fn a_seek_position_past_the_end_of_numbers_is_refused() {
        let header = el(EBML, &el(DOC_TYPE, b"matroska"));
        let seek = [el(SEEK_ID, &TRACKS.to_be_bytes()), uint_el(SEEK_POSITION, u64::MAX)].concat();
        let data = [header, el(SEGMENT, &el(SEEK_HEAD, &el(SEEK, &seek)))].concat();
        assert!(std::panic::catch_unwind(|| fuzz_input(&data)).is_ok(), "subtitle_timings panicked on a SeekPosition of u64::MAX");
    }
}
