/**
 * The startup safe-mode key: Shift held on its own for about a second. Shift+Tab, a capital
 * letter or any other key while Shift is down doesn't count, so typing or moving focus right
 * after launch never turns custom CSS off by accident.
 */
export const SAFE_MODE_HOLD_MS = 1000;

type KeyEventLike = { type: string; key: string; timeStamp: number };

/**
 * Returns a handler for keydown and keyup that calls `held` (once) when Shift has been held
 * alone for SAFE_MODE_HOLD_MS: on a repeated Shift keydown (Windows repeats modifiers) or on the
 * Shift keyup (macOS and Linux don't).
 */
export function shiftHoldWatcher(held: () => void): (event: KeyEventLike) => void {
  let downAt: number | null = null;
  let spoiled = false;
  let done = false;
  const fire = () => {
    done = true;
    held();
  };
  return (event) => {
    if (done) return;
    const long = downAt !== null && !spoiled && event.timeStamp - downAt >= SAFE_MODE_HOLD_MS;
    if (event.key !== 'Shift') {
      if (event.type === 'keydown' && downAt !== null) spoiled = true;
      return;
    }
    if (event.type === 'keyup') {
      downAt = null;
      spoiled = false;
      if (long) fire();
    } else if (event.type === 'keydown') {
      if (downAt === null) downAt = event.timeStamp;
      else if (long) fire();
    }
  };
}
