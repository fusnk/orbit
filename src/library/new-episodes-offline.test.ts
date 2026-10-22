import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../catalog/titles';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined)) }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { loadMeta } = await import('../catalog/service');
const { continueWatching, loadWatch, recordProgress, refreshNewEpisodes, newEpisodeCount } = await import('./watch');

const DAY = 24 * 60 * 60 * 1000;
const ep = (number: number, released?: string): Episode => ({ id: `tt7:1:${number}`, number, title: `Episode ${number}`, ...(released ? { released } : {}) });

afterEach(() => vi.useRealTimers());

describe('new episodes when the check ran offline', () => {
  it('checks again later instead of staying empty until a restart', async () => {
    await loadWatch();
    const now = Date.now();
    const show: Title = { id: 'tt7', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2, new Date(now - DAY).toISOString())] }] };
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 3 * DAY);
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1500);
    clock.mockRestore();

    vi.useFakeTimers({ now });
    // Started offline: every lookup fails.
    vi.mocked(loadMeta).mockRejectedValue(new Error('offline'));
    await refreshNewEpisodes();
    expect(newEpisodeCount(show.id)).toBe(0);

    // The connection is back; a while later the check runs again by itself.
    vi.mocked(loadMeta).mockResolvedValue(show);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(newEpisodeCount(show.id)).toBe(1);
    expect(continueWatching().some((entry) => entry.title.id === show.id)).toBe(true);
  });
});
