import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../catalog/titles';
import {
  cardProgress,
  fillTitleFields,
  continueWatching,
  episodeState,
  historyClearedAt,
  historyRows,
  historyUndo,
  importWatch,
  isWatched,
  lastWatchedAt,
  loadWatch,
  readWatch,
  movieProgress,
  onWatchSaved,
  recentlyWatched,
  recordProgress,
  removeFromContinue,
  removeHistory,
  resumePosition,
  setEpisodesWatched,
  setEpisodeWatched,
  setWatched,
  tasteWatched,
  watchedTitles,
  watchHistory,
  watchLoadError,
} from './watch';

const mocked = vi.mocked(invoke);
const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}`, thumbnail: `https://img.example/${number}.jpg` });
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', year: '2020', genres: [], origins: [] };
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3)] }] };

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
  await loadWatch();
});

describe('reading history', () => {
  it('remembers a failed read, so My Library can tell it apart from no history, until a read works', async () => {
    expect(watchLoadError()).toBeNull();
    const failure = 'database is locked';
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_list') throw failure;
      return undefined;
    });
    await expect(readWatch()).rejects.toBe(failure);
    expect(watchLoadError()).toBe(failure);
    mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
    await readWatch();
    expect(watchLoadError()).toBeNull();
  });
});

describe('movies', () => {
  it('resumes a movie part way through and shows it in Continue Watching', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    expect(resumePosition(movie)).toBe(1800);
    expect(movieProgress(movie)).toBeCloseTo(0.3);
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: '2020', left: '70m left' })]);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_progress', expect.anything()));
  });

  it('saves quick changes in the order they were made', async () => {
    // The first write is slow; the second change must still land last.
    let slow = true;
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_put_progress' && slow) {
        slow = false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return undefined;
    });
    setWatched(movie, true);
    setWatched(movie, false);
    await vi.waitFor(() => expect(mocked.mock.calls.filter(([cmd]) => cmd === 'watch_put_title')).toHaveLength(2));
    const completed = mocked.mock.calls.filter(([cmd]) => cmd === 'watch_put_title').map(([, args]) => (args as { completed: boolean }).completed);
    expect(completed).toEqual([true, false]);
  });

  it('starts over when barely begun, and counts as watched at 90%', () => {
    recordProgress(movie, undefined, 10, 6000);
    expect(resumePosition(movie)).toBe(0);
    recordProgress(movie, undefined, 5500, 6000);
    expect(isWatched(movie)).toBe(true);
    expect(continueWatching()).toEqual([]);
    expect(watchedTitles().map((t) => t.title.id)).toEqual(['tt1']);
    setWatched(movie, false);
    expect(isWatched(movie)).toBe(false);
  });
});

