import { describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../../catalog/titles';
import { fullShow } from './episode-list';

const episode = (number: number): Episode => ({ id: `tt1:2:${number}`, number, title: `Episode ${number}` });
const shell: Title = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [] };
const full: Title = { ...shell, seasons: [{ number: 2, episodes: [episode(14), episode(15)] }] };
const ref = { season: 2, episode: episode(14) };

describe('the show behind an episode the player was handed', () => {
  it('loads the full show when the episode came with a copy that has no episode list', async () => {
    const load = vi.fn(async () => full);
    expect(await fullShow({ title: shell, episode: ref }, load)).toBe(full);
    expect(load).toHaveBeenCalledWith('series', 'tt1');
  });

  it('leaves a show that has its episodes, and a film, as they are', async () => {
    const load = vi.fn(async () => full);
    expect(await fullShow({ title: full, episode: ref }, load)).toBeNull();
    expect(await fullShow({ title: { ...shell, type: 'movie' } }, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('gives nothing when the show can’t be loaded or has no episodes either', async () => {
    expect(await fullShow({ title: shell, episode: ref }, async () => null)).toBeNull();
    expect(await fullShow({ title: shell, episode: ref }, async () => shell)).toBeNull();
    expect(await fullShow({ title: shell, episode: ref }, () => Promise.reject(new Error('offline')))).toBeNull();
  });
});
