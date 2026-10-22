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

describe('a Stremio session that ends while changes are being sent', () => {
  it('is said once, notes the account signed out, and stops trying until signed in again', async () => {
    let ended = false;
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_pull') return [];
      if (cmd === 'stremio_library_push') {
        if (ended) throw 'err.stremio.session-ended';
        return 0;
      }
      return undefined;
    });
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    expect(sync.stremioSyncState().signedIn).toBe(true);
    ended = true;
    watch.recordProgress(movie, undefined, 1800, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushes()).toHaveLength(1);
    expect(sync.stremioSyncState().signedIn).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
    // More watching meanwhile: nothing is sent to a session that's gone, and nothing more is said.
    watch.recordProgress(movie, undefined, 2400, 6000);
    await vi.advanceTimersByTimeAsync(120_000);
    watch.recordProgress(movie, undefined, 3000, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushes()).toHaveLength(1);
    expect(toast).toHaveBeenCalledTimes(1);
    // Signed in again (Settings pulls): what was waiting goes out.
    ended = false;
    sync.noteStremioAccount(true);
    await sync.syncNow();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushes()).toHaveLength(2);
  });
});
