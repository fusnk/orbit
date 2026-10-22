/**
 * Learned intro skipping: where the person skipped an intro by hand in a
 * series (the Skip button, or seeking forward across a stretch near the
 * start), so its later episodes offer "Skip intro" at the same time when
 * neither the file's chapters nor TheIntroDB say where the intro is (see
 * skip-controller.ts).
 *
 * Kept per profile, on this device only, for the series skipped in most
 * recently; nothing about it goes to the network.
 */
import * as v from 'valibot';
import { profileStore } from './profile-store';
import type { LooseSegment } from './skip';

export const LEARNED_SKIPS_PREFIX = 'player.learned-skips';
/** Settings → Playback → Learn where I skip intros (on unless turned off). */
export const LEARN_SKIPS_KEY = 'playback.learn-skips';

/** Series remembered; with title ids capped below, the setting stays well under its 64 KB. */
export const MAX_SHOWS = 300;
const MAX_TITLE_ID = 100;
/** Shorter than this is a nudge (a press or two of →), not skipping an intro. */
export const MIN_SKIP = 20;
/** Longer than this isn't an intro (as skip.ts's MAX_OPENING): e.g. a number key jumping halfway in. */
export const MAX_SKIP = 300;
/** Intros start in the first ten minutes; a skip from later on is something else. */
export const LEARN_WITHIN = 600;
/** Seeks this close together are one skip: → pressed a few times, or a few clicks along the seek bar. */
export const RUN_GAP_MS = 3000;
/**
 * Intros move a little between episodes: skips whose start and end are each
 * within this many seconds are the same intro, and the button shows up this
 * early.
 */
export const TOLERANCE = 10;
/** How sure a learned intro gets: each matching skip adds one, a different one takes one off. */
export const MAX_HITS = 5;

/** [series id, start, end (seconds), how many skips matched it]. */
export type Learned = [titleId: string, start: number, end: number, hits: number];

export interface Intro {
  start: number;
  end: number;
}

const Seconds = v.pipe(v.number(), v.finite(), v.minValue(0));
const EntrySchema = v.pipe(
  v.tuple([v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TITLE_ID)), Seconds, Seconds, v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_HITS))]),
  v.check(([, start, end]) => start < LEARN_WITHIN && end - start >= MIN_SKIP && end - start <= MAX_SKIP),
);

/** Saved intros, oldest first, minus junk (they can come from a hand-edited backup). */
export function parseLearned(value: unknown): Learned[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: Learned[] = [];
  // From the newest, so a duplicated series keeps its latest times.
  for (const raw of [...value].reverse()) {
    if (entries.length >= MAX_SHOWS) break;
    const r = v.safeParse(EntrySchema, raw);
    if (!r.success || seen.has(r.output[0])) continue;
    seen.add(r.output[0]);
    entries.push(r.output as Learned);
  }
  return entries.reverse();
}

/** A skip in progress: where it left from, where it has got to, and when it last moved (ms). */
export interface SeekRun {
  from: number;
  to: number;
  at: number;
}

/**
 * Adds a seek from `from` to `to` (at `now`) to the skip in progress, or
 * starts one. Seeks in quick succession add up, and a step back within it
 * trims an overshoot; going back before where it started, or a first seek
 * backwards, is watching something again: no skip.
 */
export function addSeek(run: SeekRun | undefined, from: number, to: number, now: number): SeekRun | undefined {
  if (run && now - run.at <= RUN_GAP_MS) return to > run.from ? { from: run.from, to, at: now } : undefined;
  return to > from ? { from, to, at: now } : undefined;
}

const tenths = (seconds: number) => Math.round(seconds * 10) / 10;

/** The intro a finished skip passed over, or null for a nudge, a long jump, or a skip from past the first minutes. */
export function skippedIntro(run: Pick<SeekRun, 'from' | 'to'>): Intro | null {
  const length = run.to - run.from;
  if (!(run.from >= 0) || run.from >= LEARN_WITHIN || !(length >= MIN_SKIP) || length > MAX_SKIP) return null;
  return { start: tenths(run.from), end: tenths(run.to) };
}

/** Whether two skips passed over the same intro (allowing for how intros move between episodes). */
export const sameIntro = (a: Intro, b: Intro): boolean => Math.abs(a.start - b.start) <= TOLERANCE && Math.abs(a.end - b.end) <= TOLERANCE;

/**
 * Notes an intro skipped in a series, making it the most recently used. One
 * like the learned one confirms it (taking the newer times); a different one
 * replaces it, unless it had been confirmed: then a single odd skip only
 * makes it less sure. The least recently used go past the cap.
 */
export function learnIntro(entries: readonly Learned[], titleId: string, intro: Intro): Learned[] {
  if (!titleId || titleId.length > MAX_TITLE_ID) return [...entries];
  const old = entries.find(([id]) => id === titleId);
  let entry: Learned = [titleId, intro.start, intro.end, 1];
  if (old && sameIntro({ start: old[1], end: old[2] }, intro)) entry = [titleId, intro.start, intro.end, Math.min(MAX_HITS, old[3] + 1)];
  else if (old && old[3] > 1) entry = [titleId, old[1], old[2], old[3] - 1];
  return [...entries.filter(([id]) => id !== titleId), entry].slice(-MAX_SHOWS);
}

/** The intro learned for a series, if any. */
export function learnedFor(entries: readonly Learned[], titleId: string): Intro | undefined {
  const entry = entries.find(([id]) => id === titleId);
  return entry && { start: entry[1], end: entry[2] };
}

/** What a later episode offers for a learned intro: Skip from a little before it starts (in case it starts earlier this time) to its end. */
export const offeredIntro = (intro: Intro): LooseSegment => ({ kind: 'intro', start: Math.max(0, intro.start - TOLERANCE), end: intro.end });

const store = profileStore(LEARNED_SKIPS_PREFIX, parseLearned);

export const learnedSkips = {
  load: () => store.load(),
  /** The intro learned for a series (nothing until loaded). */
  get: (titleId: string) => learnedFor(store.get(), titleId),
  /** Not while watch history is paused (see profile-store.ts). */
  learn: (titleId: string, intro: Intro) => void store.record((entries) => learnIntro(entries, titleId, intro)),
  /** Settings → Playback: forgets every series' intro, for the active profile. */
  forgetAll: () => store.update(() => []),
};
