/**
 * Discover's grid filters: rating range, votes, decade or year (or a range
 * of years), runtime, age certification, cast and director (movies), original
 * language, genres (all or any), sort and Hide watched. One set per profile, applied to every grid that browses
 * TMDB's discover. This module turns them into the query Rust checks again
 * (src-tauri/src/tmdb.rs `filter_param`) before anything reaches TMDB.
 */
import { GENRES, type GenreKey } from '../../catalog/explore';
import { settings } from '../../lib/ipc';
import { profileSetting } from '../../library/profiles';

export type Kind = 'movie' | 'series';
export type QueryFilters = Record<string, string | number>;

/** A grid's own TMDB discover query, which the person's filters narrow. */
export interface DiscoverSpec {
  filters(kind: Kind): QueryFilters;
  sort(kind: Kind): string;
}

export const SORTS = ['default', 'popularity', 'rating', 'newest', 'oldest', 'title'] as const;
export type FilterSort = (typeof SORTS)[number];
export const VOTE_CHOICES = [0, 50, 200, 1000, 5000] as const;
/** Newest first, as the menu lists them. */
export const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950, 1940, 1930, 1920] as const;
/** Original languages the menu offers (ISO 639-1, as TMDB names them). */
export const FILTER_LANGUAGES = ['en', 'ko', 'ja', 'zh', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'tr', 'ru', 'sv', 'da', 'no', 'nl', 'pl', 'cs', 'ar', 'th', 'id', 'fa', 'he'] as const;

/** Year sliders' range; each end means "any". */
export const RANGE_FIRST_YEAR = 1920;
/** Runtime sliders, in minutes: 0 and the top mean "any". */
export const RUNTIME_STEP = 15;
export const RUNTIME_MAX = 240;

/** A person picked from TMDB's people search, as a filter. */
export interface FilterPerson {
  id: number;
  name: string;
}

export interface DiscoverFilters {
  /** 0 is no lower bound. */
  ratingMin: number;
  /** 10 is no upper bound. */
  ratingMax: number;
  /** 0 is any. */
  minVotes: (typeof VOTE_CHOICES)[number];
  decade: number | null;
  /** An exact year (within `decade`). */
  year: number | null;
  /** A range of years, instead of a decade (null: open at that end). */
  yearFrom: number | null;
  yearTo: number | null;
  /** Minutes; 0 is no lower bound. */
  runtimeMin: number;
  /** Minutes; RUNTIME_MAX is no upper bound. */
  runtimeMax: number;
  /** Movies with this person in the cast (TMDB's TV discover can't filter by people). */
  cast: FilterPerson | null;
  /** Movies with this person in the crew, usually as director. */
  director: FilterPerson | null;
  /** Movies rated at most this, in the streaming region's ratings. */
  certification: string | null;
  language: string | null;
  genres: GenreKey[];
  /** Titles in all the picked genres, or in any of them. */
  genreMatch: 'all' | 'any';
  sort: FilterSort;
  hideWatched: boolean;
}

export const DEFAULT_FILTERS: DiscoverFilters = { ratingMin: 0, ratingMax: 10, minVotes: 0, decade: null, year: null, yearFrom: null, yearTo: null, runtimeMin: 0, runtimeMax: RUNTIME_MAX, cast: null, director: null, certification: null, language: null, genres: [], genreMatch: 'all', sort: 'default', hideWatched: false };

/** With a rating sort, at least this many votes, so one-vote 10s don't lead. */
const RATING_SORT_VOTES = 100;
const FIRST_YEAR = 1900;

const isRating = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10 && Number.isInteger(n * 2);
const GENRE_KEYS = new Set<string>(GENRES.map((g) => g.key));
const isRuntime = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= RUNTIME_MAX && n % RUNTIME_STEP === 0;
const isRangeYear = (n: unknown, thisYear: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= RANGE_FIRST_YEAR && n <= thisYear;

/** A saved person: TMDB's id and a name to show (it only labels the chip). */
function parsePerson(value: unknown): FilterPerson | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 1e9 || typeof name !== 'string') return null;
  const clean = name.trim();
  return clean && clean.length <= 200 ? { id, name: clean } : null;
}

