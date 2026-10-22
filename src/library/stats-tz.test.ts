import { afterAll, expect, it, vi } from 'vitest';
import type { Title } from '../catalog/titles';
import { computeStats } from './stats';
import type { Progress } from './watch';

// src-tauri/src/import.rs `day_ms`: a Letterboxd date is noon that day where the person is,
// with the offset the page sent at import time (`getTimezoneOffset`, here on 13 October).
const letterboxdDay = (iso: string) => Date.parse(`${iso}T12:00:00Z`) + new Date(2026, 9, 13).getTimezoneOffset() * 60_000;
const film = (id: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], runtime: '100 min' });
const row = (id: string, at: number): Progress => ({ videoId: id, titleId: id, season: null, episode: null, position: 0, duration: 0, watched: true, updatedAt: at });
const history = (dates: string[]) => ({
  titles: dates.map((d, i) => ({ title: film(`tt${i + 1}`), completed: true, updatedAt: letterboxdDay(d) })),
  progress: dates.map((d, i) => row(`tt${i + 1}`, letterboxdDay(d))),
});
afterAll(() => {
  vi.unstubAllEnvs();
});

it('Letterboxd imports in Berlin land around midday, not at 1 am (no "night owl")', () => {
  vi.stubEnv('TZ', 'Europe/Berlin');
  const stats = computeStats(history(['2026-03-01', '2026-03-05', '2026-04-10']), 'year', new Date(2026, 9, 13, 12));
  expect(stats.busiestHour).toBeGreaterThanOrEqual(11);
  expect(stats.busiestHour).toBeLessThanOrEqual(13);
});

it('In New York a film logged on 1 January counts toward that year', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const stats = computeStats(history(['2026-01-01']), 'year', new Date(2026, 9, 13, 12));
  expect(stats.movies).toBe(1);
});
