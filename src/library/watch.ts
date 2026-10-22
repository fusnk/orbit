/**
 * Watch state, following the spec's "Watch state" model: one source for every
 * surface. Progress is kept per movie and per episode, in SQLite (Rust), and
 * loaded once at startup; reads are synchronous from memory. The player
 * records progress; details, cards, Continue Watching and My Library read it.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { loadMeta } from '../catalog/service';
import { episodeAfter, isShowType, type Episode, type Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t, tn } from '../i18n';
import { releasedAt } from '../lib/air-date';
import { settings } from '../lib/ipc';
import { isLocalId } from '../lib/local-media';
import { historyPaused } from './history-pause';
import { episodeName, hiddenFor } from './spoilers';
import { profileSetting } from './profiles';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

/** Less than this in, a title starts over rather than resuming. */
export const MIN_RESUME_SECONDS = 30;

/** Settings → Library & Metadata. */
export const WATCH_SETTINGS = {
  /** Share of the runtime that counts as watched: 0.8, 0.85, 0.9 (spec default) or 0.95. */
  watchedAt: 'library.watched-at',
  /** Days untouched before a title leaves Continue Watching: 7, 14, 30 (spec default), 60, or 0 for never. */
  continueDays: 'library.continue-days',
} as const;
export const WATCHED_AT_CHOICES = [0.8, 0.85, 0.9, 0.95] as const;
export const CONTINUE_DAYS_CHOICES = [7, 14, 30, 60, 0] as const;

export function parseWatchedAt(value: unknown): number {
  return WATCHED_AT_CHOICES.find((c) => c === value) ?? 0.9;
}
export function parseContinueDays(value: unknown): number {
  return CONTINUE_DAYS_CHOICES.find((c) => c === value) ?? 30;
}

let watchedAt = parseWatchedAt(undefined);
let continueDays = parseContinueDays(undefined);

/** The current choices; `setWatchPrefs` changes and saves them. */
export const watchPrefs = () => ({ watchedAt, continueDays });
export async function setWatchPrefs(next: { watchedAt?: number; continueDays?: number }): Promise<void> {
  if (next.watchedAt !== undefined) {
    watchedAt = parseWatchedAt(next.watchedAt);
    await settings.set(WATCH_SETTINGS.watchedAt, watchedAt);
  }
  if (next.continueDays !== undefined) {
    continueDays = parseContinueDays(next.continueDays);
    await settings.set(WATCH_SETTINGS.continueDays, continueDays);
  }
  changed();
}
const DAY_MS = 24 * 60 * 60 * 1000;

export type EpisodeState =
  | { kind: 'unaired'; airs: string }
  | { kind: 'watched' }
  | { kind: 'in-progress'; progress: number }
  | { kind: 'up-next' }
  | { kind: 'unwatched' };

export interface ContinueEntry {
  title: Title;
  /** 0–1 through the current movie or episode; 0 when the next episode hasn't started. */
  progress: number;
  sub: string;
  /** Right-aligned time left, e.g. "7m left"; omitted for a next episode. */
  left?: string;
  badge?: string;
  still?: string;
  /** The still is a next episode's own picture, blurred against spoilers. */
  spoiler?: boolean;
}

const seconds = v.pipe(v.number(), v.finite(), v.minValue(0));
const count = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)));

const ProgressSchema = v.object({
  videoId: v.string(),
  titleId: v.string(),
  season: count,
  episode: count,
  position: seconds,
  duration: seconds,
  watched: v.boolean(),
  updatedAt: v.number(),
});
export type Progress = v.InferOutput<typeof ProgressSchema>;

/** What Continue Watching offers after a finished episode. Its fields came from an addon. */
const NextSchema = v.object({
  videoId: v.string(),
  season: v.pipe(v.number(), v.integer(), v.minValue(0)),
  episode: v.pipe(v.number(), v.integer(), v.minValue(0)),
  title: v.pipe(v.string(), v.maxLength(300)),
  thumbnail: v.fallback(v.optional(v.pipe(v.string(), v.maxLength(2048), v.url(), v.startsWith('https://'))), undefined),
});
export type NextEpisode = v.InferOutput<typeof NextSchema>;

const TitleRowSchema = v.object({
  titleId: v.string(),
  title: SnapshotSchema,
  next: v.fallback(v.nullable(NextSchema), null),
  completed: v.boolean(),
  updatedAt: v.number(),
});

interface TitleRow {
  title: Title;
  next: NextEpisode | null;
  completed: boolean;
  updatedAt: number;
}

const progress = new Map<string, Progress>();
const titles = new Map<string, TitleRow>();
/**
 * Files (on this PC, or untitled in the cloud) by id: just their names, for
 * My Library → History. Kept apart from `titles` so they stay out of
 * everything else (see `save`).
 */
const fileTitles = new Map<string, Title>();
/**
 * My Library → History: when the person cleared a title's history (ms), per
 * profile. A pull from Stremio leaves alone what it watched before then, so
 * cleared history doesn't come back (Stremio's own copy is never changed).
 */
