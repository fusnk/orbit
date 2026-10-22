import { describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../catalog/titles';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined)) }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { loadMeta } = await import('../catalog/service');
const { continueWatching, latestNewEpisode, loadWatch, recordProgress, refreshNewEpisodes, newEpisodeCount } = await import('./watch');

const DAY = 24 * 60 * 60 * 1000;
const ep = (number: number, released?: string): Episode => ({ id: `tt8:1:${number}`, number, title: `Episode ${number}`, ...(released ? { released } : {}) });

describe('new episodes once they are watched', () => {
  it('a new episode watched to the end is no longer offered as new', async () => {
    await loadWatch();
    const now = Date.now();
    const show: Title = { id: 'tt8', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2, new Date(now - DAY).toISOString())] }] };
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 3 * DAY);
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1500);
    clock.mockRestore();
    vi.mocked(loadMeta).mockResolvedValue(show);
    await refreshNewEpisodes(now);
    expect(newEpisodeCount(show.id)).toBe(1);

    // The person plays the new episode from Continue Watching and watches it through.
    recordProgress(show, { season: 1, episode: show.seasons![0]!.episodes[1]! }, 1500, 1500);
    expect(newEpisodeCount(show.id)).toBe(0);
    expect(latestNewEpisode()).toBeNull();
    // Nothing left to play: the show isn't offered again (least of all the episode just watched, as "new").
    expect(continueWatching().some((entry) => entry.title.id === show.id)).toBe(false);
  });
});
