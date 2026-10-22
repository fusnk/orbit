/**
 * The banner Home last showed, kept per profile so the next start can draw it
 * at once instead of waiting on the addons and TMDB (seconds on a cold start).
 * The mix is the same all day for a profile (see `daySeed`), so a banner kept
 * from earlier today is what the network would bring back; one from another
 * day, or made for another count of featured titles, isn't used.
 *
 * Every title came from an addon, so it's stored as a snapshot and validated
 * with the addon schemas when read back, like My Library's copies.
 */
import * as v from 'valibot';
import type { Title } from '../../catalog/titles';
import { fromSnapshot, snapshot, SnapshotSchema } from '../../library/snapshot';
import type { HeroPick } from './hero-mix';

const KEY_PREFIX = 'orbit.hero.';
/** More than Settings → Appearance → Featured titles allows; anything longer isn't a banner Orbit wrote. */
const MAX_PICKS = 30;

const ReasonSchema = v.union([
  v.object({ kind: v.literal('trending'), rank: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)) }),
  v.object({ kind: v.literal('because'), seed: v.pipe(v.string(), v.maxLength(300)) }),
  v.object({ kind: v.literal('watchlist') }),
]);

const CachedSchema = v.object({
  seed: v.number(),
  count: v.number(),
  picks: v.pipe(v.array(v.object({ title: SnapshotSchema, reason: v.optional(ReasonSchema) })), v.maxLength(MAX_PICKS)),
});

/** What a banner is stored as: its titles in order, with why each is there. */
export function encodeHero(seed: number, count: number, titles: readonly Title[], reasons: ReadonlyMap<Title, HeroPick['reason']>): string {
  return JSON.stringify({ seed, count, picks: titles.slice(0, MAX_PICKS).map((title) => ({ title: snapshot(title), reason: reasons.get(title) })) });
}

/** The stored banner's picks if it was made today (`seed`) for `count` titles; null otherwise or if it doesn't read as one. */
export function decodeHero(raw: string | null, seed: number, count: number): { title: Title; reason: HeroPick['reason'] | undefined }[] | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = v.safeParse(CachedSchema, json);
  if (!parsed.success || parsed.output.seed !== seed || parsed.output.count !== count || !parsed.output.picks.length) return null;
  return parsed.output.picks.map((pick) => ({ title: fromSnapshot(pick.title), reason: pick.reason }));
}

/** The ids a banner shows, to tell whether a new one differs from what's drawn. */
export const heroKey = (titles: readonly Pick<Title, 'id'>[]): string => titles.map((title) => title.id).join('\n');

export function readHero(profile: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + profile);
  } catch {
    return null;
  }
}

export function writeHero(profile: string, value: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + profile, value);
  } catch {
    // Without storage the next start waits for the network, as before.
  }
}
