import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { arcIndexOf, arcsFor, ratingHeat, seasonRatings, storyArcs } from './episode-extras';
import type { Season } from './titles';

const episode = (number: number) => ({ id: `tt1:1:${number}`, number, title: `Episode ${number}` });
const show: Season[] = [
  { number: 1, episodes: [1, 2, 3, 4].map(episode) },
  { number: 2, episodes: [1, 2].map(episode) },
];

describe('episode extras', () => {
  beforeEach(() => invoke.mockReset());

  it('reads and keeps a season’s ratings', async () => {
    invoke.mockResolvedValue([{ episode: 1, rating: 8.2, votes: 171 }, { episode: 6, rating: 7.65, votes: 5 }]);
    const ratings = await seasonRatings({ id: 'tt0903747', type: 'series' }, 1);
    expect(ratings?.get(1)).toEqual({ rating: 8.2, votes: 171 });
    await seasonRatings({ id: 'tt0903747', type: 'series' }, 1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('tmdb_season_ratings', { imdbId: 'tt0903747', season: 1 });
  });

  it('keeps a bounded number of seasons over a long session, letting the oldest go', async () => {
    invoke.mockResolvedValue([]);
    for (let i = 1; i <= 1000; i++) await seasonRatings({ id: `tt9${i}`, type: 'series' }, 1);
    expect(invoke).toHaveBeenCalledTimes(1000);
    await seasonRatings({ id: 'tt91000', type: 'series' }, 1);
    expect(invoke).toHaveBeenCalledTimes(1000);
    await seasonRatings({ id: 'tt91', type: 'series' }, 1);
    expect(invoke).toHaveBeenCalledTimes(1001);
  });

  it('asks again after a failure, and never for movies or other ids', async () => {
    invoke.mockRejectedValueOnce('offline').mockResolvedValueOnce(null);
    expect(await seasonRatings({ id: 'tt1', type: 'series' }, 2)).toBeNull();
    expect(await seasonRatings({ id: 'tt1', type: 'series' }, 2)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(await seasonRatings({ id: 'tt1', type: 'movie' }, 1)).toBeNull();
    expect(await storyArcs({ id: 'kitsu:1', type: 'series' })).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('refuses ratings out of range', async () => {
    invoke.mockResolvedValue([{ episode: 1, rating: 42, votes: 3 }]);
    expect(await seasonRatings({ id: 'tt2', type: 'series' }, 1)).toBeNull();
  });

  it('colours ratings', () => {
    expect([9.1, 8, 7.9, 6.5, 6.4].map(ratingHeat)).toEqual(['high', 'high', 'mid', 'mid', 'low']);
  });

  it('matches arcs to the show’s own episodes', () => {
    const arcs = arcsFor(
      [
        { name: 'Romance Dawn', episodes: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] },
        { name: 'Orange Town', episodes: [{ season: 1, episode: 3 }, { season: 1, episode: 4 }, { season: 2, episode: 1 }, { season: 9, episode: 9 }] },
        { name: 'Elsewhere', episodes: [{ season: 7, episode: 1 }] },
      ],
      show,
    );
    expect(arcs?.map((a) => [a.name, a.episodes.map((e) => `${e.season}x${e.episode.number}`)])).toEqual([
      ['Romance Dawn', ['1x1', '1x2']],
      ['Orange Town', ['1x3', '1x4', '2x1']],
    ]);
    expect(arcIndexOf(arcs!, 2, 1)).toBe(1);
    expect(arcIndexOf(arcs!, 2, 2)).toBe(-1);
  });

  it('offers no arcs when the numbering doesn’t line up', () => {
    // TMDB numbers this show's episodes as one long season; the addon by seasons.
    const absolute = [{ name: 'A', episodes: Array.from({ length: 15 }, (_, n) => ({ season: 1, episode: n + 11 })) }, { name: 'B', episodes: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] }];
    expect(arcsFor(absolute, show)).toBeNull();
    expect(arcsFor([{ name: 'Only', episodes: [{ season: 1, episode: 1 }] }], show)).toBeNull();
  });

  it('falls back to the order episodes aired in when TMDB numbers them differently', () => {
    // TMDB: one long season (6 episodes) plus a special; the addon: three seasons of 2.
    const arcs = arcsFor(
      [
        { name: 'Romance Dawn', episodes: [{ season: 1, episode: 1 }, { season: 0, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }] },
        { name: 'Orange Town', episodes: [{ season: 1, episode: 4 }, { season: 1, episode: 5 }, { season: 1, episode: 6 }] },
      ],
      [0, 3, 1, 2].map((number) => ({ number, episodes: (number ? [1, 2] : [1]).map(episode) })),
    );
    expect(arcs?.map((a) => [a.name, a.episodes.map((e) => `${e.season}x${e.episode.number}`)])).toEqual([
      ['Romance Dawn', ['1x1', '1x2', '2x1']],
      ['Orange Town', ['2x2', '3x1', '3x2']],
    ]);
  });
});
