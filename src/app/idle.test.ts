import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCKED_CHECK_MS, createIdleTimer, idleBlocked, type IdleConditions } from './idle';

const MIN = 60_000;

function setup(initial: Partial<IdleConditions> = {}) {
  const conditions: IdleConditions = { player: 'none', editing: false, hidden: false, ...initial };
  const onIdle = vi.fn();
  const timer = createIdleTimer({ conditions: () => conditions, onIdle });
  return { conditions, onIdle, timer };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('idleBlocked', () => {
  const base: IdleConditions = { player: 'none', editing: false, hidden: false };
  it('allows an ordinary page', () => expect(idleBlocked(base, true)).toBe(false));
  it('never while playing', () => {
    expect(idleBlocked({ ...base, player: 'playing' }, true)).toBe(true);
    expect(idleBlocked({ ...base, player: 'playing' }, false)).toBe(true);
  });
  it('paused only with the setting on', () => {
    expect(idleBlocked({ ...base, player: 'paused' }, true)).toBe(false);
    expect(idleBlocked({ ...base, player: 'paused' }, false)).toBe(true);
  });
  it('never while editing or hidden', () => {
    expect(idleBlocked({ ...base, editing: true }, true)).toBe(true);
    expect(idleBlocked({ ...base, hidden: true }, true)).toBe(true);
  });
});

describe('createIdleTimer', () => {
  it('goes idle after the chosen time without input, once', () => {
    const { onIdle, timer } = setup();
    timer.configure({ afterMs: 10 * MIN, whenPaused: true });
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('input starts the wait over', () => {
    const { onIdle, timer } = setup();
    timer.configure({ afterMs: 2 * MIN, whenPaused: true });
    vi.advanceTimersByTime(MIN + 30_000);
    timer.activity();
    vi.advanceTimersByTime(MIN + 30_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('waits again after waking', () => {
    const { onIdle, timer } = setup();
    timer.configure({ afterMs: 2 * MIN, whenPaused: true });
    vi.advanceTimersByTime(2 * MIN);
    timer.activity();
    vi.advanceTimersByTime(2 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('does nothing when off', () => {
    const { onIdle, timer } = setup();
    timer.configure({ afterMs: 0, whenPaused: true });
    timer.activity();
    vi.advanceTimersByTime(120 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('never while playing; counts from when it stopped', () => {
    const { conditions, onIdle, timer } = setup({ player: 'playing' });
    timer.configure({ afterMs: 5 * MIN, whenPaused: true });
    vi.advanceTimersByTime(60 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    // Paused without input (e.g. the end of a film): idle once paused for the full time.
    // (The last check, just now, found it playing; checks run every BLOCKED_CHECK_MS.)
    conditions.player = 'paused';
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('not over a paused player when that setting is off', () => {
    const { onIdle, timer } = setup({ player: 'paused' });
    timer.configure({ afterMs: 2 * MIN, whenPaused: false });
    vi.advanceTimersByTime(60 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('not while a field is being edited', () => {
    const { conditions, onIdle, timer } = setup({ editing: true });
    timer.configure({ afterMs: 2 * MIN, whenPaused: true });
    vi.advanceTimersByTime(30 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    conditions.editing = false;
    vi.advanceTimersByTime(2 * MIN + BLOCKED_CHECK_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stops while the window is hidden and waits afresh when shown', () => {
    const { conditions, onIdle, timer } = setup();
    timer.configure({ afterMs: 2 * MIN, whenPaused: true });
    vi.advanceTimersByTime(MIN);
    conditions.hidden = true;
    timer.visibility(true);
    vi.advanceTimersByTime(60 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    conditions.hidden = false;
    timer.visibility(false);
    vi.advanceTimersByTime(2 * MIN - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('a hidden window found at the deadline waits for it to come back', () => {
    const { conditions, onIdle, timer } = setup();
    timer.configure({ afterMs: 2 * MIN, whenPaused: true });
    conditions.hidden = true;
    vi.advanceTimersByTime(60 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconfiguring starts the wait over', () => {
    const { onIdle, timer } = setup();
    timer.configure({ afterMs: 10 * MIN, whenPaused: true });
    vi.advanceTimersByTime(9 * MIN);
    timer.configure({ afterMs: 2 * MIN, whenPaused: true });
    vi.advanceTimersByTime(2 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
