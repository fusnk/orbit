import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Title } from '../../catalog/titles';

// The real watch state (only storage is faked), so Play is checked against what Continue Watching shows.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined)) }));
vi.mock('../../catalog/service', () => ({ loadMeta: async () => null }));
vi.mock('./streams', () => ({ playTitle: async () => {} }));
vi.mock('../lists/lists', () => ({ openListPicker: () => {} }));
vi.mock('../collections/picker', () => ({ openCollectionPicker: () => {} }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, toggleLibrary: () => {} }));
vi.mock('../../library/queue', () => ({ dequeue: () => {}, dequeueTitle: () => {}, enqueue: () => {}, episodeQueued: () => false, queueItems: () => [], titleQueued: () => false }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));

const { continueWatching, loadWatch, recordProgress, setEpisodesWatched } = await import('../../library/watch');
const { nextEpisode, primaryLabel } = await import('./title-actions');

const ep = (season: number, number: number): Episode => ({ id: `tt7:${season}:${number}`, number, title: `Episode ${number}` });
const show: Title = {
  id: 'tt7',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [
    { number: 1, episodes: [ep(1, 1), ep(1, 2), ep(1, 3)] },
    { number: 2, episodes: [ep(2, 1), ep(2, 2), ep(2, 3)] },
  ],
};

let clock = Date.now() - 60_000;
const at = (fn: () => void) => {
  const now = vi.spyOn(Date, 'now').mockReturnValue((clock += 1000));
  fn();
  now.mockRestore();
};

describe('the episode Play starts, with real watch state', () => {
  beforeEach(async () => {
    await loadWatch();
  });

  it('continues the episode Continue Watching shows, not one abandoned earlier', () => {
    at(() => recordProgress(show, { season: 1, episode: ep(1, 2) }, 600, 1500)); // left part-way
    at(() => recordProgress(show, { season: 1, episode: ep(1, 3) }, 1490, 1500));
    at(() => recordProgress(show, { season: 2, episode: ep(2, 1) }, 1490, 1500));
    at(() => recordProgress(show, { season: 2, episode: ep(2, 2) }, 300, 1500)); // watching now
    expect(continueWatching()[0]).toMatchObject({ sub: 'S2 · E2' });
    expect(nextEpisode(show)?.episode.id).toBe('tt7:2:2');
  });

  it('starts the episode up next rather than an older one left part-way', () => {
    at(() => recordProgress(show, { season: 1, episode: ep(1, 2) }, 600, 1500));
    at(() => recordProgress(show, { season: 1, episode: ep(1, 3) }, 1490, 1500));
    at(() => recordProgress(show, { season: 2, episode: ep(2, 1) }, 1490, 1500));
    expect(continueWatching()[0]).toMatchObject({ sub: expect.stringContaining('S2 · E2') });
    expect(nextEpisode(show)?.episode.id).toBe('tt7:2:2');
  });

  it('rewatching a finished show, starts the episode Continue Watching names, not the first one again', () => {
    at(() => setEpisodesWatched(show, show.seasons!.flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode }))), true));
    at(() => recordProgress(show, { season: 2, episode: ep(2, 1) }, 1550, 1600));
    // Stopped at 86%: past where a watched episode counts as part way, short of finishing it.
    at(() => recordProgress(show, { season: 2, episode: ep(2, 2) }, 1380, 1600));
    expect(continueWatching()[0]).toMatchObject({ sub: expect.stringContaining('S2 · E2') });
    expect(nextEpisode(show)?.episode.id).toBe('tt7:2:2');
    expect(primaryLabel(show)).toBe('Play S2 · E2');
  });

  it('still resumes an episode left part-way when nothing is up next', () => {
    at(() => recordProgress(show, { season: 1, episode: ep(1, 2) }, 600, 1500));
    expect(nextEpisode(show)?.episode.id).toBe('tt7:1:2');
  });
});
