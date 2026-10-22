/**
 * Offline downloads (see src-tauri/src/downloads): the page's view of them,
 * kept in memory and updated from Rust's `downloads://event`. Rust owns the
 * files and the stream addresses; the page refers to a download by id only.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as v from 'valibot';
import * as registry from '../addons/registry';
import { parseWith, StreamResponseSchema } from '../addons/schema';
import type { Stream } from '../addons/types';
import { usableAddons } from '../catalog/service';
import type { Episode, Title } from '../catalog/titles';
import { locale, t, type MessageKey } from '../i18n';
import { settings, withDialog } from '../lib/ipc';
import type { Resolution } from '../lib/ranking-fallback';
import { CLOUD_ADDON_KEY } from './cloud';
import { parseSpeedLimit, parseWindow, SPEED_LIMIT_KEY, WINDOW_KEY, type DownloadWindow } from './download-schedule';
import { fromSnapshot, SnapshotSchema } from './snapshot';

export const STATES = ['queued', 'running', 'paused', 'expired', 'failed', 'done'] as const;
export type DownloadState = (typeof STATES)[number];

/** Why a download stopped (mirrors `Failure` in src-tauri/src/downloads/mod.rs). */
const FailureSchema = v.object({ kind: v.string(), status: v.optional(v.number()) });
export type Failure = v.InferOutput<typeof FailureSchema>;

/** Stored rows are validated like addon data: the snapshot's fields came from addons. */
const ItemSchema = v.object({
  id: v.string(),
  titleId: v.string(),
  videoId: v.string(),
  title: SnapshotSchema,
  season: v.nullable(v.number()),
  episode: v.nullable(v.number()),
  episodeTitle: v.nullable(v.string()),
  label: v.string(),
  addonKey: v.string(),
  streamType: v.string(),
  streamId: v.string(),
  identity: v.string(),
  torrent: v.boolean(),
  state: v.picklist(STATES),
  error: v.nullable(FailureSchema),
  doneBytes: v.number(),
  totalBytes: v.nullable(v.number()),
  createdAt: v.number(),
  finishedAt: v.nullable(v.number()),
});

export type DownloadItem = Omit<v.InferOutput<typeof ItemSchema>, 'title'> & { title: Title; speed: number };

const EventSchema = v.variant('kind', [
  v.object({ kind: v.literal('progress'), id: v.string(), done: v.number(), total: v.nullable(v.number()), speed: v.number() }),
  v.object({ kind: v.literal('state'), id: v.string(), state: v.picklist(STATES), error: v.nullable(FailureSchema) }),
  v.object({ kind: v.literal('removed'), id: v.string() }),
  v.object({ kind: v.literal('schedule'), open: v.boolean() }),
]);

const items = new Map<string, DownloadItem>();
const listeners = new Set<() => void>();
const progressListeners = new Set<(item: DownloadItem) => void>();
let listening = false;
let loads = 0;
/** Settings → Downloads → "Only download between" (null: any time), and whether it's open now (Rust says). */
let downloadWindow: DownloadWindow | null = null;
let windowOpen = true;
/** Downloads started outside the window this session ("Download now anyway"; Rust forgets them on restart too). */
const anyway = new Set<string>();
/** The page's offset from UTC changes with daylight saving: it's sent again this often. */
const SCHEDULE_REFRESH_MS = 15 * 60 * 1000;

