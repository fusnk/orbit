/**
 * Home's banner as a mix: popular titles (with their rank) taking turns with
 * picks for the profile — recommendations from what it watched lately, and
 * saved titles it hasn't started. The picks are drawn from a pool bigger
 * than the banner, seeded by the day and the profile, so the banner changes
 * from day to day but stays put within one. Pure, so it's testable.
 */
import type { Title } from '../../catalog/titles';

export type HeroReason = { kind: 'trending'; rank: number } | { kind: 'because'; seed: string } | { kind: 'watchlist' };

export interface HeroPick {
  title: Title;
  reason: HeroReason;
}

/** A number from the day (local date) and the profile, the same all day long. */
export function daySeed(date: Date, profile: string): number {
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}|${profile}`;
  // FNV-1a.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}

/** `items` shuffled the same way for the same seed (mulberry32 driving Fisher–Yates). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A banner needs art and a line about the title. */
const showable = (title: Title) => !!title.background && !!title.description;

export interface MixInput {
  /** Popular titles, most popular first, with their rank. */
  trending: readonly { title: Title; rank: number }[];
  /** Picks for the profile, best first within each source. */
  personal: readonly HeroPick[];
  /** Titles to leave out: finished, or in Continue Watching (they have their own row). */
  exclude: ReadonlySet<string>;
  count: number;
  seed: number;
}

/**
 * Up to `count` picks: popular and personal taking turns (popular first),
 * about half each, without repeats. With no personal picks it's the popular
 * titles in order, as the banner always was.
 */
export function mixHero({ trending, personal, exclude, count, seed }: MixInput): HeroPick[] {
  const seen = new Set<string>();
  const fresh = (title: Title) => showable(title) && !exclude.has(title.id) && !seen.has(title.id);
  const claim = (pick: HeroPick) => (seen.add(pick.title.id), pick);

  const mine = seededShuffle(
    personal.filter((pick) => fresh(pick.title) && !!claim(pick)),
    seed,
  );
  const popular = trending.filter(({ title }) => fresh(title) && !!seen.add(title.id)).map(({ title, rank }): HeroPick => ({ title, reason: { kind: 'trending', rank } }));
  if (!mine.length) return popular.slice(0, count);

  // About half, or more when there aren't enough popular ones.
  const personalCount = Math.min(mine.length, Math.max(Math.floor(count / 2), count - popular.length));
  // A different handful of the popular ones each day, shown in rank order.
  const pool = popular.slice(0, count * 2);
  const chosen = new Set(seededShuffle(pool, seed ^ 0x9e3779b9).slice(0, count - personalCount));
  const shown = pool.filter((pick) => chosen.has(pick));
  const picks = mine.slice(0, count - shown.length);

  const out: HeroPick[] = [];
  for (let i = 0; out.length < count && (i < shown.length || i < picks.length); i++) {
    if (shown[i]) out.push(shown[i]!);
    if (picks[i] && out.length < count) out.push(picks[i]!);
  }
  return out;
}
