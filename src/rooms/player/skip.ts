/**
 * Skip Intro: where the intro, recap and credits are in the playing video.
 * Up to three sources, merged in this order of trust: the file's own chapter
 * names (exact for this file, and private), TheIntroDB's community times,
 * then for anime AniSkip's (both fetched in Rust; AniSkip only when turned
 * on, see skip-tuning.ts). A later source only fills what the earlier ones
 * left open.
 */

import { t, type MessageKey } from '../../i18n';

export const SEGMENT_KINDS = ['intro', 'recap', 'credits', 'preview'] as const;
/** "preview" is TheIntroDB's "next time on…" after the credits. */
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export interface Segment {
  kind: SegmentKind;
  /** Seconds. */
  start: number;
  end: number;
}

/** As TheIntroDB reports it: null start is the beginning, null end the end of the video. */
export interface LooseSegment {
  kind: SegmentKind;
  start: number | null;
  end: number | null;
  /** AniSkip: how long the video the times were taken from was, in seconds. */
  length?: number | null;
}

export interface Chapter {
  title: string | null;
  time: number;
}

export const SKIP_LABELS: Record<SegmentKind, string> = { intro: t('player.skip.intro'), recap: t('player.skip.recap'), credits: t('player.skip.credits'), preview: t('playerplus.skip.preview') };

/** Each kind's name ("Intro"), as the seek bar's bands and the Chapters view call it. */
export const BAND_NAMES = {
  intro: 'playerplus.bands.intro',
  recap: 'playerplus.bands.recap',
  credits: 'playerplus.bands.credits',
  preview: 'playerplus.bands.preview',
} as const satisfies Record<SegmentKind, MessageKey>;

/** What happens when each kind of segment plays: nothing, a Skip button, or skipped without asking. */
export const SKIP_MODES = ['off', 'button', 'auto'] as const;
export type SkipMode = (typeof SKIP_MODES)[number];
export type SkipModes = Record<SegmentKind, SkipMode>;

/** Settings → Playback → Skipping, per kind. */
export const SKIP_MODES_KEY = 'playback.skip-modes';

/**
 * The saved modes. Before there was one per kind, a single switch skipped
 * intros and recaps without asking (`legacyAuto`); with nothing saved yet it
 * still decides, and credits keep their button either way.
 */
export function parseSkipModes(saved: unknown, legacyAuto: unknown): SkipModes {
  const opening: SkipMode = legacyAuto === true ? 'auto' : 'button';
  const modes: SkipModes = { intro: opening, recap: opening, credits: 'button', preview: 'button' };
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return modes;
  for (const kind of SEGMENT_KINDS) {
    const value = (saved as Record<string, unknown>)[kind];
    const mode = SKIP_MODES.find((m) => m === value);
    if (mode) modes[kind] = mode;
  }
  return modes;
}

/** Settings → Playback → Skipping: how long an automatic skip waits, counting down on the Skip button (0: at once). */
export const AUTO_SKIP_DELAYS = [0, 2, 3, 5] as const;
export type AutoSkipDelay = (typeof AUTO_SKIP_DELAYS)[number];
export const AUTO_SKIP_DELAY_KEY = 'playback.auto-skip-delay';
export const parseAutoSkipDelay = (value: unknown): AutoSkipDelay => AUTO_SKIP_DELAYS.find((d) => d === value) ?? 0;

/**
 * Whole seconds left before an automatic skip, counted in playback time from
 * `since` (where the segment was reached), so pausing pauses the countdown
 * too. 0 is "skip now".
 */
export function autoSkipLeft(since: number, now: number, delay: number): number {
  if (!(delay > 0)) return 0;
  return Math.max(0, Math.ceil(delay - Math.max(0, now - since)));
}

/** Credits (or a preview) that run to the very end: nothing is left to skip to but what plays next. */
const TO_THE_END = 3;
export const runsToEnd = (segment: Segment, duration: number) => (segment.kind === 'credits' || segment.kind === 'preview') && segment.end >= duration - TO_THE_END;

