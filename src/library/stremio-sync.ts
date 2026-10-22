/**
 * Continue Watching and watched marks, synced both ways with the signed-in
 * Stremio account (Settings → Integrations → Stremio). The account's library
 * is read and written by Rust (src-tauri/src/stremio.rs); this decides what
 * to take and what to send.
 *
 * - Pull (at startup and from "Sync now"): a title Stremio watched more
 *   recently than Orbit takes Stremio's place in it. Watched marks are only
 *   ever added from Stremio, never removed, so a sparse Stremio record can't
 *   wipe history Orbit has from elsewhere (e.g. a Trakt import).
 * - History the person removed in My Library → History isn't sent anywhere
 *   (Stremio keeps its own); a pull just doesn't bring back what Stremio
 *   watched before it was cleared.
 * - Push: each change the person makes is sent a few seconds later, and as
 *   Orbit quits (`flushStremioSync`). What's still waiting is kept per profile
 *   (`stremio.pending`) and sent after the next start's pull, so a change made
 *   just before quitting, or offline, still reaches Stremio. Nothing
 *   is sent until a pull has succeeded in this session, so Orbit never
 *   overwrites Stremio with state it hasn't caught up on; changes made before
 *   then wait for it (a pull skips them, being newer, so they'd be lost).
 * - A series' watched episodes are read from Stremio just before a push and
 *   Orbit's marks added to them, so marks made on another device since the
 *   last pull are never dropped. (So an episode unmarked here stays marked in
 *   Stremio: losing a mark is worse than keeping one.)
 * - A movie is sent as unwatched only after "Mark unwatched" here. One Orbit
 *   merely hasn't seen finished leaves Stremio's mark as it is: it may have
 *   been finished on another device since the last pull.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { httpsUrl } from '../addons/schema';
import { loadMeta } from '../catalog/service';
import { episodeAfter, type Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { settings } from '../lib/ipc';
import { isLocalId } from '../lib/local-media';
import { isJellyfinId } from './jellyfin';
import { isPlexId } from './plex';
import { profileSetting } from './profiles';
import { historyClearedAt, importWatch, isResumable, MIN_RESUME_SECONDS, onWatchSaved, watchHistoryRead, watchLoadError, watchPrefs, watchRecord, type NextEpisode, type Progress } from './watch';
import { decodeWatched, encodeWatched, readWatched, videoOrder } from './watched-bitfield';

export const SYNC_KEY = 'stremio.sync';
/** The ids of titles still to send, kept across restarts (src-tauri/src/profiles.rs PROFILE_SETTINGS). */
export const PENDING_KEY = 'stremio.pending';
/** Titles kept waiting at most; more than that and the oldest are left to the next change or pull. */
const MAX_KEPT_PENDING = 500;
/** Series looked up per pull (their episode lists are needed); the most recently watched first. */
const MAX_SERIES = 60;
const PUSH_DELAY_MS = 15_000;
/** Stremio's "at the start of the next episode". */
const NEXT_EPISODE_OFFSET = 1;
/** What Rust sends at most (src-tauri/src/stremio.rs checks each again, and refuses more). */
const MAX_PUSH = 50;
const MAX_NAME_BYTES = 500;
const MAX_WATCHED_FIELD = 64 * 1024;

const ms = v.fallback(v.pipe(v.number(), v.finite(), v.minValue(0)), 0);
const ItemSchema = v.object({
  _id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  type: v.picklist(['movie', 'series']),
  name: v.pipe(v.string(), v.maxLength(500)),
  // Whatever wrote it to the account (another app, an addon's meta): never on this machine or the LAN.
  poster: v.fallback(v.nullable(httpsUrl), null),
  state: v.object({
    lastWatched: v.pipe(v.string(), v.maxLength(40)),
    timeOffset: ms,
    duration: ms,
    video_id: v.fallback(v.nullable(v.pipe(v.string(), v.maxLength(200))), null),
    timesWatched: ms,
    watched: v.fallback(v.nullable(v.pipe(v.string(), v.maxLength(64 * 1024))), null),
  }),
});
export type StremioItem = v.InferOutput<typeof ItemSchema>;
/** Taken out of the library ("Remove from library"), and whether it was played since (stremio-core sets `temp` then). */
const ListingSchema = v.object({ removed: v.fallback(v.boolean(), false), temp: v.fallback(v.boolean(), false) });

/**
 * `item` as Stremio's Continue Watching has it: one taken out of the library keeps its progress
 * but isn't shown (stremio-core: `!removed || temp`) until it's played again, so it counts as at the start.
 */