function changed(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` when downloads are added, removed or change state; returns an unsubscribe function. */
export function onDownloadsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Calls `listener` (a few times a second) as a download makes progress. */
export function onDownloadProgress(listener: (item: DownloadItem) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** Why the last read failed, or null: Downloads says so (and stays in the nav) rather than showing none. */
let loadError: unknown = null;
export const downloadsLoadError = (): unknown => loadError;

/** Reads the active profile's downloads; call at startup (and after switching profile). */
export async function loadDownloads(): Promise<void> {
  if (!listening) {
    listening = true;
    await listen<unknown>('downloads://event', (event) => onEvent(event.payload));
    // Once per run, in the app (tests have no page): Settings → Downloads' limits reach Rust.
    if (typeof document !== 'undefined') {
      void applyDownloadSchedule().catch((err: unknown) => console.warn('Could not apply the download schedule', err));
      window.setInterval(() => void applyDownloadSchedule().catch(() => undefined), SCHEDULE_REFRESH_MS);
      window.addEventListener('online', resumeAfterReconnect);
    }
  }
  // Loads can overlap (startup, and events about downloads not listed yet); only the latest is kept.
  const generation = ++loads;
  let rows: unknown[];
  try {
    rows = await invoke<unknown[]>('download_list');
  } catch (err) {
    if (generation === loads) {
      loadError = err;
      changed();
    }
    throw err;
  }
  if (generation !== loads) return;
  loadError = null;
  items.clear();
  for (const raw of rows) {
    const row = v.safeParse(ItemSchema, raw);
    // A row that no longer validates is left out, not fatal.
    if (row.success) items.set(row.output.id, { ...row.output, title: fromSnapshot(row.output.title), speed: 0 });
  }
  changed();
}

function onEvent(payload: unknown): void {
  const parsed = v.safeParse(EventSchema, payload);
  if (!parsed.success) return;
  const event = parsed.output;
  if (event.kind === 'schedule') {
    windowOpen = event.open;
    changed();
    return;
  }
  if (event.kind === 'removed') {
    forgetPoster(event.id);
    anyway.delete(event.id);
    if (items.delete(event.id)) changed();
    return;
  }
  const item = items.get(event.id);
  // Another profile's download, or one this page hasn't listed yet.
  if (!item) {
    if (event.kind === 'state') void loadDownloads().catch(() => undefined);
    return;
  }
  if (event.kind === 'progress') {
    item.doneBytes = event.done;
    item.totalBytes = event.total;
    item.speed = event.speed;
    for (const listener of progressListeners) listener(item);
    return;
  }
  const before = item.state;
  item.state = event.state;
  item.error = event.error;
  if (event.state !== 'running') item.speed = 0;
  // A transfer that ended no longer runs anyway: tried again, it waits for the window (as Rust's `run` forgets it).
  if (event.state === 'done' || event.state === 'failed' || event.state === 'expired') anyway.delete(item.id);
  if (event.state === 'done') {
    item.finishedAt = Date.now();
    if (item.totalBytes !== null) item.doneBytes = item.totalBytes;
  }
  if (event.state === 'expired' && before !== 'expired' && !refreshTried.has(item.id)) void refreshLink(item, true);
  changed();
}

/** Every download, oldest first. */
export function allDownloads(): DownloadItem[] {
  return [...items.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** The download of a movie (`videoId` = the title's id) or episode, in whatever state. */
export function downloadOf(videoId: string): DownloadItem | undefined {
  return [...items.values()].find((d) => d.videoId === videoId);
}

/** A finished download of this movie or episode, if there is one. */
export function downloadedCopy(videoId: string): DownloadItem | undefined {
  const item = downloadOf(videoId);
  return item?.state === 'done' ? item : undefined;
}

/** The episode reference the player and watch history use, rebuilt from a download. */
export function episodeOf(item: DownloadItem): { season: number; episode: Episode } | undefined {
  if (item.season === null || item.episode === null) return undefined;
  return { season: item.season, episode: { id: item.videoId, number: item.episode, title: item.episodeTitle ?? '' } };
}

/** The player source for a downloaded copy: Rust finds the file by id (the page never sees paths). */
export function downloadedSource(item: DownloadItem) {
  return { id: `download-${item.id}`, url: `orbit-download://${item.id}`, addon: t('downloads.source.addon'), label: t('downloads.source.label'), meta: item.label };
}

// ── Choosing what to download ──

