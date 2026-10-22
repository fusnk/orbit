import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./parental', () => ({ allowedTitles: vi.fn(async (titles: unknown[]) => titles) }));
vi.mock('./streaming', () => ({ streamingRegion: vi.fn(async () => 'US') }));
vi.mock('./tmdb', () => ({ tmdbConnected: vi.fn(async () => true), tmdbSourcePage: vi.fn() }));
vi.mock('./release-calendar', async (original) => ({
  ...(await original<typeof import('./release-calendar')>()),
  calendarFilms: (saved: unknown[]) => saved,
}));

import { invoke } from '@tauri-apps/api/core';
import { savedFilmReleases } from './release-dates';
import type { Title } from './titles';

const film = (id: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [] });
const films = [film('tt1'), film('tt2')];
const found = (ids: string[]) => ids.map((id) => ({ id, releases: [{ kind: 'digital', date: '2026-10-20' }] }));
const asked = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'tmdb_release_dates').length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12));
  vi.mocked(invoke).mockReset();
});
afterEach(() => vi.useRealTimers());

it('asks again for saved films on a new day, and after a partial answer', async () => {
  vi.mocked(invoke).mockResolvedValue(found(['tt1']));
  await savedFilmReleases(films);
  await Promise.resolve();
  // tt2's lookup failed in Rust: not remembered.
  vi.mocked(invoke).mockResolvedValue(found(['tt1', 'tt2']));
  await savedFilmReleases(films);
  expect(asked()).toBe(2);
  // A full answer is kept for the day…
  await savedFilmReleases(films);
  expect(asked()).toBe(2);
  // …and asked again the next.
  vi.setSystemTime(new Date(2026, 9, 14, 12));
  await savedFilmReleases(films);
  expect(asked()).toBe(3);
});
