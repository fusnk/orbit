/**
 * Time limits for waits that must never last forever. Rust already bounds
 * every network request; these are the page's safety net for anything that
 * still doesn't answer (a stuck command, a locked keychain), so a loading
 * state always ends in content or an error.
 */

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} took longer than ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * `promise`, or a rejection with `TimeoutError` after `ms`. The work itself
 * isn't cancelled; a late answer is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what = 'The operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * `promise`'s value, or `fallback` if it fails or takes longer than `ms`;
 * for optional startup steps. `onFallback` hears why (e.g. to log it).
 */
export function settleWithin<T, F>(promise: Promise<T>, ms: number, fallback: F, onFallback?: (err: unknown) => void): Promise<T | F> {
  return withTimeout(promise, ms).catch((err: unknown) => {
    onFallback?.(err);
    return fallback;
  });
}
