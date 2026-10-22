import { afterAll, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../catalog/service', () => ({ loadMeta: vi.fn() }));

const { latestEpisodeText } = await import('./card-tags');

afterAll(() => {
  vi.unstubAllEnvs();
});

const item = { titleId: 'tt1', season: 14, episode: 19 };

it('a landscape card dates the latest episode by the day it aired where the person is', () => {
  vi.stubEnv('TZ', 'Europe/Berlin');
  // An air date, as the alerts keep it: the start of 2 October in Berlin (22:00 UTC on the 1st).
  expect(latestEpisodeText({ ...item, airedAt: new Date(2026, 9, 2).getTime() })).toBe('S14.E19 · Oct 2');
});

it('and an exact air time by the local day too', () => {
  vi.stubEnv('TZ', 'America/New_York');
  // 01:00 UTC on 3 October is 9 pm on the 2nd in New York.
  expect(latestEpisodeText({ ...item, airedAt: Date.parse('2026-10-03T01:00:00Z'), exact: true })).toBe('S14.E19 · Oct 2');
});
