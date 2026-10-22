import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';

const mocked = vi.mocked(invoke);
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

/** Fresh modules for each test: whether a pull went through, and what was unmarked, are module state. */
async function fresh() {
  vi.resetModules();
  const watch = await import('./watch');
  const sync = await import('./stremio-sync');
  await watch.loadWatch();
  return { watch, sync };
}

/** The movie's `watched` in each push, in order. */
const sentWatched = () =>
  mocked.mock.calls.filter(([cmd]) => cmd === 'stremio_library_push').map(([, args]) => (args as { patches: { id: string; watched: unknown }[] }).patches.find((p) => p.id === 'tt1')?.watched);

beforeAll(() => import('./stremio-sync'), 60_000);
beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => {
    if (cmd === 'watch_list') return { titles: [], progress: [] };
    if (cmd === 'stremio_library_pull') return [];
    return cmd === 'stremio_library_push' ? 0 : undefined;
  });
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('a movie’s watched mark in Stremio', () => {
  it('isn’t wiped by a movie merely not finished here (it may have been finished on another device)', async () => {
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    watch.recordProgress(movie, undefined, 1800, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    // null: Rust leaves Stremio's timesWatched and flaggedWatched as they are.
    expect(sentWatched()).toEqual([null]);
  });

  it('is cleared by "Mark unwatched" here, and only by the push that carries it', async () => {
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    watch.setWatched(movie, true);
    await vi.advanceTimersByTimeAsync(20_000);
    watch.setWatched(movie, false);
    await vi.advanceTimersByTimeAsync(20_000);
    // Played a little afterwards: no longer an unmark, so Stremio keeps whatever it has by then.
    watch.recordProgress(movie, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sentWatched()).toEqual([true, false, null]);
  });

  it('is cleared when the movie is played a little after "Mark unwatched", before the push goes out', async () => {
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    watch.setWatched(movie, false);
    watch.recordProgress(movie, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sentWatched()).toEqual([false]);
  });
});
