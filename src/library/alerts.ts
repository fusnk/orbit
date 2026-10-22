/**
 * New-episode alerts: the title bar's bell and, if asked, system
 * notifications. On launch and every few hours while Orbit runs, the series
 * the profile follows are looked up (their metadata carries air dates) and
 * episodes that aired since the last check, and aren't watched, are noted.
 *
 * Per profile (profiles.rs `PROFILE_SETTINGS`): the choices, and what was
 * already announced (`seen`), so an episode is announced once. Every check
 * looks at the whole lookback window (not just since the last check): an
 * addon often lists an episode only after its air time has passed, and a
 * series that couldn't be looked up is simply looked at again next time.
 * Episodes already announced are remembered by video id (`announced`) for as
 * long as they can be in that window, apart from the bell's 60-item cap.
 * A series newly followed isn't announced for what aired before it was
 * followed (`follows`, see `followedFloor`).
 *
 * A profile with a content limit only follows series the limit allows.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { exactAirTime, loadAirTimes } from '../catalog/air-times';
import { allowedTitles, verdictNow } from '../catalog/parental';
import { loadMeta } from '../catalog/service';
import { isShowType, type Title } from '../catalog/titles';
import { formatList, t, tn } from '../i18n';
import { releasedAt } from '../lib/air-date';
import { settings } from '../lib/ipc';
import { settleWithin } from '../lib/timeout';
import { libraryEntries } from './library';
import { profileSetting } from './profiles';
import { episodeName, hiddenFor } from './spoilers';
import { episodeState, lastWatchedAt, onWatchChange, recentlyWatched } from './watch';

export const ALERT_PREFS_KEY = 'alerts.prefs';
export const ALERT_SEEN_KEY = 'alerts.seen';

/** Between checks while Orbit runs. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How far back the first check (and a check after a long pause) looks. */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Episodes kept in the bell (oldest leave first), and how long a read one stays remembered. */
const MAX_ITEMS = 60;
const KEEP_READ_MS = 60 * 24 * 60 * 60 * 1000;
/** Series looked up per check, and how many at once. */
const MAX_SERIES = 40;
const CONCURRENCY = 3;
const META_TIMEOUT_MS = 20_000;
/** More new episodes than this at once become one grouped notification. */
const GROUP_FROM = 4;

const PrefsSchema = v.object({
  enabled: v.fallback(v.boolean(), true),
  toasts: v.fallback(v.boolean(), false),
  scope: v.fallback(v.picklist(['watching', 'library']), 'watching'),
});
export type AlertPrefs = v.InferOutput<typeof PrefsSchema>;
export type AlertScope = AlertPrefs['scope'];

/** The longest id the addon schema accepts (src/addons/schema.ts). */
const MAX_ID = 512;

/** One announced episode. Names and titles came from an addon: text only, never markup. */
const ItemSchema = v.object({
  videoId: v.pipe(v.string(), v.maxLength(MAX_ID)),
  titleId: v.pipe(v.string(), v.maxLength(MAX_ID)),
  show: v.pipe(v.string(), v.maxLength(300)),
  season: v.pipe(v.number(), v.integer(), v.minValue(0)),
  episode: v.pipe(v.number(), v.integer(), v.minValue(0)),
  title: v.pipe(v.string(), v.maxLength(300)),
  poster: v.fallback(v.optional(v.pipe(v.string(), v.maxLength(2048), v.url(), v.startsWith('https://'))), undefined),
  airedAt: v.pipe(v.number(), v.finite()),
  /** `airedAt` is an exact air time (catalog/air-times.ts), not an air date. Missing in data saved before it existed. */
  exact: v.optional(v.boolean()),
  read: v.boolean(),
});
export type AlertItem = v.InferOutput<typeof ItemSchema>;

