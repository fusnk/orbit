/**
 * Switching to another profile while Orbit is in use (the title bar's
 * picker). Rust writes watch history, and sends to Stremio, for whichever
 * profile is active when each command runs, so before the switch the video
 * playing saves where it got to and what's waiting is stored and sent, as when
 * Orbit quits; and nothing this page saves after the switch reaches the new
 * profile (the window starts over for it). Without this the last stretch since
 * the player's periodic save was lost, or landed in the other profile.
 */
import { flushStremioSync } from '../library/stremio-sync';
import { selectProfile } from '../library/profiles';
import { switchProfileAfterWrites, watchWritesSettled } from '../library/watch';
import { withTimeout } from '../lib/timeout';

/** Dispatched on `window` before the active profile changes: the player saves where it got to. */
export const LEAVING_PROFILE = 'orbit:leaving-profile';
/** How long sending to Stremio may hold up the switch (as when quitting, see quit.ts). */
const SEND_WAIT_MS = 2500;

/** Makes `id` the active profile; rejects with a code (`err.pin.wrong`…) as `selectProfile` does. */
export async function switchProfile(id: string, pin?: string): Promise<void> {
  window.dispatchEvent(new Event(LEAVING_PROFILE));
  const done = watchWritesSettled().then(flushStremioSync);
  await withTimeout(done, SEND_WAIT_MS, 'Saving before switching profile').catch((err: unknown) => console.warn(err));
  await switchProfileAfterWrites(() => selectProfile(id, pin));
}
