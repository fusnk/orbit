/**
 * Film release dates for My Library → Release Radar, from TMDB through Rust
 * (`tmdb_release_dates`), for the saved films release-calendar.ts picks;
 * and the new and upcoming titles the Radar's Matched and Everything add,
 * from TMDB's discover (`tmdb_source_page`), with their films' release dates
 * looked up the same way.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { withTimeout } from '../lib/timeout';
import { genreOf, type GenreKey } from './explore';
import { allowedTitles } from './parental';
import { calendarFilms, filmReleases, MAX_FILMS, RECENT_DAYS, RELEASE_KINDS, type FilmRelease } from './release-calendar';
import { SOON_UNTIL_DAYS } from './release-radar';
import { streamingRegion } from './streaming';
import { tmdbConnected, tmdbSourcePage } from './tmdb';
import type { Title } from './titles';

const FoundSchema = v.pipe(
  v.array(
    v.object({
      id: v.pipe(v.string(), v.regex(/^tt\d+$/)),
      releases: v.pipe(v.array(v.object({ kind: v.picklist(RELEASE_KINDS), date: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)) })), v.maxLength(3)),
    }),
  ),
  v.maxLength(MAX_FILMS),
);

let cache: { key: string; releases: Promise<FilmRelease<Title>[] | null> } | null = null;
/** Answers missing some films (Rust leaves out a film whose lookup failed): shown, but never remembered. */
const partial = new WeakSet<object>();

async function fetchReleases(films: Title[], region: string): Promise<FilmRelease<Title>[] | null> {
  const allowed = await allowedTitles(films);
  if (!allowed.length) return (await tmdbConnected()) ? [] : null;
  const raw = await invoke<unknown>('tmdb_release_dates', { imdbIds: allowed.map((f) => f.id), region });
  if (raw === null) return null;
  const found = v.parse(FoundSchema, raw);
  const releases = filmReleases(allowed, found);
  if (found.length < allowed.length) partial.add(releases);
  return releases;
}

/**
 * Release days of the saved films worth showing, in the streaming region
 * (Rust falls back to the US's), within the profile's content limit. Null
 * without a TMDB token. Asked once per day for the same films and region
 * (a release date can change, and "recent" moves with the day).
 */
export async function savedFilmReleases(saved: readonly Title[]): Promise<FilmRelease<Title>[] | null> {
  const films = calendarFilms(saved, new Date());
  const region = await streamingRegion();
  const key = `${isoDay(new Date())}:${region}:${films.map((f) => f.id).join()}`;
  if (cache?.key === key) return cache.releases;
  const releases = fetchReleases(films, region);
  cache = { key, releases };
  // A failed or partial lookup, or one made before TMDB was connected, is asked again next time.
  const forget = () => {
    if (cache?.releases === releases) cache = null;
  };
  void releases.then((found) => {
    if (!found || partial.has(found)) forget();
  }, forget);
  return releases;
}

/** New and upcoming titles from TMDB: films with their releases in the region, and shows by premiere day. */
export interface Discovered {
  films: FilmRelease<Title>[];
  /** Shows first airing in the window; `released` is the premiere day. */
  premieres: Title[];
}

/** The page's safety net per discover request (Rust bounds each TMDB request already). */
const DISCOVER_TIMEOUT_MS = 30_000;
/** Remembered lookups (one per genre set and day); a few at most. */
const discovered = new Map<string, Promise<Discovered | null>>();

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** TMDB genre ids for discover's "any of" (`a|b`), for films or shows; undefined when none apply. */
function genreFilter(genres: readonly GenreKey[], media: 'movie' | 'tv'): string | undefined {
  const ids = [
    ...new Set(
      genres.flatMap((key): number[] => {
        const id = genreOf(key)[media];
        return id === null ? [] : [id];
      }),
    ),
  ];
  return ids.length ? ids.join('|') : undefined;
}

async function fetchDiscovered(genres: readonly GenreKey[], today: Date): Promise<Discovered | null> {
  const from = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - RECENT_DAYS));
  const until = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + SOON_UNTIL_DAYS));
  const page = (media: 'movie' | 'tv') => {
    const withGenres = genres.length ? genreFilter(genres, media) : undefined;
    // Genres asked for that shows don't have (Horror, say): no shows rather than every show.
    if (genres.length && !withGenres) return Promise.resolve({ titles: [], done: true });
    const filters: Record<string, string> = { releaseDateGte: from, releaseDateLte: until, ...(withGenres ? { withGenres } : {}) };
    return withTimeout(tmdbSourcePage({ kind: 'discover', media, sort: 'popularity.desc', filters }, 1), DISCOVER_TIMEOUT_MS, 'Upcoming releases');
  };
  const [movies, shows, region] = await Promise.all([page('movie'), page('tv'), streamingRegion()]);
  if (!movies || !shows) return null;
  const films = (await withTimeout(fetchReleases(movies.titles, region), DISCOVER_TIMEOUT_MS, 'Release dates')) ?? [];
  const result = { films, premieres: shows.titles.filter((s) => !!s.released) };
  if (partial.has(films)) partial.add(result);
  return result;
}

/**
 * TMDB's most popular films and shows coming out from `RECENT_DAYS` ago to
 * `SOON_UNTIL_DAYS` ahead, in any of `genres` (every genre when empty), within
 * the profile's content limit. Null without a TMDB token. Asked once per
 * session and day for the same genres; a failure is asked again next time.
 */
export function discoveredReleases(genres: readonly GenreKey[], today: Date): Promise<Discovered | null> {
  const key = `${isoDay(today)}:${genres.join()}`;
  const known = discovered.get(key);
  if (known) return known;
  const found = fetchDiscovered(genres, today);
  discovered.set(key, found);
  const forget = () => {
    if (discovered.get(key) === found) discovered.delete(key);
  };
  void found.then((result) => {
    if (!result || partial.has(result)) forget();
  }, forget);
  return found;
}
