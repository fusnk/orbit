/**
 * Episode reminders: "Remind me" on an upcoming episode of a show, on the
 * day it's out or 1, 3 or 7 days before. Set per show (every upcoming
 * episode of it is reminded), per profile, and sent as a system notification
 * through the same command as new-episode alerts (notify.rs), whether or not
 * the bell is on: the person asked for each one.
 *
 * Checked a little after startup and every hour while Orbit runs. An episode
 * is reminded once, from the morning of its reminder day until it airs; with
 * its exact air time known (catalog/air-times.ts) the day and "at 21:00" come
 * from that, otherwise from its air date.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { exactAirTime, loadAirTimes } from '../catalog/air-times';
import { verdictNow } from '../catalog/parental';
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { t, tn } from '../i18n';
import { releasedAt } from '../lib/air-date';
import { formatClock } from '../lib/clock';
import { settings } from '../lib/ipc';
import { settleWithin } from '../lib/timeout';
import { profileSetting } from './profiles';

/** profiles.rs `PROFILE_SETTINGS`. */
export const REMINDERS_KEY = 'alerts.reminders';
export const REMINDER_DAYS = [0, 1, 3, 7] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** The most shows reminded at once. */
export const MAX_SHOWS = 50;
const META_TIMEOUT_MS = 20_000;
/** How long a sent reminder is remembered (well past any episode it was for). */
const KEEP_SENT_MS = 60 * DAY_MS;

const ShowSchema = v.object({
  days: v.picklist(REMINDER_DAYS),
  /** The show's name when it was set, for the notification if its details can't be loaded. Text only. */
  name: v.pipe(v.string(), v.maxLength(300)),
});
const SavedSchema = v.object({
  shows: v.fallback(v.record(v.pipe(v.string(), v.maxLength(512)), v.unknown()), {}),
  sent: v.fallback(v.record(v.pipe(v.string(), v.maxLength(512)), v.unknown()), {}),
});

interface Saved {
  shows: Record<string, v.InferOutput<typeof ShowSchema>>;
  /** Video id → when its reminder went out. */
  sent: Record<string, number>;
}

/** The saved reminders; a bad entry is dropped alone. */
export function parseReminders(value: unknown): Saved {
  const parsed = v.safeParse(SavedSchema, value ?? {});
  if (!parsed.success) return { shows: {}, sent: {} };
  const shows: Saved['shows'] = {};
  for (const [id, raw] of Object.entries(parsed.output.shows).slice(0, MAX_SHOWS)) {
    const show = v.safeParse(ShowSchema, raw);
    if (show.success) shows[id] = show.output;
  }
  const sent: Saved['sent'] = {};
  for (const [id, at] of Object.entries(parsed.output.sent)) if (typeof at === 'number' && Number.isFinite(at)) sent[id] = at;
  return { shows, sent };
}

let saved: Saved = { shows: {}, sent: {} };
let key = REMINDERS_KEY;
let loaded: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function load(): Promise<void> {
  loaded ??= profileSetting(REMINDERS_KEY)
    .then((found) => {
      key = found.key;
      saved = parseReminders(found.value);
    })
    .catch((err: unknown) => console.warn('Could not read episode reminders', err));
  return loaded;
}

const store = () => settings.set(key, saved);

/** The show's reminder, or null (call after `loadReminders`). */
export const reminderFor = (titleId: string): ReminderDays | null => saved.shows[titleId]?.days ?? null;

export const loadReminders = (): Promise<void> => load();

/**
 * Sets (or, with null, removes) a show's reminder. False when it's a new show
 * and `MAX_SHOWS` are already reminded: reading them back keeps only that
 * many, so one more would be quietly lost on restart. The cap stays because
 * each check loads every reminded show's details, one after another.
 */
export async function setReminder(title: Pick<Title, 'id' | 'name'>, days: ReminderDays | null): Promise<boolean> {
  await load();
  if (days !== null && !saved.shows[title.id] && Object.keys(saved.shows).length >= MAX_SHOWS) return false;
  const shows = { ...saved.shows };
  if (days === null) delete shows[title.id];
  else shows[title.id] = { days, name: title.name.slice(0, 300) };
  saved = { ...saved, shows };
  await store();
  if (days !== null) void checkReminders().catch((err: unknown) => console.warn('Could not check episode reminders', err));
  return true;
}

/** Local midnight of a moment's day. */
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export interface DueReminder {
  videoId: string;
  season: number;
  episode: number;
  /** When it airs: the exact time, or the local start of its air day. */
  at: number;
  exact: boolean;
}

