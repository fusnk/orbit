/**
 * The rules behind Home's small extras, kept pure so they're testable: the
 * greeting's time of day, the tags on cards ("New episode", "New season")
 * and the episode line under landscape cards, and what each mood chip asks
 * TMDB (or, without TMDB, the catalogs) for.
 */
import type { AlertItem } from '../../library/alerts';
import type { MoodId } from './moods';

// ── Greeting ─────────────────────────────────────────────────────────────

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** Morning 5–12, afternoon 12–17, evening 17–22, night 22–5 (local hours). */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

// ── Card tags ────────────────────────────────────────────────────────────

export type CardTag = 'new-season' | 'new-episode';

/** An episode counts as new for this long after it aired. */
export const NEW_EPISODE_MS = 7 * 24 * 60 * 60 * 1000;

type Aired = Pick<AlertItem, 'titleId' | 'season' | 'episode' | 'airedAt' | 'exact'>;

/**
 * A series' tag from the new-episode alerts already loaded (no lookups of
 * its own): "New season" when a later season's first episode aired in the
 * last week, else "New episode" when any episode did; null otherwise.
 */
export function cardTag(titleId: string, items: readonly Aired[], now: number): CardTag | null {
  const recent = items.filter((item) => item.titleId === titleId && item.airedAt <= now && now - item.airedAt <= NEW_EPISODE_MS);
  if (!recent.length) return null;
  return recent.some((item) => item.season > 1 && item.episode === 1) ? 'new-season' : 'new-episode';
}

/** The latest aired episode the alerts know of for a series, or null. */
export function latestEpisode(titleId: string, items: readonly Aired[], now: number): Aired | null {
  let latest: Aired | null = null;
  for (const item of items) {
    if (item.titleId !== titleId || item.airedAt > now) continue;
    if (!latest || item.airedAt > latest.airedAt || (item.airedAt === latest.airedAt && item.season * 10000 + item.episode > latest.season * 10000 + latest.episode)) latest = item;
  }
  return latest;
}

/** "S14.E19" (the date is added by the caller, in the person's language). */
export const episodeCode = (item: Pick<Aired, 'season' | 'episode'>): string => `S${item.season}.E${item.episode}`;

// ── Mood chips ───────────────────────────────────────────────────────────

export const CHIPS = ['action', 'funny', 'feel-good', 'edge', 'scare', 'mind-bending', 'romance', 'short', 'greats', 'country'] as const;
export type ChipId = (typeof CHIPS)[number];

/** A TMDB discover request for films, as src-tauri/src/tmdb.rs `SourceRequest` reads it. */
export interface ChipQuery {
  kind: 'discover';
  media: 'movie';
  sort: string;
  filters: Record<string, string | number>;
}

/** TMDB's movie genre ids. */
const G = { action: 28, animation: 16, comedy: 35, family: 10751, horror: 27, mystery: 9648, romance: 10749, scifi: 878, thriller: 53, war: 10752 } as const;

/** Enough votes that a title is known, not just new. */
const KNOWN = 200;

/** What a chip asks TMDB for; `region` is the person's country (two letters), for the country chip. */
export function chipQuery(chip: ChipId, region: string): ChipQuery {
  const discover = (filters: Record<string, string | number>, sort = 'popularity.desc'): ChipQuery => ({ kind: 'discover', media: 'movie', sort, filters: { voteCountGte: KNOWN, ...filters } });
  switch (chip) {
    case 'action':
      return discover({ withGenres: `${G.action}` });
    case 'funny':
      return discover({ withGenres: `${G.comedy}`, withoutGenres: `${G.horror}` });
    case 'feel-good':
      // Any of comedy, family or animation; none of the dark ones.
      return discover({ withGenres: `${G.comedy}|${G.family}|${G.animation}`, withoutGenres: `${G.horror},${G.thriller},${G.war}`, voteAverageGte: 6.5 });
    case 'edge':
      return discover({ withGenres: `${G.thriller}` });
    case 'scare':
      return discover({ withGenres: `${G.horror}` });
    case 'mind-bending':
      return discover({ withGenres: `${G.scifi}|${G.mystery}`, voteAverageGte: 7 });
    case 'romance':
      return discover({ withGenres: `${G.romance}` });
    case 'short':
      // Feature length, but not long.
      return discover({ runtimeGte: 60, runtimeLte: 90 });
    case 'greats':
      return discover({ voteCountGte: 5000 }, 'vote_average.desc');
    case 'country':
      return discover({ withOriginCountry: region, voteCountGte: 50 });
  }
}

/**
 * Without TMDB: a genre of the first catalog that filters by genre (matched
 * by name), a mood row's picks, or a filter over the catalogs' first pages.
 * The country chip needs TMDB (catalogs don't say where a film is from).
 */
export type ChipFallback = { genre: RegExp } | { mood: MoodId } | { maxMinutes: number } | { minRating: number } | null;

export function chipFallback(chip: ChipId): ChipFallback {
  switch (chip) {
    case 'action':
      return { genre: /action/i };
    case 'funny':
      return { genre: /comedy/i };
    case 'feel-good':
      return { mood: 'feel-good' };
    case 'edge':
      return { genre: /thriller|suspense/i };
    case 'scare':
      return { genre: /horror/i };
    case 'mind-bending':
      return { mood: 'mind-bending' };
    case 'romance':
      return { genre: /romance/i };
    case 'short':
      return { maxMinutes: 90 };
    case 'greats':
      return { minRating: 8 };
    case 'country':
      return null;
  }
}