describe('series', () => {
  it('makes the following episode up next once one finishes', () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    expect(episodeState(show, 1, ep(1)).kind).toBe('watched');
    expect(episodeState(show, 1, ep(2)).kind).toBe('up-next');
    expect(continueWatching()[0]).toMatchObject({ badge: 'Next episode', sub: 'S1 · E2 · Episode 2', still: 'https://img.example/2.jpg' });
  });

  it('shows an episode in progress with its time left', () => {
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 1500);
    expect(episodeState(show, 1, ep(2))).toEqual({ kind: 'in-progress', progress: 0.4 });
    expect(continueWatching()[0]).toMatchObject({ sub: 'S1 · E2', left: '15m left' });
  });

  it('keeps up next past episodes already watched when an earlier one is marked', () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    recordProgress(show, { season: 1, episode: ep(2) }, 1500, 1600);
    setEpisodeWatched(show, 1, ep(1), true);
    expect(episodeState(show, 1, ep(3)).kind).toBe('up-next');
    expect(continueWatching()[0]).toMatchObject({ sub: 'S1 · E3 · Episode 3' });
  });

  it('finishes the show when marking an earlier episode leaves nothing unwatched after it', () => {
    setEpisodesWatched(show, [2, 3].map((n) => ({ season: 1, episode: ep(n) })), true);
    setEpisodeWatched(show, 1, ep(1), true);
    expect(isWatched(show)).toBe(true);
  });

  it('counts an anime addon\'s show as watched once its last episode is', () => {
    const anime: Title = { ...show, id: 'kitsu:1', type: 'anime' };
    for (const n of [1, 2, 3]) recordProgress(anime, { season: 1, episode: ep(n) }, 1590, 1600);
    expect(isWatched(anime)).toBe(true);
  });

  it('works out up next again when a season is unmarked', () => {
    const e = (season: number, number: number): Episode => ({ id: `tt9:${season}:${number}`, number, title: `Episode ${number}` });
    const three: Title = { ...show, seasons: [1, 2, 3].map((number) => ({ number, episodes: [e(number, 1), e(number, 2)] })) };
    const season = (n: number) => [1, 2].map((number) => ({ season: n, episode: e(n, number) }));
    setEpisodesWatched(three, [...season(1), ...season(2)], true);
    expect(episodeState(three, 3, e(3, 1)).kind).toBe('up-next');
    // Up next follows the last episode still watched.
    setEpisodesWatched(three, season(2), false);
    expect(episodeState(three, 2, e(2, 1)).kind).toBe('up-next');
    expect(episodeState(three, 3, e(3, 1)).kind).toBe('unwatched');
    // Nothing watched: nothing is up next.
    setEpisodesWatched(three, season(1), false);
    expect(episodeState(three, 1, e(1, 1)).kind).toBe('unwatched');
    expect(episodeState(three, 2, e(2, 1)).kind).toBe('unwatched');
  });

  it('completes the show when the last episode is marked watched', () => {
    setEpisodesWatched(show, [1, 2, 3].map((n) => ({ season: 1, episode: ep(n) })), true);
    expect(isWatched(show)).toBe(true);
    expect(continueWatching()).toEqual([]);
  });
});

describe('specials (season 0)', () => {
  const special: Episode = { id: 'tt9:0:1', number: 1, title: 'Behind the scenes' };
  const withSpecials: Title = { ...show, seasons: [{ number: 0, episodes: [special] }, ...(show.seasons ?? [])] };

  it('keeps the show going when a special is marked watched', () => {
    recordProgress(withSpecials, { season: 1, episode: ep(1) }, 1500, 1600);
    setEpisodesWatched(withSpecials, [{ season: 0, episode: special }], true);
    expect(isWatched(withSpecials)).toBe(false);
    expect(episodeState(withSpecials, 1, ep(2)).kind).toBe('up-next');
    expect(episodeState(withSpecials, 0, special).kind).toBe('watched');
    expect(continueWatching()[0]).toMatchObject({ sub: 'S1 · E2 · Episode 2' });
  });

  it('keeps the show going when a special finishes playing', () => {
    recordProgress(withSpecials, { season: 0, episode: special }, 1500, 1600);
    expect(isWatched(withSpecials)).toBe(false);
    recordProgress(withSpecials, { season: 1, episode: ep(1) }, 1500, 1600);
    recordProgress(withSpecials, { season: 0, episode: special }, 1500, 1600);
    expect(episodeState(withSpecials, 1, ep(2)).kind).toBe('up-next');
  });

  it('goes on with the regular episode that aired after a special finished first', () => {
    const dated = (episode: Episode, released: string): Episode => ({ ...episode, released });
    const aired: Title = { ...show, seasons: [{ number: 0, episodes: [dated(special, '2020-02-10')] }, { number: 1, episodes: [dated(ep(1), '2020-02-01'), dated(ep(2), '2020-02-15'), dated(ep(3), '2020-02-22')] }] };
    recordProgress(aired, { season: 0, episode: aired.seasons![0]!.episodes[0]! }, 1500, 1600);
    expect(episodeState(aired, 1, ep(2)).kind).toBe('up-next');
    expect(isWatched(aired)).toBe(false);
  });

  it('goes on with the first unwatched regular episode after a special without an air date', () => {
    recordProgress(withSpecials, { season: 0, episode: special }, 1500, 1600);
    expect(episodeState(withSpecials, 1, ep(1)).kind).toBe('up-next');
    expect(continueWatching()[0]).toMatchObject({ sub: 'S1 · E1 · Episode 1' });
  });

  it('still completes the show when the last regular episode is among those marked', () => {
    setEpisodesWatched(withSpecials, [special, ep(1), ep(2), ep(3)].map((episode) => ({ season: episode === special ? 0 : 1, episode })), true);
    expect(isWatched(withSpecials)).toBe(true);
  });

  it('does not un-complete a finished show when a special is un-marked', () => {
    setEpisodesWatched(withSpecials, [1, 2, 3].map((n) => ({ season: 1, episode: ep(n) })), true);
    setEpisodesWatched(withSpecials, [{ season: 0, episode: special }], false);
    expect(isWatched(withSpecials)).toBe(true);
  });
});

