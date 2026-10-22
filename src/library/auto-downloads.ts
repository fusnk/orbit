/**
 * "Download season" and "Keep next episodes downloaded": which episodes to
 * queue, which watched ones to delete, and the per-show choices (kept per
 * profile). Starting the downloads is src/rooms/downloads/auto.ts's job.
 */
import type { Episode, Title } from '../catalog/titles';
import { releasedAt } from '../lib/air-date';
import { settings } from '../lib/ipc';
import { profileSetting } from './profiles';

/** Per profile (see profiles.rs `PROFILE_SETTINGS`): `{ "<title id>": { deleteWatched } }` for each show kept downloaded. */
export const KEEP_NEXT_PREFIX = 'downloads.keep-next';
/** For every show: how many unwatched episodes to keep downloaded ahead. */
export const KEEP_COUNT_KEY = 'downloads.keep-next-count';
export const KEEP_COUNTS = [1, 2, 3] as const;
export const parseKeepCount = (value: unknown): number => KEEP_COUNTS.find((c) => c === value) ?? 1;

export interface KeepNext {
  /** Delete an episode's download once it's watched. Off unless chosen. */
  deleteWatched: boolean;
}

export interface EpisodeRef {
  season: number;
  episode: Episode;
}

/** Plenty for anyone; keeps a hand-edited backup from growing the setting without bound. */
const MAX_SHOWS = 500;
/** Title ids as addons use them ("tt0944947", "kitsu:1"); never "__proto__" and the like. */
const TITLE_ID = /^[A-Za-z0-9][\w:.%-]{0,199}$/;

/** The stored choices, skipping anything malformed (they can come from a hand-edited backup). */
export function parseKeepNext(value: unknown): Map<string, KeepNext> {
  const shows = new Map<string, KeepNext>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return shows;
  for (const [id, entry] of Object.entries(value)) {
    if (shows.size >= MAX_SHOWS) break;
    if (!TITLE_ID.test(id) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    shows.set(id, { deleteWatched: (entry as { deleteWatched?: unknown }).deleteWatched === true });
  }
  return shows;
}

/** Aired: no "Airs …" note, and a release date (when there is one) that has passed. */
export function hasAired(episode: Episode, now: number): boolean {
  if (episode.airs) return false;
  const at = releasedAt(episode.released);
  return Number.isNaN(at) || at <= now;
}

/** A season's aired episodes that have no download yet (in any state but failed), in order. */
export function seasonToQueue(title: Title, season: number, now: number, hasDownload: (videoId: string) => boolean): EpisodeRef[] {
  const episodes = title.seasons?.find((s) => s.number === season)?.episodes ?? [];
  return [...episodes]
    .sort((a, b) => a.number - b.number)
    .filter((episode) => hasAired(episode, now) && !hasDownload(episode.id))
    .map((episode) => ({ season, episode }));
}

/** Every episode in watching order, specials (season 0) left out. */
function inOrder(title: Title): EpisodeRef[] {
  return [...(title.seasons ?? [])]
    .filter((s) => s.number > 0)
    .sort((a, b) => a.number - b.number)
    .flatMap((s) => [...s.episodes].sort((a, b) => a.number - b.number).map((episode) => ({ season: s.number, episode })));
}

/**
 * What "Keep next episodes downloaded" queues: the first `count` aired,
 * unwatched episodes after the furthest one watched (from the start when
 * none is), minus those already downloaded or downloading — so `count`
 * stays ready ahead without queuing anything twice.
 */
export function nextToQueue(
  title: Title,
  options: { count: number; now: number; isWatched: (videoId: string) => boolean; hasDownload: (videoId: string) => boolean },
): EpisodeRef[] {
  const all = inOrder(title);
  let last = -1;
  all.forEach((ref, i) => {
    if (options.isWatched(ref.episode.id)) last = i;
  });
  return all
    .slice(last + 1)
    .filter((ref) => hasAired(ref.episode, options.now) && !options.isWatched(ref.episode.id))
    .slice(0, options.count)
    .filter((ref) => !options.hasDownload(ref.episode.id));
}

/**
 * Downloads to delete after episodes became watched: only for a show kept
 * downloaded with "Delete watched episodes" on, only its finished episode
 * downloads, and only those episodes just watched.
 */
export function watchedToDelete(
  downloads: readonly { id: string; titleId: string; videoId: string; season: number | null; state: string }[],
  titleId: string,
  keep: KeepNext | undefined,
  justWatched: ReadonlySet<string>,
): string[] {
  if (!keep?.deleteWatched) return [];
  return downloads.filter((d) => d.titleId === titleId && d.season !== null && d.state === 'done' && justWatched.has(d.videoId)).map((d) => d.id);
}

// ── The active profile's choices ──

let shows = new Map<string, KeepNext>();

/** Reads the active profile's choices; call at startup. */
export async function loadKeepNext(): Promise<void> {
  shows = parseKeepNext((await profileSetting(KEEP_NEXT_PREFIX)).value);
}

export const keepNextOf = (titleId: string): KeepNext | undefined => shows.get(titleId);
export const keptShows = (): string[] => [...shows.keys()];

/** Turns "Keep next episodes downloaded" on (with its options) or off (null) for a show, and saves it. */
export async function setKeepNext(titleId: string, keep: KeepNext | null): Promise<void> {
  if (!TITLE_ID.test(titleId)) return;
  const next = new Map(shows);
  if (keep) next.set(titleId, keep);
  else next.delete(titleId);
  await settings.set((await profileSetting(KEEP_NEXT_PREFIX)).key, Object.fromEntries(next));
  shows = next;
}
