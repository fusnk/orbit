import { describe, expect, it } from 'vitest';
import type { Season } from '../../catalog/titles';
import type { ArcView } from '../../catalog/episode-extras';
import { findEpisode, jumpTarget, parseEpisodeQuery } from './episode-jump';

const season = (number: number, count: number): Season => ({ number, episodes: Array.from({ length: count }, (_, i) => ({ id: `x:${number}:${i + 1}`, number: i + 1, title: '' })) });

describe('parseEpisodeQuery', () => {
  it('reads an episode number alone', () => {
    expect(parseEpisodeQuery('742')).toEqual({ episode: 742 });
    expect(parseEpisodeQuery(' e12 ')).toEqual({ episode: 12 });
    expect(parseEpisodeQuery('#3')).toEqual({ episode: 3 });
  });

  it('reads a season and episode however they are written', () => {
    for (const text of ['S2E5', 's2 e5', '2x5', '2.5', 'S02E05', 's2:5', '2-5']) expect(parseEpisodeQuery(text), text).toEqual({ season: 2, episode: 5 });
  });

  it('leaves anything else', () => {
    for (const text of ['', 'pilot', 'S2', '2 5 6', 'e', '1234567']) expect(parseEpisodeQuery(text), text).toBeNull();
  });
});

describe('findEpisode', () => {
  const seasons = [season(0, 2), season(1, 10), season(2, 8)];

  it('finds a numbered episode in the season on screen first', () => {
    expect(findEpisode(seasons, { episode: 3 }, 2)).toEqual({ season: 2, episode: 3 });
    expect(findEpisode(seasons, { episode: 9 }, 2)).toEqual({ season: 1, episode: 9 });
  });

  it('keeps to the season asked for', () => {
    expect(findEpisode(seasons, { season: 1, episode: 4 }, 2)).toEqual({ season: 1, episode: 4 });
    expect(findEpisode(seasons, { season: 2, episode: 9 })).toBeNull();
    expect(findEpisode(seasons, { season: 7, episode: 1 })).toBeNull();
  });

  it('counts through the seasons when no season has that number (a long anime numbered by season)', () => {
    // Season 1 has 10, so the 13th episode is season 2's third; specials don't count.
    expect(findEpisode(seasons, { episode: 13 }, 1)).toEqual({ season: 2, episode: 3 });
    expect(findEpisode(seasons, { episode: 18 })).toEqual({ season: 2, episode: 8 });
    expect(findEpisode(seasons, { episode: 19 })).toBeNull();
    // The number as listed still wins over the count.
    expect(findEpisode(seasons, { episode: 8 }, 1)).toEqual({ season: 1, episode: 8 });
  });

  it('looks in specials last', () => {
    expect(findEpisode(seasons, { episode: 1 })).toEqual({ season: 1, episode: 1 });
    expect(findEpisode([season(0, 2)], { episode: 2 })).toEqual({ season: 0, episode: 2 });
  });
});

describe('jumpTarget', () => {
  const s1 = season(1, 4);
  const arc = (name: string, from: number, to: number): ArcView => ({ name, episodes: s1.episodes.slice(from - 1, to).map((episode) => ({ season: 1, episode })) });
  const arcs = [arc('Opening', 1, 2), arc('Finale', 3, 3)];

  it('opens the arc holding the episode', () => {
    expect(jumpTarget(arcs, { season: 1, episode: 3 })).toEqual({ arc: 1 });
  });

  it('goes to its season when no arc holds it, rather than the first arc', () => {
    expect(jumpTarget(arcs, { season: 1, episode: 4 })).toEqual({ season: 1 });
    expect(jumpTarget(arcs, { season: 0, episode: 1 })).toEqual({ season: 0 });
  });

  it('goes to its season when listed by season', () => {
    expect(jumpTarget(null, { season: 1, episode: 3 })).toEqual({ season: 1 });
  });
});
