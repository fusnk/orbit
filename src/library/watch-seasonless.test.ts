import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../catalog/titles';
import { continueWatching, episodeState, isWatched, loadWatch, recordProgress, watchedTitles } from './watch';

const mocked = vi.mocked(invoke);
const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3)] }] };
// What a download keeps of its show (a snapshot: no episode list), and what the player gets from the Downloads page.
const kept: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [] };

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
  await loadWatch();
});

describe('finishing an episode played without its episode list (a download)', () => {
  it("marks the episode watched but doesn't call the show finished", () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    recordProgress(kept, { season: 1, episode: ep(2) }, 1500, 1600);
    expect(episodeState(show, 1, ep(2)).kind).toBe('watched');
    expect(isWatched(show)).toBe(false);
    expect(watchedTitles()).toEqual([]);
  });

  it('keeps what was up next when that was another episode', () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    // E2 is up next; a downloaded E3 is watched first.
    recordProgress(kept, { season: 1, episode: ep(3) }, 1500, 1600);
    expect(episodeState(show, 1, ep(2)).kind).toBe('up-next');
    expect(continueWatching()[0]).toMatchObject({ sub: 'S1 · E2 · Episode 2' });
  });
});
