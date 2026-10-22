/**
 * My Library → Release Radar: how the releases it knows (episodes of the
 * series you follow, your saved films' releases, and TMDB's new and upcoming
 * titles) are filtered, ranked and grouped into the featured release, this
 * week's days, "Coming soon", the month grid and the Upcoming list. Pure; calendar.ts draws,
 * release-dates.ts fetches.
 */
import { releasedAt } from '../lib/air-date';
import type { CalendarFilter, ReleaseKind } from './release-calendar';

/** For you: your library and followed series. Matched: new titles in your favourite genres. Everything: those plus what's popular. */
export const RADAR_SCOPES = ['for-you', 'matched', 'everything'] as const;
export type RadarScope = (typeof RADAR_SCOPES)[number];

/** Where a release came from, most relevant first: yours, matched to your taste, popular. */
export type RadarRank = 0 | 1 | 2;

export interface RadarRelease<T extends { id: string }, E = unknown> {
  title: T;
  /** Local midnight. */
  day: Date;
  rank: RadarRank;
  /** An episode (with the series' own episode when its metadata named it, and its exact air time when known: catalog/air-times.ts), or a film's release. */
  release: { type: 'episode'; season: number; number: number; episode?: E | undefined; at?: number | undefined } | { type: 'film'; kind: ReleaseKind };
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `today` to `day` (both local midnights; rounding absorbs a daylight-saving hour). */
export const dayOffset = (today: Date, day: Date) => Math.round((day.getTime() - today.getTime()) / DAY_MS);

/**
 * The local day an episode comes out on (local midnight): its exact air
 * time's day when known, else its air date's (lib/air-date.ts: a date alone
 * is that calendar day, a real time of day is the day it falls on here).
 * Undefined without a date.
 */
export function episodeDay(released: string | undefined, exact?: number): Date | undefined {
  const at = exact ?? releasedAt(released);
  if (Number.isNaN(at)) return undefined;
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** One release of one title, for de-duplication. */
const releaseKey = (r: RadarRelease<{ id: string }>) => (r.release.type === 'episode' ? `${r.title.id}:e:${r.release.season}:${r.release.number}` : `${r.title.id}:f:${r.release.kind}`);

/**
 * The releases a scope shows, by day, each once (the most relevant copy
 * wins), under the show / release-type filter. `matched` and `popular` are
 * TMDB's (absent until loaded); For you's are always the library's own.
 */
export function radarReleases<T extends { id: string }, E>(
  scope: RadarScope,
  sources: { forYou: readonly RadarRelease<T, E>[]; matched?: readonly RadarRelease<T, E>[] | undefined; popular?: readonly RadarRelease<T, E>[] | undefined },
  filter: CalendarFilter,
): RadarRelease<T, E>[] {
  const pool = scope === 'for-you' ? sources.forYou : scope === 'matched' ? (sources.matched ?? []) : [...sources.forYou, ...(sources.matched ?? []), ...(sources.popular ?? [])];
  // Matched is about titles you don't have yet; yours are For you's.
  const yours = new Set(scope === 'matched' ? sources.forYou.map((r) => r.title.id) : []);
  const best = new Map<string, RadarRelease<T, E>>();
  for (const r of pool) {
    if (yours.has(r.title.id)) continue;
    if (r.release.type === 'episode' ? filter.show === 'movies' : filter.show === 'episodes' || !filter.kinds.includes(r.release.kind)) continue;
    const key = releaseKey(r);
    const known = best.get(key);
    if (!known || r.rank < known.rank) best.set(key, r);
  }
  // Array sort is stable: on one day, the more relevant come first, then the order given.
  return [...best.values()].sort((a, b) => a.day.getTime() - b.day.getTime() || a.rank - b.rank);
}

/** How many of your releases (For you's, under `filter`) come out today or later: what the Release Radar tab counts. */
export function upcomingCount<T extends { id: string }, E>(forYou: readonly RadarRelease<T, E>[], filter: CalendarFilter, today: Date): number {
  return radarReleases('for-you', { forYou }, filter).filter((r) => dayOffset(today, r.day) >= 0).length;
}

/** A release of yours this many days later still beats a popular one today (half that for a matched one). */
export const RANK_DAYS = 2;

/**
 * The release to feature: the most relevant one out today or coming next,
 * weighing how soon against whose it is; with nothing ahead, the latest one
 * out. Undefined when there are none.
 */
export function featuredRelease<R extends { day: Date; rank: RadarRank }>(releases: readonly R[], today: Date): R | undefined {
  let best: R | undefined;
  let bestScore = Infinity;
  for (const r of releases) {
    const offset = dayOffset(today, r.day);
    if (offset < 0) continue;
    const score = offset + r.rank * RANK_DAYS;
    if (score < bestScore) [best, bestScore] = [r, score];
  }
  if (best) return best;
  let latest: R | undefined;
  for (const r of releases) if (!latest || r.day > latest.day || (r.day.getTime() === latest.day.getTime() && r.rank < latest.rank)) latest = r;
  return latest;
}

/** This week: `days` columns from today, each with that day's releases in order. */
export function weekColumns<R extends { day: Date }>(releases: readonly R[], today: Date, days = 7): { day: Date; offset: number; releases: R[] }[] {
  const columns = Array.from({ length: days }, (_, offset) => ({ day: new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset), offset, releases: [] as R[] }));
  for (const r of releases) {
    const offset = dayOffset(today, r.day);
    if (offset >= 0 && offset < days) columns[offset]!.releases.push(r);
  }
  return columns;
}

/** "Coming soon" starts after this week and looks this far ahead. */
export const SOON_FROM_DAYS = 7;
export const SOON_UNTIL_DAYS = 120;
export const MAX_SOON = 20;

/** "Coming soon": each title's first release after this week, soonest first, capped. */
export function comingSoon<R extends { day: Date; title: { id: string } }>(releases: readonly R[], today: Date, max = MAX_SOON): R[] {
  const seen = new Set<string>();
  const out: R[] = [];
  for (const r of [...releases].sort((a, b) => a.day.getTime() - b.day.getTime())) {
    const offset = dayOffset(today, r.day);
    if (offset < SOON_FROM_DAYS || offset >= SOON_UNTIL_DAYS || seen.has(r.title.id)) continue;
    seen.add(r.title.id);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Upcoming's groups, in order: today, the rest of this week (as This week's columns), then later (as far as Coming soon looks). */
export const UPCOMING_GROUPS = ['today', 'week', 'later'] as const;
export type UpcomingGroup = (typeof UPCOMING_GROUPS)[number];

/** One line of Upcoming: a title's releases on one day (a season dropped at once is one line). */
export interface UpcomingRow<R> {
  day: Date;
  offset: number;
  releases: R[];
}

/**
 * Upcoming, the Radar's list: releases from today on, by day, each title's
 * releases on one day as one row. Today and This week list every day; Later
 * lists each title once, its next day after this week, so a weekly show
 * doesn't fill it. Only groups with rows; on a day, titles keep the order given.
 */
export function upcomingGroups<R extends { day: Date; title: { id: string } }>(releases: readonly R[], today: Date): { group: UpcomingGroup; rows: UpcomingRow<R>[] }[] {
  const groups: Record<UpcomingGroup, UpcomingRow<R>[]> = { today: [], week: [], later: [] };
  const rows = new Map<string, UpcomingRow<R>>();
  const later = new Set<string>();
  // Array sort is stable: on one day, the order given.
  for (const r of [...releases].sort((a, b) => a.day.getTime() - b.day.getTime())) {
    const offset = dayOffset(today, r.day);
    if (offset < 0 || offset >= SOON_UNTIL_DAYS) continue;
    const key = `${r.title.id}:${offset}`;
    const row = rows.get(key);
    if (row) {
      row.releases.push(r);
      continue;
    }
    const group: UpcomingGroup = offset === 0 ? 'today' : offset < SOON_FROM_DAYS ? 'week' : 'later';
    if (group === 'later') {
      if (later.has(r.title.id)) continue;
      later.add(r.title.id);
    }
    const next = { day: r.day, offset, releases: [r] };
    rows.set(key, next);
    groups[group].push(next);
  }
  return UPCOMING_GROUPS.filter((group) => groups[group].length).map((group) => ({ group, rows: groups[group] }));
}

/** A short "in 3d" / "in 2w" / "in 3mo" for a poster badge, in the interface language. */
export function shortUntil(offset: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'always' });
  if (offset < 7) return format.format(offset, 'day');
  if (offset < 56) return format.format(Math.floor(offset / 7), 'week');
  return format.format(Math.round(offset / 30), 'month');
}

/**
 * Whether a release `offset` days from today is out at `now`: earlier days'
 * and today's are, unless an exact air time (`at`) today is still to come.
 */
export const isOut = (offset: number, at: number | undefined, now = Date.now()): boolean => offset < 0 || (offset === 0 && (at === undefined || at <= now));

/** What the featured card's chip says: out, or "tomorrow" / "in 3 days". */
export function chipUntil(offset: number, locale: string): string | null {
  return offset <= 0 ? null : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(offset, 'day');
}

/** How the featured card says when: which message, and what fills it. */
export type WhenLine = { key: 'today' } | { key: 'tomorrow' } | { key: 'weekday'; day: Date } | { key: 'date'; day: Date } | { key: 'past'; days: number };

export function whenLine(offset: number, day: Date): WhenLine {
  if (offset === 0) return { key: 'today' };
  if (offset === 1) return { key: 'tomorrow' };
  if (offset > 1 && offset < 7) return { key: 'weekday', day };
  if (offset >= 7) return { key: 'date', day };
  return { key: 'past', days: -offset };
}

/** An episode's line: a series or season premiere, or nothing special. */
export const premiere = (season: number, number: number): 'series' | 'season' | null => (number !== 1 ? null : season === 1 ? 'series' : 'season');