describe('removing from Continue Watching', () => {
  it('takes a movie out, keeps when it was watched, and tells sync', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    const at = lastWatchedAt(movie.id);
    const { onWatchSaved } = await import('./watch');
    const synced: string[] = [];
    const stop = onWatchSaved((title) => synced.push(title.id));
    removeFromContinue(movie.id);
    stop();
    expect(continueWatching()).toEqual([]);
    expect(resumePosition(movie)).toBe(0);
    expect(isWatched(movie)).toBe(false);
    expect(lastWatchedAt(movie.id)).toBe(at);
    expect(synced).toEqual(['tt1']);
  });

  it('drops a series up next but keeps its watched episodes, until it is watched again', () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    removeFromContinue(show.id);
    expect(continueWatching()).toEqual([]);
    expect(episodeState(show, 1, ep(1)).kind).toBe('watched');
    // A moment later (rows saved in the same millisecond would tie).
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 1500);
    now.mockRestore();
    expect(continueWatching()[0]).toMatchObject({ sub: 'S1 · E2' });
  });
});

describe('progress on cards', () => {
  it('gives a movie part-way through its progress, and a show its episode', () => {
    expect(cardProgress(movie.id)).toBeNull();
    recordProgress(movie, undefined, 1500, 6000);
    expect(cardProgress(movie.id)).toEqual({ progress: 0.25 });
    recordProgress(show, { season: 1, episode: ep(2) }, 300, 1200);
    expect(cardProgress(show.id)).toEqual({ progress: 0.25, episode: 'S1 · E2' });
  });

  it('has nothing for a finished movie', () => {
    recordProgress(movie, undefined, 5900, 6000);
    expect(cardProgress(movie.id)).toBeNull();
  });
});

describe('undoing a removal', () => {
  it('puts a title back in Continue Watching where it was', () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 1500);
    const before = continueWatching();
    const undo = removeFromContinue(show.id);
    expect(continueWatching()).toEqual([]);
    undo();
    expect(continueWatching()).toEqual(before);
    expect(resumePosition(show, ep(2))).toBe(600);
  });

  it('puts back a whole title cleared from history, and forgets that it was cleared', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    const at = lastWatchedAt(movie.id);
    const undo = historyUndo(movie.id);
    await removeHistory(movie.id);
    expect(historyClearedAt(movie.id)).toBeGreaterThan(0);
    undo();
    expect(historyRows().map((r) => r.row.videoId)).toEqual(['tt1']);
    expect(lastWatchedAt(movie.id)).toBe(at);
    expect(resumePosition(movie)).toBe(1800);
    expect(historyClearedAt(movie.id)).toBe(0);
  });

  it('puts back one removed episode, keeping its time', async () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1300, 1400);
    const time = historyRows()[0]!.row.updatedAt;
    vi.spyOn(Date, 'now').mockReturnValueOnce(time + 5000);
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 1400);
    const undo = historyUndo(show.id, ['tt9:1:1']);
    await removeHistory(show.id, ['tt9:1:1']);
    undo();
    expect(historyRows().find((r) => r.row.videoId === 'tt9:1:1')?.row.updatedAt).toBe(time);
    expect(episodeState(show, 1, ep(1)).kind).toBe('watched');
  });

  it('keeps a title in history when storage refuses to remove it', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.anything()));
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'watch_remove') throw 'database is locked';
      return undefined;
    });
    await expect(removeHistory(movie.id)).rejects.toBe('database is locked');
    expect(historyRows().map((r) => r.row.videoId)).toEqual(['tt1']);
    expect(resumePosition(movie)).toBe(1800);
    expect(historyClearedAt(movie.id)).toBe(0);
  });
});

