import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadMeta } from '../catalog/service';
import type { Episode, Title } from '../catalog/titles';

// Whether a pull has succeeded is module state, so every test starts from fresh modules (mocks are kept).
const mocked = vi.mocked(invoke);
const meta = vi.mocked(loadMeta);
const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3)] }] };
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

async function fresh() {
  vi.resetModules();
  const watch = await import('./watch');
  const sync = await import('./stremio-sync');
  await watch.loadWatch();
  return { watch, sync };
}

beforeEach(() => {
  mocked.mockReset();
  meta.mockReset();
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Stremio sync timing', () => {
  it('what was watched before the first pull went through is sent once it does', async () => {
    let online = false;
    const pushed: string[] = [];
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'profile_setting' || cmd === 'settings_get') return null;
      if (cmd === 'stremio_library_pull') {
        if (!online) throw new Error('err.stremio.unreachable');
        return [];
      }
      if (cmd === 'stremio_library_push') pushed.push(...(args as { patches: { id: string }[] }).patches.map((p) => p.id));
      return 0;
    });
    const { watch, sync } = await fresh();
    // Orbit starts offline: the pull fails.
    await sync.startStremioSync();
    watch.recordProgress(movie, undefined, 1800, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushed).toEqual([]);
    // Back online, "Sync now": the film watched meanwhile reaches Stremio.
    online = true;
    await sync.syncNow();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushed).toEqual(['tt1']);
  });

  it('started offline, the next watch save once the connection is back syncs without "Sync now"', async () => {
    let online = false;
    const pushed: string[] = [];
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'profile_setting' || cmd === 'settings_get') return null;
      if (cmd === 'stremio_library_pull') {
        if (!online) throw new Error('err.stremio.unreachable');
        return [];
      }
      if (cmd === 'stremio_library_push') pushed.push(...(args as { patches: { id: string }[] }).patches.map((p) => p.id));
      return 0;
    });
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    online = true;
    // A while later, a film is watched: Orbit asks Stremio again rather than hold it until a restart.
    await vi.advanceTimersByTimeAsync(120_000);
    watch.recordProgress(movie, undefined, 1800, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushed).toEqual(['tt1']);
  });

  it('a Stremio time in the future (another device’s clock ahead) is brought in once, not on every pull', async () => {
    // Watched on a phone whose clock runs an hour ahead.
    const lastWatched = new Date(Date.now() + 3_600_000).toISOString();
    const remote = { _id: 'tt1', type: 'movie', name: 'Film', poster: null, state: { lastWatched, timeOffset: 1_800_000, duration: 6_000_000, video_id: null, timesWatched: 0, watched: null } };
    let online = true;
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_pull') return [remote];
      if (cmd === 'stremio_library_push' && !online) throw new Error('err.stremio.unreachable');
      return cmd === 'stremio_library_push' ? 0 : undefined;
    });
    const { watch, sync } = await fresh();
    expect(await sync.syncNow()).toBe(1);
    // Watched on here, offline, so Stremio still has the phone's time.
    online = false;
    await vi.advanceTimersByTimeAsync(60_000);
    watch.recordProgress(movie, undefined, 3000, 6000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await sync.syncNow()).toBe(0);
    expect(watch.watchRecord('tt1')!.rows[0]!.position).toBe(3000);
  });

  it('a send still under way when the next is due is waited for, so an older one can’t land last', async () => {
    const sent: number[] = [];
    let answer: (() => void) | undefined;
    mocked.mockImplementation((cmd, args) => {
      if (cmd === 'watch_list') return Promise.resolve({ titles: [], progress: [] });
      if (cmd === 'stremio_library_pull') return Promise.resolve([]);
      if (cmd === 'stremio_library_push') {
        sent.push((args as { patches: { timeOffset: number }[] }).patches[0]!.timeOffset);
        return new Promise((resolve) => (answer = () => resolve(0)));
      }
      return Promise.resolve(undefined);
    });
    const { watch, sync } = await fresh();
    await sync.startStremioSync();
    watch.recordProgress(movie, undefined, 600, 6000);
    await vi.advanceTimersByTimeAsync(15_000);
    // Stremio is slow to answer; meanwhile the film plays on and the next send comes due.
    watch.recordProgress(movie, undefined, 1200, 6000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toEqual([600_000]);
    answer!();
    await vi.waitFor(() => expect(sent).toEqual([600_000, 1_200_000]));
  });

  it('progress made while a pull looks a series up isn’t overwritten by Stremio’s older state', async () => {
    let found!: (title: Title) => void;
    meta.mockImplementation(() => new Promise((resolve) => (found = resolve)));
    const lastWatched = new Date(Date.now() - 60_000).toISOString();
    const remote = { _id: 'tt9', type: 'series', name: 'Show', poster: null, state: { lastWatched, timeOffset: 120_000, duration: 2_400_000, video_id: 'tt9:1:2', timesWatched: 0, watched: null } };
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_pull') return [remote];
      return undefined;
    });
    const { watch, sync } = await fresh();
    const pull = sync.syncNow();
    await vi.waitFor(() => expect(meta).toHaveBeenCalled());
    // Meanwhile the person plays episode 2 further along.
    vi.advanceTimersByTime(1000);
    watch.recordProgress(show, { season: 1, episode: ep(2) }, 900, 2400);
    const before = watch.watchRecord('tt9')!.updatedAt;
    found(show);
    await pull;
    const record = watch.watchRecord('tt9')!;
    expect(record.rows.find((r) => r.videoId === 'tt9:1:2')?.position).toBe(900);
    expect(record.updatedAt).toBe(before);
  });

  it('a poster on this machine or the LAN is left out of what a pull brings in', async () => {
    const lastWatched = new Date(Date.now() - 60_000).toISOString();
    const item = (id: string, poster: string) => ({ _id: id, type: 'movie', name: 'Film', poster, state: { lastWatched, timeOffset: 1_800_000, duration: 6_000_000, video_id: null, timesWatched: 0, watched: null } });
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'stremio_library_pull') return [item('tt1', 'https://192.168.1.1/cgi-bin/x.jpg'), item('tt2', 'https://img.example/p.jpg')];
      return cmd === 'stremio_library_push' ? 0 : undefined;
    });
    const { watch, sync } = await fresh();
    expect(await sync.syncNow()).toBe(2);
    expect(watch.watchRecord('tt1')?.title.poster).toBeUndefined();
    expect(watch.watchRecord('tt2')?.title.poster).toBe('https://img.example/p.jpg');
  });
});
