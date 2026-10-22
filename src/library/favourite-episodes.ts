/**
 * The profile's favourite episodes: the heart on an episode (a show's page,
 * the player's episode lists, the player itself) keeps it in My Library →
 * Favourite episodes. Kept in SQLite (Rust, see episode_favourites.rs) with
 * the episode's name and still and a snapshot of its show, so the list draws
 * without the network. Loaded at startup; reads are synchronous from memory,
 * and a change shows at once and is undone if saving fails (like library.ts).
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import type { Episode, Title } from '../catalog/titles';
import { t } from '../i18n';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

export interface FavouriteEpisode {
  show: Title;
  season: number;
  episode: number;
  videoId: string;
  /** The episode's name. */
  name: string;
  still: string | undefined;
  /** Milliseconds since the epoch. */
  addedAt: number;
}

/** Stored rows are validated like addon data: every field came from an addon. */
const RowSchema = v.object({
  seriesId: v.pipe(v.string(), v.minLength(1)),
  season: v.pipe(v.number(), v.integer(), v.minValue(0)),
  episode: v.pipe(v.number(), v.integer(), v.minValue(0)),
  videoId: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
  // Only https pictures: anything else would be blocked by the CSP or is a downgrade.
  still: v.fallback(v.nullable(v.pipe(v.string(), v.maxLength(2048), v.url(), v.startsWith('https://'))), null),
  show: SnapshotSchema,
  addedAt: v.number(),
});

const keyOf = (seriesId: string, season: number, episode: number) => `${seriesId}\u0000${season}\u0000${episode}`;

const entries = new Map<string, FavouriteEpisode>();
const listeners = new Set<() => void>();
let writes: Promise<unknown> = Promise.resolve();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Reads the favourites from storage; call once before the first page renders. */
export async function loadFavouriteEpisodes(): Promise<void> {
  const rows = await invoke<unknown[]>('favourite_episode_all');
  entries.clear();
  for (const raw of rows) {
    const row = v.safeParse(RowSchema, raw);
    // A row that no longer validates is skipped, not fatal.
    if (!row.success) continue;
    const { seriesId, season, episode, videoId, title, still, show, addedAt } = row.output;
    entries.set(keyOf(seriesId, season, episode), { show: { ...fromSnapshot(show), id: seriesId }, season, episode, videoId, name: title, still: still ?? undefined, addedAt });
  }
  changed();
}

/** Whether episode `number` of `season` of show `seriesId` is a favourite. */
export const isFavouriteEpisode = (seriesId: string, season: number, number: number): boolean => entries.has(keyOf(seriesId, season, number));

/** Every favourite, newest first. */
export const favouriteEpisodes = (): FavouriteEpisode[] => [...entries.values()].sort((a, b) => b.addedAt - a.addedAt);

/** Calls `listener` whenever the favourites change; returns an unsubscribe function. */
export function onFavouriteEpisodesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Favourites by show for My Library: the show with the newest favourite
 * first, and each show's episodes newest first.
 */
export function groupByShow(list: readonly FavouriteEpisode[]): { show: Title; episodes: FavouriteEpisode[] }[] {
  const groups = new Map<string, { show: Title; episodes: FavouriteEpisode[] }>();
  for (const entry of [...list].sort((a, b) => b.addedAt - a.addedAt)) {
    const group = groups.get(entry.show.id);
    if (group) group.episodes.push(entry);
    else groups.set(entry.show.id, { show: entry.show, episodes: [entry] });
  }
  return [...groups.values()];
}

/**
 * Hearts or un-hearts an episode of `show`. Resolves true once saved; on
 * failure the change is undone, the person is told, and it resolves false.
 */
export async function toggleFavouriteEpisode(show: Title, season: number, episode: Episode): Promise<boolean> {
  const key = keyOf(show.id, season, episode.number);
  const previous = entries.get(key);
  const still = episode.thumbnail?.startsWith('https://') ? episode.thumbnail : undefined;
  // On one line and within what Rust keeps (300 characters).
  const name = [...episode.title.replace(/\s+/g, ' ').trim()].slice(0, 300).join('');
  if (previous) entries.delete(key);
  else entries.set(key, { show, season, episode: episode.number, videoId: episode.id, name, still, addedAt: Date.now() });
  changed();
  // Saved one after another: two quick presses reach storage in the order they were made.
  const write = writes.then(() =>
    previous
      ? invoke('favourite_episode_remove', { seriesId: show.id, season, episode: episode.number })
      : invoke('favourite_episode_add', { seriesId: show.id, season, episode: episode.number, videoId: episode.id, title: name, still: still ?? null, show: snapshot(show) }),
  );
  writes = write.catch(() => {});
  try {
    await write;
    return true;
  } catch (err) {
    console.error('Could not update favourite episodes', err);
    if (previous) entries.set(key, previous);
    else entries.delete(key);
    changed();
    // Loaded when needed: the toast draws itself on import, and the player's
    // panels (which tests load without a page) import this module.
    void import('../components/toast').then(({ toast }) => toast(t('favourites.failed')));
    return false;
  }
}