describe('loading', () => {
  it('skips rows that fail validation and drops stale titles from Continue Watching', async () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    mocked.mockImplementation(async (cmd) =>
      cmd === 'watch_list'
        ? {
            titles: [
              { titleId: 'tt1', title: { meta: { id: 'tt1', type: 'movie', name: 'Film' } }, next: null, completed: false, updatedAt: old },
              { titleId: 'bad', title: { meta: {} }, completed: false, updatedAt: 1 },
            ],
            progress: [
              { videoId: 'tt1', titleId: 'tt1', season: null, episode: null, position: 100, duration: 1000, watched: false, updatedAt: old },
              { videoId: 'x', titleId: 'x', position: -5 },
            ],
          }
        : undefined,
    );
    await loadWatch();
    expect(resumePosition(movie)).toBe(100);
    expect(continueWatching()).toEqual([]);
  });
});

describe('filling in genres', () => {
  it('adds genres to titles without them, keeping when they were watched', async () => {
    const at = Date.now() - 1000 * 60 * 60 * 24 * 100;
    importWatch(movie, [{ videoId: 'tt1', titleId: 'tt1', season: null, episode: null, position: 0, duration: 0, watched: true, updatedAt: 0 }], { next: null, completed: true }, at);
    setWatched({ ...movie, id: 'tt2', genres: ['Comedy'] }, true);
    // Those saves land first, so only the fill's own writes are counted below.
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.objectContaining({ titleId: 'tt2' })));
    mocked.mockClear();
    fillTitleFields(
      new Map([
        ['tt1', { genres: ['Drama', 'Crime'] }],
        ['tt2', { genres: ['Horror'] }],
        ['unknown', { genres: ['Drama'] }],
      ]),
    );
    const genres = new Map(watchHistory().titles.map((row) => [row.title.id, row.title.genres]));
    expect(genres.get('tt1')).toEqual(['Drama', 'Crime']);
    expect(genres.get('tt2')).toEqual(['Comedy']);
    expect(lastWatchedAt('tt1')).toBe(at);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.objectContaining({ titleId: 'tt1', at })));
    expect(mocked.mock.calls.filter(([cmd]) => cmd === 'watch_put_title')).toHaveLength(1);
  });
});

