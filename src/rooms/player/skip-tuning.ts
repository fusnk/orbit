/**
 * Settings → Playback → Skipping, the finer points: AniSkip as a second
 * source for anime, the smooth skip, how long the Skip button waits, where a
 * skip lands, and each kind's colour on the seek bar. The keys, the parsers
 * and the rules; skip-controller.ts and skip-transition.ts apply them.
 */
import type { MessageKey } from '../../i18n';
import { normalize, runsToEnd, SEGMENT_KINDS, type LooseSegment, type Segment, type SegmentKind } from './skip';

/** Ask AniSkip for anime openings and endings too (default off: it's one more outside service). */
export const ANISKIP_KEY = 'playback.aniskip';
export const parseAniSkip = (value: unknown): boolean => value === true;

/** Fade out and back in around a skip (default on; never with Reduce motion). */
export const SMOOTH_SKIP_KEY = 'playback.smooth-skip';
export const parseSmoothSkip = (value: unknown): boolean => value !== false;

/** Seconds of a segment that play before its Skip button appears (0: at once). Automatic skips don't wait for it. */
export const SKIP_BUTTON_DELAYS = [0, 2, 5] as const;
export type SkipButtonDelay = (typeof SKIP_BUTTON_DELAYS)[number];
export const SKIP_BUTTON_DELAY_KEY = 'playback.skip-button-delay';
export const parseSkipButtonDelay = (value: unknown): SkipButtonDelay => SKIP_BUTTON_DELAYS.find((d) => d === value) ?? 0;

/** Seconds before a segment's end that a skip lands (0: at the end), so the first moment after it isn't cut. */
export const SKIP_LANDINGS = [0, 1, 2, 3, 4, 5] as const;
export type SkipLanding = (typeof SKIP_LANDINGS)[number];
export const SKIP_LANDING_KEY = 'playback.skip-landing';
export const parseSkipLanding = (value: unknown): SkipLanding => SKIP_LANDINGS.find((d) => d === value) ?? 0;

/**
 * Where skipping `segment` lands: `offset` seconds before its end, but never
 * before its start. Credits (or a preview) that run to the end go to the end
 * as always, where what plays next takes over.
 */
export function landing(segment: Segment, duration: number | null, offset: number): number {
  if (duration && runsToEnd(segment, duration)) return segment.end;
  return Math.max(segment.start, segment.end - Math.max(0, offset));
}

/** Whether a Skip button reached at `reachedAt` has waited out `delay` seconds of playback (a seek within it counts, as for prominence). */
export const buttonDue = (reachedAt: number, position: number, delay: number): boolean => !(delay > 0) || Math.abs(position - reachedAt) >= delay;

/** Times taken from a cut more than this many seconds longer or shorter than the playing one don't fit it. */
const CUT_TOLERANCE = 15;

/**
 * The three sources, in order of trust: the file's own chapters (exact for
 * this very file), TheIntroDB, then AniSkip. A later source only fills what
 * the earlier ones left open (no overlap, see `merge`); AniSkip's times are
 * dropped when they were taken from a cut of another length.
 */
export function aniSkipFits(segments: readonly LooseSegment[], duration: number): LooseSegment[] {
  return segments.filter((s) => !s.length || !(duration > 0) || Math.abs(s.length - duration) <= CUT_TOLERANCE);
}

/** AniSkip's times for a video of `duration` seconds, ready to merge after the others. */
export const aniSkipSegments = (segments: readonly LooseSegment[], duration: number): Segment[] => normalize(aniSkipFits(segments, duration), duration);

/** Colours each kind may have on the seek bar ('default' is the theme's own). */
export const SEGMENT_SWATCHES = {
  default: '',
  amber: '#f5b041',
  sky: '#6fb6ff',
  mint: '#5fd3a5',
  rose: '#ff7a9c',
  violet: '#b08cff',
  white: '#e9e9e9',
} as const;
export type SegmentSwatch = keyof typeof SEGMENT_SWATCHES;
export const SWATCH_NAMES: Record<SegmentSwatch, MessageKey> = {
  default: 'movix.swatch.default',
  amber: 'movix.swatch.amber',
  sky: 'movix.swatch.sky',
  mint: 'movix.swatch.mint',
  rose: 'movix.swatch.rose',
  violet: 'movix.swatch.violet',
  white: 'movix.swatch.white',
};
export type SegmentColors = Record<SegmentKind, SegmentSwatch>;
export const SEGMENT_COLORS_KEY = 'playback.segment-colors';

/** The saved colour per kind; anything unknown is the default. */
export function parseSegmentColors(value: unknown): SegmentColors {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const colors = {} as SegmentColors;
  for (const kind of SEGMENT_KINDS) {
    const swatch = saved[kind];
    colors[kind] = typeof swatch === 'string' && Object.hasOwn(SEGMENT_SWATCHES, swatch) ? (swatch as SegmentSwatch) : 'default';
  }
  return colors;
}

/** Sets the seek bar's band colours on `element` (`--band-intro`…); a default colour leaves the stylesheet's. */
export function applySegmentColors(element: HTMLElement, colors: SegmentColors): void {
  for (const kind of SEGMENT_KINDS) {
    const hex = SEGMENT_SWATCHES[colors[kind]];
    if (hex) element.style.setProperty(`--band-${kind}`, hex);
    else element.style.removeProperty(`--band-${kind}`);
  }
}
