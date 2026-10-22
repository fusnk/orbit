import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';

const mocked = vi.mocked(invoke);
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

/** Fresh modules for each test: whether a pull went through, and the setting, are module state. */
async function fresh() {
  vi.resetModules();
  const watch = await import('./watch');
  const sync = await import('./stremio-sync');
  await watch.loadWatch();
  return { watch, sync };
}

const pushes = () => mocked.mock.calls.filter(([cmd]) => cmd === 'stremio_library_push');

// The first import transforms the whole module graph, which takes seconds on a loaded machine:
// done once here so no test's own timeout pays for it.
beforeAll(() => import('./stremio-sync'), 60_000);
beforeEach(() => {
  mocked.mockReset();
  vi.mocked(toast).mockReset();
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('turning Stremio sync off', () => {
  it('a change waiting to be sent isn’t sent once sync is off', async () => {
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_pull') return [];
      return cmd === 'stremio_library_push' ? 0 : undefined;
    });
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    watch.recordProgress(movie, undefined, 1800, 6000);
    await sync.setSyncEnabled(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushes()).toEqual([]);
  });

  it('turned on again, Orbit catches up with Stremio before sending anything', async () => {
    const order: string[] = [];
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_pull' || cmd === 'stremio_library_push') order.push(cmd);
      if (cmd === 'stremio_library_pull') return [];
      return cmd === 'stremio_library_push' ? 0 : undefined;
    });
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    await sync.setSyncEnabled(false);
    // Stremio may have moved on meanwhile (another device): it's asked again first.
    await sync.setSyncEnabled(true);
    watch.recordProgress(movie, undefined, 1800, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(order).toEqual(['stremio_library_pull', 'stremio_library_pull', 'stremio_library_push']);
  });

  it('a pull that answers after sync was turned off brings nothing in', async () => {
    let answer!: (items: unknown[]) => void;
    const lastWatched = new Date(Date.now() - 60_000).toISOString();
    mocked.mockImplementation((cmd) => {
      if (cmd === 'watch_list') return Promise.resolve({ titles: [], progress: [] });
      if (cmd === 'stremio_library_pull') return new Promise((resolve) => (answer = resolve));
      return Promise.resolve(undefined);
    });
    const { watch, sync } = await fresh();
    const pull = sync.syncNow();
    await sync.setSyncEnabled(false);
    answer([{ _id: 'tt1', type: 'movie', name: 'Film', poster: null, state: { lastWatched, timeOffset: 1_800_000, duration: 6_000_000, video_id: null, timesWatched: 0, watched: null } }]);
    expect(await pull).toBe(0);
    expect(watch.watchRecord('tt1')).toBeUndefined();
  });
});
