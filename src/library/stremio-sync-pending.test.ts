import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadMeta } from '../catalog/service';
import type { Episode, Title } from '../catalog/titles';

// What's waiting to be sent is module state, so every test starts from fresh modules (mocks are kept).
const mocked = vi.mocked(invoke);
const meta = vi.mocked(loadMeta);
const ep = (number: number): Episode => ({
  id: `tt9:1:${number}`,
  number,
  title: `Episode ${number}`,
});
const show: Title = {
  id: 'tt9',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3)] }],
};
const movie: Title = {
  id: 'tt1',
  type: 'movie',
  name: 'Film',
  genres: [],
  origins: [],
};

async function fresh() {
  vi.resetModules();
  const watch = await import('./watch');
  const sync = await import('./stremio-sync');
  await watch.loadWatch();
  return { watch, sync };
}

/** A Stremio that answers (or not, while `online.value` is false), recording what's pushed and what's kept. */
function stremio(kept: unknown = null) {
  const online = { value: true };
  const pushed: string[] = [];
  const saved: unknown[] = [];
  mocked.mockImplementation(async (cmd, args) => {
    const a = args as { key?: string; value?: unknown; patches?: { id: string }[] } | undefined;
    if (cmd === 'watch_list') return { titles: [], progress: [] };
    if (cmd === 'settings_get') return a?.key === 'stremio.pending' ? kept : null;
    if (cmd === 'settings_set') {
      if (a?.key === 'stremio.pending') saved.push(a.value);
      return null;
    }
    if (cmd === 'stremio_library_pull') return [];
    if (cmd === 'stremio_library_watched') return {};
    if (cmd === 'stremio_library_push') {
      if (!online.value) throw new Error('err.stremio.unreachable');
      pushed.push(...(a?.patches ?? []).map((p) => p.id));
      return 0;
    }
    return null;
  });
  return { online, pushed, saved, lastSaved: () => saved.at(-1) };
}

beforeEach(() => {
  mocked.mockReset();
  meta.mockReset();
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('what is waiting for Stremio as Orbit quits', () => {
  it('is sent at once, not a few seconds later', async () => {
    const s = stremio();
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    watch.recordProgress(movie, undefined, 5800, 6000);
    await sync.flushStremioSync();
    expect(s.pushed).toEqual(['tt1']);
    // Sent: nothing is kept for the next start.
    expect(s.lastSaved()).toBeNull();
  });

  it('is kept when it can’t be sent, and sent after the next start’s pull', async () => {
    const s = stremio();
    s.online.value = false;
    const first = await fresh();
    await first.sync.startStremioSync();
    first.watch.recordProgress(movie, undefined, 5800, 6000);
    await first.sync.flushStremioSync();
    expect(s.pushed).toEqual([]);
    expect(s.lastSaved()).toEqual(['tt1']);

    // The next start, online: the film's history is there (from the database) and its change goes out.
    const next = stremio(['tt1']);
    const { watch, sync } = await fresh();
    watch.recordProgress(movie, undefined, 5800, 6000);
    await sync.startStremioSync();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(next.pushed).toEqual(['tt1']);
    expect(next.lastSaved()).toBeNull();
  });

  it('a kept series is sent with its episode list looked up again', async () => {
    const s = stremio(['tt9']);
    meta.mockResolvedValue(show);
    const { watch, sync } = await fresh();
    watch.recordProgress({ ...show, seasons: undefined }, { season: 1, episode: ep(2) }, 600, 1500);
    await sync.startStremioSync();
    await vi.advanceTimersByTimeAsync(20_000);
    // The watched field is written with real (not fake) async work: wait for the send to finish.
    await sync.flushStremioSync();
    expect(meta).toHaveBeenCalledWith('series', 'tt9');
    expect(s.pushed).toEqual(['tt9']);
  });

  it('a kept title with no history left here is dropped, not sent', async () => {
    const s = stremio(['tt404']);
    const { sync } = await fresh();
    await sync.startStremioSync();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.pushed).toEqual([]);
    expect(s.lastSaved()).toBeNull();
  });

  it('with sync off, nothing kept is sent', async () => {
    const s = stremio(['tt1']);
    mocked.mockImplementation(async (cmd, args) => {
      const key = (args as { key?: string } | undefined)?.key;
      if (cmd === 'settings_get') return key === 'stremio.sync' ? false : key === 'stremio.pending' ? ['tt1'] : null;
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_push') s.pushed.push('tt1');
      return null;
    });
    const { watch, sync } = await fresh();
    watch.recordProgress(movie, undefined, 5800, 6000);
    await sync.startStremioSync();
    await sync.flushStremioSync();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.pushed).toEqual([]);
  });
});

describe('a change made while what was kept is still being looked up', () => {
  it('is kept too when Orbit quits before the lookup ends', async () => {
    const s = stremio(['tt9']);
    // The kept series' episode list is slow to come (an addon timing out).
    let answer: (title: Title) => void = () => {};
    meta.mockReturnValue(new Promise<Title>((resolve) => (answer = resolve)));
    const { watch, sync } = await fresh();
    watch.recordProgress({ ...show, seasons: undefined }, { season: 1, episode: ep(2) }, 600, 1500);
    void sync.startStremioSync();
    await vi.advanceTimersByTimeAsync(0);
    // A film finished meanwhile, then Orbit quits.
    watch.recordProgress(movie, undefined, 5800, 6000);
    await sync.flushStremioSync();
    expect(s.lastSaved()).toEqual(expect.arrayContaining(['tt9', 'tt1']));
    answer(show);
  });
});

describe('the kept list', () => {
  it('takes title ids only, once each, and not too many', async () => {
    stremio();
    const { sync } = await fresh();
    expect(sync.keptIds(null)).toEqual([]);
    expect(sync.keptIds('tt1')).toEqual([]);
    expect(sync.keptIds(['tt1', 'tt1', 7, '', 'x'.repeat(201), 'tt2'])).toEqual(['tt1', 'tt2']);
    expect(sync.keptIds(Array.from({ length: 900 }, (_, i) => `tt${i}`))).toHaveLength(500);
  });
});
