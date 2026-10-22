/**
 * Exact air times (Settings → General → Notifications → "Look up exact air
 * times", off unless turned on): when each episode of a show airs, to the
 * minute, from TVmaze through Rust (src-tauri/src/tvmaze.rs, which sends only
 * the show's IMDb or TheTVDB id). Addons and TMDB give air dates only.
 *
 * Release Radar and title pages say "Out today at 21:00" (in local time, as
 * the Clock setting writes times), new-episode alerts wait for the air time
 * rather than the date, and autoplay doesn't offer an episode before it has
 * aired. Without the setting (or for a show TVmaze doesn't know) everything
 * keeps using dates.
 *
 * TVmaze sometimes numbers a show's episodes differently from the addon
 * (specials folded in, a double episode split). An episode's time is used
 * only when TVmaze's air date for that number agrees with the addon's date;
 * otherwise it's the one episode TVmaze has on the addon's date, or none.
 *
 * Kept per show in memory for a few hours; Rust keeps its own copy too.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { locale, t } from '../i18n';
import { formatClock } from '../lib/clock';
import { settings } from '../lib/ipc';

export const AIR_TIMES_KEY = 'alerts.air-times';
const FRESH_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const AirTimesSchema = v.pipe(
  v.array(v.object({
      season: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
      episode: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100_000)),
      at: v.pipe(v.number(), v.finite()),
      /** TVmaze's air date where the show airs. */
      day: v.optional(v.pipe(v.string(), v.regex(DAY))),
    })),
  v.maxLength(5000),
);

let on = false;
interface Known {
  /** By "season:episode": when, and the dates it may go by (TVmaze's local one, and the UTC one of its time). */
  times: Map<string, { at: number; days: string[] }>;
  /** By TVmaze's air date: every time that day. */
  byDay: Map<string, number[]>;
  until: number;
}
const known = new Map<string, Known>();
/** The most shows kept (as many as Rust keeps): the one looked up longest ago goes first. */
const MAX_KNOWN = 500;
const pending = new Map<string, Promise<boolean>>();

export const airTimesOn = (): boolean => on;

/** Reads the setting; call once at startup. */
export async function loadAirTimesSetting(): Promise<void> {
  on = (await settings.get(AIR_TIMES_KEY).catch(() => null)) === true;
}

export async function setAirTimesOn(next: boolean): Promise<void> {
  on = next;
  known.clear();
  await settings.set(AIR_TIMES_KEY, next);
}

/** The id TVmaze can look a show up by (IMDb `tt…` or TheTVDB `tvdb:…`), or null. */
export const lookupId = (id: string): string | null => (/^tt\d{1,10}$/.test(id) || /^tvdb:\d{1,10}$/.test(id) ? id : null);

const key = (season: number, episode: number) => `${season}:${episode}`;

/**
 * Looks up a series' air times (once every few hours). Resolves to whether
 * any are known for it; never rejects (no times is the same as before).
 */
export function loadAirTimes(title: { id: string; type: string }, now = Date.now()): Promise<boolean> {
  const id = lookupId(title.id);
  if (!on || title.type !== 'series' || !id) return Promise.resolve(false);
  const cached = known.get(id);
  if (cached && cached.until > now) return Promise.resolve(cached.times.size > 0);
  const asking = pending.get(id);
  if (asking) return asking;
  const ask = invoke<unknown>('tvmaze_air_times', { id })
    .then((raw) => {
      if (raw === null) return false;
      const parsed = v.parse(AirTimesSchema, raw);
      const byDay = new Map<string, number[]>();
      for (const e of parsed) if (e.day) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e.at]);
      const times = new Map(parsed.map((e) => [key(e.season, e.episode), { at: e.at, days: [e.day, new Date(e.at).toISOString().slice(0, 10)].filter((d) => d !== undefined) }]));
      known.delete(id);
      if (known.size >= MAX_KNOWN) known.delete(known.keys().next().value!);
      known.set(id, { times, byDay, until: now + FRESH_MS });
      return parsed.length > 0;
    })
    .catch((err: unknown) => {
      console.warn('No air times from TVmaze', err);
      return false;
    })
    .finally(() => pending.delete(id));
  pending.set(id, ask);
  return ask;
}

/**
 * When an episode airs, to the minute, if it's been looked up. With the
 * addon's `released` date, TVmaze's episode of that number counts only if
 * its date agrees; if not, the one TVmaze episode that day (none when there
 * are several), so a differently numbered episode never gets another's time.
 */
export function exactAirTime(titleId: string, season: number, episode: number, released?: string): number | undefined {
  if (!on) return undefined;
  const show = known.get(titleId);
  const numbered = show?.times.get(key(season, episode));
  const day = released?.slice(0, 10);
  if (!day || !DAY.test(day) || numbered?.days.includes(day)) return numbered?.at;
  const that = show?.byDay.get(day);
  return that?.length === 1 ? that[0] : undefined;
}

/** Calendar days from `now`'s local day to `at`'s. */
function daysAhead(at: number, now: number): number {
  const day = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((day(at) - day(now)) / DAY_MS);
}

/** "Out today at 21:00", "Out tomorrow at 21:00" or "Out Thu 6 Mar at 21:00", in local time. */
export function airTimeLabel(at: number, now = Date.now()): string {
  const time = formatClock(at);
  const days = daysAhead(at, now);
  if (days === 0) return t('movix.air.today', { time });
  if (days === 1) return t('movix.air.tomorrow', { time });
  const date = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  return t('movix.air.date', { date, time });
}
