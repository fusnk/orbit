import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../catalog/titles';

const calls: { command: string; args: Record<string, unknown> }[] = [];
let stored: unknown[] = [];
let failNext = false;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (failNext) {
      failNext = false;
      throw new Error('database unavailable');
    }
    return command === 'favourite_episode_all' ? stored : undefined;
  },
}));
const toasts: string[] = [];
vi.mock('../components/toast', () => ({ toast: (text: string) => toasts.push(text) }));

import { favouriteEpisodes, groupByShow, isFavouriteEpisode, loadFavouriteEpisodes, toggleFavouriteEpisode, type FavouriteEpisode } from './favourite-episodes';

const show = (id: string, name = 'Show'): Title => ({ id, type: 'series', name, genres: [], origins: [] }) as unknown as Title;
const episode = (number: number, extra: Partial<Episode> = {}): Episode => ({ id: `tt1:1:${number}`, number, title: `Episode ${number}`, ...extra });
const row = (seriesId: string, season: number, number: number, addedAt: number, extra: Record<string, unknown> = {}) => ({
  seriesId,
  season,
  episode: number,
  videoId: `${seriesId}:${season}:${number}`,
  title: 'Pilot',
  still: 'https://img.example/s.jpg',
  show: { meta: { id: seriesId, type: 'series', name: 'Show' } },
  addedAt,
  ...extra,
});

beforeEach(async () => {
  calls.length = 0;
  toasts.length = 0;
  stored = [];
  await loadFavouriteEpisodes();
});

describe('favourite episodes', () => {
  it('reads stored rows, skipping ones that no longer validate', async () => {
    stored = [row('tt1', 1, 2, 5), row('tt2', 1, 1, 9), row('tt3', 1, 1, 1, { still: 'http://img.example/s.jpg' }), row('tt4', 1, 1, 1, { show: 'nope' }), row('tt5', -1, 1, 1)];
    await loadFavouriteEpisodes();
    // An http still is dropped (not the row); a broken show or number drops the row.
    expect(favouriteEpisodes().map((f) => [f.show.id, f.season, f.episode, f.still])).toEqual([
      ['tt2', 1, 1, 'https://img.example/s.jpg'],
      ['tt1', 1, 2, 'https://img.example/s.jpg'],
      ['tt3', 1, 1, undefined],
    ]);
    expect(isFavouriteEpisode('tt1', 1, 2)).toBe(true);
    expect(isFavouriteEpisode('tt1', 2, 1)).toBe(false);
  });

  it('adds and removes, sending only what Rust keeps', async () => {
    expect(await toggleFavouriteEpisode(show('tt1'), 1, episode(3, { title: ' Two\nlines ', thumbnail: 'http://img.example/a.jpg' }))).toBe(true);
    expect(isFavouriteEpisode('tt1', 1, 3)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ command: 'favourite_episode_add', args: { seriesId: 'tt1', season: 1, episode: 3, videoId: 'tt1:1:3', title: 'Two lines', still: null } });
    expect(await toggleFavouriteEpisode(show('tt1'), 1, episode(3))).toBe(true);
    expect(isFavouriteEpisode('tt1', 1, 3)).toBe(false);
    expect(calls.at(-1)).toMatchObject({ command: 'favourite_episode_remove', args: { seriesId: 'tt1', season: 1, episode: 3 } });
  });

  it('undoes a change that could not be saved, and says so', async () => {
    failNext = true;
    expect(await toggleFavouriteEpisode(show('tt1'), 1, episode(1))).toBe(false);
    expect(isFavouriteEpisode('tt1', 1, 1)).toBe(false);
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
  });

  it('groups by show, the newest favourite first', () => {
    const fav = (id: string, number: number, addedAt: number): FavouriteEpisode => ({ show: show(id, id), season: 1, episode: number, videoId: `${id}:${number}`, name: '', still: undefined, addedAt });
    const groups = groupByShow([fav('a', 1, 1), fav('b', 1, 5), fav('a', 2, 9), fav('b', 2, 3)]);
    expect(groups.map((g) => [g.show.id, g.episodes.map((e) => e.episode)])).toEqual([
      ['a', [2, 1]],
      ['b', [1, 2]],
    ]);
  });
});
