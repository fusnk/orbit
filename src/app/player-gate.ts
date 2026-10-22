/**
 * Whether the player is showing, and work held until it closes. A video
 * playing must not be stopped from under the person by something that can
 * wait: "Restart to update" (an accepted restart ends playback with no
 * warning) and an addon install link (its review opens over the player).
 * Kept apart from rooms/player so app code can ask without loading the
 * player; the player reports in (`setPlayerOpen`) as it opens and closes.
 * Modelled on onboarding/gate.ts.
 */

let open = false;
const held: (() => void)[] = [];

export const playerShowing = (): boolean => open;

/** The player opened or closed. Work held for its closing runs after the navigation that closed it. */
export function setPlayerOpen(value: boolean): void {
  open = value;
  if (value || !held.length) return;
  const runs = held.splice(0);
  setTimeout(() => {
    for (const run of runs) run();
  }, 0);
}

/** Runs `work` now, or once the player closes if it's showing. True if it had to wait. */
export function afterPlayer(work: () => void): boolean {
  if (!open) {
    work();
    return false;
  }
  held.push(work);
  return true;
}