export const HISTORY_CLEARED_KEY = 'history.cleared';
/** The most cleared titles remembered (oldest forgotten first), to keep the setting small. */
const MAX_CLEARED = 500;
let cleared = new Map<string, number>();
let clearedKey = HISTORY_CLEARED_KEY;
/** Series checked for new episodes: the most recently watched ones. */
const NEW_EPISODE_SERIES = 20;
const NEW_EPISODE_CONCURRENCY = 4;
/** After a check some shows' lookups failed in, the next one comes this much later. */
const NEW_EPISODE_RETRY_MS = 5 * 60_000;
let newEpisodesRetry: ReturnType<typeof setTimeout> | undefined;
/** Series with unwatched episodes that aired after they were last watched: how many, and the first. */
let newEpisodes = new Map<string, { count: number; first: NextEpisode; airedAt: number }>();
const listeners = new Set<() => void>();
/** What a saved change was, when sync needs to know more than the new state. */
export interface SavedChange {
  /** The person marked the movie unwatched (title menu): the one change that may clear a watched mark elsewhere. */
  unmarked?: boolean;
}
/** Told about the person's own changes (not ones brought in from elsewhere), e.g. to sync them. */
const savedListeners = new Set<(title: Title, change: SavedChange) => void>();
let version = 0;

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Increases on every change: a view can compare it to know whether to redraw. */
export function watchVersion(): number {
  return version;
}

/** Calls `listener` whenever watch state changes; returns an unsubscribe function. */
export function onWatchChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Why the last read of watch history failed, or null: My Library shows that, not an empty history. */
let loadError: unknown = null;
export const watchLoadError = (): unknown => loadError;

/**
 * Settles once watch history has been read: at once, unless the last read failed, then when a
 * read goes through (My Library's Try again). Sync waits for it: against the empty history
 * left by a failed read, everything elsewhere looks newer and would be written over what's saved.
 */
export function watchHistoryRead(): Promise<void> {
  if (loadError === null) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = onWatchChange(() => {
      if (loadError !== null) return;
      stop();
      resolve();
    });
  });
}

/** Reads watch history from storage; call once before the first page renders. */
export async function loadWatch(): Promise<void> {
  // Failed writes belong to the profile they were made in, not whichever is loaded next.
  failedWrites.clear();
  latestWrite.clear();
  clearTimeout(retryTimer);
  retryDelay = RETRY_FIRST_MS;
  writesClosed = false;
  await readWatch();
}

/**
 * Reads watch history again after it couldn't be read (My Library's Try again).
 * Unlike `loadWatch`, writes still waiting to be saved are kept and retried.
 */
export async function readWatch(): Promise<void> {
  let loaded;
  try {
    loaded = await Promise.all([
      invoke<{ titles: unknown[]; progress: unknown[] }>('watch_list'),
      settings.get(WATCH_SETTINGS.watchedAt).catch(() => undefined),
      settings.get(WATCH_SETTINGS.continueDays).catch(() => undefined),
      profileSetting(HISTORY_CLEARED_KEY).catch(() => ({ key: HISTORY_CLEARED_KEY, value: null })),
    ]);
  } catch (err) {
    // Listeners redraw to show the error.
    loadError = err;
    changed();
    throw err;
  }
  loadError = null;
  const [state, watchedSetting, daysSetting, clearedSetting] = loaded;
  clearedKey = clearedSetting.key;
  cleared = parseCleared(clearedSetting.value);
  watchedAt = parseWatchedAt(watchedSetting);
  continueDays = parseContinueDays(daysSetting);
  progress.clear();
  titles.clear();
  fileTitles.clear();
  // Rows that no longer validate are skipped, not fatal.
  for (const raw of state.progress) {
    const row = v.safeParse(ProgressSchema, raw);
    if (row.success) progress.set(row.output.videoId, row.output);
  }
  for (const raw of state.titles) {
    const row = v.safeParse(TitleRowSchema, raw);
    if (!row.success) continue;
    if (isLocalId(row.output.titleId)) fileTitles.set(row.output.titleId, fromSnapshot(row.output.title));
    else titles.set(row.output.titleId, { title: fromSnapshot(row.output.title), next: row.output.next, completed: row.output.completed, updatedAt: row.output.updatedAt });
  }
  changed();
}

const fraction = (row: Progress) => (row.duration > 0 ? Math.min(1, row.position / row.duration) : 0);
/**
 * Part-way through. A watched row is too while it's being watched again (see `recordProgress`), but only
 * below the lowest threshold there is: a row finished at 85% stays finished if the threshold is raised to 90%.
 */
const inProgress = (row: Progress | undefined): row is Progress =>
  !!row && row.position >= MIN_RESUME_SECONDS && fraction(row) < (row.watched ? WATCHED_AT_CHOICES[0] : watchedAt);

let writes: Promise<unknown> = Promise.resolve();

/** Settles once every save made so far has reached the database (or failed, to be retried); Orbit waits for it as it quits. */
export const watchWritesSettled = (): Promise<void> => writes.then(() => undefined, () => undefined);

/** Set once the active profile changed under this page: Rust writes to the active profile, so a save now would land in the new one. */
let writesClosed = false;