function asListed(item: StremioItem, raw: unknown): StremioItem {
  const listing = v.safeParse(ListingSchema, raw);
  return listing.success && listing.output.removed && !listing.output.temp ? { ...item, state: { ...item.state, timeOffset: 0 } } : item;
}

let enabled = true;
/** The active profile's key for the setting. */
let syncKey = SYNC_KEY;
/** The active profile's key for what's waiting to be sent; null until `startStremioSync` has read it. */
let pendingKey: string | null = null;
let pulled = false;
const pending = new Map<string, Title>();
/**
 * Movies the person marked unwatched here and not yet sent. Only these go out as `watched: false`:
 * a movie Orbit merely hasn't seen finished may have been finished on another device, and `false`
 * would wipe that mark in Stremio (its timesWatched and flaggedWatched).
 */
const unmarked = new Set<string>();
let timer: number | undefined;

export const syncEnabled = () => enabled;

/** Dispatched on `document` when what's known about the account or the last sync changes. */
export const STREMIO_SYNC_CHANGED = 'orbit:stremio-sync';

export interface StremioSyncState {
  /** Null until a pull or the Settings page has found out. */
  signedIn: boolean | null;
  /** When a pull or push last went through in this session (ms), or null. */
  lastSync: number | null;
}

let state: StremioSyncState = { signedIn: null, lastSync: null };

/** What's known without asking Stremio (for Settings' profile header). */
export const stremioSyncState = (): StremioSyncState => state;

function note(change: Partial<StremioSyncState>): void {
  state = { ...state, ...change };
  // (Tests run without a page.)
  if (typeof document !== 'undefined') document.dispatchEvent(new Event(STREMIO_SYNC_CHANGED));
}

/** Settings → Integrations → Stremio found the account signed in or out. */
export function noteStremioAccount(signedIn: boolean): void {
  // Nothing is sent again until a pull of whichever account signs in next has gone through.
  if (!signedIn) pulled = false;
  if (signedIn !== state.signedIn) note(signedIn ? { signedIn } : { signedIn, lastSync: null });
}

/**
 * Whether Stremio can know a title: a movie or series under an IMDb or addon
 * id. A file played from this PC has a local id (a hash of its path) that
 * means nothing elsewhere, and a title only on the person's own Jellyfin or
 * Plex server names an item on that server; neither is ever sent, nor taken
 * in from a pull.
 */
export const syncable = (title: Pick<Title, 'id' | 'type'>): boolean =>
  (title.type === 'movie' || title.type === 'series') && !isLocalId(title.id) && !isJellyfinId(title.id) && !isPlexId(title.id);

/** Reads the setting, pulls, and starts pushing changes; call once at startup. */
export async function startStremioSync(): Promise<void> {
  const saved = await profileSetting(SYNC_KEY);
  syncKey = saved.key;
  enabled = saved.value !== false;
  onWatchSaved((title, change) => {
    if (!enabled || !syncable(title)) return;
    if (change.unmarked) unmarked.add(title.id);
    pending.set(title.id, title);
    rememberPending();
    if (pulled) schedulePush();
    // The first pull failed (started offline, Stremio down): try it again, at most once a
    // minute, rather than hold every change until a restart. A pull that goes through pushes.
    // Not when signed out: there's nothing to pull until the person signs in.
    else if (state.signedIn !== false && Date.now() - pullTriedAt >= RETRY_PULL_MS) void syncNow().catch(() => {});
  });
  const kept = await profileSetting(PENDING_KEY);
  pendingKey = kept.key;
  keptWaiting = enabled ? keptIds(kept.value) : [];
  // Until watch history is read, what was kept waiting can't be looked up (it would be dropped) and a pull would overwrite it.
  await watchHistoryRead();
  await restorePending();
  if (enabled) await syncNow().catch(() => {});
}

/**
 * Ids kept waiting last time and not yet taken back by `restorePending`. They stay in the kept
 * list meanwhile, beside changes made since, so quitting before they're looked up loses neither.
 */
let keptWaiting: string[] = [];

/**
 * Takes back what was left waiting last time (quit offline, or before it went out), to send after
 * this start's pull. Saved history keeps only a snapshot of a series, so its episode list (for the
 * watched marks) is looked up.
 */
