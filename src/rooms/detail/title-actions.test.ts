import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';

let progress = 0;
let position = 0;
let episodeKind = 'unwatched';
let resuming: string | undefined;
/** Episodes in another state than `episodeKind`. */
let kinds: Record<string, string> = {};

vi.mock('../../library/watch', () => ({
  movieProgress: () => progress,
  resumePosition: () => position,
  // As the real one: an episode with an air date isn't out yet.
  episodeState: (_title: unknown, _season: number, episode: { id: string; airs?: string }) => (episode.airs ? { kind: 'unaired', airs: episode.airs } : { kind: kinds[episode.id] ?? episodeKind, progress }),
  isWatched: () => false,
  removeFromContinue: () => {},
  resumingVideoId: () => resuming,
  setWatched: () => {},
  watchRecord: () => undefined,
}));
let meta: Title | null = null;
vi.mock('../../catalog/service', () => ({ loadMeta: async () => meta }));
vi.mock('./streams', () => ({ playTitle: async () => {} }));
vi.mock('../lists/lists', () => ({ openListPicker: () => {} }));
vi.mock('../collections/picker', () => ({ openCollectionPicker: () => {} }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, toggleLibrary: () => {} }));
const enqueue = vi.fn<(title: unknown, episode: unknown, where: unknown) => Promise<string>>(async () => 'added');
vi.mock('../../library/queue', () => ({ dequeue: () => {}, dequeueTitle: () => {}, enqueue, episodeQueued: () => false, queueItems: () => [], titleQueued: () => false }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));

const { nextEpisode, nothingAired, primaryLabel, queueTitle, titleMenu } = await import('./title-actions');

const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
const show: Title = { id: 'tt2', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [{ id: 'tt2:1:3', number: 3, title: 'Three' }] }] } as Title;

describe('Play button label', () => {
  beforeEach(() => {
    progress = 0;
    position = 0;
    episodeKind = 'unwatched';
  });

  it('says where a movie in progress continues', () => {
    expect(primaryLabel(movie)).toBe('Play');
    progress = 0.36;
    position = 2530;
    expect(primaryLabel(movie)).toBe('Continue at 42:10');
    position = 3725;
    expect(primaryLabel(movie)).toBe('Continue at 1:02:05');
  });

  it('says which episode continues and where', () => {
    expect(primaryLabel(show)).toBe('Play S1 · E3');
    episodeKind = 'in-progress';
    progress = 0.4;
    position = 724;
    expect(primaryLabel(show)).toBe('Continue S1 · E3 at 12:04');
  });

  it('treats another type with episodes (an addon’s "anime") as a show', () => {
    const anime = { ...show, type: 'anime' } as Title;
    expect(primaryLabel(anime)).toBe('Play S1 · E3');
    expect(nothingAired({ ...anime, seasons: [{ number: 1, episodes: [{ id: 'x:1:1', number: 1, title: 'One', airs: 'Mar 3' }] }] } as Title)).toBe(true);
    // Without episodes it plays as a whole.
    expect(primaryLabel({ ...anime, seasons: undefined })).toBe('Play');
  });

  it('falls back to Resume when the spot isn’t known', () => {
    progress = 0.5;
    expect(primaryLabel(movie)).toBe('Resume');
    episodeKind = 'in-progress';
    expect(primaryLabel(show)).toBe('Resume S1 · E3');
  });
});

describe('the episode Play starts', () => {
  const announced: Title = { ...show, id: 'tt3', seasons: [{ number: 1, episodes: [{ id: 'tt3:1:1', number: 1, title: 'One', airs: 'Mar 3' }, { id: 'tt3:1:2', number: 2, title: 'Two', airs: 'Mar 10' }] }] } as Title;
  const airing: Title = { ...show, id: 'tt4', seasons: [{ number: 1, episodes: [{ id: 'tt4:1:1', number: 1, title: 'One' }, { id: 'tt4:1:2', number: 2, title: 'Two', airs: 'Mar 10' }] }] } as Title;
  beforeEach(() => {
    episodeKind = 'unwatched';
  });

  it('is none on a show announced but not yet aired, so Play says so instead of offering one', () => {
    expect(nextEpisode(announced)).toBeUndefined();
    expect(nothingAired(announced)).toBe(true);
    expect(primaryLabel(announced)).toBe('Not yet aired');
  });

  it('is the first one again once everything aired is watched, never an unaired one', () => {
    episodeKind = 'watched';
    expect(nextEpisode(airing)?.episode.number).toBe(1);
    expect(nothingAired(airing)).toBe(false);
  });

  it('is the episode being watched again, part-way through, even though it’s marked watched', () => {
    // A rewatch: everything marked watched but one episode later on, and S1 E1 being watched again.
    const rewatch: Title = { ...show, id: 'tt5', seasons: [{ number: 1, episodes: [{ id: 'tt5:1:1', number: 1, title: 'One' }, { id: 'tt5:1:2', number: 2, title: 'Two' }] }] } as Title;
    episodeKind = 'watched';
    kinds = { 'tt5:1:2': 'unwatched' };
    resuming = 'tt5:1:1';
    position = 879;
    try {
      expect(nextEpisode(rewatch)?.episode.id).toBe('tt5:1:1');
      expect(primaryLabel(rewatch)).toBe('Continue S1 · E1 at 14:39');
    } finally {
      resuming = undefined;
      kinds = {};
      position = 0;
    }
  });

  it('leaves a show without an episode list to Play as before', () => {
    expect(nothingAired({ ...show, seasons: undefined })).toBe(false);
  });
});

describe('queueing a title', () => {
  beforeEach(() => {
    episodeKind = 'unwatched';
    meta = null;
    enqueue.mockClear();
  });

  it('queues the episode Play would start for another type with episodes (an addon’s "anime")', async () => {
    const anime = { ...show, type: 'anime' } as Title;
    await queueTitle(anime, 'end');
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({ season: 1, number: 3, videoId: 'tt2:1:3' });
    // From a card, whose preview has no episode list.
    meta = anime;
    await queueTitle({ ...anime, seasons: undefined }, 'end');
    expect(enqueue.mock.calls[1]?.[1]).toMatchObject({ season: 1, number: 3 });
  });

  it('queues a movie, or another type without episodes, whole', async () => {
    await queueTitle(movie, 'end');
    meta = { ...movie, id: 'ch1', type: 'tv' };
    await queueTitle({ ...movie, id: 'ch1', type: 'tv' }, 'end');
    expect(enqueue.mock.calls.map((call) => call[1])).toEqual([null, null]);
  });
});

describe('Shuffle in the title menu', () => {
  const labels = (title: Title) => titleMenu(title, { play: () => {}, shuffle: () => {} }).map((item) => item.label);

  it('is offered for a show, an anime addon\'s "anime" show included, and not for a movie', () => {
    expect(labels(show)).toContain('Shuffle');
    expect(labels({ ...show, id: 'kitsu:1', type: 'anime' })).toContain('Shuffle');
    expect(labels(movie)).not.toContain('Shuffle');
  });
});