export const QUALITY_KEY = 'downloads.quality';
export const MAX_QUALITIES = ['original', '2160p', '1080p', '720p'] as const;
export type MaxQuality = (typeof MAX_QUALITIES)[number];
export const parseMaxQuality = (value: unknown): MaxQuality => MAX_QUALITIES.find((q) => q === value) ?? 'original';

const HEIGHT: Record<Resolution, number> = { '2160p': 2160, '1080p': 1080, '720p': 720, '480p': 480 };

/** Title types that are live channels: nothing to save. */
const LIVE_TYPES = ['tv', 'channel'];
export const isLiveType = (titleType: string) => LIVE_TYPES.includes(titleType);

/** Why a source can't be downloaded, or null when it can. */
export function downloadBlock(source: { url: string }, titleType: string): 'live' | 'playlist' | null {
  if (isLiveType(titleType)) return 'live';
  if (source.url.startsWith('magnet:')) return null;
  try {
    const path = new URL(source.url).pathname.toLowerCase();
    return /\.(m3u8?|mpd)$/.test(path) ? 'playlist' : null;
  } catch {
    return 'playlist';
  }
}

export const blockReason = (block: 'live' | 'playlist'): string => t(block === 'live' ? 'downloads.blocked.live' : 'downloads.blocked.playlist');

/**
 * The best source to download from a ranked list: the first that can be
 * downloaded and isn't above `cap`. Sources of unknown quality are allowed.
 */
export function pickForDownload<T extends { stream: { url: string }; traits: { resolution?: Resolution | undefined } }>(ranked: readonly T[], cap: MaxQuality, titleType: string): T | undefined {
  return downloadCandidates(ranked, cap, titleType)[0];
}

/** Every source that can be downloaded within `cap`, best first (the next ones are tried if the first turns out to be junk). */
export function downloadCandidates<T extends { stream: { url: string }; traits: { resolution?: Resolution | undefined } }>(ranked: readonly T[], cap: MaxQuality, titleType: string): T[] {
  const limit = cap === 'original' ? Infinity : HEIGHT[cap];
  return ranked.filter((s) => !downloadBlock(s.stream, titleType) && (!s.traits.resolution || HEIGHT[s.traits.resolution] <= limit));
}

/**
 * Failures that mean "this source sent something other than the video" —
 * e.g. a debrid service's short placeholder for a torrent it hasn't cached —
 * where another source is worth trying instead of giving up.
 */
export const isWrongContent = (error: { kind: string } | null | undefined) => error?.kind === 'too-small' || error?.kind === 'not-video';

/**
 * What finds the same stream again when its link expires, without keeping the
 * address: a torrent's info hash and file, else a hash of the stream's stable
 * description (its file name and size, or its name and first description
 * line; seeders and other changing details are left out).
 */
