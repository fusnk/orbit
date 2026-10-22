/**
 * Idle detection for ambient mode: calls `onIdle` once nothing has been
 * pressed, moved or scrolled for the chosen time, but never while something
 * plays, a field is being typed in, or the window is hidden.
 *
 * Framework-free: the app reports input (`activity`) and window visibility,
 * and answers `conditions()` when asked. Input is the hot path (every mouse
 * move), so it only notes the time; the one timer works out what's left when
 * it fires instead of being restarted on every event.
 */

export interface IdleConditions {
  /** The player: not open, playing, or paused. Something else playing with sound counts as 'playing'. */
  player: 'none' | 'playing' | 'paused';
  /** A text field is being typed in. */
  editing: boolean;
  /** The window is minimised or hidden (document.visibilityState). */
  hidden: boolean;
}

export interface IdleOptions {
  /** How long without input before going idle; 0 turns it off. */
  afterMs: number;
  /** Whether a paused player may go idle (it never does while playing). */
  whenPaused: boolean;
}

/**
 * While something blocks going idle (playing, editing), it's checked this
 * often; the quiet time counts from the last check that found it blocked, so
 * "paused for 10 minutes" is right to within this much without hooking the
 * player's events.
 */
export const BLOCKED_CHECK_MS = 15_000;

/** Whether `c` rules out going idle right now. */
export function idleBlocked(c: IdleConditions, whenPaused: boolean): boolean {
  return c.hidden || c.editing || c.player === 'playing' || (c.player === 'paused' && !whenPaused);
}

export function createIdleTimer(deps: { conditions(): IdleConditions; onIdle(): void }) {
  let options: IdleOptions = { afterMs: 0, whenPaused: true };
  let quietSince = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Went idle; stays quiet until the next input. */
  let fired = false;

  function stop(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(ms: number): void {
    stop();
    timer = setTimeout(check, Math.max(0, ms));
  }

  function check(): void {
    timer = undefined;
    if (!options.afterMs || fired) return;
    const c = deps.conditions();
    // Hidden: nothing runs until the window is back (`visibility`).
    if (c.hidden) return;
    const now = Date.now();
    if (idleBlocked(c, options.whenPaused)) {
      quietSince = now;
      return schedule(Math.min(BLOCKED_CHECK_MS, options.afterMs));
    }
    const left = quietSince + options.afterMs - now;
    if (left > 0) return schedule(left);
    fired = true;
    deps.onIdle();
  }

  function activity(): void {
    quietSince = Date.now();
    fired = false;
    if (options.afterMs > 0 && timer === undefined) schedule(options.afterMs);
  }

  return {
    /** New settings; the wait starts over. */
    configure(next: IdleOptions): void {
      options = { ...next };
      quietSince = Date.now();
      fired = false;
      if (options.afterMs > 0) schedule(options.afterMs);
      else stop();
    },
    /** Any key, click, wheel, pointer move or gamepad press. */
    activity,
    /** The window was hidden or shown again; showing it counts as the person coming back. */
    visibility(hidden: boolean): void {
      if (hidden) stop();
      else activity();
    },
  };
}

export type IdleTimer = ReturnType<typeof createIdleTimer>;