/**
 * Runs `select` (which switches the active profile) after every save made so far, holding the
 * saves made meanwhile. Once it succeeds nothing more is written: the page starts over for the
 * new profile. If it fails (a wrong PIN), the held saves go through to the profile still active.
 */
export function switchProfileAfterWrites(select: () => Promise<void>): Promise<void> {
  const done = writes.then(select);
  writes = done.then(
    () => {
      writesClosed = true;
      clearTimeout(retryTimer);
    },
    () => undefined,
  );
  return done;
}

/** One row to store, keyed by that row so a newer write of it replaces this one. */
type Write = { key: string; at: number } & (
  | { kind: 'progress'; row: Progress }
  | { kind: 'title'; titleId: string; title: unknown; next: NextEpisode | null; completed: boolean }
);

/** Writes as storage calls, in order: progress rows sharing a time in one call, then each title. */
function calls(steps: Write[]): { steps: Write[]; run: () => Promise<unknown> }[] {
  const byTime = new Map<number, Extract<Write, { kind: 'progress' }>[]>();
  const out: { steps: Write[]; run: () => Promise<unknown> }[] = [];
  for (const step of steps) {
    if (step.kind === 'progress') byTime.set(step.at, [...(byTime.get(step.at) ?? []), step]);
  }
  for (const [at, group] of byTime) out.push({ steps: group, run: () => invoke('watch_put_progress', { rows: group.map((s) => s.row), at }) });
  for (const step of steps) {
    if (step.kind !== 'title') continue;
    const { titleId, title, next, completed, at } = step;
    out.push({ steps: [step], run: () => invoke('watch_put_title', { titleId, title, next, completed, at }) });
  }
  return out;
}
let writeSeq = 0;
/** The newest write queued for each row still in flight or failed. */
const latestWrite = new Map<string, number>();
/** Writes that failed (e.g. a full disk), newest per row, tried again until they go through. */
const failedWrites = new Map<string, Write>();
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
let retryDelay = RETRY_FIRST_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Told the person saving fails; not again until a write goes through. */
let failureShown = false;

function scheduleRetry(delay: number): void {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (failedWrites.size) persist([...failedWrites.values()]);
  }, delay);
}

/**
 * Queues writes one after another, so a quick second change (watched, then
 * unwatched) can't have its title row overtaken by the first one's. A failed
 * write keeps only the row's latest version and is retried with backoff; the
 * person hears about it once, since progress would otherwise stop saving silently.
 */