/** Shorter than this isn't worth a button. */
const MIN_SEGMENT = 2;
/** Longer than this isn't an intro or recap (credits can run long). */
const MAX_OPENING = 300;
/** Credits only count in the second half of the video. */
const CREDITS_FROM = 0.5;
/** The button leaves this close to the end, so it doesn't vanish under a click. */
const END_MARGIN = 0.75;

// Checked in this order, so "Opening credits" is an intro.
const CHAPTER_KINDS: [SegmentKind, RegExp][] = [
  ['recap', /\b(recap|previously)\b/i],
  ['intro', /\b(intro|opening|op|theme song)\b/i],
  ['credits', /\b(credits|ending|ed|outro)\b/i],
  ['preview', /\b(preview|next time|next episode)\b/i],
];

/** Segments named by the file's chapters; each runs until the next chapter. */
export function chapterSegments(chapters: readonly Chapter[], duration: number): LooseSegment[] {
  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  return sorted.flatMap((chapter, i) => {
    const kind = CHAPTER_KINDS.find(([, pattern]) => pattern.test(chapter.title ?? ''))?.[0];
    return kind ? [{ kind, start: chapter.time, end: sorted[i + 1]?.time ?? duration }] : [];
  });
}

/** Fills in open ends and drops anything implausible for a video of `duration` seconds. */
export function normalize(segments: readonly LooseSegment[], duration: number): Segment[] {
  if (!(duration > 0)) return [];
  return segments.flatMap((s) => {
    const start = Math.max(0, s.start ?? 0);
    const end = Math.min(duration, s.end ?? duration);
    const length = end - start;
    if (length < MIN_SEGMENT) return [];
    const closing = s.kind === 'credits' || s.kind === 'preview';
    if (closing ? start < duration * CREDITS_FROM : length > MAX_OPENING) return [];
    return [{ kind: s.kind, start, end }];
  });
}

/** `preferred` first, then each of `others` that doesn't overlap one already kept. */
export function merge(preferred: readonly Segment[], others: readonly Segment[]): Segment[] {
  const kept: Segment[] = [];
  for (const s of [...preferred, ...others]) {
    if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** The segment playing at `position`, if any. */
export function activeSegment(segments: readonly Segment[], position: number): Segment | undefined {
  return segments.find((s) => position >= s.start && position < s.end - END_MARGIN);
}

/** A Skip or Next button stays quiet for this many seconds of playback after it appears… */
export const QUIET_FOR = 4;
/** …unless what it skips ends within this many seconds. */
export const LOUD_BEFORE_END = 5;

/**
 * How a Skip or Next button looks: quiet (small, outlined) when it first
 * appears at `shownAt`, so it doesn't shout over the start of a scene, and
 * prominent (filled, larger) once it's been up a few seconds or the end
 * (`end`) is near. With reduced motion it's prominent from the start, so
 * nothing changes on screen by itself.
 */
export function skipProminence(shownAt: number, position: number, end: number, reduced: boolean): 'subtle' | 'prominent' {
  if (reduced) return 'prominent';
  // A seek back within it counts as time it has been up: it has been seen.
  return Math.abs(position - shownAt) >= QUIET_FOR || end - position <= LOUD_BEFORE_END ? 'prominent' : 'subtle';
}

/** After this many seconds of playback up, a Skip or Next button steps back while the controls are hidden (it comes back with them). */
export const TUCK_AFTER = 10;

/** Whether a button up since `shownAt` has been up long enough to step back with the controls. */
export const tucked = (shownAt: number, position: number) => Math.abs(position - shownAt) >= TUCK_AFTER;

/** How long "Back to 1:23" is offered after a skip. */
export const UNDO_MS = 5000;

/** A skip that can be taken back: where it was made from (`to`), where it landed, and until when (ms since the epoch). */
export interface SkipUndo {
  key: string;
  to: number;
  landed: number;
  until: number;
}

/** Whether `undo` is still offered at `position`: not once it times out, or playback moved well away from where the skip landed (a seek elsewhere). */
export function undoOffered(undo: SkipUndo, position: number | null, now: number): boolean {
  if (now >= undo.until) return false;
  return position === null || (position >= undo.landed - 2 && position <= undo.landed + 15);
}
