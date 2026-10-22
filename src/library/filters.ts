/**
 * My Library's sorting and filters: pure helpers, so they can be tested
 * without the page. Titles come from addons, so years and ratings are text
 * ("2011–2019", "8.4") and may be missing.
 */
import type { Title } from '../catalog/titles';

export type WatchStatus = 'unstarted' | 'started' | 'watched';
/** Whether the profile has rated a title with stars (see library/ratings.ts). */
export type RatedFilter = 'rated' | 'unrated';

export interface LibraryFilters {
  query: string;
  genre: string | null;
  status: WatchStatus | null;
  rated: RatedFilter | null;
}

export const NO_FILTERS: LibraryFilters = { query: '', genre: null, status: null, rated: null };

/** The filters My Library remembers per profile: not the typed name, which is a one-off search. */
export type SavedFilters = Omit<LibraryFilters, 'query'>;
export const SAVED_FILTERS_PREFIX = 'library.filters';

/** Saved filters, keeping only valid values (they can come from a hand-edited backup). */
export function parseSavedFilters(value: unknown): SavedFilters {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const genre = typeof saved.genre === 'string' ? saved.genre.trim() : '';
  return {
    // Genres are the addons' own words, so any short name is accepted.
    genre: genre && genre.length <= 60 ? genre : null,
    status: saved.status === 'unstarted' || saved.status === 'started' || saved.status === 'watched' ? saved.status : null,
    rated: saved.rated === 'rated' || saved.rated === 'unrated' ? saved.rated : null,
  };
}

/**
 * `current` with the saved filters loaded into it: those `picked` since the
 * page opened stay the person's, and a saved genre that isn't one of
 * `genres` (the tab's titles') is left out.
 */
export function restoreFilters(current: LibraryFilters, saved: SavedFilters, picked: ReadonlySet<keyof SavedFilters>, genres: readonly string[]): LibraryFilters {
  const out = { ...current };
  if (!picked.has('genre') && saved.genre !== null && genres.includes(saved.genre)) out.genre = saved.genre;
  if (!picked.has('status')) out.status = saved.status;
  if (!picked.has('rated')) out.rated = saved.rated;
  return out;
}

/** What to save of `filters`. */
export const savedFilters = ({ genre, status, rated }: LibraryFilters): SavedFilters => ({ genre, status, rated });

export const filtersActive = (f: LibraryFilters) => !!f.query.trim() || f.genre !== null || f.status !== null || f.rated !== null;

/** The filters that apply on a view: Continue Watching is all started and Watched all finished, so status doesn't there. */
export const filtersOn = (view: string, f: LibraryFilters): LibraryFilters => (view === 'continue' || view === 'watched' ? { ...f, status: null } : f);

/** The first year in "2010" or "2011–2019"; 0 if there isn't one. */
export function releaseYear(year: string | undefined): number {
  const match = /\d{4}/.exec(year ?? '');
  return match ? Number(match[0]) : 0;
}

/** "8.4" as 8.4; 0 if missing or not a number. */
export function ratingOf(rating: string | undefined): number {
  const value = Number.parseFloat(rating ?? '');
  return Number.isFinite(value) ? value : 0;
}

/** Lower case without accents, so "amelie" finds "Amélie". */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Genres among `titles`, most common first. */
export function genresOf(titles: readonly Title[]): { genre: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of titles) for (const g of new Set(t.genres)) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

/** `rated`: whether the profile has rated the title with stars. */
export function matchesFilters(title: Title, filters: LibraryFilters, status: (title: Title) => WatchStatus, rated: (title: Title) => boolean = () => false): boolean {
  const query = fold(filters.query.trim());
  if (query && !fold(title.name).includes(query)) return false;
  if (filters.genre !== null && !title.genres.includes(filters.genre)) return false;
  if (filters.rated !== null && rated(title) !== (filters.rated === 'rated')) return false;
  return filters.status === null || status(title) === filters.status;
}

/**
 * A–Z by name in Orbit's language (`locale`), ignoring case, with numbers in
 * number order ("9" before "10 Cloverfield Lane"); a list page sorted by name
 * uses the same order.
 */
export const nameOrder = (locale: string): ((a: string, b: string) => number) => new Intl.Collator(locale, { sensitivity: 'base', numeric: true }).compare;

/** What a title grid shows: its titles, "nothing matches" (with Clear filters) while filters hide them all, or nothing. */
export function gridState(total: number, shown: number): 'titles' | 'no-match' | 'empty' {
  return shown ? 'titles' : total ? 'no-match' : 'empty';
}
