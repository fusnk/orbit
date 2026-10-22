/**
 * The play queue ("Play next" / "Add to queue"): single plays, a movie or one
 * episode each, in order. Kept per profile as one setting, read once and held
 * in memory; changes update memory first, then save, and roll back if saving
 * fails. Sources are never stored: they're found when an item plays (they
 * expire, and their URLs can carry debrid keys).
 */
import * as v from 'valibot';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { settings } from '../lib/ipc';
import { profileSetting } from './profiles';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

/** The settings key, as `library.queue.<profile id>` (listed in profiles.rs `PROFILE_SETTINGS`). */
export const QUEUE_PREFIX = 'library.queue';
/**
 * At most this many items. A setting holds 64 KB at most (db.rs), and an
 * item's snapshot is a few hundred bytes, so this leaves room to spare.
 */
export const QUEUE_LIMIT = 100;
const GENRES = 3;
const EPISODE_NAME_CHARS = 300;

export interface QueueEpisode {
  season: number;
  number: number;
  /** The addon's video id, e.g. "tt0903747:1:3". */
  videoId: string;
  /** The episode's title when it was queued, to show without the network. */
  name: string;
}

export interface QueueItem {
  id: string;
  title: Title;
  /** The episode to play, or null for a movie. */
  episode: QueueEpisode | null;
  addedAt: number;
}

export type Placement = 'next' | 'end';
/** What adding did: `moved` when Play next brought a queued item to the front. */
export type AddResult = 'added' | 'moved' | 'exists' | 'full';

const episodeNumber = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000));

/** Stored items are validated like addon data: the snapshots' fields came from addons. */
const ItemSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/)),
  title: SnapshotSchema,
  episode: v.nullable(
    v.object({
      season: episodeNumber,
      number: episodeNumber,
      videoId: v.pipe(v.string(), v.minLength(1), v.maxLength(300)),
      name: v.fallback(v.pipe(v.string(), v.maxLength(EPISODE_NAME_CHARS)), ''),
    }),
  ),
  addedAt: v.pipe(v.number(), v.finite()),
});

/** Whether `item` is the movie `titleId`, or its episode `videoId`. */
export const matches = (item: QueueItem, titleId: string, videoId: string | null | undefined) => item.title.id === titleId && (item.episode?.videoId ?? null) === (videoId ?? null);

/** The saved queue: valid items only (an invalid one is dropped, not fatal), no repeats, at most `QUEUE_LIMIT`. */
export function parseQueue(value: unknown): QueueItem[] {
  if (!Array.isArray(value)) return [];
  const items: QueueItem[] = [];
  for (const raw of value.slice(0, QUEUE_LIMIT)) {
    const parsed = v.safeParse(ItemSchema, raw);
    if (!parsed.success) continue;
    const { id, title, episode, addedAt } = parsed.output;
    const item: QueueItem = { id, title: fromSnapshot(title), episode, addedAt };
    if (!items.some((other) => other.id === id || matches(other, title.meta.id, episode?.videoId))) items.push(item);
  }
  return items;
}

/** What's saved: the catalog-preview fields a card needs, without the long ones, so the list fits one setting. */
export function serializeQueue(items: readonly QueueItem[]): unknown[] {
  return items.map(({ id, title, episode, addedAt }) => {
    const s = snapshot(title);
    return { id, title: { ...s, meta: { ...s.meta, description: undefined, logo: undefined, genres: title.genres.slice(0, GENRES) } }, episode, addedAt };
  });
}

/** Adds `item` at the front (Play next) or the end; Play next on a queued item moves it to the front. */
export function placed(items: readonly QueueItem[], item: QueueItem, where: Placement): { items: readonly QueueItem[]; result: AddResult } {
  const existing = items.find((other) => matches(other, item.title.id, item.episode?.videoId));
  if (existing) {
    if (where === 'end') return { items, result: 'exists' };
    return { items: [existing, ...items.filter((other) => other !== existing)], result: items[0] === existing ? 'exists' : 'moved' };
  }
  if (items.length >= QUEUE_LIMIT) return { items, result: 'full' };
  return { items: where === 'next' ? [item, ...items] : [...items, item], result: 'added' };
}

/** `id` one place earlier (-1) or later (1); unchanged at either end. */
export function shifted(items: readonly QueueItem[], id: string, step: -1 | 1): readonly QueueItem[] {
  const from = items.findIndex((item) => item.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** A short random id for a new item. */
function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── The active profile's queue ──

let items: readonly QueueItem[] = [];
let key: string | null = null;
let loading: Promise<void> | undefined;
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Reads the queue once (switching profile reloads the window); later calls wait for the first. */
export function loadQueue(): Promise<void> {
  return (loading ??= profileSetting(QUEUE_PREFIX)
    .then(({ key: k, value }) => {
      key = k;
      items = parseQueue(value);
      changed();
    })
    .catch((err: unknown) => console.warn('Could not read the queue', err)));
}

export const queueItems = (): readonly QueueItem[] => items;
export const queueHead = (): QueueItem | undefined => items[0];
/** Whether anything of `titleId` (the movie, or any episode) is queued. */
export const titleQueued = (titleId: string) => items.some((item) => item.title.id === titleId);
export const episodeQueued = (titleId: string, videoId: string) => items.some((item) => matches(item, titleId, videoId));

/** Calls `listener` whenever the queue changes; returns an unsubscribe function. */
export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Applies a change once loaded, then saves it (in order); undoes it if saving fails. */
async function update<R>(change: (current: readonly QueueItem[]) => { items: readonly QueueItem[]; result: R }): Promise<R> {
  await loadQueue();
  const before = items;
  const { items: next, result } = change(items);
  if (next === before) return result;
  items = next;
  changed();
  const saving = key;
  const value = serializeQueue(next);
  const write = writes.then(() => (saving ? settings.set(saving, value) : undefined));
  writes = write.catch(() => {});
  try {
    await write;
  } catch (err) {
    console.error('Could not save the queue', err);
    // Undone only if nothing changed it since.
    if (items === next) {
      items = before;
      changed();
    }
    toast(t('watching.queue.save-failed'));
  }
  return result;
}

export const enqueue = (title: Title, episode: QueueEpisode | null, where: Placement) =>
  update((current) => placed(current, { id: newId(), title, episode: episode ? { ...episode, name: episode.name.slice(0, EPISODE_NAME_CHARS) } : null, addedAt: Date.now() }, where));
export const dequeue = (id: string) => update((current) => ({ items: current.some((i) => i.id === id) ? current.filter((i) => i.id !== id) : current, result: undefined }));
/** Removes every queued item of `titleId` (the title menu's "Remove from queue"). */
export const dequeueTitle = (titleId: string) => update((current) => ({ items: current.some((i) => i.title.id === titleId) ? current.filter((i) => i.title.id !== titleId) : current, result: undefined }));
export const moveQueued = (id: string, step: -1 | 1) => update((current) => ({ items: shifted(current, id, step), result: undefined }));
export const clearQueue = () => update((current) => ({ items: current.length ? [] : current, result: undefined }));
/** A movie or episode started playing (from the queue or not): it leaves the queue. */
export const markStarted = (titleId: string, videoId: string | undefined) =>
  update((current) => ({ items: current.some((i) => matches(i, titleId, videoId)) ? current.filter((i) => !matches(i, titleId, videoId)) : current, result: undefined }));
