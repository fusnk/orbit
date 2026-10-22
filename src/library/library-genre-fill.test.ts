import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('./profiles', () => ({ activeProfileId: () => Promise.resolve('main') }));

import { invoke } from '@tauri-apps/api/core';
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { fillGenresInBatches, fillLibraryGenres, genresKnown, type BatchFillDeps } from './genre-fill';
import { libraryEntries, loadLibrary } from './library';

const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...extra });

describe('genresKnown', () => {
  const titles = (withGenres: number, without: number) => [...Array.from({ length: withGenres }, (_, i) => title(`g${i}`, { genres: ['Drama'] })), ...Array.from({ length: without }, (_, i) => title(`n${i}`))];

  it('needs at least 60% of the titles to have genres', () => {
    expect(genresKnown(titles(2, 141))).toBe(false);
    expect(genresKnown(titles(5, 4))).toBe(false);
    expect(genresKnown(titles(6, 4))).toBe(true);
    expect(genresKnown([])).toBe(false);
  });

  it('leaves out files and channels, which never get genres', () => {
    const others = [title('local:a.mkv'), title('tv', { type: 'channel' }), title('local:b.mkv')];
    expect(genresKnown([...titles(3, 2), ...others])).toBe(true);
  });
});

describe('fillGenresInBatches', () => {
  function deps(overrides: Partial<BatchFillDeps> = {}) {
    let active = 0;
    const events: string[] = [];
    const state = { peak: 0, events };
    const load = vi.fn(async (_type: string, id: string) => {
      events.push(`load ${id}`);
      active++;
      state.peak = Math.max(state.peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return id === 'unknown' ? null : title(id, { genres: ['Drama'] });
    });
    const save = vi.fn((found: ReadonlyMap<string, string[]>) => {
      events.push(`save ${[...found.keys()].join(',')}`);
    });
    const idle = vi.fn(async () => {
      events.push('idle');
    });
    const d: BatchFillDeps = { load, save, idle, tried: new Set(), concurrency: 2, signal: new AbortController().signal, ...overrides };
    return { d, load, save, idle, state };
  }

  it('looks titles up a batch at a time, each after idle time, saving each batch as it comes', async () => {
    const { d, load, idle, state } = deps();
    await fillGenresInBatches(['a', 'b', 'c', 'unknown', 'e'].map((id) => title(id)), d);
    expect(state.peak).toBe(2);
    expect(idle).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenCalledTimes(5);
    expect(state.events.filter((e) => e === 'idle' || e.startsWith('save'))).toEqual(['idle', 'save a,b', 'idle', 'save c', 'idle', 'save e']);
  });

  it('stops before the next batch once aborted', async () => {
    const controller = new AbortController();
    const { d, load, save } = deps({ signal: controller.signal });
    save.mockImplementation(() => controller.abort());
    await fillGenresInBatches(['a', 'b', 'c', 'd'].map((id) => title(id)), d);
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips titles already tried', async () => {
    const { d, load } = deps({ tried: new Set(['a', 'b']) });
    await fillGenresInBatches(['a', 'b', 'c'].map((id) => title(id)), d);
    expect(load.mock.calls.map(([, id]) => id)).toEqual(['c']);
  });
});

describe('fillLibraryGenres', () => {
  const mocked = vi.mocked(invoke);
  const meta = vi.mocked(loadMeta);
  const row = (id: string, addedAt: number, genres?: string[]) => ({ id, addedAt, title: { meta: { id, type: 'movie', name: id, ...(genres ? { genres } : {}) }, origins: [] } });

  beforeEach(async () => {
    mocked.mockReset();
    meta.mockReset();
    mocked.mockResolvedValueOnce([row('tt1', 1), row('tt2', 2, ['Comedy']), row('tt3', 3)]);
    await loadLibrary();
    mocked.mockResolvedValue(undefined);
  });

  it('saves what it finds with each title, once for good', async () => {
    meta.mockImplementation(async (_type, id) => (id === 'tt3' ? title(id, { genres: ['Drama', 'Crime'] }) : null));
    const onFound = vi.fn();
    await fillLibraryGenres(new AbortController().signal, onFound);
    // The one already with genres isn't asked about; the newest is asked first.
    expect(meta.mock.calls.map(([, id]) => id)).toEqual(['tt3', 'tt1']);
    expect(onFound).toHaveBeenCalledTimes(1);
    const saved = libraryEntries().find((e) => e.title.id === 'tt3')!;
    expect(saved.title.genres).toEqual(['Drama', 'Crime']);
    expect(saved.addedAt).toBe(3);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('library_add', { id: 'tt3', profile: 'main', title: expect.objectContaining({ meta: expect.objectContaining({ genres: ['Drama', 'Crime'] }) }) }));
    expect(mocked.mock.calls.filter(([command]) => command === 'library_add')).toHaveLength(1);

    // The next visit asks about nothing: one found is saved, one unknown was tried this session.
    meta.mockClear();
    await fillLibraryGenres(new AbortController().signal, onFound);
    expect(meta).not.toHaveBeenCalled();
  });
});
