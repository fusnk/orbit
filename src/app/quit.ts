/**
 * Orbit's way out: closing the window (unless it goes to the tray), the
 * tray's Quit, and "Restart to update". Before Orbit goes, the video playing
 * saves where it got to, watch history reaches the database, and changes
 * waiting for Stremio are sent (or kept for the next start). Without this the
 * last stretch since the player's periodic save was lost, and a finished
 * episode never reached Stremio.
 *
 * Rust asks with `app://quitting` and waits for `quit_ready`, but only a few
 * seconds (src-tauri/src/quit.rs), so a page that hangs can't keep Orbit open.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { flushStremioSync } from '../library/stremio-sync';
import { watchWritesSettled } from '../library/watch';
import { withTimeout } from '../lib/timeout';

/** Dispatched on `window` as Orbit quits: the player saves where it got to. */
export const QUITTING = 'orbit:quitting';
const QUITTING_EVENT = 'app://quitting';
/** How long sending to Stremio may take; shorter than Rust's own wait (quit.rs `PAGE_WAIT`). */
const SEND_WAIT_MS = 2500;

let quitting: Promise<void> | null = null;

/** Saves and sends what's left; settles within `SEND_WAIT_MS`, whatever happens. Called once however often it's asked. */
export function beforeQuit(): Promise<void> {
  quitting ??= (async () => {
    // Listeners run now: the player's save reaches watch history (and Stremio's waiting list) before what follows.
    window.dispatchEvent(new Event(QUITTING));
    const done = watchWritesSettled().then(flushStremioSync);
    await withTimeout(done, SEND_WAIT_MS, 'Saving before quitting').catch((err: unknown) => console.warn(err));
  })();
  return quitting;
}

/** The quit didn't happen after all (an update that failed to install): the next one saves again. */
export function quitCancelled(): void {
  quitting = null;
}

/** Answers Rust's "quitting" once everything is saved; call once at startup. */
export function installQuit(): void {
  void listen(QUITTING_EVENT, () => {
    void beforeQuit().finally(() => invoke('quit_ready').catch(() => {}));
  });
}