async function restorePending(): Promise<void> {
  const waiting = keptWaiting.flatMap((id) => {
    const record = watchRecord(id);
    return record && syncable(record.title) ? [record.title] : [];
  });
  const titles = await Promise.all(waiting.map(async (title) => (title.type === 'series' ? ((await loadMeta('series', title.id).catch(() => null)) ?? title) : title)));
  // Watched again meanwhile: the title saved since is newer. Sync turned off meanwhile: nothing waits.
  if (enabled) for (const title of titles) if (!pending.has(title.id)) pending.set(title.id, title);
  keptWaiting = [];
  rememberPending();
}

export async function setSyncEnabled(on: boolean): Promise<void> {
  enabled = on;
  // Turned off: what was waiting to be sent stays here (a later pull won't undo it, being older),
  // and turned on again, Orbit catches up with Stremio (which may have moved on meanwhile) before sending.
  if (!on) {
    window.clearTimeout(timer);
    pending.clear();
    keptWaiting = [];
    rememberPending();
    pulled = false;
  }
  await settings.set(syncKey, on);
  if (on && !pulled) await syncNow().catch(() => {});
}

/** The send under way, if any: the next waits for it, so an older state can't reach Stremio after a newer one. */
let pushing: Promise<void> = Promise.resolve();

/** Title ids from the kept setting: strings only, without repeats, at most `MAX_KEPT_PENDING`. */
export function keptIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
  return [...new Set(ids)].slice(0, MAX_KEPT_PENDING);
}

let remembering: Promise<unknown> = Promise.resolve();
/** Keeps what's waiting to be sent for the next start; in order, so an older list never lands after a newer one. */
function rememberPending(): void {
  const key = pendingKey;
  if (!key) return;
  const ids = [...new Set([...keptWaiting, ...pending.keys()])].slice(-MAX_KEPT_PENDING);
  remembering = remembering
    .then(() => settings.set(key, ids.length ? ids : null))
    .catch((err: unknown) => console.warn('Could not keep what is waiting for Stremio', err));
}

/**
 * Sends what's waiting now instead of a few seconds later, for Orbit quitting; settles once it's
 * sent (or failed) and the list kept for the next start is saved. Before this session's pull
 * nothing is sent (see the module docs): it stays kept for the next start.
 */
export async function flushStremioSync(): Promise<void> {
  if (enabled && pulled && pending.size) {
    window.clearTimeout(timer);
    pushing = pushing.then(push);
  }
  await pushing;
  await remembering;
}

function schedulePush(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void (pushing = pushing.then(push)), PUSH_DELAY_MS);
}

let running: Promise<number> | null = null;
/** When a pull was last started, and how soon a watch save may start another after one failed. */
let pullTriedAt = -Infinity;
const RETRY_PULL_MS = 60_000;

/**
 * Brings in what Stremio watched more recently; returns how many titles changed.
 * A call made while a sync is running shares that one, so two pulls never
 * import the same titles at once.
 */
export function syncNow(): Promise<number> {
  if (!running) pullTriedAt = Date.now();
  running ??= pull().finally(() => (running = null));
  return running;
}

/** What src-tauri/src/stremio.rs answers once Stremio has ended the session. */
const SESSION_ENDED = 'err.stremio.session-ended';

/**
 * Whether `err` says the profile isn't signed in to Stremio (never was, signed out, or its session ended).
 * Then nothing more is sent until a pull of the account signed in next has gone through.
 */
function signedOut(err: unknown): boolean {
  const code = err instanceof Error ? err.message : String(err);
  if (code !== SESSION_ENDED && code !== 'err.stremio.sign-in-first') return false;
  // A session Stremio ended (not one never started) is news: say so once, in the person's language.
  if (state.signedIn !== false && code === SESSION_ENDED) toast(t('states.auth.stremio'));
  noteStremioAccount(false);
  return true;
}