/** Items and announced ids are read one by one below, so one bad entry is dropped alone. */
const SeenSchema = v.object({
  checkedAt: v.fallback(v.pipe(v.number(), v.finite(), v.minValue(0)), 0),
  items: v.fallback(v.array(v.unknown()), []),
  /** Video id → when it aired, for every episode announced within the lookback (in the bell or not). Missing in data saved before it existed. */
  announced: v.fallback(v.optional(v.record(v.string(), v.unknown())), undefined),
  /** Series id → episodes that aired before this aren't announced (see `followedFloor`). */
  follows: v.fallback(v.record(v.string(), v.unknown()), {}),
});
interface Seen {
  checkedAt: number;
  items: AlertItem[];
  announced: Record<string, number>;
  follows: Record<string, number>;
  /** Saved before `announced` existed, and not checked since: that version only looked at what aired after `checkedAt`. */
  legacy?: true;
}

/**
 * A series' floor when it is first seen followed and when it was followed
 * isn't known (only the last watch is): a day before the previous check.
 * It was followed after that check, so at most about a day of what aired
 * before is announced; and an episode that aired just before the check but
 * was listed by the addon only later (addons often lag by hours) is still
 * caught. Checks run every 6 hours while Orbit is open.
 */
const FOLLOW_GRACE_MS = 24 * 60 * 60 * 1000;

const numbers = (record: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(record)) if (id.length <= MAX_ID && typeof at === 'number' && Number.isFinite(at)) out[id] = at;
  return out;
};

export const parsePrefs = (value: unknown): AlertPrefs => {
  const parsed = v.safeParse(PrefsSchema, value ?? {});
  return parsed.success ? parsed.output : { enabled: true, toasts: false, scope: 'watching' };
};
const parseSeen = (value: unknown): Seen => {
  const parsed = v.safeParse(SeenSchema, value ?? {});
  if (!parsed.success) return { checkedAt: 0, items: [], announced: {}, follows: {} };
  const items = parsed.output.items.flatMap((raw) => {
    const item = v.safeParse(ItemSchema, raw);
    return item.success ? [item.output] : [];
  });
  const { checkedAt } = parsed.output;
  const follows = numbers(parsed.output.follows);
  if (parsed.output.announced) return { checkedAt, items, announced: numbers(parsed.output.announced), follows };
  // The old format: what's in the bell is what was announced.
  const announced = Object.fromEntries(items.map((item) => [item.videoId, item.airedAt]));
  return checkedAt > 0 ? { checkedAt, items, announced, follows, legacy: true } : { checkedAt, items, announced, follows };
};

let prefs = parsePrefs(undefined);
let prefsKey = ALERT_PREFS_KEY;
let seen = parseSeen(undefined);
let seenKey = ALERT_SEEN_KEY;
let loaded = false;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let checking: Promise<void> | null = null;

