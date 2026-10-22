import { expect, it, vi } from 'vitest';
import type { Title } from '../catalog/titles';
import { snapshot } from './snapshot';

const TITLES = 2000;
const EPISODES = 20;
const now = Date.now();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd !== 'watch_list') return undefined;
    const titles = [];
    const progress = [];
    for (let i = 0; i < TITLES; i++) {
      const id = `tt${i}`;
      const title: Title = { id, type: 'series', name: `Show ${i}`, genres: [], origins: [] };
      titles.push({ titleId: id, title: snapshot(title), next: null, completed: false, updatedAt: now - i * 1000 });
      // The newest episode is the one part-way through.
      for (let e = 1; e <= EPISODES; e++) progress.push({ videoId: `${id}:1:${e}`, titleId: id, season: 1, episode: e, position: e === EPISODES ? 600 : 1500, duration: 1500, watched: e !== EPISODES, updatedAt: now - i * 1000 - (EPISODES - e) });
    }
    return { titles, progress };
  }),
}));

const { continueWatching, loadWatch } = await import('./watch');

// My Library works out Continue Watching several times per redraw: a long watch history must not make that slow.
it('works out Continue Watching for a large history quickly', async () => {
  await loadWatch();
  const started = performance.now();
  const entries = continueWatching(now);
  const took = performance.now() - started;
  expect(entries).toHaveLength(TITLES);
  expect(entries[0]).toEqual(expect.objectContaining({ sub: expect.stringContaining('20') }));
  // One pass takes tens of ms; the old per-title scan took ~1.8 s idle. The bound sits well between
  // the two, since a busy machine (parallel test files, builds) slows the linear pass several-fold too.
  expect(took).toBeLessThan(1000);
});
