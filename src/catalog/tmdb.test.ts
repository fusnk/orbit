import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./parental', () => ({ allowedTitles: <T>(titles: T[]) => Promise.resolve(titles) }));

import { invoke } from '@tauri-apps/api/core';
import { recommendationsFor, tmdbRating } from './tmdb';

const mocked = vi.mocked(invoke);
const movie = (n: number) => ({ id: `tt${n}`, type: 'movie' as const });
const answer = (n: number, rating = 7) => [{ imdbId: `tt${n}`, kind: 'movie', name: `Film ${n}`, poster: null, background: null, year: null, overview: null, rating }];

beforeEach(() => mocked.mockReset());

describe('recommendationsFor', () => {
  it('keeps only the latest titles asked for, so a long session does not hold every title page’s answer', async () => {
    mocked.mockResolvedValue([]);
    // 100 is the cache's size; the first title has been pushed out by the 101st.
    for (let n = 1; n <= 101; n++) await recommendationsFor(movie(n));
    expect(mocked).toHaveBeenCalledTimes(101);
    await recommendationsFor(movie(101));
    expect(mocked).toHaveBeenCalledTimes(101);
    await recommendationsFor(movie(1));
    expect(mocked).toHaveBeenCalledTimes(102);
  });
});

describe('tmdbRating', () => {
  it('forgets the titles seen least recently past its limit', async () => {
    mocked.mockImplementation((cmd, args) => Promise.resolve(cmd === 'tmdb_recommendations' ? answer(Number((args as { imdbId: string }).imdbId.slice(2)) + 100_000) : null));
    await recommendationsFor(movie(1_000_001));
    expect(tmdbRating('tt1100001')).toBe(7);
    // 5000 more titles seen push the first one out.
    for (let n = 1; n <= 5000; n++) await recommendationsFor(movie(2_000_000 + n));
    expect(tmdbRating('tt1100001')).toBeUndefined();
    expect(tmdbRating('tt2105000')).toBe(7);
  });
});
