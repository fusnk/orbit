/**
 * Pause watch history (Quick settings, Ctrl+K), per profile. While it's on,
 * playback leaves no trace: the player's progress isn't recorded (so nothing
 * reaches watch history, Continue Watching, Stremio sync or auto-downloads,
 * which all follow `recordProgress` in watch.ts), the person's own
 * Jellyfin or Plex server isn't told what plays (own-servers.ts), and the
 * player's per-title memory (last source, failed sources, audio and
 * subtitles picked) isn't written (`record` in player/profile-store.ts).
 * Those read `historyPaused()`; the decision lives only here. Things the person
 * does by hand (marking watched, clearing history) still apply: pausing is
 * about what playing does on its own.
 */
import { settings } from '../lib/ipc';
import { profileSetting } from './profiles';

export const HISTORY_PAUSED_KEY = 'history.paused';

let paused = false;
let key = HISTORY_PAUSED_KEY;
const listeners = new Set<() => void>();

export const historyPaused = (): boolean => paused;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` when pausing is turned on or off; returns an unsubscribe function. */
export function onHistoryPauseChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the profile's choice; call once at startup (switching profile reloads the window). */
export async function loadHistoryPause(): Promise<void> {
  const saved = await profileSetting(HISTORY_PAUSED_KEY);
  key = saved.key;
  paused = saved.value === true;
  notify();
}

/** Turns pausing on or off and saves it; a failed save puts the previous state back and rejects. */
export async function setHistoryPaused(on: boolean): Promise<void> {
  const before = paused;
  paused = on;
  notify();
  try {
    await settings.set(key, on);
  } catch (err) {
    paused = before;
    notify();
    throw err;
  }
}