function persist(steps: Write[]): void {
  if (writesClosed) return;
  const seq = ++writeSeq;
  for (const step of steps) {
    latestWrite.set(step.key, seq);
    failedWrites.delete(step.key);
  }
  writes = writes.then(async () => {
    // Queued while the profile was switching: Rust would write it to the new one.
    if (writesClosed) return;
    const todo = calls(steps);
    for (const [i, call] of todo.entries()) {
      try {
        await call.run();
        for (const step of call.steps) if (latestWrite.get(step.key) === seq) latestWrite.delete(step.key);
      } catch (err) {
        console.error('Could not save watch history', err);
        for (const rest of todo.slice(i).flatMap((c) => c.steps)) if (latestWrite.get(rest.key) === seq) failedWrites.set(rest.key, rest);
        if (!failureShown) {
          failureShown = true;
          toast(t('insights.history.save-failed'));
        }
        scheduleRetry(retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        return;
      }
    }
    failureShown = false;
    retryDelay = RETRY_FIRST_MS;
    // Storage works again: what failed before needn't wait for its timer.
    if (failedWrites.size) scheduleRetry(0);
  });
}

const progressWrites = (rows: Progress[], at: number): Write[] => rows.map((row) => ({ key: `p:${row.videoId}`, at, kind: 'progress', row }));
const titleWrite = (titleId: string, title: Title, next: NextEpisode | null, completed: boolean, at: number): Write => ({
  key: `t:${titleId}`,
  at,
  kind: 'title',
  titleId,
  title: snapshot(title),
  next,
  completed,
});

/** `at`: when it happened, for history brought in from elsewhere; otherwise now. */
function save(rows: Progress[], title: Title, meta: Omit<TitleRow, 'title' | 'updatedAt'>, at?: number, change: SavedChange = {}): void {
  const now = at ?? Date.now();
  for (const row of rows) progress.set(row.videoId, { ...row, updatedAt: now });
  // A file from this PC keeps its progress, so dropping it again resumes, and its name for
  // My Library → History. Kept apart from titles, it stays out of Continue Watching, recent
  // titles and Stats (which couldn't open it again or look it up), and isn't announced to sync.
  if (isLocalId(title.id)) {
    const file = { id: title.id, type: title.type, name: title.name, genres: [], origins: [] };
    fileTitles.set(title.id, file);
    changed();
    persist([...progressWrites(rows, now), titleWrite(title.id, file, null, false, now)]);
    return;
  }
  titles.set(title.id, { title, ...meta, updatedAt: now });
  changed();
  if (at === undefined) for (const listener of savedListeners) listener(title, change);
  persist([...progressWrites(rows, now), titleWrite(title.id, title, meta.next, meta.completed, now)]);
}

/** Calls `listener` with the title (and what the change was) after each change the person makes; returns an unsubscribe function. */
export function onWatchSaved(listener: (title: Title, change: SavedChange) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/** What Orbit has for a title: its progress rows, what's next, and when it was last watched. */
export function watchRecord(titleId: string): { title: Title; rows: Progress[]; next: NextEpisode | null; completed: boolean; updatedAt: number } | undefined {
  const row = titles.get(titleId);
  return row && { ...row, rows: [...progress.values()].filter((p) => p.titleId === titleId) };
}

/** Whether a row is part-way through (what Continue Watching resumes). */
export const isResumable = (row: Progress | undefined): row is Progress => inProgress(row);

/** The movie or episode Continue Watching resumes for a title: its latest row, when that's part-way through. */
export function resumingVideoId(titleId: string): string | undefined {
  const latest = [...progress.values()].filter((p) => p.titleId === titleId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return inProgress(latest) ? latest.videoId : undefined;
}

/** The fields of a kept title that `fillTitleFields` may fill in. */
export type FillableFields = Partial<Pick<Title, 'poster' | 'background' | 'logo' | 'year' | 'runtime' | 'genres'>>;

/** `title` with the fields it lacks taken from `found`; the same object when there's nothing to add. */
export function withMissingFields(title: Title, found: FillableFields): Title {
  const add: FillableFields = {};
  for (const key of ['poster', 'background', 'logo', 'year', 'runtime'] as const) {
    if (!title[key]?.trim() && found[key]?.trim()) add[key] = found[key];
  }
  if (!title.genres.length && found.genres?.length) add.genres = [...found.genres];
  return Object.keys(add).length ? { ...title, ...add } : title;
}

/**
 * Fills in what titles were kept without (history brought in from elsewhere,
 * e.g. Stremio sync, often has only a name and poster), by title id: artwork,
 * year, runtime, genres. Fields a title already has are left alone, when each
 * was last watched stays as it was, and it isn't announced to sync (it's
 * nothing the person did).
 */
export function fillTitleFields(found: ReadonlyMap<string, FillableFields>): void {
  let any = false;
  for (const [id, fields] of found) {
    const row = titles.get(id);
    if (!row) continue;
    const title = withMissingFields(row.title, fields);
    if (title === row.title) continue;
    titles.set(id, { ...row, title });
    any = true;
    persist([titleWrite(id, title, row.next, row.completed, row.updatedAt)]);
  }
  if (any) changed();
}

/** Brings in history from elsewhere (a Stremio account) as of `at`, without echoing it back out. */
export function importWatch(title: Title, rows: Progress[], meta: { next: NextEpisode | null; completed: boolean }, at: number): void {
  save(rows, title, meta, Math.min(at, Date.now()));
}

const asNext = (ref: { season: number; episode: Episode }): NextEpisode => ({
  videoId: ref.episode.id,
  season: ref.season,
  episode: ref.episode.number,
  title: ref.episode.title,
  ...(ref.episode.thumbnail ? { thumbnail: ref.episode.thumbnail } : {}),
});

function nextOf(title: Title, season: number, number: number, id?: string): NextEpisode | null {
  const ref = episodeAfter(title, season, number, id);
  return ref ? asNext(ref) : null;
}

/** Regular episodes (no specials) in season order. */
const regularOrder = (title: Title) => (title.seasons ?? []).filter((s) => s.number !== 0).flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode })));

/**
 * Where the main order goes on after a special, when nothing was up next:
 * the first unwatched regular episode that aired after the special, else the
 * first unwatched one. (stremio-core goes on to whatever the addon lists next;
 * Orbit keeps specials apart, so it places the special by its air date.)
 */
function nextAfterSpecial(title: Title, special: Episode): NextEpisode | null {
  const open = regularOrder(title).filter((ref) => !ref.episode.airs && !progress.get(ref.episode.id)?.watched);
  const aired = special.released ? Date.parse(special.released) : NaN;
  const later = Number.isNaN(aired) ? undefined : open.find((ref) => ref.episode.released && Date.parse(ref.episode.released) > aired);
  const ref = later ?? open[0];
  return ref ? asNext(ref) : null;
}

/**
 * After unmarking: the episode after the last one still `seen` in season
 * order (specials aside), or nothing when none is. The old up next may now
 * sit past episodes that are unwatched again.
 */
function nextAfterLastSeen(title: Title, seen: (videoId: string) => boolean): NextEpisode | null {
  let last: { season: number; episode: Episode } | undefined;
  for (const ref of regularOrder(title)) if (seen(ref.episode.id)) last = ref;
  const next = last ? nextOf(title, last.season, last.episode.number, last.episode.id) : null;
  // An episode number an addon lists twice can lead back to one seen.
  return next && !seen(next.videoId) ? next : null;
}

/** 0–1 through a movie, or 0 if it hasn't started or is finished. */
export function movieProgress(title: Title): number {
  const row = progress.get(title.id);
  return inProgress(row) ? fraction(row) : 0;
}

export function isWatched(title: Title): boolean {
  if (isShowType(title.type)) return titles.get(title.id)?.completed ?? false;
  return progress.get(title.id)?.watched ?? false;
}

