/**
 * Orbit's Continue Watching on the Android TV home screen (Google TV's
 * "Continue watching" row), off until turned on in Settings → Playback. It's
 * one list for the whole TV, and anyone at the TV sees it, so it holds the
 * active profile's titles only while that profile has no PIN; a locked
 * profile (or the setting off) clears it. Entries carry public names and
 * pictures, never a still (the next episode's would spoil it) or an address
 * to play; picking one opens Orbit, which plays the title only if the
 * profile that comes up has it in its own list (main.ts `__orbitWatchNext`).
 * A profile with a content limit lists only what its limit allows.
 */
import { invoke } from '@tauri-apps/api/core';
import { allowedTitles } from '../catalog/parental';
import { settings } from '../lib/ipc';
import { isAndroid } from '../lib/platform';
import { activeProfileId, listProfiles } from './profiles';
import { continueWatching, onWatchChange, watchRecord, type ContinueEntry } from './watch';

export const WATCH_NEXT_KEY = 'android.watch-next';

/** What watch_next.rs takes (and checks again). */
export interface WatchNextItem {
  id: string;
  kind: 'movie' | 'series';
  title: string;
  season: number | null;
  episode: number | null;
  art: string | null;
  wide: boolean;
  positionMs: number;
  durationMs: number;
  next: boolean;
  lastWatched: number;
}

type WatchRecord = ReturnType<typeof watchRecord>;

const https = (url: string | undefined): url is string => !!url && url.startsWith('https://');

/** Continue Watching as home-screen entries, in its order. */
export function watchNextItems(entries: readonly ContinueEntry[], recordOf: (titleId: string) => WatchRecord): WatchNextItem[] {
  return entries.slice(0, 20).map(({ title, progress }) => {
    const record = recordOf(title.id);
    const latest = record?.rows.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    // Part-way through: where, and which episode. A next episode has neither until it starts.
    const resuming = progress > 0 && latest ? latest : undefined;
    const wide = https(title.background);
    return {
      id: title.id,
      kind: title.type === 'series' ? 'series' : 'movie',
      title: title.name,
      season: resuming?.season ?? null,
      episode: resuming?.episode ?? null,
      art: wide ? title.background! : https(title.poster) ? title.poster : null,
      wide,
      positionMs: resuming ? Math.round(resuming.position * 1000) : 0,
      durationMs: resuming ? Math.round(resuming.duration * 1000) : 0,
      next: progress === 0,
      lastWatched: record?.updatedAt ?? 0,
    };
  });
}

async function publishable(): Promise<boolean> {
  if ((await settings.get(WATCH_NEXT_KEY).catch(() => false)) !== true) return false;
  const [id, profiles] = await Promise.all([activeProfileId(), listProfiles()]);
  const profile = profiles.find((p) => p.id === id);
  return !!profile && !profile.hasPin;
}

/**
 * The entries the active profile's content limit allows: the row shows names
 * and posters to anyone at the TV, as Continue Watching's cards would. A
 * rating still unknown after the wait leaves its title out (failing closed)
 * until the next change publishes the row again.
 */
export async function allowedEntries(entries: readonly ContinueEntry[]): Promise<ContinueEntry[]> {
  const allowed = new Set((await allowedTitles(entries.map((e) => e.title), 15_000)).map((title) => title.id));
  return entries.filter((e) => allowed.has(e.title.id));
}

let pending: ReturnType<typeof setTimeout> | undefined;

/** Brings the home screen's row up to date (or clears it), a moment after the last change. */
export function syncWatchNext(): void {
  if (!isAndroid) return;
  clearTimeout(pending);
  pending = setTimeout(() => {
    void publishable()
      .catch(() => false)
      .then(async (on) => invoke('watch_next_publish', { items: on ? watchNextItems(await allowedEntries(continueWatching()), watchRecord) : [] }))
      .catch((err: unknown) => console.warn('Could not update the home screen’s Continue Watching', err));
  }, 2000);
}

/** Keeps the row in step with Continue Watching (Android only). */
export function installWatchNext(): void {
  syncWatchNext();
  onWatchChange(syncWatchNext);
}
