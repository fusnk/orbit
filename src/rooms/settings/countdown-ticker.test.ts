import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTicker } from './countdown-ticker';

describe('createTicker', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks only while a countdown is wanted and seen', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const ticker = createTicker(tick, 1000);
    ticker.want(true);
    vi.advanceTimersByTime(5000);
    // A pairing code shown, but Settings left (or the window minimised): it used to tick every second all session.
    expect(tick).not.toHaveBeenCalled();
    ticker.seen(true);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(4);
    ticker.seen(false);
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    // Back on the page: right at once, and on again.
    ticker.seen(true);
    expect(tick).toHaveBeenCalledTimes(5);
    ticker.want(false);
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
