import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { QueueItem } from '../../library/queue';
import { chooseUpNext } from './next-up';
import { pickShuffled, shuffleEpisodes, shufflePlayed, startShuffle } from './shuffle';

const episode = (season: number, number: number, airs?: string) => ({ id: `tt1:${season}:${number}`, number, title: `E${number}`, ...(airs ? { airs } : {}) });
const show: Title = {
  id: 'tt1',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [
    { number: 1, episodes: [episode(1, 1), episode(1, 2), episode(1, 3)] },
    { number: 2, episodes: [episode(2, 1), episode(2, 2, 'Airs Nov 4')] },
    { number: 0, episodes: [episode(0, 1)] },
  ],
};

/** A seeded generator, so a run is repeatable. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('shuffle', () => {
  it('draws from aired episodes only, leaving specials out by default', () => {
    expect(shuffleEpisodes(show).map((r) => r.episode.id)).toEqual(['tt1:1:1', 'tt1:1:2', 'tt1:1:3', 'tt1:2:1']);
    expect(shuffleEpisodes(show, true).map((r) => r.episode.id)).toContain('tt1:0:1');
  });

  it('plays every episode once before any repeats', () => {
    const random = seeded(7);
    const session = startShuffle(show.id);
    let current = 'tt1:1:2';
    const seen = [current];
    for (let i = 0; i < 3; i++) {
      shufflePlayed(session, show, current, random);
      current = session.next!.episode.id;
      seen.push(current);
    }
    expect(new Set(seen).size).toBe(4);
    // All four have played: a new round starts, without repeating the one just played.
    shufflePlayed(session, show, current, random);
    expect(session.next).toBeDefined();
    expect(session.next!.episode.id).not.toBe(current);
    expect([...session.played]).toEqual([current]);
  });

  it('never picks the episode playing now, and has nothing to offer for a single episode', () => {
    const episodes = shuffleEpisodes(show);
    for (const r of [0, 0.5, 0.999]) expect(pickShuffled(episodes, new Set(), 'tt1:1:1', () => r)?.ref.episode.id).not.toBe('tt1:1:1');
    expect(pickShuffled(episodes.slice(0, 1), new Set(), 'tt1:1:1')).toBeUndefined();
  });

  it('gives way to the queue', () => {
    const session = startShuffle(show.id);
    shufflePlayed(session, show, 'tt1:1:1', () => 0);
    const queued: QueueItem = { id: 'q', title: { id: 'tt2', type: 'movie', name: 'Film', genres: [], origins: [] }, episode: null, addedAt: 0 };
    expect(chooseUpNext(queued, session.next, {})).toEqual({ kind: 'queue', item: queued });
    expect(chooseUpNext(undefined, session.next, {})).toEqual({ kind: 'episode', episode: session.next });
  });
});
