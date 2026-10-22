/**
 * Watch statistics (My Library → Stats), worked out on this device from watch
 * history alone. Pure, so it can be tested without the page.
 *
 * History keeps one row per movie or episode with when it was last touched,
 * not every sitting, so each row counts once, on the day it was last
 * watched. Time is the real duration when the player knew it, else the
 * title's listed runtime (e.g. for titles marked watched from a menu).
 */
import { runtimeMinutes } from '../catalog/runtime';
import type { Title } from '../catalog/titles';
import { isLocalId } from '../lib/local-media';
import { genresOf } from './filters';
import type { Progress } from './watch';

export type StatsRange = 'year' | '12m' | 'all';

export interface WatchHistory {
  titles: readonly { title: Title; completed: boolean; updatedAt: number }[];
  progress: readonly Progress[];
}

export interface MonthStat {
  /** The first moment of the month (local time), in ms. */
  start: number;
  minutes: number;
}

export interface WatchStats {
  movies: number;
  episodes: number;
  minutes: number;
  /** Whether some of `minutes` are typical lengths standing in for unknown ones. */
  estimated: boolean;
  /** Month by month, oldest first: this year so far, or the last 12 months. */
  months: MonthStat[];
  /** Most common genres among the titles watched, by number of titles. */
  genres: { genre: string; count: number }[];
  /** Titles watched that list no genres (yet), so `genres` leaves them out. */
  missingGenres: number;
  /** Series by episodes watched. */
  shows: { title: Title; episodes: number }[];
  /** Titles by time spent watching them. */
  top: { title: Title; minutes: number }[];
  /** The most days in a row with something watched. */
  streak: number;
  /** Days with something watched. */
  days: number;
  /** 0 (Sunday) to 6; null without history. */
  busiestWeekday: number | null;
  /** 0 to 23; null without history. */
  busiestHour: number | null;
}

const TOP = 5;
/** Under this, an unfinished row is a peek, not watching. */
const MIN_SECONDS = 60;
const MONTHS_SHOWN = 12;

/** When a range begins (ms, local time). */
export function rangeStart(range: StatsRange, now: Date): number {
  if (range === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  if (range === '12m') return new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1).getTime();
  return -Infinity;
}

/**
 * Typical lengths for watched rows with no known duration or runtime, such
 * as history imported from Trakt or Letterboxd: without them, hundreds of
 * imported titles would count as no time at all.
 */
const TYPICAL_MOVIE_MINUTES = 110;
const TYPICAL_EPISODE_MINUTES = 40;

/** Minutes a row stands for: the whole thing once watched, else how far it got; `estimated` if a typical length stood in. */
function minutesOf(row: Progress, title: Title | undefined): { minutes: number; estimated: boolean } {
  if (!row.watched) return { minutes: row.position / 60, estimated: false };
  if (row.duration > 0) return { minutes: row.duration / 60, estimated: false };
  // A series' runtime is per episode, so it fits an episode row too.
  const listed = runtimeMinutes(title?.runtime);
  if (listed > 0) return { minutes: listed, estimated: false };
  return { minutes: row.episode !== null ? TYPICAL_EPISODE_MINUTES : TYPICAL_MOVIE_MINUTES, estimated: true };
}

/** Local calendar day as a whole number, so consecutive days differ by 1 across DST changes. */
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

function busiest(counts: number[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < counts.length; i++) if (counts[i]! > 0 && (best === null || counts[i]! > counts[best]!)) best = i;
  return best;
}

function longestRun(days: number[]): number {
  let best = 0;
  let run = 0;
  let previous = NaN;
  for (const day of days) {
    run = day === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

export function computeStats(history: WatchHistory, range: StatsRange, now = new Date()): WatchStats {
  const from = rangeStart(range, now);
  const titles = new Map(history.titles.map((t) => [t.title.id, t.title]));
  // Files played from this PC aren't titles: they're left out (see local-media.ts).
  const rows = history.progress.filter((row) => !isLocalId(row.titleId) && row.updatedAt >= from && row.updatedAt <= now.getTime() && (row.watched || row.position >= MIN_SECONDS));

  const firstMonth = range === 'year' ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1);
  const months: MonthStat[] = [];
  for (let d = firstMonth; d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push({ start: d.getTime(), minutes: 0 });

  let movies = 0;
  let episodes = 0;
  let minutes = 0;
  let estimated = false;
  const perTitle = new Map<string, number>();
  const episodesPerShow = new Map<string, number>();
  const days = new Set<number>();
  const weekdays = Array<number>(7).fill(0);
  const hours = Array<number>(24).fill(0);

  for (const row of rows) {
    const title = titles.get(row.titleId);
    const time = minutesOf(row, title);
    const spent = time.minutes;
    estimated ||= time.estimated;
    minutes += spent;
    perTitle.set(row.titleId, (perTitle.get(row.titleId) ?? 0) + spent);
    const isEpisode = row.episode !== null;
    if (row.watched && isEpisode) {
      episodes++;
      episodesPerShow.set(row.titleId, (episodesPerShow.get(row.titleId) ?? 0) + 1);
    } else if (row.watched) movies++;

    const at = new Date(row.updatedAt);
    days.add(dayNumber(at));
    weekdays[at.getDay()]!++;
    hours[at.getHours()]!++;
    // Months are oldest first; the row belongs to the last one that began before it.
    const month = [...months].reverse().find((m) => m.start <= row.updatedAt);
    if (month) month.minutes += spent;
  }

  const watchedTitles = [...perTitle.keys()].flatMap((id) => titles.get(id) ?? []);
  /** `fields` with the title they're for; nothing for a row whose title is missing. */
  const withTitle = <T extends object>(id: string, fields: T) => {
    const title = titles.get(id);
    return title ? [{ title, ...fields }] : [];
  };
  return {
    movies,
    episodes,
    minutes: Math.round(minutes),
    estimated,
    months: months.map((m) => ({ ...m, minutes: Math.round(m.minutes) })),
    genres: genresOf(watchedTitles).slice(0, TOP),
    missingGenres: watchedTitles.filter((title) => !title.genres.length).length,
    shows: [...episodesPerShow]
      .flatMap(([id, n]) => withTitle(id, { episodes: n }))
      .sort((a, b) => b.episodes - a.episodes || a.title.name.localeCompare(b.title.name))
      .slice(0, TOP),
    top: [...perTitle]
      .flatMap(([id, spent]) => withTitle(id, { minutes: Math.round(spent) }))
      .sort((a, b) => b.minutes - a.minutes || a.title.name.localeCompare(b.title.name))
      .slice(0, TOP),
    streak: longestRun([...days].sort((a, b) => a - b)),
    days: days.size,
    busiestWeekday: busiest(weekdays),
    busiestHour: busiest(hours),
  };
}

/** Whether there's any watching in the stats at all. */
export const hasActivity = (stats: WatchStats) => stats.days > 0;
