/**
 * Which sources Orbit may start on its own: Play, the next episode, "Best
 * source automatically". The source list itself always shows everything;
 * these rules only narrow what an automatic pick may land on.
 *
 * - Autoplay limits (Settings → Playback, per profile): lowest and highest
 *   quality, largest file. Unlike "Never above" and "Maximum size" under
 *   "Choosing a source", which only reorder the list (and so also order the
 *   picker), these are a filter on top of that order: the pick is the
 *   best-ranked source that fits. When none fits, the best-ranked one plays
 *   anyway and the person is told.
 * - A debrid source that isn't cached yet is never picked automatically: it
 *   would play the service's "downloading" clip instead of the film.
 */
import * as v from 'valibot';
import type { Resolution, SourceTraits } from './ranking-fallback';

export interface AutoplayLimits {
  /** Sources below this (or of unknown quality) don't fit; null is any. */
  minQuality: Resolution | null;
  /** Sources above this don't fit; null is any. */
  maxQuality: Resolution | null;
  /** Largest file in GB (whole numbers, 1–50); 0 is any. Sources that don't give a size fit. */
  maxSizeGB: number;
}

/** Any quality, any size: what Orbit did before the limits existed. */
export const NO_AUTOPLAY_LIMITS: AutoplayLimits = { minQuality: null, maxQuality: null, maxSizeGB: 0 };
/** The qualities a limit can be. */
export const LIMIT_QUALITIES = ['720p', '1080p', '2160p'] as const satisfies readonly Resolution[];
export const MAX_LIMIT_GB = 50;

const RANK: Record<Resolution, number> = { '480p': 0, '720p': 1, '1080p': 2, '2160p': 3 };
export const qualityRank = (quality: Resolution) => RANK[quality];

const Quality = v.fallback(v.nullable(v.picklist(LIMIT_QUALITIES)), null);
const LimitsSchema = v.object({
  minQuality: Quality,
  maxQuality: Quality,
  maxSizeGB: v.fallback(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_LIMIT_GB)), 0),
});

/** Saved limits, field by field (one bad value never resets the rest). */
export function parseAutoplayLimits(value: unknown): AutoplayLimits {
  const parsed = v.safeParse(LimitsSchema, typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {});
  return parsed.success ? parsed.output : { ...NO_AUTOPLAY_LIMITS };
}

/** Why a source isn't a first choice for an automatic pick; undefined when it is. */
export type AutoplayGate = 'uncached' | 'outside-limits';

/**
 * `largestGB`: the larger of the size the addon hints and the one its text
 * shows, so a "9.96 GB" file shown as "10 GB" (or the other way round) can't
 * slip under a 10 GB cap.
 */
export function withinLimits(source: { traits: SourceTraits; largestGB?: number | undefined }, limits: AutoplayLimits): boolean {
  const res = source.traits.resolution;
  // An unknown quality can't be shown to reach a minimum; it can't exceed a maximum either.
  if (limits.minQuality && (!res || RANK[res] < RANK[limits.minQuality])) return false;
  if (limits.maxQuality && res && RANK[res] > RANK[limits.maxQuality]) return false;
  const size = source.largestGB ?? source.traits.sizeGB;
  return !(limits.maxSizeGB > 0 && size !== undefined && size > limits.maxSizeGB);
}

export function autoplayGate(source: { traits: SourceTraits; largestGB?: number | undefined }, limits: AutoplayLimits): AutoplayGate | undefined {
  if (source.traits.uncached) return 'uncached';
  return withinLimits(source, limits) ? undefined : 'outside-limits';
}

/**
 * What an automatic pick chooses from, keeping the ranked order: the sources
 * that fit the limits, or (`fellBack`) when none does, every one that may be
 * started automatically at all. Empty when every source is uncached.
 */
export function autoCandidates<T extends { autoplay?: AutoplayGate | undefined }>(sources: readonly T[]): { list: T[]; fellBack: boolean } {
  const fits = sources.filter((s) => !s.autoplay);
  if (fits.length) return { list: fits, fellBack: false };
  const allowed = sources.filter((s) => s.autoplay !== 'uncached');
  return { list: allowed, fellBack: allowed.length > 0 };
}

/** A source as good as the profile allows (4K, or the highest-quality limit): no need to wait long for better. */
export const isTopQuality = (traits: SourceTraits, limits: AutoplayLimits) => traits.resolution === (limits.maxQuality ?? '2160p');

/** How long an automatic pick waits for slower addons, and how much longer once a top-quality source is in. */
export const COLLECT_WINDOW_MS = 2000;
export const TOP_GRACE_MS = 450;

/** When collecting may stop (given something worth playing is in): the window's end, or soon after a top-quality source came. */
export function collectDeadline(startedAt: number, topAt: number | undefined, windowMs = COLLECT_WINDOW_MS, graceMs = TOP_GRACE_MS): number {
  return topAt === undefined ? startedAt + windowMs : Math.min(startedAt + windowMs, topAt + graceMs);
}

/** What the caller knows after an event: whether a source worth playing is in, and whether a top-quality one is. */
export interface CollectState {
  candidate: boolean;
  top: boolean;
}

/**
 * Reads `events` for an automatic pick: until they end (every addon
 * answered), or until the collect window closes with a source worth playing
 * in hand, then calls `stop` (which should end the events' source). Without
 * any candidate it keeps waiting, as before the window existed.
 * `onEvent` takes each event and says what's in so far.
 */
export async function collectForAutoplay<E>(
  events: AsyncIterator<E>,
  onEvent: (event: E) => CollectState,
  stop: () => void,
  options: { now?: () => number; windowMs?: number; graceMs?: number } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let topAt: number | undefined;
  let candidate = false;
  const deadline = () => collectDeadline(startedAt, topAt, options.windowMs, options.graceMs);
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = events.next();
    const result = candidate
      ? await Promise.race([pending, new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline() - now()))))])
      : await pending;
    clearTimeout(timer);
    if (result === 'timeout') return stop();
    if (result.done) return;
    const state = onEvent(result.value);
    candidate ||= state.candidate;
    if (state.candidate && state.top && topAt === undefined) topAt = now();
    if (candidate && now() >= deadline()) return stop();
  }
}