export async function streamIdentity(stream: Pick<Stream, 'url' | 'torrent'> & Partial<Pick<Stream, 'name' | 'description' | 'filename' | 'videoSize'>>): Promise<string> {
  const magnet = stream.torrent ? /btih:([0-9a-f]{40})(?:.*?[?&]so=(\d+))?/i.exec(stream.url) : null;
  if (magnet) return `bt:${magnet[1]!.toLowerCase()}:${magnet[2] ?? ''}`;
  const basis = stream.filename ? `f|${stream.filename}|${stream.videoSize ?? ''}` : `d|${stream.name ?? ''}|${stream.description?.split('\n')[0] ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return `h:${[...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ── Expired links ──

/** Downloads whose link was already refreshed automatically this session (once each, so a bad addon can't loop). */
const refreshTried = new Set<string>();

/**
 * Asks the download's addon for the movie's or episode's streams again, finds
 * the same one, and gives Rust its fresh address to continue the same file
 * (a cloud file just resumes: Rust makes its link again). Resolves false
 * when the addon or stream can't be found.
 */
export async function refreshLink(item: DownloadItem, automatic = false): Promise<boolean> {
  if (automatic) refreshTried.add(item.id);
  if (item.torrent) return false;
  // A file from the debrid cloud: Rust makes a fresh link each time the download starts.
  if (item.addonKey === CLOUD_ADDON_KEY) {
    return resumeDownload(item.id).then(
      () => true,
      (err: unknown) => {
        console.warn('Could not resume a cloud download', err);
        return false;
      },
    );
  }
  try {
    const addon = (await usableAddons()).find((a) => a.key === item.addonKey);
    if (!addon) return false;
    // Older episode downloads stored `id:season:episode`, not the episode's own
    // video id (see `streamRequest`): if that finds nothing, ask by the video id.
    const ids = item.season !== null && item.videoId !== item.streamId ? [item.streamId, item.videoId] : [item.streamId];
    for (const id of ids) {
      const { streams } = parseWith(StreamResponseSchema, await registry.request(addon, { resource: 'stream', type: item.streamType, id }));
      for (const stream of streams) {
        if (stream.torrent || (await streamIdentity(stream)) !== item.identity) continue;
        await invoke('download_refresh', { id: item.id, url: stream.url });
        return true;
      }
    }
  } catch (err) {
    console.warn('Could not refresh a download link', err);
  }
  return false;
}

// ── Speed limit and download window ──

/** Sends Settings → Downloads' speed limit and window to Rust (at startup, and after each change). */
export async function applyDownloadSchedule(): Promise<void> {
  const [limit, saved] = await Promise.all([settings.get(SPEED_LIMIT_KEY).catch(() => null), settings.get(WINDOW_KEY).catch(() => null)]);
  downloadWindow = parseWindow(saved);
  windowOpen = (await invoke<boolean>('download_schedule_set', { limit: parseSpeedLimit(limit), window: downloadWindow, offset: new Date().getTimezoneOffset() })) !== false;
  changed();
}

/** The window queued downloads wait for, while it's closed; null while downloads may run. */
export const waitingForWindow = (item: Pick<DownloadItem, 'id' | 'state'>): DownloadWindow | null =>
  item.state === 'queued' && !windowOpen && !anyway.has(item.id) ? downloadWindow : null;

/** "Download now anyway": starts a waiting download outside the window. */
export async function downloadNow(id: string): Promise<void> {
  await invoke<void>('download_now', { id });
  anyway.add(id);
  changed();
}

/**
 * Downloads that stopped because the connection dropped (Wi-Fi gone, the
 * computer asleep) go on from where they were once it's back, rather than
 * each waiting for Retry: a web download gives up after a couple of minutes
 * without one, and the next waiting download then fails the same way, so one
 * outage in the night stopped the whole queue. Only on the connection coming
 * back, so a server that stays down isn't asked again and again.
 */
export function resumeAfterReconnect(): void {
  for (const item of items.values()) {
    if (item.state === 'failed' && item.error?.kind === 'network') void resumeDownload(item.id).catch(() => undefined);
  }
}

// ── Actions ──

export const pauseDownload = (id: string) => invoke<void>('download_pause', { id });
export const resumeDownload = (id: string) => invoke<void>('download_resume', { id });
export const removeDownload = (id: string) => invoke<void>('download_remove', { id });
export const revealDownload = (id: string) => invoke<void>('download_reveal', { id });

/** Retries a download: an expired link is first refreshed from its addon, if it can be. */
export async function retryDownload(item: DownloadItem): Promise<void> {
  if (item.state === 'expired' && (await refreshLink(item))) return;
  await resumeDownload(item.id);
}

const posters = new Map<string, Promise<string | null>>();

/** A `blob:` URL for the poster saved with a download (works offline), or null. */
export function savedPoster(id: string): Promise<string | null> {
  let poster = posters.get(id);
  if (!poster) {
    poster = invoke<ArrayBuffer>('download_art', { id })
      .then((bytes) => (bytes.byteLength ? URL.createObjectURL(new Blob([bytes])) : null))
      .catch(() => null);
    posters.set(id, poster);
  }
  return poster;
}

/** Lets go of a removed download's poster (its bytes stay in memory until the URL is revoked). */
function forgetPoster(id: string): void {
  const poster = posters.get(id);
  posters.delete(id);
  void poster?.then((url) => url && URL.revokeObjectURL(url));
}

export interface Storage {
  folder: string | null;
  custom: boolean;
  used: number;
  free: number | null;
}

export const storage = () => invoke<Storage>('download_storage');
export const setFolder = (path: string) => invoke<void>('download_folder_set', { path });
/** Picks the folder with the system's folder dialog and saves it; resolves to it, or `null` if cancelled. */
export const pickFolder = () => withDialog('download_folder_pick');

// ── Wording ──

const ERRORS: Record<string, MessageKey> = {
  network: 'downloads.error.network',
  blocked: 'downloads.error.blocked',
  'not-video': 'downloads.error.not-video',
  'too-small': 'downloads.error.too-small',
  incomplete: 'downloads.error.incomplete',
  expired: 'downloads.error.expired',
  'not-downloadable': 'downloads.error.not-downloadable',
  'disk-full': 'downloads.error.disk-full',
  permission: 'downloads.error.permission',
  disk: 'downloads.error.disk',
  'no-space': 'downloads.error.no-space',
  folder: 'downloads.error.folder',
  'network-folder': 'downloads.error.network-folder',
  torrent: 'downloads.error.torrent',
  'torrent-timeout': 'downloads.error.torrent-timeout',
  'no-video-file': 'downloads.error.no-video-file',
  'too-many-files': 'downloads.error.too-many-files',
  vault: 'downloads.error.vault',
  storage: 'downloads.error.storage',
  'not-found': 'downloads.error.not-found',
  missing: 'downloads.error.missing',
  invalid: 'downloads.error.invalid',
};

/** A failure from Rust (a rejected command or a stopped download) in words. */
export function failureText(error: unknown): string {
  const parsed = v.safeParse(FailureSchema, error);
  if (!parsed.success) return t('downloads.error.unknown');
  if (parsed.output.kind === 'http') return t('downloads.error.http', { status: String(parsed.output.status ?? '') });
  const key = ERRORS[parsed.output.kind];
  return key ? t(key) : t('downloads.error.unknown');
}

/** "1.4 GB", "820 MB" in the interface's language. */
export function formatBytes(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(locale(), { style: 'unit', unit: units[unit], unitDisplay: 'short', maximumFractionDigits: value < 10 && unit > 1 ? 1 : 0 }).format(value);
}

/** "5.2 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  const mb = Math.max(0, bytesPerSecond) / (1024 * 1024);
  return new Intl.NumberFormat(locale(), { style: 'unit', unit: 'megabyte-per-second', unitDisplay: 'short', maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb);
}

/** Seconds until done at the current speed, or null when it can't be told. */
export function secondsLeft(item: Pick<DownloadItem, 'doneBytes' | 'totalBytes' | 'speed'>): number | null {
  if (!item.totalBytes || item.speed <= 0) return null;
  return Math.max(0, (item.totalBytes - item.doneBytes) / item.speed);
}

/** "3 min", "1 hr 20 min". */
export function formatDuration(seconds: number): string {
  const unit = (n: number, u: 'hour' | 'minute' | 'second') => new Intl.NumberFormat(locale(), { style: 'unit', unit: u, unitDisplay: 'short' }).format(n);
  if (seconds < 60) return unit(Math.max(1, Math.round(seconds)), 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${unit(hours, 'hour')} ${unit(minutes % 60, 'minute')}` : unit(hours, 'hour');
}

/** 0–1, or null when the size isn't known yet. */
export function fraction(item: Pick<DownloadItem, 'doneBytes' | 'totalBytes'>): number | null {
  return item.totalBytes ? Math.min(1, item.doneBytes / item.totalBytes) : null;
}
