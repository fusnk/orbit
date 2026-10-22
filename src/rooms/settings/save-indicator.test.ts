import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_WINDOW_MS, createSavedPulse, followsAction, SAVED_HOLD_MS } from './save-indicator';

describe('createSavedPulse', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows at the first save and hides once the hold has passed', () => {
    const show = vi.fn();
    const hide = vi.fn();
    const pulse = createSavedPulse(show, hide);
    pulse.saved();
    expect(show).toHaveBeenCalledTimes(1);
    expect(pulse.showing).toBe(true);
    vi.advanceTimersByTime(SAVED_HOLD_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(pulse.showing).toBe(false);
  });

  it('treats a quick run of saves as one, held from the last', () => {
    const show = vi.fn();
    const hide = vi.fn();
    const pulse = createSavedPulse(show, hide, 1000);
    pulse.saved();
    vi.advanceTimersByTime(600);
    pulse.saved();
    vi.advanceTimersByTime(600);
    pulse.saved();
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('shows again for a save after it has gone back', () => {
    const show = vi.fn();
    const pulse = createSavedPulse(show, () => {}, 1000);
    pulse.saved();
    vi.advanceTimersByTime(1000);
    pulse.saved();
    expect(show).toHaveBeenCalledTimes(2);
  });
});

describe('followsAction', () => {
  it('counts a save soon after the person acted', () => {
    expect(followsAction(1000, 1000)).toBe(true);
    expect(followsAction(1000 + ACTION_WINDOW_MS, 1000)).toBe(true);
  });

  it('ignores saves with no recent action', () => {
    expect(followsAction(1000, null)).toBe(false);
    expect(followsAction(1001 + ACTION_WINDOW_MS, 1000)).toBe(false);
    expect(followsAction(500, 1000)).toBe(false);
  });
});
