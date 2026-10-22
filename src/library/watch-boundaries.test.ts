import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../catalog/titles';
import { DEFAULT_COUNTDOWN, leftAt, NEXT_UP_AT } from '../rooms/player/next-up';
import { continueWatching, episodeState, isWatched, loadWatch, recordProgress, resumePosition, setWatchPrefs, watchHistory } from './watch';

const mocked = vi.mocked(invoke);
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockImplementation(async (command) => command === 'watch_list' ? { titles: [], progress: [] } : undefined);
  await loadWatch();
});

describe('watch preference boundaries', () => {
  it('resumes at exactly thirty seconds but starts over just below it', () => {
    recordProgress(movie, undefined, 29.99, 1000);
    expect(resumePosition(movie)).toBe(0);
    recordProgress(movie, undefined, 30, 1000);
    expect(resumePosition(movie)).toBe(30);
  });

  it('uses the chosen completion threshold inclusively', async () => {
    await setWatchPrefs({ watchedAt: 0.8 });
    recordProgress(movie, undefined, 799, 1000);
    expect(isWatched(movie)).toBe(false);
    recordProgress(movie, undefined, 800, 1000);
    expect(isWatched(movie)).toBe(true);
    expect(resumePosition(movie)).toBe(0);
  });

  it('expires Continue Watching only after the exact chosen day boundary', async () => {
    await setWatchPrefs({ continueDays: 7 });
    recordProgress(movie, undefined, 100, 1000);
    const savedAt = watchHistory().titles[0]!.updatedAt;
    expect(continueWatching(savedAt + 7 * 86400000)).toHaveLength(1);
    expect(continueWatching(savedAt + 7 * 86400000 + 1)).toEqual([]);
    await setWatchPrefs({ continueDays: 0 });
    expect(continueWatching(savedAt + 1000 * 86400000)).toHaveLength(1);
  });

  it.each([NaN, Infinity, -Infinity])('ignores a nonfinite playback position (%s) without replacing valid progress', (position) => {
    recordProgress(movie, undefined, 100, 1000);
    recordProgress(movie, undefined, position, 1000);
    expect(resumePosition(movie)).toBe(100);
    expect(watchHistory().progress).toHaveLength(1);
  });

  it('clamps seeking before the start and beyond the duration', () => {
    recordProgress(movie, undefined, -100, 1000);
    expect(watchHistory().progress[0]?.position).toBe(0);
    recordProgress(movie, undefined, 2000, 1000);
    expect(watchHistory().progress[0]?.position).toBe(1000);
    expect(isWatched(movie)).toBe(true);
  });
});

describe('handing off to the next episode', () => {
  const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
  const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2)] }] };
  const first = { season: 1, episode: ep(1) };

  it('counts the episode left as watched when Next Up or the credits hand off before the threshold', async () => {
    await setWatchPrefs({ watchedAt: 0.95 });
    // Next Up shows at 94% and counts down 10 s: still short of 95% when it plays the next one.
    const duration = 1320;
    recordProgress(show, first, leftAt(duration * NEXT_UP_AT + DEFAULT_COUNTDOWN, duration, true), duration);
    expect(episodeState(show, 1, ep(1)).kind).toBe('watched');
    expect(resumePosition(show, ep(1))).toBe(0);
  });

  it('keeps an episode in progress when Next is pressed part-way', async () => {
    await setWatchPrefs({ watchedAt: 0.9 });
    recordProgress(show, first, leftAt(400, 1320, false), 1320);
    expect(episodeState(show, 1, ep(1)).kind).toBe('in-progress');
    expect(resumePosition(show, ep(1))).toBe(400);
  });
});
