import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../catalog/titles';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined)) }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { loadMeta } = await import('../catalog/service');
const { cardProgress, continueWatching, episodeState, loadWatch, recordProgress, refreshNewEpisodes } = await import('./watch');

const DAY = 24 * 60 * 60 * 1000;
const ep = (number: number, released?: string, id = `tt9:1:${number}`): Episode => ({ id, number, title: `Episode ${number}`, ...(released ? { released } : {}) });

beforeEach(async () => {
  vi.restoreAllMocks();
  await loadWatch();
});

describe('a poster card of a show', () => {
  const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3), ep(4)] }] };

  it('shows no progress from an episode abandoned before later ones were finished', () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1_000_000);
    recordProgress(show, { season: 1, episode: ep(1) }, 800, 1600);
    clock.mockReturnValue(2_000_000);
    recordProgress(show, { season: 1, episode: ep(2) }, 1600, 1600);
    clock.mockReturnValue(3_000_000);
    recordProgress(show, { season: 1, episode: ep(3) }, 1600, 1600);
    // Continue Watching and Play (title-actions nextEpisode, up next first) go on with E4; the card mustn't say E1 at 50%.
    expect(continueWatching()[0]?.progress).toBe(0);
    expect(episodeState(show, 1, ep(4)).kind).toBe('up-next');
    expect(cardProgress(show.id)).toBeNull();
  });
});

describe('new episodes of a show the person is behind on', () => {
  it('the card offers the episode up next, the one Play starts, not the newest one', async () => {
    const now = Date.now();
    const long = new Date(now - 60 * DAY).toISOString();
    const show: Title = {
      id: 'tt9',
      type: 'series',
      name: 'Show',
      genres: [],
      origins: [],
      seasons: [{ number: 1, episodes: [ep(1, long), ep(2, long), ep(3, long), ep(4, new Date(now - DAY).toISOString())] }],
    };
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 10 * DAY);
    recordProgress(show, { season: 1, episode: ep(1, long) }, 1600, 1600);
    clock.mockRestore();
    vi.mocked(loadMeta).mockResolvedValue(show);
    await refreshNewEpisodes(now);

    expect(episodeState(show, 1, show.seasons![0]!.episodes[1]!).kind).toBe('up-next');
    const card = continueWatching(now).find((entry) => entry.title.id === show.id);
    expect(card?.sub).toMatch(/E2\b/);
  });
});
