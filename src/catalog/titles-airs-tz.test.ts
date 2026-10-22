import { afterAll, expect, it, vi } from 'vitest';
import { seasonsFrom } from './titles';

afterAll(() => {
  vi.unstubAllEnvs();
});

it('an episode listed with its real air time says the local day it airs on', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const now = new Date(2026, 9, 20, 12);
  const [season] = seasonsFrom(
    [
      // 01:00 UTC on the 21st is 9 pm on the 20th in New York: out tonight, not tomorrow.
      { id: 'moment', season: 1, episode: 1, released: '2026-10-21T01:00:00.000Z' },
      // A date alone stays that calendar day.
      { id: 'date', season: 1, episode: 2, released: '2026-10-28T00:00:00.000Z' },
    ],
    now,
  );
  expect(season!.episodes.map((e) => e.airs)).toEqual(['Airs Oct 20', 'Airs Oct 28']);
});
