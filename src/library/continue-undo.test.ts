import { describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../catalog/titles';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined)) }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { loadMeta } = await import('../catalog/service');
const { continueWatching, lastWatchedAt, loadWatch, recordProgress, refreshNewEpisodes, removeFromContinue, watchRecord } = await import('./watch');

const DAY = 24 * 60 * 60 * 1000;
const ep = (number: number, released?: string): Episode => ({ id: `tt8:1:${number}`, number, title: `Episode ${number}`, ...(released ? { released } : {}) });

describe('undoing "Remove from Continue Watching" on a show with new episodes', () => {
  it('puts back when it was last watched, not when the new episode aired', async () => {
    await loadWatch();
    const now = Date.now();
    const watchedAt = now - 3 * DAY;
    const show: Title = { id: 'tt8', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3, new Date(now - DAY).toISOString())] }] };
    const clock = vi.spyOn(Date, 'now').mockReturnValue(watchedAt);
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 1500);
    clock.mockRestore();
    vi.mocked(loadMeta).mockResolvedValue(show);
    await refreshNewEpisodes(now);
    const rowTimes = watchRecord(show.id)!.rows.map((r) => r.updatedAt);

    const undo = removeFromContinue(show.id);
    undo();

    expect(lastWatchedAt(show.id)).toBe(watchedAt);
    expect(watchRecord(show.id)!.rows.map((r) => r.updatedAt)).toEqual(rowTimes);
    expect(continueWatching(now)).toHaveLength(1);
  });
});