/** Marks a movie watched or unwatched (from the title menu). */
export function setWatched(title: Title, on: boolean): void {
  const previous = progress.get(title.id);
  save([{ videoId: title.id, titleId: title.id, season: null, episode: null, position: 0, duration: previous?.duration ?? 0, watched: on, updatedAt: 0 }], title, { next: null, completed: on }, undefined, { unmarked: !on });
}

export function episodeState(title: Title, season: number, episode: Episode): EpisodeState {
  if (episode.airs) return { kind: 'unaired', airs: episode.airs };
  const row = progress.get(episode.id);
  if (row?.watched) return { kind: 'watched' };
  if (inProgress(row)) return { kind: 'in-progress', progress: fraction(row) };
  const next = titles.get(title.id)?.next;
  if (next && next.season === season && next.episode === episode.number) return { kind: 'up-next' };
  return { kind: 'unwatched' };
}

/** Marks episodes watched or unwatched in one save (e.g. a whole season). */
export function setEpisodesWatched(title: Title, refs: readonly { season: number; episode: Episode }[], on: boolean): void {
  if (!refs.length) return;
  const rows = refs.map(({ season, episode }) => ({
    videoId: episode.id,
    titleId: title.id,
    season,
    episode: episode.number,
    position: 0,
    duration: progress.get(episode.id)?.duration ?? 0,
    watched: on,
    updatedAt: 0,
  }));
  // Specials (season 0) sit outside the watch order (see episodeAfter), so marking only those leaves what's up next, and whether the show is done, as it was.
  const regular = refs.filter((ref) => ref.season !== 0);
  const previous = titles.get(title.id);
  if (!regular.length) return save(rows, title, { next: previous?.next ?? null, completed: previous?.completed ?? false });
  // After marking watched, what's next is the first unwatched episode after the last of them
  // (marking an old episode mustn't pull up next back onto ones already seen).
  const last = regular.reduce((a, b) => (b.season > a.season || (b.season === a.season && b.episode.number > a.episode.number) ? b : a));
  const marked = new Set(rows.map((row) => row.videoId));
  let next = on ? nextOf(title, last.season, last.episode.number, last.episode.id) : title.seasons?.length ? nextAfterLastSeen(title, (id) => !marked.has(id) && !!progress.get(id)?.watched) : (previous?.next ?? null);
  // `marked` also stops the walk on an episode number an addon lists twice (nextOf would return it again).
  while (on && next && (marked.has(next.videoId) || progress.get(next.videoId)?.watched)) {
    marked.add(next.videoId);
    const after = nextOf(title, next.season, next.episode, next.videoId);
    next = after && marked.has(after.videoId) ? null : after;
  }
  save(rows, title, { next, completed: on && !next });
}

export function setEpisodeWatched(title: Title, season: number, episode: Episode, on: boolean): void {
  setEpisodesWatched(title, [{ season, episode }], on);
}

/** Where to resume a movie or episode, in seconds; 0 to start from the beginning. */
export function resumePosition(title: Title, episode?: Episode): number {
  const row = progress.get(episode ? episode.id : title.id);
  return inProgress(row) ? row.position : 0;
}

/**
 * Records how far the player got. Reaching the watched threshold marks the
 * movie or episode watched and, for an episode, makes the following one "up
 * next". Watching one again keeps it watched (and a finished show finished)
 * while its position is kept for resuming: only "Mark unwatched" unmarks.
 * `title` should be the full title (with seasons) for series.
 * Nothing is recorded while watch history is paused (history-pause.ts).
 */
export function recordProgress(title: Title, episode: { season: number; episode: Episode } | undefined, position: number, duration: number): void {
  if (historyPaused() || !(duration > 0) || !Number.isFinite(position)) return;
  const pos = Math.min(Math.max(0, position), duration);
  const videoId = episode ? episode.episode.id : title.id;
  const finished = pos / duration >= watchedAt;
  const rewatch = progress.get(videoId)?.watched === true;
  const watched = finished || rewatch;
  const row: Progress = {
    videoId,
    titleId: title.id,
    season: episode ? episode.season : null,
    episode: episode ? episode.episode.number : null,
    position: pos,
    duration,
    watched,
    updatedAt: 0,
  };
  const previous = titles.get(title.id);
  if (!episode) return save([row], title, { next: null, completed: watched });
  // A special (season 0) is outside the watch order: finishing one must not end the show or move what's up next.
  // With nothing up next, finishing it goes on with the main order where it fits.
  if (episode.season === 0) {
    const next = previous?.next ?? (finished && !previous?.completed ? nextAfterSpecial(title, episode.episode) : null);
    return save([row], title, { next, completed: previous?.completed ?? false });
  }
  // Without the episode list (a download keeps only a snapshot of its show) what follows isn't known: that's not the show being finished.
  if (!title.seasons?.length) {
    const kept = finished && previous?.next?.videoId === videoId ? null : (previous?.next ?? null);
    return save([row], title, { next: kept, completed: previous?.completed ?? false });
  }
  const next = finished ? nextOf(title, episode.season, episode.episode.number, videoId) : (previous?.next ?? null);
  save([row], title, { next, completed: (rewatch && (previous?.completed ?? false)) || (finished && !next) });
}

