import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { loadWatch, recordProgress } from './watch';

const mocked = vi.mocked(invoke);
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
let diskFull: boolean;

const putPositions = () =>
  mocked.mock.calls.filter(([cmd]) => cmd === 'watch_put_progress').map(([, args]) => (args as { rows: { position: number }[] }).rows[0]!.position);

beforeEach(async () => {
  vi.useFakeTimers();
  diskFull = false;
  mocked.mockReset();
  vi.mocked(toast).mockReset();
  mocked.mockImplementation(async (cmd) => {
    if (cmd === 'watch_list') return { titles: [], progress: [] };
    if (cmd === 'profile_active') return 'p1';
    if (cmd.startsWith('watch_put') && diskFull) throw new Error('disk full');
    return null;
  });
  await loadWatch();
});
afterEach(() => vi.useRealTimers());

describe('watch history writes that fail', () => {
  it('say so once, keep retrying the latest position, and say so again after a later failure', async () => {
    diskFull = true;
    recordProgress(movie, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(0);
    recordProgress(movie, undefined, 700, 6000);
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(1);

    // Still failing: retried on a timer, without a second notice.
    const before = putPositions().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(putPositions().length).toBeGreaterThan(before);
    expect(toast).toHaveBeenCalledTimes(1);

    diskFull = false;
    mocked.mockClear();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // Only the latest position is written again, not the stale one.
    expect(putPositions()).toEqual([700]);

    diskFull = true;
    recordProgress(movie, undefined, 800, 6000);
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
