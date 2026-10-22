/**
 * The scores Orbit draws on posters (Settings → Appearance → Ratings on
 * posters): IMDb, TMDB and Letterboxd, from what Orbit already has for a
 * title. No lookups here; just which scores to show, in what order, and how
 * they read.
 */
import { formatDecimal } from '../i18n';

export type ScoreSite = 'imdb' | 'tmdb' | 'letterboxd';

/** Off, one score (the first there is), or all of them. */
export const POSTER_RATINGS = ['off', 'minimal', 'full'] as const;
export type PosterRatings = (typeof POSTER_RATINGS)[number];

export interface PosterScore {
  site: ScoreSite;
  /** "8.1"; Letterboxd's is out of 5. */
  value: string;
  /** What the score is out of. */
  outOf: 5 | 10;
}

/** What Orbit knows about a title's scores; anything may be missing or junk (addons send the IMDb one as text). */
export interface KnownScores {
  imdb?: string | number | null | undefined;
  tmdb?: number | null | undefined;
  letterboxd?: number | null | undefined;
}

/** A score above zero and at most `max`, or null. */
function score(raw: string | number | null | undefined, max: number): number | null {
  const value = typeof raw === 'string' ? Number.parseFloat(raw.trim()) : raw;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

/** The scores worth showing, IMDb first (the one most people know), then TMDB, then Letterboxd. */
export function posterScores(known: KnownScores): PosterScore[] {
  const found: PosterScore[] = [];
  const imdb = score(known.imdb ?? null, 10);
  if (imdb !== null) found.push({ site: 'imdb', value: formatDecimal(imdb), outOf: 10 });
  const tmdb = score(known.tmdb ?? null, 10);
  if (tmdb !== null) found.push({ site: 'tmdb', value: formatDecimal(tmdb), outOf: 10 });
  const letterboxd = score(known.letterboxd ?? null, 5);
  if (letterboxd !== null) found.push({ site: 'letterboxd', value: formatDecimal(letterboxd), outOf: 5 });
  return found;
}

/** The scores a setting shows. */
export function shownScores(scores: PosterScore[], mode: PosterRatings): PosterScore[] {
  if (mode === 'off') return [];
  return mode === 'minimal' ? scores.slice(0, 1) : scores;
}

export const SITE_NAMES: Record<ScoreSite, string> = { imdb: 'IMDb', tmdb: 'TMDB', letterboxd: 'Letterboxd' };