async function pull(): Promise<number> {
  let raw: unknown[];
  try {
    raw = await invoke<unknown[]>('stremio_library_pull');
  } catch (err) {
    // Signed out: nothing to sync, and nothing to send either.
    if (signedOut(err)) return 0;
    throw err;
  }
  // Turned off while Stremio was asked: nothing comes in.
  if (!enabled) return 0;
  // Watch history couldn't be read: compared with nothing, Stremio's older state would replace what's saved here.
  if (watchLoadError() !== null) throw watchLoadError();
  const items = raw.flatMap((r) => {
    const parsed = v.safeParse(ItemSchema, r);
    return parsed.success && syncable({ id: parsed.output._id, type: parsed.output.type }) ? [asListed(parsed.output, r)] : [];
  });
  const newer = items
    .map((item) => ({ item, at: Date.parse(item.state.lastWatched) }))
    // A second of slack: both sides round times differently.
    // Titles Orbit has are checked too: Stremio may have taken one out of Continue Watching.
    .filter(({ item, at }) => remoteNewer(item._id, at) && (hasProgress(item) || !!watchRecord(item._id)))
    .sort((a, b) => b.at - a.at);
  let count = 0;
  for (const { item, at } of newer.filter((n) => n.item.type === 'movie')) {
    importWatch(...movieImport(item), at);
    imported.set(item._id, at);
    count++;
  }
  const series = newer.filter((n) => n.item.type === 'series').slice(0, MAX_SERIES);
  await Promise.all(
    series.map(async ({ item, at }) => {
      const full = await loadMeta('series', item._id).catch(() => null);
      if (!full?.seasons) return;
      const watched = item.state.watched ? await decodeWatched(item.state.watched, videoOrder(full)) : new Set<string>();
      // Looked at again: the person may have watched it here (or turned sync off) while its episodes were looked up.
      if (!enabled || !remoteNewer(item._id, at)) return;
      importSeries(item, full, watched, at);
      imported.set(item._id, at);
      count++;
    }),
  );
  pulled = true;
  note({ signedIn: true, lastSync: Date.now() });
  if (pending.size) schedulePush();
  return count;
}

/**
 * Stremio's time for each title brought in this session. A time in the future (another device's clock
 * running ahead) is kept here as now, so it would stay "newer" on every pull and undo what was watched
 * here since; the same time again is nothing new.
 */
const imported = new Map<string, number>();

/** Whether Stremio's time for a title (`at`) is later than Orbit's, and than when its history was cleared. */
const remoteNewer = (id: string, at: number) => imported.get(id) !== at && at > Math.max(watchRecord(id)?.updatedAt ?? 0, historyClearedAt(id)) + 1000;

/** A title, its rows and what's next, ready for `importWatch`. */
type Imported = [Title, Progress[], { next: NextEpisode | null; completed: boolean }];

const hasProgress = (item: StremioItem) => item.state.timeOffset > 0 || item.state.timesWatched > 0 || !!item.state.watched;

const shell = (item: StremioItem): Title => ({ id: item._id, type: item.type, name: item.name, poster: item.poster ?? undefined, genres: [], origins: [] });

/** A movie's Stremio state as Orbit history; a movie watched in Orbit stays watched. */
export function movieImport(item: StremioItem): Imported {
  const local = watchRecord(item._id);
  const watched = item.state.timesWatched > 0 || (local?.rows[0]?.watched ?? false);
  const row: Progress = {
    videoId: item._id,
    titleId: item._id,
    season: null,
    episode: null,
    // An offset of 0 means Stremio took it out of Continue Watching.
    position: item.state.timeOffset > NEXT_EPISODE_OFFSET ? item.state.timeOffset / 1000 : 0,
    duration: item.state.duration / 1000,
    watched,
    updatedAt: 0,
  };
  return [local?.title ?? shell(item), [row], { next: null, completed: watched }];
}

