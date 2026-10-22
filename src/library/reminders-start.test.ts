import { afterEach, expect, it, vi } from 'vitest';

// Episode 6 airs at 00:30 on 27 Oct (an exact time): "on the day" is due from midnight for half an hour.
const at = new Date(2026, 9, 27, 0, 30).getTime();
vi.mock('../catalog/air-times', () => ({ exactAirTime: (_id: string, season: number, episode: number) => (season === 2 && episode === 6 ? at : undefined), loadAirTimes: async () => true }));
const invoke = vi.fn(async () => {});
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../catalog/parental', () => ({ verdictNow: () => 'allowed' }));
vi.mock('../catalog/service', () => ({
  loadMeta: async () => ({
    id: 'tt9',
    type: 'series',
    name: 'Show',
    genres: [],
    origins: [],
    seasons: [{ number: 2, episodes: [{ id: 'e6', number: 6, title: 'Six', released: '2026-10-27T00:00:00.000Z' }] }],
  }),
}));
vi.mock('../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('./profiles', () => ({ profileSetting: async () => ({ key: 'alerts.reminders', value: { shows: { tt9: { days: 0, name: 'Show' } }, sent: {} } }) }));

const { checkReminders } = await import('./reminders');

afterEach(() => {
  vi.useRealTimers();
});

it('a reminder whose window is shorter than an hour still goes out between hourly checks', async () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 26, 23, 40) });
  await checkReminders();
  expect(invoke).not.toHaveBeenCalled();
  // The next hourly check would be at 00:40, after it aired: a check runs when the window opens instead.
  await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
  expect(invoke).toHaveBeenCalledWith('alerts_notify', expect.objectContaining({ title: 'Show' }));
});
