/**
 * Tonight: three suggestions that fit the time the person has and their
 * mood, chosen only from what Orbit already holds (Continue Watching, My
 * Library, catalog pages already loaded). Pure, so the rules are testable;
 * the drawer (rooms/tonight) gathers the inputs and applies the profile's
 * content limit before they get here.
 *
 * The rules:
 * - Only movies and shows. A title offered by several sources counts once,
 *   as its strongest source (Continue Watching, then My Library, then a catalog).
 * - Time: what Play would start (what's left of something in progress, an
 *   episode for a show) must fit, with a few minutes' grace. An unknown
 *   length only fits "120+", which has no limit.
 * - Mood: the title's genres must include one of the mood's, and none it
 *   rules out. A title without genres fits no mood (but fits "any").
 * - Finished titles are left out (Continue Watching's always have something
 *   left: a new episode), and "Unwatched only" leaves out anything started.
 * - Best first: Continue Watching, then My Library, then catalogs; within
 *   each, how much of the time it fills plus its rating (each counting
 *   0–1), then the order they came in. The first three take at most two from one source
 *   while others fit, so there's always something new when there can be.
 */
import { genreTags, type GenreTag } from './genre-tags';
import type { Title } from './titles';

/** Minutes the person has; 120 means "120+" (no limit). */
export const TONIGHT_TIMES = [30, 60, 90, 120] as const;
export type TonightTime = (typeof TONIGHT_TIMES)[number];

export const TONIGHT_MOODS = ['light', 'intense', 'cozy', 'mind-bending'] as const;
export type TonightMood = (typeof TONIGHT_MOODS)[number];

export interface TonightChoice {
  time: TonightTime;
  /** Null for any mood. */
  mood: TonightMood | null;
  unwatchedOnly: boolean;
}

export type TonightSource = 'continue' | 'library' | 'catalog';

export interface TonightCandidate {
  title: Title;
  from: TonightSource;
  /** Minutes Play would start (what's left of one in progress; an episode's for a show); 0 when unknown. */
  minutes: number;
  /** Has any watch history. */
  started: boolean;
  /** A watched movie, or a show with nothing left to play. */
  finished: boolean;
}

/** Over the chosen time by this much still fits: a 95-minute film is a 90-minute evening. */
export const GRACE_MINUTES = 5;
/** Suggestions shown at once. */
export const TONIGHT_COUNT = 3;
/** The most of the first suggestions one source may take while others fit. */
const PER_SOURCE = 2;

const SOURCE_WEIGHT: Record<TonightSource, number> = { continue: 3, library: 2, catalog: 0 };

/** The dark genres a gentle mood rules out (as Home's "Feel-good" mood does). */
const DARK: readonly GenreTag[] = ['horror', 'thriller', 'war'];

/** Each mood's genres: any of `any`, none of `none`. Light is Home's "Feel-good"; mind-bending draws on what Home's does. */
export const MOOD_TAGS: Record<TonightMood, { any: readonly GenreTag[]; none: readonly GenreTag[] }> = {
  light: { any: ['comedy', 'family', 'animation'], none: DARK },
  intense: { any: ['action', 'thriller', 'horror', 'war'], none: [] },
  cozy: { any: ['romance', 'family', 'animation'], none: DARK },
  'mind-bending': { any: ['scifi', 'mystery'], none: [] },
};

export function fitsTime(minutes: number, time: TonightTime): boolean {
  if (time === 120) return true;
  return minutes > 0 && minutes <= time + GRACE_MINUTES;
}

export function fitsMood(genres: readonly string[], mood: TonightMood | null): boolean {
  if (mood === null) return true;
  const tags = genreTags(genres);
  const { any, none } = MOOD_TAGS[mood];
  return any.some((tag) => tags.has(tag)) && !none.some((tag) => tags.has(tag));
}

function fits(c: TonightCandidate, choice: TonightChoice): boolean {
  if (c.title.type !== 'movie' && c.title.type !== 'series') return false;
  if (c.finished && c.from !== 'continue') return false;
  if (choice.unwatchedOnly && c.started) return false;
  return fitsTime(c.minutes, choice.time) && fitsMood(c.title.genres, choice.mood);
}

/** How much of the time it fills, 0–1 (unknown: 0). "120+" counts two hours as full. */
function fill(minutes: number, time: TonightTime): number {
  return minutes > 0 ? Math.min(1, minutes / time) : 0;
}

/** An IMDb-style rating as 0–1 (unknown: 0). */
function rated(title: Title): number {
  const value = Number.parseFloat(title.rating ?? '');
  return Number.isFinite(value) ? Math.min(10, Math.max(0, value)) / 10 : 0;
}

/** Every candidate that fits, once each, best first. */
export function rankTonight(pool: readonly TonightCandidate[], choice: TonightChoice): TonightCandidate[] {
  const byId = new Map<string, { candidate: TonightCandidate; order: number }>();
  pool.forEach((candidate, order) => {
    const known = byId.get(candidate.title.id);
    if (!known) byId.set(candidate.title.id, { candidate, order });
    // The stronger source wins, at the place the title first came in.
    else if (SOURCE_WEIGHT[candidate.from] > SOURCE_WEIGHT[known.candidate.from]) known.candidate = candidate;
  });
  const score = (c: TonightCandidate) => SOURCE_WEIGHT[c.from] + fill(c.minutes, choice.time) + rated(c.title);
  return [...byId.values()]
    .filter(({ candidate }) => fits(candidate, choice))
    .map((entry) => ({ ...entry, score: score(entry.candidate) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ candidate }) => candidate);
}

/**
 * Up to `count` suggestions from `ranked` (see rankTonight), leaving out
 * `exclude` (already offered): best first, at most two from one source
 * while others are left. "Another" is the same with a count of one.
 */
export function pickTonight(ranked: readonly TonightCandidate[], exclude: ReadonlySet<string>, count = TONIGHT_COUNT): TonightCandidate[] {
  const open = ranked.filter((c) => !exclude.has(c.title.id));
  const picks: TonightCandidate[] = [];
  const perSource = new Map<TonightSource, number>();
  for (const c of open) {
    if (picks.length >= count) break;
    const taken = perSource.get(c.from) ?? 0;
    if (taken >= PER_SOURCE) continue;
    perSource.set(c.from, taken + 1);
    picks.push(c);
  }
  // Not enough variety to go round: fill up in rank order.
  for (const c of open) {
    if (picks.length >= count) break;
    if (!picks.includes(c)) picks.push(c);
  }
  return picks.sort((a, b) => open.indexOf(a) - open.indexOf(b));
}