function changed(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the alerts or their settings change; returns an unsubscribe function. */
export function onAlertsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const alertPrefs = (): AlertPrefs => prefs;
/** Announced episodes, newest first (read ones too, dimmed). */
export const alertItems = (): AlertItem[] => [...seen.items].sort((a, b) => b.airedAt - a.airedAt);
export const unreadAlerts = (): number => seen.items.filter((item) => !item.read).length;

/** Reads the profile's choices and announced episodes; call once at startup. */
export async function loadAlerts(): Promise<void> {
  const [p, s] = await Promise.all([profileSetting(ALERT_PREFS_KEY), profileSetting(ALERT_SEEN_KEY)]);
  prefsKey = p.key;
  prefs = parsePrefs(p.value);
  seenKey = s.key;
  seen = parseSeen(s.value);
  loaded = true;
  changed();
}

export async function setAlertPrefs(next: Partial<AlertPrefs>): Promise<void> {
  const before = prefs;
  prefs = { ...prefs, ...next };
  changed();
  await settings.set(prefsKey, prefs);
  // Turned on, or following more shows: look now rather than at the next timed check, hours away.
  // A wider scope brings the newly followed shows' past week along: that backlog fills the bell
  // quietly, as the first check does, rather than as a pile of notifications at once.
  if (loaded && prefs.enabled && (!before.enabled || prefs.scope !== before.scope)) {
    void checkNewEpisodes(Date.now(), { quiet: prefs.scope !== before.scope }).catch((err: unknown) => console.warn('Could not check for new episodes', err));
  }
}

function saveSeen(): Promise<void> {
  // Marking read before the first check after the upgrade keeps the old format, so that check still knows.
  const { legacy, ...value } = seen;
  return settings.set(seenKey, legacy ? { checkedAt: value.checkedAt, items: value.items } : value).catch((err: unknown) => console.warn('Could not save new-episode alerts', err));
}

export function markAllRead(): void {
  if (!seen.items.some((item) => !item.read)) return;
  seen = { ...seen, items: seen.items.map((item) => ({ ...item, read: true })) };
  changed();
  void saveSeen();
}

export function markRead(videoId: string): void {
  const item = seen.items.find((i) => i.videoId === videoId);
  if (!item || item.read) return;
  item.read = true;
  changed();
  void saveSeen();
}

/**
 * An announced episode the person has since watched (from Continue Watching,
 * its title page, another device's sync) no longer waits on the badge.
 */
onWatchChange(() => {
  const watched = seen.items.filter((item) => !item.read && episodeState({ id: item.titleId, type: 'series', name: item.show, genres: [], origins: [] }, item.season, { id: item.videoId, number: item.episode, title: item.title }).kind === 'watched');
  if (!watched.length) return;
  const ids = new Set(watched.map((item) => item.videoId));
  seen = { ...seen, items: seen.items.map((item) => (ids.has(item.videoId) ? { ...item, read: true } : item)) };
  changed();
  void saveSeen();
});

/**
 * The series to look up: ones with watch history ("shows I'm watching"),
 * plus every saved series when the scope is the whole library. Most recently
 * watched first, so the cap keeps the ones that matter.
 */
export function followedSeries(scope: AlertScope, library: Title[] = libraryEntries().map((e) => e.title), watched: Title[] = recentlyWatched()): Title[] {
  const ids = new Set<string>();
  const all = scope === 'library' ? [...watched, ...library] : watched;
  return all.filter((title) => isShowType(title.type) && !ids.has(title.id) && ids.add(title.id)).slice(0, MAX_SERIES);
}

/**
 * For a series the last check didn't follow: what aired before this isn't
 * announced, as it came before the person followed it. The first check
 * after upgrading from a version without `announced` starts where that
 * version stopped looking. A series saved to the library (and not watched)
 * was followed when it was saved; for one that's watched only its last
 * watch is known, so a day's grace before the previous check is used.
 */
function followedFloor(titleId: string, now: number): number {
  // A last check later than now ran while the clock was ahead: when it really was is unknown, so the whole lookback counts.
  if (seen.checkedAt > now) return now - LOOKBACK_MS;
  if (seen.legacy) return seen.checkedAt;
  const saved = prefs.scope === 'library' && lastWatchedAt(titleId) === 0 ? libraryEntries().find((e) => e.title.id === titleId)?.addedAt : undefined;
  return saved ?? Math.max(seen.checkedAt - FOLLOW_GRACE_MS, now - LOOKBACK_MS);
}

/**
 * Episodes of `full` that aired in (`since`, `now`], aren't watched and
 * weren't announced before. Specials (season 0) are left out, as they are
 * from Continue Watching's count.
 */
export function freshEpisodes(full: Title, since: number, now: number, known: ReadonlySet<string>): AlertItem[] {
  // An addon can list the same episode twice: it's one alert (and one on the badge).
  const listed = new Set<string>();
  return (full.seasons ?? [])
    .filter((s) => s.number > 0)
    .flatMap((s) =>
      s.episodes.flatMap((episode) => {
        // The exact air time when it's known (catalog/air-times.ts), else the air date.
        const exact = exactAirTime(full.id, s.number, episode.number, episode.released);
        const at = exact ?? releasedAt(episode.released);
        if (!(at > since && at <= now) || known.has(episode.id) || listed.has(episode.id) || episodeState(full, s.number, episode).kind === 'watched') return [];
        listed.add(episode.id);
        const item: AlertItem = { videoId: episode.id, titleId: full.id, show: full.name, season: s.number, episode: episode.number, title: episode.title, airedAt: at, read: false };
        if (full.poster) item.poster = full.poster;
        if (exact !== undefined) item.exact = true;
        return [item];
      }),
    );
}

/** The soonest exact air time of `full`'s episodes after `now`, if any is known. */
export function nextAirTime(full: Title, now: number): number | undefined {
  let soonest: number | undefined;
  for (const s of full.seasons ?? []) {
    if (s.number <= 0) continue;
    for (const episode of s.episodes) {
      const at = exactAirTime(full.id, s.number, episode.number, episode.released);
      if (at !== undefined && at > now && (soonest === undefined || at < soonest)) soonest = at;
    }
  }
  return soonest;
}

/**
 * The day an announced episode aired, as the bell shows it. An exact air time
 * (`exact`, catalog/air-times.ts) is a moment, shown as the local day it aired
 * on, even one at midnight UTC (8 pm in New York). So is an air date, kept as
 * the start of its day locally (lib/air-date.ts); one saved by older versions
 * as UTC midnight is shown as that UTC date, so it doesn't slip a day.
 */
export function airedDateText(at: number, tag: string, exact = false): string {
  const dateOnly = !exact && at % 86_400_000 === 0;
  return new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(at);
}

/** Text for a system notification about `found`: one per episode, or one for the lot when there are many. */
export function toastsFor(found: readonly AlertItem[]): { title: string; body: string }[] {
  if (found.length === 0) return [];
  if (found.length >= GROUP_FROM) {
    const shows = [...new Set(found.map((item) => item.show))];
    return [{ title: t('alerts.toast.grouped-title'), body: tn('alerts.toast.grouped', found.length, { shows: formatList(shows.slice(0, 5)) }) }];
  }
  // Every announced episode is unwatched: spoiler protection decides whether its name shows.
  const hide = hiddenFor('unwatched').title;
  return found.map((item) => ({ title: item.show, body: t('alerts.toast.episode', { season: item.season, episode: item.episode, title: episodeName(item.episode, item.title, hide) }) }));
}

/**
 * One check: looks up the followed series a few at a time and announces
 * what aired since the last check. The first check (nothing announced yet)
 * fills the bell with the past week but shows no system notifications, so
 * a fresh profile isn't greeted with a pile of toasts; a `quiet` check does
 * the same (the scope just widened to shows nobody has been told about).
 */
export async function checkNewEpisodes(now = Date.now(), { quiet = false } = {}): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    if (!loaded || !prefs.enabled) return;
    const first = seen.checkedAt === 0;
    const since = now - LOOKBACK_MS;
    const known = new Set([...seen.items.map((item) => item.videoId), ...Object.keys(seen.announced)]);
    // A content limit: series it doesn't allow (or whose rating can't be found) aren't followed.
    const queue = await allowedTitles(followedSeries(prefs.scope));
    const total = queue.length;
    const follows: Record<string, number> = {};
    for (const title of queue) {
      // A floor later than now was saved while the clock was ahead; kept, it would hide what airs until then.
      const floor = seen.follows[title.id];
      follows[title.id] = floor !== undefined && floor <= now ? floor : followedFloor(title.id, now);
    }
    const found: AlertItem[] = [];
    let failures = 0;
    /** The next exact air time among the followed series: a check is due then (see `checkAtAirTime`). */
    let soonest: number | undefined;
    const worker = async () => {
      for (let title = queue.shift(); title; title = queue.shift()) {
        const full = await settleWithin(loadMeta(title.type, title.id), META_TIMEOUT_MS, null, () => failures++);
        if (!full) continue;
        await settleWithin(loadAirTimes(full), META_TIMEOUT_MS, false);
        found.push(...freshEpisodes(full, Math.max(since, follows[title.id] ?? since), now, known));
        const next = nextAirTime(full, now);
        if (next !== undefined && (soonest === undefined || next < soonest)) soonest = next;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    checkAtAirTime(soonest, now);
    // A check where nothing could be looked up (offline) changes nothing; the next one looks at the same window,
    // in a few minutes rather than at the next timed check hours away.
    clearTimeout(retryTimer);
    if (total > 0 && failures === total) {
      retryTimer = setTimeout(() => void checkNewEpisodes().catch((err: unknown) => console.warn('Could not check for new episodes', err)), RETRY_MS);
      return;
    }
    const kept = seen.items.filter((item) => !item.read || now - item.airedAt < KEEP_READ_MS);
    // Remembered while they can still fall in the window, however many the bell keeps.
    const announced: Record<string, number> = {};
    for (const [id, at] of Object.entries(seen.announced)) if (at > since) announced[id] = at;
    for (const item of found) announced[item.videoId] = item.airedAt;
    seen = { checkedAt: now, items: [...found, ...kept].sort((a, b) => b.airedAt - a.airedAt).slice(0, MAX_ITEMS), announced, follows };
    changed();
    await saveSeen();
    if (first || quiet || !prefs.toasts) return;
    // The limit is asked again per show: one whose rating isn't known right now gets no notification.
    const shown = found.filter((item) => verdictNow({ id: item.titleId, type: 'series' }) === 'allowed');
    for (const toast of toastsFor(shown)) await invoke('alerts_notify', toast).catch((err: unknown) => console.warn('Could not show a notification', err));
  })().finally(() => {
    checking = null;
  });
  return checking;
}

