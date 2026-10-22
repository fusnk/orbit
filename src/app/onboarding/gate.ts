/**
 * Whether first-run setup is open, and work held until it ends. Setup is a
 * modal the person ends themselves (Finish or Skip): an install link or an
 * app shortcut arriving meanwhile must not take the window from under it.
 * Kept apart from flow.ts so the deep-link and shortcut code can ask without
 * loading setup's pages.
 */

let open = false;
const held: (() => void)[] = [];

export const setupOpen = (): boolean => open;

export function setSetupOpen(value: boolean): void {
  open = value;
  if (!value) for (const run of held.splice(0)) run();
}

/** Runs `work` now, or once setup ends if it's open. */
export function afterSetup(work: () => void): void {
  if (open) held.push(work);
  else work();
}

let play: (() => void) | null = null;

/**
 * A title another device (Orbit Connect, the phone remote) asks to play or open: now, or once setup
 * ends. Only the newest is kept, so plays asked for during setup don't open one after another.
 */
export function playAfterSetup(work: () => void): void {
  if (!open) return work();
  if (!play) {
    afterSetup(() => {
      const run = play;
      play = null;
      run?.();
    });
  }
  play = work;
}
