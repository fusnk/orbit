import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';

const mocked = vi.mocked(invoke);

/** In the database: a film finished in Orbit (e.g. brought in from Trakt), never sent to Stremio. */
const saved = {
  titles: [{ titleId: 'tt1', title: { v: 1, meta: { id: 'tt1', type: 'movie', name: 'Film' } }, next: null, completed: true, updatedAt: 1_700_000_000_000 }],
  progress: [{ videoId: 'tt1', titleId: 'tt1', season: null, episode: null, position: 0, duration: 6000, watched: true, updatedAt: 1_700_000_000_000 }],
};
/** Stremio: the same film, opened once long ago and left part way. */
const remote = [
  {
    _id: 'tt1',
    type: 'movie',
    name: 'Film',
    poster: null,
    state: { lastWatched: '2023-01-01T00:00:00.000Z', timeOffset: 600_000, duration: 6_000_000, video_id: 'tt1', timesWatched: 0, watched: null },
  },
];

function backend(readable: { value: boolean }) {
  const writes: string[] = [];
  const kept: unknown[] = [];
  mocked.mockImplementation(async (cmd, args) => {
    const a = args as { key?: string; value?: unknown } | undefined;
    if (cmd === 'watch_list') {
      if (!readable.value) throw new Error('database is locked');
      return saved;
    }
    if (cmd === 'watch_put_progress' || cmd === 'watch_put_title') writes.push(cmd);
    if (cmd === 'settings_get') return a?.key === 'stremio.pending' ? ['tt1'] : null;
    if (cmd === 'settings_set') {
      if (a?.key === 'stremio.pending') kept.push(a.value);
      return null;
    }
    if (cmd === 'stremio_library_pull') return remote;
    if (cmd === 'stremio_library_watched') return {};
    if (cmd === 'stremio_library_push') return 0;
    return null;
  });
  return { writes, kept };
}

beforeEach(() => {
  mocked.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Stremio sync while watch history could not be read', () => {
  it('neither overwrites the saved history nor forgets what was waiting to be sent', async () => {
    const readable = { value: false };
    const b = backend(readable);
    const watch = await import('./watch');
    const sync = await import('./stremio-sync');
    await watch.loadWatch().catch(() => {});
    expect(watch.watchLoadError()).not.toBeNull();

    void sync.startStremioSync();
    await vi.advanceTimersByTimeAsync(20_000);
    // Nothing is known here yet: Stremio's older state isn't written over the film finished in Orbit.
    expect(b.writes).toEqual([]);
    // And the film still waiting for Stremio stays kept for when history can be read.
    expect(b.kept).toEqual([]);

    // My Library's Try again reads it: sync starts then, and the finished film stays finished.
    readable.value = true;
    await watch.readWatch();
    await vi.advanceTimersByTimeAsync(20_000);
    await sync.flushStremioSync();
    expect(watch.watchRecord('tt1')?.rows[0]?.watched).toBe(true);
    expect(mocked.mock.calls.some(([cmd]) => cmd === 'stremio_library_push')).toBe(true);
  });
});
