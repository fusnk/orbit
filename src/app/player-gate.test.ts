import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterPlayer, playerShowing, setPlayerOpen } from './player-gate';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  setPlayerOpen(false);
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('work held while the player shows', () => {
  it('runs at once while no video plays', () => {
    const show = vi.fn();
    expect(afterPlayer(show)).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('waits while a video plays ("Restart to update" would stop it), and runs once the player closes', () => {
    setPlayerOpen(true);
    expect(playerShowing()).toBe(true);
    const show = vi.fn();
    expect(afterPlayer(show)).toBe(true);
    expect(show).not.toHaveBeenCalled();

    setPlayerOpen(false);
    // Not inside the navigation that closed the player: after it.
    expect(show).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through another file in the same player, and runs each held piece once', () => {
    setPlayerOpen(true);
    const a = vi.fn();
    const b = vi.fn();
    afterPlayer(a);
    setPlayerOpen(true);
    afterPlayer(b);
    vi.runAllTimers();
    expect(a).not.toHaveBeenCalled();
    setPlayerOpen(false);
    vi.runAllTimers();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    setPlayerOpen(false);
    vi.runAllTimers();
    expect(a).toHaveBeenCalledTimes(1);
  });
});
