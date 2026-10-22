/**
 * My Library → Release Radar's films: which saved films to ask TMDB about,
 * their cinema / digital / physical release days, and the Radar's filter.
 * Pure; release-dates.ts fetches, release-radar.ts groups.
 */
import { RADAR_SCOPES, type RadarScope } from './release-radar';

export const RELEASE_KINDS = ['cinema', 'digital', 'physical'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

export const CALENDAR_SHOWS = ['all', 'episodes', 'movies'] as const;
export type CalendarShow = (typeof CALENDAR_SHOWS)[number];

export interface CalendarFilter {
  /** Whose releases: yours, matched to your taste, or everything (filters saved before the Radar had none: yours). */
  scope: RadarScope;
  show: CalendarShow;
  /** Film release kinds shown (none: no films). */
  kinds: ReleaseKind[];
}

export const DEFAULT_CALENDAR_FILTER: CalendarFilter = { scope: 'for-you', show: 'all', kinds: [...RELEASE_KINDS] };

/** A saved filter, or the default for anything that isn't one. */
export function parseCalendarFilter(value: unknown): CalendarFilter {
  if (typeof value !== 'object' || value === null) return DEFAULT_CALENDAR_FILTER;
  const { scope, show, kinds } = value as { scope?: unknown; show?: unknown; kinds?: unknown };
  return {
    scope: RADAR_SCOPES.includes(scope as RadarScope) ? (scope as RadarScope) : 'for-you',
    show: CALENDAR_SHOWS.includes(show as CalendarShow) ? (show as CalendarShow) : 'all',
    // Kept in their usual order, each once.
    kinds: Array.isArray(kinds) ? RELEASE_KINDS.filter((k) => kinds.includes(k)) : [...RELEASE_KINDS],
  };
}

export const showsFilms = (filter: CalendarFilter) => filter.show !== 'episodes';

/** Release Radar asks TMDB for titles out from this many days ago. */
export const RECENT_DAYS = 14;
/** Films asked about at most (src-tauri/src/tmdb.rs `MAX_RELEASE_TITLES`). */
export const MAX_FILMS = 60;

interface FilmLike {
  id: string;
  type: string;
  year?: string | undefined;
}

/**
 * The saved films worth asking about, in the order given: films with an IMDb
 * id from last year on (or with no year yet). Older films' releases are long
 * past, so they'd only cost lookups.
 */
export function calendarFilms<T extends FilmLike>(titles: readonly T[], today: Date, max = MAX_FILMS): T[] {
  const from = today.getFullYear() - 1;
  const seen = new Set<string>();
  return titles
    .filter((t) => {
      if (t.type !== 'movie' || !/^tt\d+$/.test(t.id) || seen.has(t.id)) return false;
      seen.add(t.id);
      const year = /^\d{4}/.exec(t.year ?? '');
      return !year || Number(year[0]) >= from;
    })
    .slice(0, max);
}

/** A "YYYY-MM-DD" release day as local midnight, or null. */
export function calendarDay(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rejects dates that roll over ("2025-02-30").
  return day.getMonth() === Number(m[2]) - 1 && day.getDate() === Number(m[3]) ? day : null;
}

export interface FilmRelease<T> {
  title: T;
  kind: ReleaseKind;
  /** Local midnight. */
  day: Date;
}

/** The releases Rust found, for the films asked about (others are ignored), by day. */
export function filmReleases<T extends { id: string }>(films: readonly T[], found: readonly { id: string; releases: readonly { kind: ReleaseKind; date: string }[] }[]): FilmRelease<T>[] {
  const byId = new Map(films.map((f) => [f.id, f]));
  return found
    .flatMap(({ id, releases }) => {
      const title = byId.get(id);
      if (!title) return [];
      return releases.flatMap(({ kind, date }) => {
        const day = calendarDay(date);
        return day ? [{ title, kind, day }] : [];
      });
    })
    .sort((a, b) => a.day.getTime() - b.day.getTime());
}
