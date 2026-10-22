import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('./failed-sources', () => ({ failedRecently: () => () => false, loadFailures: async () => {}, markFailed: vi.fn(), markPlayed: vi.fn(), whereKey: (a: string, b = '') => `${a}/${b}` }));
vi.stubGlobal('window', globalThis);

import type { Title } from '../../catalog/titles';
import { markFailed, markPlayed } from './failed-sources';
import { createFailover } from './failover';
import type { PlayRequest } from './index';
import type { PlayableSource } from './panels';

const source = (id: string, addon: string, url: string): PlayableSource => ({ id, addon, url, label: '1080p', meta: '' }) as PlayableSource;
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
const SLOW_MS = 45_000;
const STALL_MS = 20_000;

/** `enabled`: Settings → Playback → When a source fails (false: show the error). */
function setup(extra: Partial<PlayRequest> = {}, enabled = true) {
  const a = source('n1', 'A', 'https://a/1');
  const b = source('n2', 'B', 'https://b/1');
  const request = { title: movie, source: a, sources: [a, b], ...extra } as unknown as PlayRequest;
  const switchTo = vi.fn();
  const failover = createFailover({ enabled: () => enabled, request: () => request, position: () => undefined, switchTo });
  return { failover, switchTo };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(markFailed).mockClear();
  vi.mocked(markPlayed).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('a failure is counted once', () => {
  it('a source that errors before its first frame (switching off) is not failed again as slow', () => {
    const { failover } = setup({}, false);
    failover.opening();
    failover.waiting();
    // mpv's error: index.ts fail() asks failover, which can't switch, so the error stays up.
    expect(failover.recover('failed')).toBe(false);
    vi.advanceTimersByTime(SLOW_MS + 1_000);
    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it('a stall that stays stalled (switching off) is failed once, until the next file or first frame', () => {
    const { failover } = setup({}, false);
    failover.opening();
    failover.waiting();
    failover.started();
    // Status keeps coming while it buffers.
    for (let i = 0; i < 10; i++) {
      failover.status(true, true, false);
      vi.advanceTimersByTime(STALL_MS / 2);
    }
    expect(markFailed).toHaveBeenCalledTimes(1);
    // Playing again from a fresh first frame: a new stall counts again.
    failover.started();
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS);
    expect(markFailed).toHaveBeenCalledTimes(2);
    failover.stop();
  });

  it('a later stall in the same file counts once more, after a sustained stretch of smooth playback', () => {
    const { failover } = setup({}, false);
    failover.opening();
    failover.waiting();
    failover.started();
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS);
    expect(markFailed).toHaveBeenCalledTimes(1);
    // Playing again, but only briefly: the same stall coming back isn't a new one.
    failover.status(true, false, false);
    vi.advanceTimersByTime(STALL_MS / 2);
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(markFailed).toHaveBeenCalledTimes(1);
    // Paused time isn't smooth playback either.
    failover.status(true, false, true);
    vi.advanceTimersByTime(STALL_MS * 2);
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS);
    expect(markFailed).toHaveBeenCalledTimes(1);
    // A whole STALL_MS of smooth playback: the next stall is a real one, counted once.
    failover.status(true, false, false);
    vi.advanceTimersByTime(STALL_MS);
    for (let i = 0; i < 6; i++) {
      failover.status(true, true, false);
      vi.advanceTimersByTime(STALL_MS / 2);
    }
    expect(markFailed).toHaveBeenCalledTimes(2);
    failover.stop();
  });
});

