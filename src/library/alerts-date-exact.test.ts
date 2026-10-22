import { afterAll, expect, it, vi } from 'vitest';

// 8 pm in New York (summer time) is midnight UTC: TVmaze gives the episode's time as 2026-10-15T00:00:00+00:00.
const AIRS = Date.parse('2026-10-15T00:00:00Z');
vi.mock('../catalog/air-times', () => ({ exactAirTime: () => AIRS, loadAirTimes: async () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { airedDateText, freshEpisodes } = await import('./alerts');

afterAll(() => {
  vi.unstubAllEnvs();
});

it('the bell dates an exact air time at midnight UTC by the local day it aired on', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const show = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [{ id: 'e1', number: 1, title: 'One', released: '2026-10-14T00:00:00.000Z' }] }] };
  const [item] = freshEpisodes(show, AIRS - 86_400_000, AIRS + 3_600_000, new Set());
  expect(item!.airedAt).toBe(AIRS);
  // It aired on the evening of the 14th there, not the 15th.
  expect(airedDateText(item!.airedAt, 'en-US', item!.exact)).toBe('Oct 14');
});