describe('filling in title details', () => {
  const synced: Title = { id: 'tt5', type: 'movie', name: 'Synced', poster: 'https://img.example/p.jpg', genres: [], origins: [] };

  it('fills only missing fields, keeps when it was watched, and tells no sync listener', async () => {
    const at = Date.now() - 1000 * 60 * 60 * 24 * 3;
    importWatch(synced, [{ videoId: 'tt5', titleId: 'tt5', season: null, episode: null, position: 1200, duration: 6000, watched: false, updatedAt: 0 }], { next: null, completed: false }, at);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.objectContaining({ titleId: 'tt5' })));
    mocked.mockClear();
    const saved = vi.fn();
    const stop = onWatchSaved(saved);
    fillTitleFields(new Map([['tt5', { poster: 'https://img.example/other.jpg', background: 'https://img.example/b.jpg', logo: 'https://img.example/l.png', year: '1999', runtime: '136 min', genres: ['Action'] }]]));
    stop();
    const title = watchHistory().titles.find((row) => row.title.id === 'tt5')!.title;
    expect(title).toMatchObject({ name: 'Synced', poster: 'https://img.example/p.jpg', background: 'https://img.example/b.jpg', logo: 'https://img.example/l.png', year: '1999', runtime: '136 min', genres: ['Action'] });
    expect(lastWatchedAt('tt5')).toBe(at);
    expect(saved).not.toHaveBeenCalled();
    // Continue Watching's card now has its "year · runtime" line.
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: '1999 · 136 min' })]);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.objectContaining({ titleId: 'tt5', at })));
  });

  it('writes nothing when every field is already there', async () => {
    const full: Title = { ...synced, id: 'tt6', background: 'https://img.example/b.jpg', logo: 'https://img.example/l.png', year: '2001', runtime: '90 min', genres: ['Drama'] };
    importWatch(full, [{ videoId: 'tt6', titleId: 'tt6', season: null, episode: null, position: 1200, duration: 6000, watched: false, updatedAt: 0 }], { next: null, completed: false }, Date.now() - 1000);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledWith('watch_put_title', expect.objectContaining({ titleId: 'tt6' })));
    mocked.mockClear();
    fillTitleFields(new Map([['tt6', { background: 'https://img.example/new.jpg', year: '2002', genres: ['Comedy'] }]]));
    expect(watchHistory().titles.find((row) => row.title.id === 'tt6')!.title).toMatchObject({ background: 'https://img.example/b.jpg', year: '2001', genres: ['Drama'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked).not.toHaveBeenCalled();
  });
});

describe('removing history', () => {
  it('takes out one episode, keeping the rest and the title', async () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1300, 1400);
    recordProgress(show, { season: 1, episode: ep(2) }, 600, 1400);
    const saved = vi.fn();
    const stop = onWatchSaved(saved);
    await removeHistory(show.id, ['tt9:1:1']);
    stop();
    expect(historyRows().map((r) => r.row.videoId)).toEqual(['tt9:1:2']);
    expect(episodeState(show, 1, ep(1)).kind).not.toBe('watched');
    expect(recentlyWatched()).toEqual([show]);
    expect(mocked).toHaveBeenCalledWith('watch_remove', { titleId: show.id, videoIds: ['tt9:1:1'] });
    // Nothing is announced (so nothing is synced), and nothing is remembered as cleared.
    expect(saved).not.toHaveBeenCalled();
    expect(historyClearedAt(show.id)).toBe(0);
  });

  it('clears a whole title, and remembers when (per profile)', async () => {
    recordProgress(movie, undefined, 1800, 6000);
    await removeHistory(movie.id);
    expect(historyRows()).toEqual([]);
    expect(recentlyWatched()).toEqual([]);
    expect(continueWatching()).toEqual([]);
    expect(historyClearedAt(movie.id)).toBeGreaterThan(0);
    expect(mocked).toHaveBeenCalledWith('watch_remove', { titleId: movie.id, videoIds: null });
    expect(mocked).toHaveBeenCalledWith('settings_set', { key: 'history.cleared', value: { [movie.id]: historyClearedAt(movie.id) } });
  });

  it('leaves out rows only marked unwatched', () => {
    setWatched(movie, true);
    setWatched(movie, false);
    expect(historyRows()).toEqual([]);
  });
});

describe('taste', () => {
  const short: Title = { id: 'tt2', type: 'movie', name: 'Sampled', year: '2021', genres: [], origins: [] };

  it('leaves out a minute’s look, keeps what was really watched', () => {
    recordProgress(short, undefined, 60, 6000);
    expect(tasteWatched()).toEqual([]);
    recordProgress(movie, undefined, 1800, 6000);
    expect(tasteWatched()).toEqual([movie]);
    expect(recentlyWatched()).toHaveLength(2);
  });

  it('counts a quarter of the way through, an episode watched, or a title marked watched', () => {
    recordProgress(short, undefined, 400, 1500);
    recordProgress(show, { season: 1, episode: ep(1) }, 1500, 1600);
    setWatched(movie, true);
    expect(new Set(tasteWatched().map((t) => t.id))).toEqual(new Set(['tt1', 'tt2', 'tt9']));
  });
});

