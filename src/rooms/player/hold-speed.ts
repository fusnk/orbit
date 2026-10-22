/**
 * Hold play/pause to watch at 2×: a tap still pauses (on release), but held
 * past HOLD_MS while playing, the video speeds up until the key is let go,
 * then goes back to the speed it had. Paused, or on a live channel, the key
 * acts at once as it always did. mpv still owns the speed: this only asks
 * for changes, and a small "2×" pill shows while held.
 *
 * Holding the mouse button on the picture works the same, except that a
 * short click is left to the picture's own click (pause, or the first half
 * of a double-click), and a click that sped up doesn't pause.
 */

export const HOLD_MS = 300;
export const BOOST_SPEED = 2;

export interface HoldHost {
  /** Settings → Player → Hold for 2× (on unless turned off). */
  enabled(): boolean;
  /** Paused, or something holding can't speed up (a live channel). */
  actNow(): boolean;
  togglePause(): void;
  /** The speed playing now (mpv's report). */
  speed(): number;
  setSpeed(speed: number): void;
  /** Shows or hides the pill. */
  boosting(on: boolean): void;
}

/** The window's timers, called as plain functions (a browser's setTimeout can't be called as another object's method). */
const WINDOW_TIMERS = { set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer) };

export function createHoldSpeed(host: HoldHost, timers = WINDOW_TIMERS) {
  /** The key being held, while it is. */
  let held: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The speed to go back to, while boosted. */
  let restore: number | null = null;
  /** Whether letting go before the boost pauses (a key) or does nothing here (the mouse: its click does). */
  let tapToggles = true;

  function end(toggle: boolean): void {
    timers.clear(timer);
    timer = undefined;
    held = null;
    if (restore !== null) {
      host.setSpeed(restore);
      restore = null;
      host.boosting(false);
    } else if (toggle && tapToggles) host.togglePause();
  }

  return {
    /** The play/pause key (or, with `tap` false, the mouse button on the picture) went down. */
    press(key: string, tap = true): void {
      if (held !== null) return;
      if (!host.enabled() || host.actNow()) return tap ? host.togglePause() : undefined;
      held = key.toLowerCase();
      tapToggles = tap;
      timer = timers.set(() => {
        timer = undefined;
        const now = host.speed();
        // Already at 2× or faster: holding has nothing to add (and releasing mustn't pause).
        restore = now;
        if (now < BOOST_SPEED) host.setSpeed(BOOST_SPEED);
        host.boosting(true);
      }, HOLD_MS);
    },
    /** A key came up: the held one ends the hold (a short press pauses). */
    release(key: string): void {
      if (held !== null && key.toLowerCase() === held) end(true);
    },
    /** The window lost focus mid-hold (or, with `key`, that press left the picture): undo without pausing. */
    cancel(key?: string): void {
      if (held !== null && (key === undefined || key.toLowerCase() === held)) end(false);
    },
    holding: () => held !== null,
    /** Whether the hold has sped playback up (rather than still waiting to). */
    boosted: () => restore !== null,
  };
}
