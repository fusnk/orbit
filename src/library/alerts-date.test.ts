import { afterAll, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { airedDateText } = await import('./alerts');

afterAll(() => {
  vi.unstubAllEnvs();
});

it('the bell dates an air date as that calendar day, wherever the person is', () => {
  vi.stubEnv('TZ', 'America/New_York');
  expect(airedDateText(Date.parse('2026-10-15T00:00:00.000Z'), 'en-US')).toBe('Oct 15');
});

it('the bell dates an exact air time by the local day it aired on', () => {
  vi.stubEnv('TZ', 'America/New_York');
  // 02:00 UTC on the 15th is 22:00 on the 14th in New York.
  expect(airedDateText(Date.parse('2026-10-15T02:00:00Z'), 'en-US')).toBe('Oct 14');
});
