import { describe, expect, it } from 'vitest';
import type { Title } from '../catalog/titles';
import { computeStats, rangeStart, type WatchHistory } from './stats';
import type { Progress } from './watch';

const title = (id: string, type: string, extra: Partial<Title> = {}): Title => ({ id, type, name: id, genres: [], origins: [], ...extra });
const at = (y: number, m: number, d: number, hour = 20) => new Date(y, m - 1, d, hour).getTime();

function row(titleId: string, when: number, extra: Partial<Progress> = {}): Progress {
  return { videoId: `${titleId}:${when}`, titleId, season: null, episode: null, position: 0, duration: 0, watched: true, updatedAt: when, ...extra };
}

const episode = (titleId: string, n: number, when: number, extra: Partial<Progress> = {}) => row(titleId, when, { videoId: `${titleId}:1:${n}`, season: 1, episode: n, duration: 45 * 60, position: 45 * 60, ...extra });

const NOW = new Date(2026, 9, 3, 12); // 3 October 2026

const movieA = title('movie-a', 'movie', { runtime: '2h 0min', genres: ['Drama', 'Crime'] });
const movieB = title('movie-b', 'movie', { runtime: '90 min', genres: ['Drama'] });
const show = title('show', 'series', { genres: ['Comedy'] });

const history: WatchHistory = {
  titles: [movieA, movieB, show].map((t) => ({ title: t, completed: false, updatedAt: 0 })),
  progress: [
    // Watched with a known duration: 100 minutes, not the listed 120.
    row('movie-a', at(2026, 3, 10), { duration: 100 * 60, position: 100 * 60 }),
    // Marked watched from a menu: the listed runtime stands in.
    row('movie-b', at(2025, 11, 20)),
    episode('show', 1, at(2026, 9, 1)),
    episode('show', 2, at(2026, 9, 2)),
    episode('show', 3, at(2026, 9, 3, 1)),
    // Part way through: counts the time, not as an episode watched.
    episode('show', 4, at(2026, 9, 5), { watched: false, position: 30 * 60 }),
    // A peek under a minute, and an unmarked row: neither counts.
    episode('show', 5, at(2026, 9, 6), { watched: false, position: 20 }),
    row('movie-b', at(2026, 9, 7), { videoId: 'unmarked', watched: false }),
    // Long ago.
    row('movie-a', at(2019, 6, 1), { videoId: 'old', duration: 100 * 60 }),
  ],
};

describe('watch stats', () => {
  it('starts ranges at the year, 12 months back, or never', () => {
    expect(rangeStart('year', NOW)).toBe(new Date(2026, 0, 1).getTime());
    expect(rangeStart('12m', NOW)).toBe(new Date(2025, 10, 1).getTime());
    expect(rangeStart('all', NOW)).toBe(-Infinity);
  });

  it('totals movies, episodes and time for this year', () => {
    const stats = computeStats(history, 'year', NOW);
    expect(stats.movies).toBe(1);
    expect(stats.episodes).toBe(3);
    expect(stats.minutes).toBe(100 + 3 * 45 + 30);
  });

  it('falls back to the listed runtime and respects the range', () => {
    const year = computeStats(history, '12m', NOW);
    expect(year.movies).toBe(2);
    expect(year.minutes).toBe(100 + 90 + 3 * 45 + 30);
    const all = computeStats(history, 'all', NOW);
    expect(all.movies).toBe(3);
    expect(all.minutes).toBe(100 + 90 + 3 * 45 + 30 + 100);
  });

  it('estimates imported history with no length known, and says so', () => {
    const imported: WatchHistory = {
      titles: [title('film', 'movie'), title('series', 'series')].map((t) => ({ title: t, completed: true, updatedAt: 0 })),
      progress: [row('film', at(2026, 9, 1)), episode('series', 1, at(2026, 9, 1), { duration: 0, position: 0 })],
    };
    const stats = computeStats(imported, 'year', NOW);
    expect(stats.minutes).toBe(110 + 40);
    expect(stats.estimated).toBe(true);
    expect(computeStats(history, 'year', NOW).estimated).toBe(false);
  });

  it('buckets time by month, oldest first', () => {
    const year = computeStats(history, 'year', NOW);
    expect(year.months).toHaveLength(10);
    expect(year.months[2]).toEqual({ start: new Date(2026, 2, 1).getTime(), minutes: 100 });
    expect(year.months[8]!.minutes).toBe(3 * 45 + 30);
    const twelve = computeStats(history, 'all', NOW);
    expect(twelve.months).toHaveLength(12);
    expect(twelve.months[0]).toEqual({ start: new Date(2025, 10, 1).getTime(), minutes: 90 });
  });

  it('finds streaks, busiest day and hour', () => {
    const stats = computeStats(history, 'year', NOW);
    // 1, 2 and 3 September in a row (the third just after midnight), then the 5th.
    expect(stats.streak).toBe(3);
    expect(stats.days).toBe(5);
    expect(stats.busiestHour).toBe(20);
    expect(stats.busiestWeekday).not.toBeNull();
  });

  it('ranks genres, shows and top titles', () => {
    const stats = computeStats(history, '12m', NOW);
    expect(stats.genres[0]).toEqual({ genre: 'Drama', count: 2 });
    expect(stats.shows).toEqual([{ title: show, episodes: 3 }]);
    expect(stats.top.map((t) => t.title.id)).toEqual(['show', 'movie-a', 'movie-b']);
  });

  it('counts watched titles that list no genres', () => {
    const imported = title('imported', 'movie');
    const stats = computeStats({ titles: [...history.titles, { title: imported, completed: true, updatedAt: 0 }], progress: [...history.progress, row('imported', at(2026, 9, 8))] }, '12m', NOW);
    expect(stats.missingGenres).toBe(1);
    expect(stats.genres.map((g) => g.genre)).toEqual(['Drama', 'Comedy', 'Crime']);
    expect(computeStats(history, '12m', NOW).missingGenres).toBe(0);
  });

  it('is empty without history', () => {
    const stats = computeStats({ titles: [], progress: [] }, 'all', NOW);
    expect(stats).toMatchObject({ movies: 0, episodes: 0, minutes: 0, streak: 0, days: 0, busiestWeekday: null, busiestHour: null, genres: [], shows: [], top: [] });
    expect(stats.months.every((m) => m.minutes === 0)).toBe(true);
  });
});