let airTimer: ReturnType<typeof setTimeout> | undefined;
/** After a check that could look nothing up, the next comes this much later. */
const RETRY_MS = 5 * 60 * 1000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** A little after an episode's exact air time, so the addon has had a moment to list it. */
const AIR_GRACE_MS = 2 * 60 * 1000;

/**
 * With exact air times known, an episode airing before the next timed check
 * is announced at its air time rather than hours later: one extra check is
 * set for then.
 */
function checkAtAirTime(at: number | undefined, now: number): void {
  clearTimeout(airTimer);
  if (at === undefined || at - now > CHECK_INTERVAL_MS) return;
  airTimer = setTimeout(() => void checkNewEpisodes().catch((err: unknown) => console.warn('Could not check for new episodes', err)), at - now + AIR_GRACE_MS);
}

/**
 * Runs the timed check now if the clock says it's overdue. The interval alone
 * can't be trusted across sleep: a PC that slept through a check leaves it
 * waiting (on some systems timers don't count the time asleep), so episodes
 * that aired overnight would be announced hours after waking.
 */
export function checkIfOverdue(now = Date.now()): Promise<void> | undefined {
  if (!loaded || seen.checkedAt === 0 || now - seen.checkedAt < CHECK_INTERVAL_MS) return undefined;
  return checkNewEpisodes(now);
}

let catchingUp = false;

/** Starts the checks: one now, then every `CHECK_INTERVAL_MS` while Orbit runs, and any overdue one after sleep. */
export async function startAlerts(): Promise<void> {
  if (!loaded) await loadAlerts();
  clearInterval(timer);
  timer = setInterval(() => void checkNewEpisodes().catch((err: unknown) => console.warn('Could not check for new episodes', err)), CHECK_INTERVAL_MS);
  if (!catchingUp && typeof window !== 'undefined') {
    catchingUp = true;
    // Waking from sleep brings the connection back (and the window, unless Orbit waits in the tray).
    const catchUp = () => void checkIfOverdue()?.catch((err: unknown) => console.warn('Could not check for new episodes', err));
    window.addEventListener('online', catchUp);
    document.addEventListener('visibilitychange', catchUp);
  }
  await checkNewEpisodes();
}
