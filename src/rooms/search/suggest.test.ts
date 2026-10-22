import { afterEach, expect, it, vi } from 'vitest';
import type { DiscoverIntent } from '../../catalog/search-intent';

const asked = vi.hoisted(() => [] as { filters?: Record<string, string | number> | undefined }[]);
vi.mock('../../catalog/tmdb', () => ({
  tmdbSourcePage: async (source: (typeof asked)[number]) => {
    asked.push(source);
    return { titles: [], done: true };
  },
  personDetails: async () => null,
  recommendationsFor: async () => null,
  searchPeople: async () => null,
  searchTitles: async () => null,
}));

const { suggestionsFor } = await import('./suggest');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  asked.length = 0;
});

it('reads "new" as out by today where the person is, not in UTC', async () => {
  // 21:00 on 15 October five hours west of UTC: already the 16th in UTC.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T02:00:00Z'));
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300);
  const intent: DiscoverIntent = { kind: 'discover', text: '', media: 'movie', anime: false, genres: ['horror'], language: undefined, country: undefined, from: undefined, to: undefined, maxRuntime: undefined, sort: 'new' };
  await suggestionsFor(intent, 'new horror movies', 'all', async () => []);
  expect(asked[0]?.filters?.releaseDateLte).toBe('2026-10-15');
});
