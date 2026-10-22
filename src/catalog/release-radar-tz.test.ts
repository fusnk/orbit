import { afterAll, expect, it, vi } from 'vitest';
import { episodeDay } from './release-radar';

afterAll(() => {
  vi.unstubAllEnvs();
});

it('puts an episode on the local day it comes out', () => {
  vi.stubEnv('TZ', 'America/New_York');
  // 01:00 UTC on the 21st is 9 pm on the 20th in New York: the Radar shows it on the 20th, as the bell and title page do.
  expect(episodeDay('2026-10-21T01:00:00.000Z')).toEqual(new Date(2026, 9, 20));
  // A date alone (UTC midnight, or no time) stays that calendar day.
  expect(episodeDay('2026-10-28T00:00:00.000Z')).toEqual(new Date(2026, 9, 28));
  expect(episodeDay('2026-10-28')).toEqual(new Date(2026, 9, 28));
  // An exact air time wins, on its local day.
  expect(episodeDay('2026-10-21T00:00:00.000Z', Date.UTC(2026, 9, 21, 1))).toEqual(new Date(2026, 9, 20));
  vi.stubEnv('TZ', 'Asia/Tokyo');
  expect(episodeDay('2026-10-21T01:00:00.000Z')).toEqual(new Date(2026, 9, 21));
  expect(episodeDay('2026-10-28T00:00:00.000Z')).toEqual(new Date(2026, 9, 28));
  expect(episodeDay(undefined)).toBeUndefined();
  expect(episodeDay('soon')).toBeUndefined();
});