/** Saved filters, keeping only valid values (they can come from a hand-edited backup). */
export function parseFilters(value: unknown, thisYear = new Date().getFullYear()): DiscoverFilters {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const ratingMin = isRating(saved.ratingMin) ? saved.ratingMin : 0;
  const ratingMax = isRating(saved.ratingMax) && saved.ratingMax >= ratingMin ? saved.ratingMax : 10;
  const decade = DECADES.includes(saved.decade as (typeof DECADES)[number]) ? (saved.decade as number) : null;
  const year = decade !== null && Number.isInteger(saved.year) && (saved.year as number) >= decade && (saved.year as number) <= Math.min(decade + 9, thisYear) ? (saved.year as number) : null;
  // A range replaces a decade: with one, the other is dropped.
  const yearFrom = decade === null && isRangeYear(saved.yearFrom, thisYear) ? saved.yearFrom : null;
  const yearTo = decade === null && isRangeYear(saved.yearTo, thisYear) && (yearFrom === null || saved.yearTo >= yearFrom) ? saved.yearTo : null;
  const runtimeMin = isRuntime(saved.runtimeMin) ? saved.runtimeMin : 0;
  const runtimeMax = isRuntime(saved.runtimeMax) && saved.runtimeMax >= runtimeMin && saved.runtimeMax > 0 ? saved.runtimeMax : RUNTIME_MAX;
  const genres = Array.isArray(saved.genres) ? [...new Set(saved.genres.filter((g): g is GenreKey => typeof g === 'string' && GENRE_KEYS.has(g)))] : [];
  return {
    ratingMin,
    ratingMax,
    minVotes: VOTE_CHOICES.includes(saved.minVotes as never) ? (saved.minVotes as DiscoverFilters['minVotes']) : 0,
    decade,
    year,
    yearFrom,
    yearTo,
    runtimeMin,
    runtimeMax,
    cast: parsePerson(saved.cast),
    director: parsePerson(saved.director),
    // The same shape Rust's `clean_cert` accepts.
    certification: typeof saved.certification === 'string' && /^[A-Za-z0-9 +\-/]{1,12}$/.test(saved.certification.trim()) ? saved.certification.trim() : null,
    language: typeof saved.language === 'string' && (FILTER_LANGUAGES as readonly string[]).includes(saved.language) ? saved.language : null,
    genres,
    genreMatch: saved.genreMatch === 'any' ? 'any' : 'all',
    sort: SORTS.includes(saved.sort as FilterSort) ? (saved.sort as FilterSort) : 'default',
    hideWatched: saved.hideWatched === true,
  };
}

/** Years an exact-year pick can be, newest first: the decade's, up to this year. */
export function decadeYears(decade: number, thisYear = new Date().getFullYear()): number[] {
  const last = Math.min(decade + 9, thisYear);
  return last < Math.max(decade, FIRST_YEAR) ? [] : Array.from({ length: last - decade + 1 }, (_, i) => last - i);
}

/**
 * How many filters are set for `kind` (the sort doesn't count), for the Filters button. People and certification only apply to movies;
 * a language or person the grid's own query fixes (`fixed`, see `fixedBy`) is ignored there, so it isn't counted either.
 */
export function activeCount(f: DiscoverFilters, kind: Kind, fixed: Partial<Fixed> = {}): number {
  const movie = kind === 'movie';
  return [f.ratingMin > 0 || f.ratingMax < 10, f.minVotes > 0, f.decade !== null || f.yearFrom !== null || f.yearTo !== null, f.runtimeMin > 0 || f.runtimeMax < RUNTIME_MAX, movie && !fixed.cast && f.cast !== null, movie && !fixed.director && f.director !== null, movie && f.certification !== null, !fixed.language && f.language !== null, f.genres.length > 0, f.hideWatched].filter(Boolean).length;
}

const SORT_PARAMS: Record<Exclude<FilterSort, 'default'>, string> = {
  popularity: 'popularity.desc',
  rating: 'vote_average.desc',
  // Rust swaps in first_air_date and name for shows.
  newest: 'primary_release_date.desc',
  oldest: 'primary_release_date.asc',
  title: 'title.asc',
};

const num = (value: string | number | undefined) => (value === undefined ? undefined : Number(value));
const higher = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
const lower = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const later = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined ? a : a > b ? a : b);
const earlier = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined ? a : a < b ? a : b);

export interface QueryContext {
  /** "YYYY-MM-DD": a newest-first sort leaves out what isn't out yet. */
  today: string;
  /** The movie certifications on offer and their country (null: none, or not loaded). */
  certifications?: { country: string; certifications: readonly string[] } | null | undefined;
}

/**
 * The grid's query narrowed by the person's filters, for `kind`; null when
 * nothing can match (e.g. a show genre TMDB doesn't have). Every bound only ever narrows the
 * grid's own: the higher minimum and the lower maximum win.
 */
