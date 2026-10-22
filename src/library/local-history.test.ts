import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';
import { needingGenres } from './genre-fill';
import { computeStats } from './stats';
import { patchFor, syncable } from './stremio-sync';
import { continueWatching, historyRows, loadWatch, onWatchSaved, recentlyWatched, recordProgress, resumePosition, watchHistory, watchRecord } from './watch';

const mocked = vi.mocked(invoke);
const file: Title = { id: 'local:0123456789abcdef', type: 'movie', name: 'Holiday', genres: [], origins: [] };

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
  await loadWatch();
});

describe('files played from this PC', () => {
  it('resume where they were left', () => {
    recordProgress(file, undefined, 600, 3600);
    expect(resumePosition(file)).toBe(600);
  });

  it('save progress and their name only (for History), and tell nobody', async () => {
    const saved = vi.fn();
    const stop = onWatchSaved(saved);
    recordProgress({ ...file, poster: 'https://example.com/p.jpg', description: 'Notes' }, undefined, 600, 3600);
    stop();
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.anything()));
    expect(mocked).toHaveBeenCalledWith('watch_put_progress', expect.anything());
    const [, args] = mocked.mock.calls.find(([cmd]) => cmd === 'watch_put_title')!;
    expect((args as { title: { meta: Record<string, unknown> } }).title.meta).toMatchObject({ id: file.id, name: 'Holiday', poster: undefined, description: undefined });
    expect(saved).not.toHaveBeenCalled();
    expect(historyRows().map((r) => r.title.name)).toEqual(['Holiday']);
  });

  it('stay out of Continue Watching, recent titles and Stats', () => {
    recordProgress(file, undefined, 600, 3600);
    expect(continueWatching()).toEqual([]);
    expect(recentlyWatched()).toEqual([]);
    expect(watchRecord(file.id)).toBeUndefined();
    expect(watchHistory().progress).toEqual([]);
    const history = { titles: [], progress: [{ videoId: file.id, titleId: file.id, season: null, episode: null, position: 3600, duration: 3600, watched: true, updatedAt: Date.now() }] };
    expect(computeStats(history, 'all').movies).toBe(0);
  });

  it('a stray title row for one is ignored when history loads', async () => {
    mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [{ titleId: file.id, title: { id: file.id, type: 'movie', name: 'Holiday' }, next: null, completed: false, updatedAt: 1 }], progress: [] } : undefined));
    await loadWatch();
    expect(recentlyWatched()).toEqual([]);
  });

  it('are never synced with Stremio', async () => {
    expect(syncable(file)).toBe(false);
    expect(syncable({ id: 'tt1', type: 'movie' })).toBe(true);
    expect(syncable({ id: 'kitsu:1', type: 'series' })).toBe(true);
    expect(syncable({ id: 'tt1', type: 'channel' })).toBe(false);
    recordProgress(file, undefined, 600, 3600);
    expect(await patchFor(file)).toBeNull();
  });

  it('are never looked up for genres', () => {
    expect(needingGenres([{ title: file, updatedAt: 1 }], new Set(), 10)).toEqual([]);
  });
});