/** A series' Stremio state as Orbit history: episodes it watched, and the one in progress or up next. */
export function seriesImport(item: StremioItem, full: Title, watchedIds: ReadonlySet<string>): Imported {
  const local = watchRecord(item._id);
  const known = new Map((local?.rows ?? []).map((r) => [r.videoId, r]));
  const episodes = (full.seasons ?? []).flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode })));
  const rows: Progress[] = [];
  const row = (ref: (typeof episodes)[number], position: number, watched: boolean): Progress => ({
    videoId: ref.episode.id,
    titleId: full.id,
    season: ref.season,
    episode: ref.episode.number,
    position,
    duration: known.get(ref.episode.id)?.duration ?? 0,
    watched,
    updatedAt: 0,
  });
  for (const ref of episodes) if (watchedIds.has(ref.episode.id) && !known.get(ref.episode.id)?.watched) rows.push(row(ref, 0, true));
  const watchedNow = new Set([...watchedIds, ...[...known.values()].filter((r) => r.watched).map((r) => r.videoId)]);

  const { video_id: videoId, timeOffset, duration } = item.state;
  const current = episodes.find((ref) => ref.episode.id === videoId);
  // Watching an episode again leaves it watched (see watch.ts `recordProgress`).
  const rewatching = !!current && watchedNow.has(current.episode.id);
  const upNext = ({ season, episode: e }: (typeof episodes)[number]): NextEpisode => ({ videoId: e.id, season, episode: e.number, title: e.title, ...(e.thumbnail ? { thumbnail: e.thumbnail } : {}) });
  let next: NextEpisode | null = null;
  // Past the share Orbit counts as watched, as when played here (watch.ts `recordProgress`): Stremio moves
  // on only past 90% once the player closes, so it may be stopped short of that or still be in the credits.
  const finished = !!current && current.season !== 0 && timeOffset > NEXT_EPISODE_OFFSET && duration > 0 && timeOffset / duration >= watchPrefs().watchedAt;
  if (finished) watchedNow.add(current.episode.id);
  if (current && timeOffset > NEXT_EPISODE_OFFSET) {
    rows.push({ ...row(current, timeOffset / 1000, rewatching || finished), duration: duration / 1000 });
    const after = finished ? episodeAfter(full, current.season, current.episode.number, current.episode.id) : undefined;
    if (after) next = upNext(after);
    // Stremio keeps an episode in Continue Watching from its first second (e.g. one it played on by
    // itself, stopped straight away); Orbit resumes only from MIN_RESUME_SECONDS, so until then it's up next.
    else if (!finished && timeOffset / 1000 < MIN_RESUME_SECONDS) next = upNext(current);
    // Watching a finished show again, stopped past where a watched episode counts as part way: what was
    // up next stays, as when played here (watch.ts `recordProgress`), so the show stays in Continue Watching.
    else if (!finished && rewatching) next = local?.next ?? null;
  } else if (current && timeOffset === NEXT_EPISODE_OFFSET) {
    next = upNext(current);
  } else if (current || !videoId || timeOffset === 0) {
    // Stremio took it out of Continue Watching: so does Orbit.
    for (const r of local?.rows ?? []) if (isResumable(r)) rows.push({ ...r, position: 0, updatedAt: 0 });
  } else {
    // An episode Orbit's list doesn't have, in progress there, says nothing of the sort: what was up next stays.
    next = local?.next ?? null;
  }
  const aired = episodes.filter((ref) => !ref.episode.airs && ref.season > 0);
  // A show watched through stays finished while an episode of it is watched again.
  const onUnwatched = (next && !watchedNow.has(next.videoId)) || (current && timeOffset > NEXT_EPISODE_OFFSET && !rewatching && !finished);
  const completed = !onUnwatched && aired.length > 0 && aired.every((ref) => watchedNow.has(ref.episode.id));
  return [full, rows, { next, completed }];
}

/**
 * Brings in a series' Stremio state as of `at`. Its watched marks are kept a
 * moment older than the episode it's on: saved at the same time, the latest
 * row would be whichever came first, often a watched episode, and a show part
 * way through in Stremio wouldn't resume or show in Continue Watching.
 */
export function importSeries(item: StremioItem, full: Title, watchedIds: ReadonlySet<string>, at: number): void {
  const [title, rows, meta] = seriesImport(item, full, watchedIds);
  const marks = rows.filter((row) => row.videoId !== item.state.video_id);
  if (marks.length && marks.length < rows.length) importWatch(title, marks, meta, at - 1);
  importWatch(title, marks.length < rows.length ? rows.filter((row) => row.videoId === item.state.video_id) : rows, meta, at);
}

/**
 * What to tell Stremio about a title, from Orbit's history. `remote` is
 * Stremio's watched field for it as read just now (null: it has none).
 * `unmarkedHere`: the person marked the movie unwatched here, the only time
 * it's sent as unwatched; otherwise an unwatched movie leaves Stremio's mark.
 */
