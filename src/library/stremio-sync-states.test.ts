import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../catalog/titles';
import { patchFor, seriesImport, syncNow, type StremioItem } from './stremio-sync';
import { continueWatching, episodeState, importWatch, isWatched, loadWatch, recordProgress, removeFromContinue, setWatchPrefs } from './watch';

// Stremio states that leave a series in Stremio's Continue Watching (stremio-core: `time_offset > 0`),
// brought in by a pull: each must leave it in Orbit's too.
const mocked = vi.mocked(invoke);
const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3), ep(4)] }] };
const MIN = 60_000;

const series = (state: Partial<StremioItem['state']>): StremioItem => ({
  _id: 'tt9',
  type: 'series',
  name: 'Show',
  poster: null,
  state: { lastWatched: '2026-10-01T12:00:00Z', timeOffset: 0, duration: 0, video_id: null, timesWatched: 0, watched: null, ...state },
});

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined));
  await loadWatch();
});

describe('a series brought in from Stremio stays in Continue Watching', () => {
  it('when the next episode played on by itself and was stopped in its first seconds', () => {
    // Watched E2 to the end here: E3 is up next.
    recordProgress(show, { season: 1, episode: ep(2) }, 40 * 60, 40 * 60);
    expect(continueWatching()[0]).toEqual(expect.objectContaining({ badge: 'Next episode' }));
    // On the TV, Stremio played E3 on from E2 and it was stopped 15 seconds in.
    importWatch(...seriesImport(series({ video_id: 'tt9:1:3', timeOffset: 15_000, duration: 40 * MIN }), show, new Set(['tt9:1:1', 'tt9:1:2'])), Date.now() + 5000);
    expect(continueWatching()).toEqual([expect.objectContaining({ sub: expect.stringContaining('3'), badge: 'Next episode' })]);
  });

  it('when Stremio was in an episode’s end credits: the next one is up', () => {
    recordProgress(show, { season: 1, episode: ep(2) }, 10 * 60, 40 * 60);
    // Watched on in Stremio into E2's credits (at 95%: past its 70% watched mark), still playing there or not stopped yet.
    importWatch(...seriesImport(series({ video_id: 'tt9:1:2', timeOffset: 38 * MIN, duration: 40 * MIN }), show, new Set(['tt9:1:1', 'tt9:1:2'])), Date.now() + 5000);
    expect(episodeState(show, 1, ep(2)).kind).toBe('watched');
    expect(continueWatching()).toEqual([expect.objectContaining({ badge: 'Next episode', sub: expect.stringContaining('Episode 3') })]);
  });

  it('when Stremio stopped an episode past the share Orbit counts as watched', async () => {
    await setWatchPrefs({ watchedAt: 0.85 });
    // Stopped at 87%: still in Stremio's Continue Watching (it moves on only past 90%), finished by Orbit's rule.
    importWatch(...seriesImport(series({ video_id: 'tt9:1:2', timeOffset: 34.8 * MIN, duration: 40 * MIN }), show, new Set(['tt9:1:1', 'tt9:1:2'])), Date.now() + 5000);
    expect(continueWatching()).toEqual([expect.objectContaining({ badge: 'Next episode', sub: expect.stringContaining('Episode 3') })]);
    await setWatchPrefs({ watchedAt: 0.9 });
  });

  it('an episode skipped to its end in Stremio counts as watched, as it would here', () => {
    // Skipped ahead to the credits: too little of it played for Stremio's own watched mark.
    importWatch(...seriesImport(series({ video_id: 'tt9:1:2', timeOffset: 38 * MIN, duration: 40 * MIN }), show, new Set(['tt9:1:1'])), Date.now() + 5000);
    expect(episodeState(show, 1, ep(2)).kind).toBe('watched');
    expect(continueWatching()).toEqual([expect.objectContaining({ badge: 'Next episode', sub: expect.stringContaining('Episode 3') })]);
  });

  it('the last episode in its credits in Stremio finishes the show', () => {
    importWatch(...seriesImport(series({ video_id: 'tt9:1:4', timeOffset: 38 * MIN, duration: 40 * MIN }), show, new Set(['tt9:1:1', 'tt9:1:2', 'tt9:1:3'])), Date.now() + 5000);
    expect(isWatched(show)).toBe(true);
    expect(continueWatching()).toEqual([]);
  });

  it('when Stremio is part way into an episode Orbit’s list doesn’t have: what was up next stays', () => {
    recordProgress(show, { season: 1, episode: ep(2) }, 40 * 60, 40 * 60);
    // Stremio's meta addon already lists season 2; Orbit's doesn't.
    importWatch(...seriesImport(series({ video_id: 'tt9:2:1', timeOffset: 5 * MIN, duration: 40 * MIN }), show, new Set(['tt9:1:1', 'tt9:1:2'])), Date.now() + 5000);
    expect(continueWatching()).toEqual([expect.objectContaining({ badge: 'Next episode', sub: expect.stringContaining('Episode 3') })]);
  });
});

describe('a title taken out of the library in Stremio', () => {
  // stremio-core: Continue Watching shows an item only while `!removed || temp`; "Remove from library"
  // sets removed (and clears temp) but leaves its progress, and playing it again sets temp.
  const film = (removed: boolean, temp: boolean) => ({
    _id: 'tt1',
    type: 'movie',
    name: 'Film',
    poster: null,
    removed,
    temp,
    state: { lastWatched: new Date(Date.now() + 60_000).toISOString(), timeOffset: 1_800_000, duration: 6_000_000, video_id: 'tt1', timesWatched: 0, watched: null },
  });
  const pull = (items: unknown[]) => mocked.mockImplementation(async (cmd) => (cmd === 'watch_list' ? { titles: [], progress: [] } : cmd === 'stremio_library_pull' ? items : undefined));

  it('stays out of Continue Watching here too', async () => {
    pull([film(true, false)]);
    await syncNow();
    expect(continueWatching()).toEqual([]);
  });

  it('comes back once it’s played again there', async () => {
    pull([film(true, true)]);
    await syncNow();
    expect(continueWatching()).toEqual([expect.objectContaining({ title: expect.objectContaining({ id: 'tt1' }) })]);
  });
});

describe('sending what Continue Watching shows', () => {
  it('a series taken out of Continue Watching after a finished episode is taken out of Stremio’s too', async () => {
    recordProgress(show, { season: 1, episode: ep(2) }, 40 * 60, 40 * 60);
    expect(continueWatching()).toHaveLength(1);
    removeFromContinue(show.id);
    expect(continueWatching()).toEqual([]);
    // Offset 1 on E3 would put it back in Stremio's Continue Watching as "next episode".
    expect(await patchFor(show)).toEqual(expect.objectContaining({ timeOffset: 0 }));
  });
});