export function discoverQuery(spec: DiscoverSpec, kind: Kind, f: DiscoverFilters, ctx: QueryContext): { sort: string; filters: QueryFilters } | null {
  const base = spec.filters(kind);
  const out: QueryFilters = { ...base };
  const set = (key: string, value: string | number | undefined) => {
    if (value === undefined) delete out[key];
    else out[key] = value;
  };

  set('voteAverageGte', higher(num(base.voteAverageGte), f.ratingMin > 0 ? f.ratingMin : undefined));
  set('voteAverageLte', lower(num(base.voteAverageLte), f.ratingMax < 10 ? f.ratingMax : undefined));
  if ((num(out.voteAverageGte) ?? 0) > (num(out.voteAverageLte) ?? 10)) return null;

  const sort = f.sort === 'default' ? spec.sort(kind) : SORT_PARAMS[f.sort];
  // Only when the person picked it: a grid sorted by rating already asks for enough votes (or few, on purpose).
  const minVotes = f.sort === 'rating' ? Math.max(f.minVotes, RATING_SORT_VOTES) : f.minVotes;
  set('voteCountGte', higher(num(base.voteCountGte), minVotes > 0 ? minVotes : undefined));
  if ((num(out.voteCountGte) ?? 0) > (num(out.voteCountLte) ?? Infinity)) return null;

  if (f.decade !== null) {
    set('releaseDateGte', later(base.releaseDateGte as string | undefined, `${f.decade}-01-01`));
    set('releaseDateLte', earlier(base.releaseDateLte as string | undefined, `${f.decade + 9}-12-31`));
  }
  if (f.year !== null) set('year', f.year);
  if (f.yearFrom !== null) set('releaseDateGte', later(out.releaseDateGte as string | undefined, `${f.yearFrom}-01-01`));
  if (f.yearTo !== null) set('releaseDateLte', earlier(out.releaseDateLte as string | undefined, `${f.yearTo}-12-31`));
  // Not on a grid that looks ahead on purpose (Upcoming, Airing this week): there, it would leave nearly nothing.
  const ahead = [base.releaseDateLte, base.regionReleaseDateLte, base.airDateLte].some((day) => typeof day === 'string' && day > ctx.today);
  if (sort.endsWith('date.desc') && !ahead) set('releaseDateLte', earlier(out.releaseDateLte as string | undefined, ctx.today));
  if (out.releaseDateGte !== undefined && out.releaseDateLte !== undefined && out.releaseDateGte > out.releaseDateLte) return null;

  set('runtimeGte', higher(num(base.runtimeGte), f.runtimeMin > 0 ? f.runtimeMin : undefined));
  set('runtimeLte', lower(num(base.runtimeLte), f.runtimeMax < RUNTIME_MAX ? f.runtimeMax : undefined));
  if ((num(out.runtimeGte) ?? 0) > (num(out.runtimeLte) ?? Infinity)) return null;

  // TMDB's TV discover has no cast or crew filter, so shows ignore them (the bar hides them there).
  // A person's own grid keeps its person, as a language grid keeps its language (see `fixedBy`).
  if (kind === 'movie' && f.cast !== null && base.withCast === undefined) set('withCast', String(f.cast.id));
  if (kind === 'movie' && f.director !== null && base.withCrew === undefined) set('withCrew', String(f.director.id));

  // A language grid keeps its own language: the filters are shared by every
  // grid, and the bar hides the language menu there (see `fixedBy`), so a
  // language picked elsewhere mustn't empty it with no way to see why.
  if (f.language !== null && base.withOriginalLanguage === undefined) set('withOriginalLanguage', f.language);

  const certs = ctx.certifications;
  if (kind === 'movie' && f.certification !== null && certs?.certifications.includes(f.certification)) {
    set('certificationLte', f.certification);
    set('certificationCountry', certs.country);
  }

  if (f.genres.length) {
    const ids: (number | null)[] = f.genres.map((key) => GENRES.find((g) => g.key === key)![kind === 'movie' ? 'movie' : 'tv']);
    // A grid that is a genre already keeps it, so the picks add to it ("all").
    const match = base.withGenres !== undefined ? 'all' : f.genreMatch;
    if (match === 'all' && ids.includes(null)) return null;
    const known = [...new Set(ids.filter((id): id is number => id !== null))];
    if (!known.length) return null;
    const own = base.withGenres !== undefined ? String(base.withGenres).split(',') : [];
    const picked = known.map(String).filter((id) => !own.includes(id));
    set('withGenres', [...own, ...picked].join(match === 'all' ? ',' : '|'));
  }
  return { sort, filters: out };
}

export interface Fixed {
  language: boolean;
  genres: boolean;
  cast: boolean;
  director: boolean;
}

/** Whether a grid's own query leaves a filter nothing to do (its language, genre or person is fixed). */
export function fixedBy(spec: DiscoverSpec, kind: Kind): Fixed {
  const base = spec.filters(kind);
  return { language: base.withOriginalLanguage !== undefined, genres: base.withGenres !== undefined, cast: base.withCast !== undefined, director: base.withCrew !== undefined };
}

const KEY = 'explore.filters';

export async function loadFilters(): Promise<DiscoverFilters> {
  return parseFilters((await profileSetting(KEY)).value);
}

export async function saveFilters(filters: DiscoverFilters): Promise<void> {
  await settings.set((await profileSetting(KEY)).key, parseFilters(filters));
}