describe('the slow-source clock', () => {
  it('does not run while a source is only being opened (the resume prompt may be waiting)', () => {
    const { failover, switchTo } = setup();
    failover.opening();
    vi.advanceTimersByTime(SLOW_MS * 4);
    expect(switchTo).not.toHaveBeenCalled();
    failover.stop();
  });

  it('switches source when nothing plays within the limit after the source is handed over', () => {
    const { failover, switchTo } = setup();
    failover.opening();
    failover.waiting();
    vi.advanceTimersByTime(SLOW_MS - 1);
    expect(switchTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(switchTo).toHaveBeenCalledTimes(1);
    failover.stop();
  });

  it('tells the player when nothing plays in time and there is nowhere to go, rather than leave it loading', () => {
    for (const enabled of [false, true]) {
      const a = source('n1', 'A', 'https://a/1');
      // Switching off, or on with this the only source.
      const request = { title: movie, source: a, sources: [a] } as unknown as PlayRequest;
      const slow = vi.fn();
      const switchTo = vi.fn();
      const failover = createFailover({ enabled: () => enabled, request: () => request, position: () => undefined, switchTo, slow });
      failover.opening();
      failover.waiting();
      vi.advanceTimersByTime(SLOW_MS);
      expect(switchTo).not.toHaveBeenCalled();
      expect(slow).toHaveBeenCalledTimes(1);
      failover.stop();
    }
  });

  it('does not call a source slow when another one takes over', () => {
    const a = source('n1', 'A', 'https://a/1');
    const b = source('n2', 'B', 'https://b/1');
    const request = { title: movie, source: a, sources: [a, b] } as unknown as PlayRequest;
    const slow = vi.fn();
    const failover = createFailover({ enabled: () => true, request: () => request, position: () => undefined, switchTo: vi.fn(), slow });
    failover.opening();
    failover.waiting();
    vi.advanceTimersByTime(SLOW_MS);
    expect(slow).not.toHaveBeenCalled();
    failover.stop();
  });

  it('is stopped by the first frame', () => {
    const { failover, switchTo } = setup();
    failover.opening();
    failover.waiting();
    failover.started();
    vi.advanceTimersByTime(SLOW_MS * 2);
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('leaves catch-up alone: a programme from a channel archive has no other sources, and its failures mark nothing', () => {
    const { failover, switchTo } = setup({ replay: true });
    failover.opening();
    failover.waiting();
    vi.advanceTimersByTime(SLOW_MS * 2);
    expect(failover.recover('failed')).toBe(false);
    failover.started();
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(switchTo).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    failover.stop();
  });

  it('tells the player when a live channel stalls, since no other source takes over', () => {
    const a = source('n1', 'A', 'orbit-tv://s/1');
    const request = { title: movie, source: a, sources: [a], live: true } as unknown as PlayRequest;
    const stalled = vi.fn();
    const failover = createFailover({ enabled: () => true, request: () => request, position: () => undefined, switchTo: vi.fn(), stalled });
    failover.opening();
    failover.waiting();
    failover.started();
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS - 1);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stalled).toHaveBeenCalledTimes(1);
    failover.stop();
  });

  it('tells the player when a film stalls with nowhere to switch to, so it shows the error rather than spin on', () => {
    const a = source('n1', 'A', 'https://a/1');
    const request = { title: movie, source: a, sources: [a] } as unknown as PlayRequest;
    const stalled = vi.fn();
    const failover = createFailover({ enabled: () => true, request: () => request, position: () => undefined, switchTo: vi.fn(), stalled });
    failover.opening();
    failover.waiting();
    failover.started();
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS - 1);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stalled).toHaveBeenCalledTimes(1);
    // Playing on, then stalling again right away: counted once, until it has played smoothly a while.
    failover.status(true, false, false);
    failover.status(true, true, false);
    vi.advanceTimersByTime(STALL_MS);
    expect(stalled).toHaveBeenCalledTimes(1);
    failover.stop();
  });

  it('leaves live TV and files from this PC alone', () => {
    for (const extra of [{ live: true }, { local: true }]) {
      const { failover, switchTo } = setup(extra);
      failover.opening();
      failover.waiting();
      vi.advanceTimersByTime(SLOW_MS * 2);
      expect(switchTo).not.toHaveBeenCalled();
      failover.stop();
    }
  });
});

describe('a source that failed and then showed a frame', () => {
  it('stays failed: a debrid placeholder with nowhere to switch to is not marked as played when its clip starts', () => {
    const { failover } = setup({}, false);
    failover.opening();
    failover.waiting();
    // Its length comes before its first frame: index.ts finds a placeholder and fails it, and the error stays up.
    expect(failover.recover('placeholder')).toBe(false);
    failover.started();
    expect(markPlayed).not.toHaveBeenCalled();
    // The next file is a fresh one: its first frame counts again.
    failover.opening();
    failover.waiting();
    failover.started();
    expect(markPlayed).toHaveBeenCalledTimes(1);
    failover.stop();
  });
});