/**
 * Takes a title out of Continue Watching the way Stremio does: the movie or
 * episode in progress goes back to the start and nothing is up next. Watched
 * marks stay, and so does when it was last watched, except that episodes
 * that already aired count as seen-about, so only newer ones bring it back.
 * Synced like any other change the person makes. Returns what puts it back
 * as it was (the toast's Undo).
 */
export function removeFromContinue(titleId: string): () => void {
  const row = titles.get(titleId);
  if (!row) return () => {};
  const before = [...progress.values()].filter((p) => p.titleId === titleId && inProgress(p)).map((p) => ({ ...p }));
  const rows = before.map((p) => ({ ...p, position: 0 }));
  const fresh = newEpisodes.get(titleId);
  const at = Math.max(row.updatedAt, fresh?.airedAt ?? 0);
  newEpisodes.delete(titleId);
  save(rows, row.title, { next: null, completed: row.completed }, at);
  for (const listener of savedListeners) listener(row.title, {});
  return () => {
    if (fresh) newEpisodes.set(titleId, fresh);
    // Each row, then the title, with its own time: `at` may be when a new episode aired,
    // which would move the title in the row and hide that episode after a restart.
    const meta = { next: row.next, completed: row.completed };
    for (const p of before) save([p], row.title, meta, p.updatedAt);
    save([], row.title, meta, row.updatedAt);
    for (const listener of savedListeners) listener(row.title, {});
  };
}

function parseCleared(value: unknown): Map<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));
}

/** When the person last cleared this title's history (ms), or 0. */
export const historyClearedAt = (titleId: string): number => cleared.get(titleId) ?? 0;

/**
 * Every movie and episode watched, with its title (files by their names),
 * for My Library → History. Rows that were only marked unwatched (nothing
 * played) are left out.
 */
export function historyRows(): { row: Progress; title: Title }[] {
  return [...progress.values()].flatMap((row) => {
    // A file played before its name was kept: listed by what it is.
    const unnamed = isLocalId(row.titleId) ? { id: row.titleId, type: 'movie', name: t('insights.history.unnamed-file'), genres: [], origins: [] } : undefined;
    const title = titles.get(row.titleId)?.title ?? fileTitles.get(row.titleId) ?? unnamed;
    return title && (row.watched || row.position > 0) ? [{ row: { ...row }, title }] : [];
  });
}

/**
 * Removes watch history (My Library → History): the given movie's or
 * episodes' rows of a title, or all of them. They go back to unwatched,
 * with nowhere to resume. Once nothing of a title is left, the title goes
 * too, and the time is remembered so a pull from Stremio doesn't bring back
 * what was watched before (see `historyClearedAt`). Nothing is sent to
 * Stremio: its own history stays as it is.
 */
export async function removeHistory(titleId: string, videoIds?: readonly string[]): Promise<void> {
  const ids = videoIds && new Set(videoIds);
  // What's taken out, put back if storage refuses the removal.
  const removed = [...progress.values()].filter((row) => row.titleId === titleId && (!ids || ids.has(row.videoId)));
  const before = { record: titles.get(titleId), file: fileTitles.get(titleId), fresh: newEpisodes.get(titleId), cleared: cleared.get(titleId) };
  for (const row of removed) progress.delete(row.videoId);
  const emptied = ![...progress.values()].some((row) => row.titleId === titleId);
  if (emptied) {
    titles.delete(titleId);
    fileTitles.delete(titleId);
    newEpisodes.delete(titleId);
    if (!isLocalId(titleId)) {
      cleared.delete(titleId);
      cleared.set(titleId, Date.now());
      while (cleared.size > MAX_CLEARED) cleared.delete(cleared.keys().next().value!);
    }
  }
  changed();
  // A write still waiting to go through must not bring back what was just removed.
  for (const key of [...failedWrites.keys(), ...latestWrite.keys()]) {
    if (key.startsWith('p:') ? !progress.has(key.slice(2)) : emptied && key === `t:${titleId}`) {
      failedWrites.delete(key);
      latestWrite.delete(key);
    }
  }
  const done = writes.then(() => invoke('watch_remove', { titleId, videoIds: videoIds ? [...videoIds] : null }));
  writes = done.catch((err: unknown) => console.error('Could not remove watch history', err));
  try {
    await done;
  } catch (err) {
    // Still saved: History shows it again (rather than until the next start), so it can be removed again.
    for (const row of removed) if (!progress.has(row.videoId)) progress.set(row.videoId, row);
    if (emptied) {
      if (before.record && !titles.has(titleId)) titles.set(titleId, before.record);
      if (before.file && !fileTitles.has(titleId)) fileTitles.set(titleId, before.file);
      if (before.fresh && !newEpisodes.has(titleId)) newEpisodes.set(titleId, before.fresh);
      cleared.delete(titleId);
      if (before.cleared !== undefined) cleared.set(titleId, before.cleared);
    }
    changed();
    throw err;
  }
  if (emptied && !isLocalId(titleId)) await settings.set(clearedKey, Object.fromEntries(cleared));
}