describe('watching again', () => {
  it('a movie rewatched to 10% stays watched, with its place kept to resume', () => {
    recordProgress(movie, undefined, 5800, 6000);
    recordProgress(movie, undefined, 600, 6000);
    expect(isWatched(movie)).toBe(true);
    expect(watchHistory().progress[0]).toMatchObject({ watched: true, position: 600 });
    expect(resumePosition(movie)).toBe(600);
    expect(movieProgress(movie)).toBeCloseTo(0.1);
    // Continue Watching offers to carry on with the rewatch, and it still counts for taste.
    expect(continueWatching()).toEqual([expect.objectContaining({ left: '90m left' })]);
    expect(tasteWatched().map((t) => t.id)).toEqual(['tt1']);
  });

  it('a rewatch finished stays watched, and leaves Continue Watching', () => {
    setWatched(movie, true);
    recordProgress(movie, undefined, 3000, 6000);
    recordProgress(movie, undefined, 5900, 6000);
    expect(isWatched(movie)).toBe(true);
    expect(continueWatching()).toEqual([]);
  });

  it('Mark unwatched still unmarks, and the next play counts from scratch', () => {
    recordProgress(movie, undefined, 5800, 6000);
    recordProgress(movie, undefined, 600, 6000);
    setWatched(movie, false);
    expect(isWatched(movie)).toBe(false);
    recordProgress(movie, undefined, 600, 6000);
    expect(isWatched(movie)).toBe(false);
  });

  it('a finished show stays finished while an episode is watched again, part way or to the end', () => {
    setEpisodesWatched(show, [1, 2, 3].map((n) => ({ season: 1, episode: ep(n) })), true);
    recordProgress(show, { season: 1, episode: ep(1) }, 160, 1600);
    expect(episodeState(show, 1, ep(1)).kind).toBe('watched');
    expect(resumePosition(show, ep(1))).toBe(160);
    expect(isWatched(show)).toBe(true);
    recordProgress(show, { season: 1, episode: ep(1) }, 1550, 1600);
    expect(isWatched(show)).toBe(true);
    expect(watchedTitles().map((t) => t.title.id)).toEqual(['tt9']);
  });

  it('a finished show being watched again stays in Continue Watching between episodes', () => {
    setEpisodesWatched(show, [1, 2, 3].map((n) => ({ season: 1, episode: ep(n) })), true);
    recordProgress(show, { season: 1, episode: ep(1) }, 1550, 1600);
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: 'S1 · E2 · Episode 2' })]);
    // Stopped at 85%: past where a watched episode counts as part way, short of finishing it.
    recordProgress(show, { season: 1, episode: ep(2) }, 1360, 1600);
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: 'S1 · E2 · Episode 2' })]);
    expect(isWatched(show)).toBe(true);
    recordProgress(show, { season: 1, episode: ep(3) }, 1550, 1600);
    expect(continueWatching()).toEqual([]);
  });

  it("an episode not yet watched still counts only once it's finished", () => {
    recordProgress(show, { season: 1, episode: ep(1) }, 1550, 1600);
    recordProgress(show, { season: 1, episode: ep(2) }, 160, 1600);
    expect(episodeState(show, 1, ep(2)).kind).toBe('in-progress');
    expect(isWatched(show)).toBe(false);
  });

  it('a movie finished at 85% stays finished with the threshold at 90%', async () => {
    mocked.mockImplementation(async (cmd) =>
      cmd === 'watch_list'
        ? {
            titles: [{ titleId: 'tt1', title: { meta: { id: 'tt1', type: 'movie', name: 'Film' } }, next: null, completed: true, updatedAt: 1 }],
            progress: [{ videoId: 'tt1', titleId: 'tt1', season: null, episode: null, position: 5100, duration: 6000, watched: true, updatedAt: 1 }],
          }
        : undefined,
    );
    await loadWatch();
    expect(isWatched(movie)).toBe(true);
    expect(resumePosition(movie)).toBe(0);
    expect(continueWatching()).toEqual([]);
  });
});
