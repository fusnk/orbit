import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../catalog/titles';
import { continueWatching, episodeState, isWatched, loadWatch, recordProgress, setEpisodesWatched } from './watch';

const mocked = vi.mocked(invoke);
const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
// Two parts an addon lists under one episode number (seasonsFrom keeps both: they have different names).
const part1: Episode = { id: 'tt9:1:5a', number: 5, title: 'Finale, Part 1' };
const part2: Episode = { id: 'tt9:1:5b', number: 5, title: 'Finale, Part 2' };
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(4), part1, part2, ep(6)] }] };

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
  await loadWatch();
});

describe('two parts under one episode number', () => {
  it('goes on to Part 2 after Part 1, then to the episode after Part 2', () => {
    recordProgress(show, { season: 1, episode: part1 }, 1500, 1600);
    expect(episodeState(show, 1, part2).kind).not.toBe('watched');
    recordProgress(show, { season: 1, episode: part2 }, 1500, 1600);
    // Not Part 2 (just watched) as the next episode: E6 is.
    expect(episodeState(show, 1, ep(6)).kind).toBe('up-next');
    expect(isWatched(show)).toBe(false);
    expect(continueWatching()[0]).toMatchObject({ badge: 'Next episode', sub: 'S1 · E6 · Episode 6' });
  });

  it('marking Part 2 watched moves on to the episode after it, not back onto Part 2 or to the end', () => {
    const part2a: Episode = { ...part1, number: 2 };
    const part2b: Episode = { ...part2, number: 2 };
    const parts: Title = { ...show, seasons: [{ number: 1, episodes: [ep(1), part2a, part2b, ep(3), ep(4)] }] };
    setEpisodesWatched(parts, [{ season: 1, episode: part2a }], true);
    expect(episodeState(parts, 1, part2b).kind).toBe('up-next');
    setEpisodesWatched(parts, [{ season: 1, episode: part2b }], true);
    expect(episodeState(parts, 1, ep(3)).kind).toBe('up-next');
    expect(isWatched(parts)).toBe(false);
    expect(continueWatching()[0]).toMatchObject({ badge: 'Next episode', sub: 'S1 · E3 · Episode 3' });
    // Unmarking E3 after both parts: what's next is E3 again, worked out from Part 2 as the last one seen.
    setEpisodesWatched(parts, [{ season: 1, episode: ep(3) }], true);
    setEpisodesWatched(parts, [{ season: 1, episode: ep(3) }], false);
    expect(episodeState(parts, 1, ep(3)).kind).toBe('up-next');
  });
});
