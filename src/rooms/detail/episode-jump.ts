/**
 * "Go to episode…" on a title page: what was typed ("742", "S2E5", "2x5",
 * "s2 e5", "2.5") and the episode it names. Kept free of the page so it can
 * be tested.
 */
import { arcIndexOf, type ArcView } from '../../catalog/episode-extras';
import type { Season } from '../../catalog/titles';

export interface EpisodeQuery {
  season?: number | undefined;
  episode: number;
}

/** The season (when given) and episode number typed, or null when it isn't one. */
export function parseEpisodeQuery(text: string): EpisodeQuery | null {
  const q = text.trim().toLowerCase();
  // A separator is needed between the two numbers ("2 5" isn't read as season 2).
  const both = /^s?\s*(\d{1,4})\s*[xe.:-]\s*(\d{1,5})$/.exec(q);
  if (both) return { season: Number(both[1]), episode: Number(both[2]) };
  const one = /^(?:e|ep|#)?\s*(\d{1,5})$/.exec(q);
  return one ? { episode: Number(one[1]) } : null;
}

/**
 * Where the episode is: in the season asked for; else in the season on
 * screen; else the first other season that has that number (specials last);
 * else, without a season, that many episodes into the show (specials left out).
 */
export function findEpisode(seasons: readonly Season[], query: EpisodeQuery, shown?: number): { season: number; episode: number } | null {
  const has = (s: Season) => s.episodes.some((e) => e.number === query.episode);
  if (query.season !== undefined) {
    const season = seasons.find((s) => s.number === query.season);
    return season && has(season) ? { season: season.number, episode: query.episode } : null;
  }
  const order = [...seasons.filter((s) => s.number === shown), ...seasons.filter((s) => s.number !== shown && s.number !== 0), ...seasons.filter((s) => s.number === 0 && s.number !== shown)];
  const found = order.find(has);
  if (found) return { season: found.number, episode: query.episode };
  // No season has that number: it's counted through the seasons ("742" of a long anime its addon numbers by season).
  const nth = seasons.filter((s) => s.number !== 0).flatMap((s) => s.episodes.map((e) => ({ season: s.number, episode: e.number })))[query.episode - 1];
  return nth ?? null;
}

/**
 * Where the list goes to show a found episode: listed by story arc, the arc
 * holding it; else (or when no arc holds it, as with specials or episodes past
 * the last arc) its season, listed by season.
 */
export function jumpTarget(arcs: readonly ArcView[] | null, found: { season: number; episode: number }): { arc: number } | { season: number } {
  const arc = arcs ? arcIndexOf(arcs, found.season, found.episode) : -1;
  return arc >= 0 ? { arc } : { season: found.season };
}