/**
 * What `removeHistory(titleId, videoIds)` is about to remove, and a way to
 * put it back as it was (the toast's Undo): each row with its own time, the
 * title's next episode and finished state, and the cleared mark it may get.
 * Read it before removing.
 */
export function historyUndo(titleId: string, videoIds?: readonly string[]): () => void {
  const ids = videoIds && new Set(videoIds);
  const rows = [...progress.values()].filter((row) => row.titleId === titleId && (!ids || ids.has(row.videoId))).map((row) => ({ ...row }));
  const record = titles.get(titleId);
  const title = record?.title ?? fileTitles.get(titleId);
  const fresh = newEpisodes.get(titleId);
  const clearedBefore = cleared.get(titleId);
  return () => {
    if (!title || !rows.length) return;
    const meta = { next: record?.next ?? null, completed: record?.completed ?? false };
    // Oldest first, so the title ends up with its latest time, then its own.
    for (const row of [...rows].sort((a, b) => a.updatedAt - b.updatedAt)) save([row], title, meta, row.updatedAt);
    if (record) save([], title, meta, record.updatedAt);
    if (fresh) newEpisodes.set(titleId, fresh);
    if (isLocalId(titleId) || cleared.get(titleId) === clearedBefore) return;
    if (clearedBefore === undefined) cleared.delete(titleId);
    else cleared.set(titleId, clearedBefore);
    void settings.set(clearedKey, Object.fromEntries(cleared)).catch((err: unknown) => console.error('Could not save cleared history', err));
  };
}

/** When the title was last watched (ms), or 0 if never. */
export function lastWatchedAt(titleId: string): number {
  return titles.get(titleId)?.updatedAt ?? 0;
}

/** All of watch history as read-only copies: each title, and each movie's or episode's progress (for My Library → Stats). */
export function watchHistory(): { titles: { title: Title; completed: boolean; updatedAt: number }[]; progress: Progress[] } {
  return {
    titles: [...titles.values()].map(({ title, completed, updatedAt }) => ({ title, completed, updatedAt })),
    progress: [...progress.values()].filter((row) => !isLocalId(row.titleId)).map((row) => ({ ...row })),
  };
}

/** Every title with watch history, most recently watched first. */
export function recentlyWatched(): Title[] {
  return [...titles.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((t) => t.title);
}

/**
 * What counts as watched for "Because you watched…" and other picks drawn from taste: a minute's
 * look isn't a liking. Finished, marked watched, or past 20 minutes or a quarter of the way through.
 */
const TASTE_SECONDS = 20 * 60;
const TASTE_FRACTION = 0.25;

function showsTaste(row: Progress): boolean {
  return row.watched || row.position >= TASTE_SECONDS || (row.duration > 0 && row.position / row.duration >= TASTE_FRACTION);
}

/** Titles watched enough to say something about taste (see `showsTaste`), most recently watched first. */
export function tasteWatched(): Title[] {
  const real = new Set<string>();
  for (const row of progress.values()) if (showsTaste(row)) real.add(row.titleId);
  return [...titles.values()]
    .filter((t) => t.completed || real.has(t.title.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => t.title);
}

/** Finished titles, most recent first: watched movies, and series with nothing left to play. */
export function watchedTitles(): { title: Title; updatedAt: number }[] {
  return [...titles.values()].filter((t) => t.completed).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * A series' new episodes (see `refreshNewEpisodes`) while they still are: watched since they
 * aired (the new episode itself, say), it's what a check now would find, so none are.
 */
function freshFor(titleId: string): { count: number; first: NextEpisode; airedAt: number } | undefined {
  const fresh = newEpisodes.get(titleId);
  return fresh && fresh.airedAt > (titles.get(titleId)?.updatedAt ?? 0) ? fresh : undefined;
}

/** How many episodes of a series aired since it was last watched (see `refreshNewEpisodes`). */
export const newEpisodeCount = (titleId: string): number => freshFor(titleId)?.count ?? 0;

/** The series whose new episodes (see `refreshNewEpisodes`) aired most recently, with the first of them. */
export function latestNewEpisode(): { title: Title; episode: NextEpisode; count: number; airedAt: number } | null {
  let latest: { title: Title; episode: NextEpisode; count: number; airedAt: number } | null = null;
  for (const id of newEpisodes.keys()) {
    const row = titles.get(id);
    const fresh = freshFor(id);
    if (row && fresh && (!latest || fresh.airedAt > latest.airedAt)) latest = { title: row.title, episode: fresh.first, count: fresh.count, airedAt: fresh.airedAt };
  }
  return latest;
}
const newLabel = (count: number) => tn('titles.watch.new-episodes', count);
const code = (season: number, episode: number) => t('titles.common.episode-code', { season, episode });

/**
 * How far into a title the profile is, for its browsing cards: the movie, or
 * the episode most recently part-way through with its "S2 · E4". Null when
 * nothing is part-way through.
 */
export function cardProgress(titleId: string): { progress: number; episode?: string } | null {
  // Most cards are of titles never watched: no need to look through history for them.
  if (!titles.has(titleId)) return null;
  // The newest row only, as Continue Watching and Play go by: an episode abandoned before later ones were finished isn't where the show is.
  const latest = [...progress.values()].filter((p) => p.titleId === titleId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!inProgress(latest)) return null;
  return latest.season !== null && latest.episode !== null ? { progress: fraction(latest), episode: code(latest.season, latest.episode) } : { progress: fraction(latest) };
}

/** A Continue Watching card for a next episode, with spoiler protection (it's unwatched): its name may read "Episode 4" and its picture blur. */
function nextEntry(title: Title, n: NextEpisode, badge: string): ContinueEntry {
  const hide = hiddenFor('up-next');
  return { title, progress: 0, sub: `${code(n.season, n.episode)} · ${episodeName(n.episode, n.title, hide.title)}`, badge, ...(n.thumbnail ? { still: n.thumbnail, spoiler: hide.thumbnail } : {}) };
}

/**
 * Looks up fresh episode lists for the most recently watched series and
 * notes the ones with episodes that aired after they were last watched.
 * Saved history keeps only a small snapshot, so this needs the network;
 * it runs in the background (at startup) and failures are just skipped.
 */
export async function refreshNewEpisodes(now = Date.now()): Promise<void> {
  const series = [...titles.entries()]
    .filter(([, row]) => isShowType(row.title.type))
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, NEW_EPISODE_SERIES);
  const found = new Map<string, { count: number; first: NextEpisode; airedAt: number }>();
  // A few at a time, so the addons (and the connection) stay free for what's on screen.
  const queue = [...series];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await check(next);
  };
  let failed = false;
  const check = async ([id, row]: [string, TitleRow]) => {
    const full = await loadMeta(row.title.type, id).catch(() => {
      failed = true;
      // What an earlier check found stays until this show can be looked up again.
      const known = newEpisodes.get(id);
      if (known) found.set(id, known);
      return null;
    });
    const fresh = (full?.seasons ?? [])
      .filter((s) => s.number > 0)
      .flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode, at: releasedAt(episode.released) })))
      .filter(({ season, episode, at }) => at > row.updatedAt && at <= now && episodeState(full!, season, episode).kind !== 'watched');
    const first = fresh[0];
    if (!first) return;
    found.set(id, {
      count: fresh.length,
      first: { videoId: first.episode.id, season: first.season, episode: first.episode.number, title: first.episode.title, ...(first.episode.thumbnail ? { thumbnail: first.episode.thumbnail } : {}) },
      airedAt: Math.max(...fresh.map((f) => f.at)),
    });
  };
  await Promise.all(Array.from({ length: NEW_EPISODE_CONCURRENCY }, worker));
  newEpisodes = found;
  changed();
  // Some shows couldn't be looked up (started offline, the addons down): look again in a while,
  // rather than leave their new episodes out until Orbit restarts.
  clearTimeout(newEpisodesRetry);
  newEpisodesRetry = failed ? setTimeout(() => void refreshNewEpisodes().catch(() => {}), NEW_EPISODE_RETRY_MS) : undefined;
}