/** Each unsent episode's reminder window: from the start of the day `days` before its air day, until it airs (the end of its air day when only the date is known). */
function reminderWindows(full: Title, days: ReminderDays, sent: Readonly<Record<string, number>>): (DueReminder & { from: number; until: number })[] {
  return (full.seasons ?? [])
    .filter((s) => s.number > 0)
    .flatMap((s) =>
      s.episodes.flatMap((episode) => {
        if (sent[episode.id] !== undefined) return [];
        const exact = exactAirTime(full.id, s.number, episode.number, episode.released);
        let airDay: number;
        if (exact !== undefined) airDay = startOfDay(exact);
        else {
          const at = releasedAt(episode.released);
          if (Number.isNaN(at)) return [];
          airDay = startOfDay(at);
        }
        const from = new Date(airDay).setDate(new Date(airDay).getDate() - days);
        const until = exact ?? new Date(airDay).setDate(new Date(airDay).getDate() + 1);
        return [{ videoId: episode.id, season: s.number, episode: episode.number, at: exact ?? airDay, exact: exact !== undefined, from, until }];
      }),
    );
}

/**
 * `full`'s episodes whose reminder is due at `now` and wasn't sent: from the
 * start of the day `days` before its air day, until it airs (the end of its
 * air day when only the date is known). Specials (season 0) are left out.
 */
export function dueReminders(full: Title, days: ReminderDays, now: number, sent: Readonly<Record<string, number>>): DueReminder[] {
  return reminderWindows(full, days, sent)
    .filter((w) => now >= w.from && now < w.until)
    .map(({ videoId, season, episode, at, exact }) => ({ videoId, season, episode, at, exact }));
}

/** When the next of `full`'s unsent reminders becomes due after `now`, if one does. */
export function nextReminderAt(full: Title, days: ReminderDays, now: number, sent: Readonly<Record<string, number>>): number | undefined {
  let soonest: number | undefined;
  for (const w of reminderWindows(full, days, sent)) if (w.from > now && w.from < w.until && (soonest === undefined || w.from < soonest)) soonest = w.from;
  return soonest;
}

/** The notification's text: "S2 · E5 is out today at 21:00", "… tomorrow", "… in 3 days". */
export function reminderText(due: DueReminder, now: number): string {
  const code = t('titles.common.episode-code', { season: due.season, episode: due.episode });
  const days = Math.round((startOfDay(due.at) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return due.exact ? t('movix.remind.today-at', { code, time: formatClock(due.at) }) : t('movix.remind.today', { code });
  if (days === 1) return due.exact ? t('movix.remind.tomorrow-at', { code, time: formatClock(due.at) }) : t('movix.remind.tomorrow', { code });
  return tn('movix.remind.in-days', days, { code });
}

let checking: Promise<void> | null = null;

/** One check: looks up each reminded show and sends what's due. */
export function checkReminders(now = Date.now()): Promise<void> {
  checking ??= (async () => {
    await load();
    const ids = Object.keys(saved.shows);
    if (!ids.length) return;
    const sent = { ...saved.sent };
    let changed = false;
    /** The next reminder to become due: a check is set for then (see `checkAtStart`). */
    let soonest: number | undefined;
    for (const id of ids) {
      const show = saved.shows[id];
      if (!show) continue;
      const full = await settleWithin(loadMeta('series', id), META_TIMEOUT_MS, null);
      if (!full) continue;
      await settleWithin(loadAirTimes(full), META_TIMEOUT_MS, false);
      // A content limit asked again per show: one it doesn't allow (or can't rate right now) gets no notification.
      if (verdictNow({ id, type: 'series' }) !== 'allowed') continue;
      for (const due of dueReminders(full, show.days, now, sent)) {
        sent[due.videoId] = now;
        changed = true;
        await invoke('alerts_notify', { title: full.name || show.name, body: reminderText(due, now) }).catch((err: unknown) => console.warn('Could not show a reminder', err));
      }
      const next = nextReminderAt(full, show.days, now, sent);
      if (next !== undefined && (soonest === undefined || next < soonest)) soonest = next;
    }
    checkAtStart(soonest, now);
    for (const [id, at] of Object.entries(sent)) {
      if (now - at > KEEP_SENT_MS) {
        delete sent[id];
        changed = true;
      }
    }
    if (!changed) return;
    saved = { ...saved, sent };
    await store();
  })().finally(() => {
    checking = null;
  });
  return checking;
}

let startTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A reminder whose window opens before the next hourly check gets a check
 * then: with an exact air time just after midnight ("on the day", airing at
 * 00:30), the window is shorter than an hour and the hourly check would
 * often fall either side of it, so the reminder never went out.
 */
function checkAtStart(at: number | undefined, now: number): void {
  clearTimeout(startTimer);
  if (at === undefined || at - now > CHECK_EVERY_MS) return;
  // A second late, so the check sees the window open.
  startTimer = setTimeout(() => void checkReminders().catch((err: unknown) => console.warn('Could not check episode reminders', err)), at - now + 1000);
}

/** Starts the checks: one now, then every hour while Orbit runs. */
export async function startReminders(): Promise<void> {
  clearInterval(timer);
  timer = setInterval(() => void checkReminders().catch((err: unknown) => console.warn('Could not check episode reminders', err)), CHECK_EVERY_MS);
  await checkReminders();
}