export async function patchFor(title: Title, remote: string | null = null, unmarkedHere = false): Promise<Record<string, unknown> | null> {
  const record = watchRecord(title.id);
  if (!record || !syncable(title)) return null;
  const base = { id: title.id, type: title.type, name: fitBytes(title.name, MAX_NAME_BYTES), poster: title.poster ?? null, lastWatched: record.updatedAt };
  if (title.type === 'movie') {
    const row = record.rows.find((r) => r.videoId === title.id);
    return { ...base, videoId: title.id, timeOffset: isResumable(row) ? Math.round(row.position * 1000) : 0, duration: Math.round((row?.duration ?? 0) * 1000), watched: row?.watched ? true : unmarkedHere ? false : null };
  }
  const latest = [...record.rows].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const playing = isResumable(latest) ? latest : undefined;
  // After a finished episode Orbit knows what's next; Stremio marks that with an offset of 1. Nothing
  // up next (the show taken out of Continue Watching, here or in Stremio) is an offset of 0.
  const nextId = record.next?.videoId;
  const videos = videoOrder(title);
  // Stremio's marks plus Orbit's. One that doesn't line up with this episode
  // list can't be merged, so Stremio keeps its own rather than lose marks.
  const theirs = remote === null ? new Set<string>() : await readWatched(remote, videos);
  const ours = record.rows.filter((r) => r.watched).map((r) => r.videoId);
  // Without the episode list the field can't be written; Stremio keeps its own.
  const field = videos.length && theirs ? await encodeWatched(new Set([...theirs, ...ours]), videos) : null;
  return {
    ...base,
    videoId: playing?.videoId ?? nextId ?? latest?.videoId ?? null,
    timeOffset: playing ? Math.round(playing.position * 1000) : nextId ? NEXT_EPISODE_OFFSET : 0,
    duration: Math.round((playing?.duration ?? 0) * 1000),
    watched: null,
    // The field starts with an episode id; one with a space or a non-ASCII character can't go in it
    // (Rust would refuse the whole title), so Stremio keeps its own field then.
    watchedField: field !== null && field.length <= MAX_WATCHED_FIELD && /^[!-~]*$/.test(field) ? field : null,
    // What the field was merged with: Rust writes it only if Stremio's is still this.
    watchedBase: remote,
  };
}

/** `text` cut to at most `max` bytes of UTF-8, between characters. */
export function fitBytes(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    used += encoder.encode(char).length;
    if (used > max) break;
    out += char;
  }
  return out;
}

async function push(): Promise<void> {
  await sendPending();
  rememberPending();
}

async function sendPending(): Promise<void> {
  const titles = [...pending.values()];
  pending.clear();
  // In batches Rust takes: after a while offline more than one batch's worth can be waiting.
  for (let i = 0; i < titles.length; i += MAX_PUSH) {
    if (!enabled) return;
    // Signed out meanwhile: the rest wait, with what failed, for the next sign-in's pull.
    if (!pulled) {
      for (const t of titles.slice(i)) if (!pending.has(t.id)) pending.set(t.id, t);
      return;
    }
    const batch = titles.slice(i, i + MAX_PUSH);
    const series = batch.filter((t) => t.type === 'series').map((t) => t.id);
    await (series.length ? invoke<Record<string, string | null>>('stremio_library_watched', { ids: series }) : Promise.resolve({} as Record<string, string | null>))
      .then(async (remote) => {
        const patches = (await Promise.all(batch.map((t) => patchFor(t, remote[t.id] ?? null, unmarked.has(t.id))))).filter((p) => p !== null);
        if (!patches.length) return;
        await invoke<number>('stremio_library_push', { patches }).then((skipped) => {
          // Sent: a later change of these movies no longer clears Stremio's mark.
          for (const t of batch) unmarked.delete(t.id);
          // Left out as invalid: sending them again wouldn't change that.
          if (skipped) console.warn(`Stremio sync left out ${skipped} title(s) it couldn't send`);
          // Nothing went out when every title was left out: no sync to note.
          note(skipped < patches.length ? { signedIn: true, lastSync: Date.now() } : { signedIn: true });
        });
      })
      .catch((err: unknown) => {
        // Try again with the next change; a lost update is caught up on by the next pull anyway.
        for (const t of batch) if (!pending.has(t.id)) pending.set(t.id, t);
        if (!signedOut(err)) console.warn('Could not sync with Stremio', err);
      });
  }
}

/** What src-tauri/src/stremio.rs `call()` answers when the request itself failed (no connection, a timeout). */
const UNREACHABLE = 'err.stremio.unreachable';

/**
 * Settings' account check: the account, null once signed out, or 'unreachable' when Stremio couldn't be asked.
 * Any other failure (the keychain, a reply Orbit can't read, a session refused in other words) counts as
 * signed out, so the person can still sign in again rather than retry forever.
 */
export const checkStremioAccount = (): Promise<{ email: string } | null | 'unreachable'> =>
  invoke<{ email: string } | null>('stremio_account').catch((err: unknown) => (err === UNREACHABLE ? ('unreachable' as const) : null));

let askingAccount = false;
/**
 * Finds out whether Stremio is signed in when nothing has yet (sync off, so no pull has):
 * asked once, and again later only if Stremio couldn't be reached. Signed out, no request leaves Orbit.
 */
export function askStremioAccount(): void {
  if (askingAccount || state.signedIn !== null) return;
  askingAccount = true;
  void checkStremioAccount().then((account) => {
    if (account === 'unreachable') askingAccount = false;
    else noteStremioAccount(account !== null);
  });
}