/**
 * Continue Watching: titles with a movie or episode in progress, or a next
 * episode after a finished one, most recent first. Ones untouched for longer
 * than the chosen days (30 by default) drop off, but a series with new episodes comes back (finished or not).
 */
export function continueWatching(now = Date.now()): ContinueEntry[] {
  const entries: { entry: ContinueEntry; at: number }[] = [];
  // Each title's newest row, in one pass: a long history made a scan per title take seconds.
  const newest = new Map<string, Progress>();
  for (const p of progress.values()) {
    const found = newest.get(p.titleId);
    if (!found || p.updatedAt > found.updatedAt) newest.set(p.titleId, p);
  }
  for (const [titleId, row] of titles) {
    const latest = newest.get(titleId);
    const fresh = freshFor(titleId);
    if (fresh && !inProgress(latest)) {
      // Behind on the show: the episode up next (the one Play starts) rather than the newest one.
      const n = row.next && !progress.get(row.next.videoId)?.watched ? row.next : fresh.first;
      entries.push({
        entry: nextEntry(row.title, n, newLabel(fresh.count)),
        at: Math.max(row.updatedAt, fresh.airedAt),
      });
      continue;
    }
    // A finished title being watched again shows while it's part-way through, and a finished show
    // between episodes of a rewatch shows what's up next (a show is finished with nothing up next).
    if ((row.completed && !inProgress(latest) && !row.next) || (continueDays > 0 && now - row.updatedAt > continueDays * DAY_MS)) continue;
    if (inProgress(latest)) {
      const minutes = Math.max(1, Math.round((latest.duration - latest.position) / 60));
      const sub = latest.season !== null && latest.episode !== null ? code(latest.season, latest.episode) : [row.title.year, row.title.runtime].filter(Boolean).join(' · ');
      entries.push({ entry: { title: row.title, progress: fraction(latest), sub, left: t('titles.watch.left', { minutes }) }, at: row.updatedAt });
    } else if (row.next) {
      const n = row.next;
      entries.push({
        entry: nextEntry(row.title, n, t('titles.watch.next-episode')),
        at: row.updatedAt,
      });
    }
  }
  return entries.sort((a, b) => b.at - a.at).map((e) => e.entry);
}
