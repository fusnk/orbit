import { describe, expect, it, vi } from 'vitest';

const exact: Record<string, number> = {};
vi.mock('../catalog/air-times', () => ({ exactAirTime: (id: string, season: number, episode: number) => exact[`${id}:${season}:${episode}`], loadAirTimes: async () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
// 50 shows already reminded: the most kept.
const full = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`tt${100 + i}`, { days: 0, name: `Show ${i}` }]));
vi.mock('./profiles', () => ({ profileSetting: async () => ({ key: 'alerts.reminders', value: { shows: full, sent: {} } }) }));

const { dueReminders, parseReminders, reminderFor, reminderText, setReminder } = await import('./reminders');
const { setClock } = await import('../lib/clock');

// Local times, so the test reads the same in any time zone.
const local = (day: number, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
// Episode 5 airs on 20 Oct (a date only, as addons give it); episode 6 on 27 Oct at 21:00 (an exact time).
const show = {
  id: 'tt9',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [
    { number: 0, episodes: [{ id: 's', number: 1, title: 'Special', released: '2026-10-20T00:00:00.000Z' }] },
    {
      number: 2,
      episodes: [
        { id: 'e5', number: 5, title: 'Five', released: '2026-10-20T00:00:00.000Z' },
        { id: 'e6', number: 6, title: 'Six', released: '2026-10-27T00:00:00.000Z' },
      ],
    },
  ],
};
exact['tt9:2:6'] = local(27, 21);

describe('episode reminders', () => {
  it('read what was saved, dropping what isn’t valid', () => {
    expect(parseReminders({ shows: { tt9: { days: 3, name: 'Show' }, tt8: { days: 2, name: 'Bad' }, tt7: 'x' }, sent: { e1: 5, e2: 'x' } })).toEqual({ shows: { tt9: { days: 3, name: 'Show' } }, sent: { e1: 5 } });
    expect(parseReminders(null)).toEqual({ shows: {}, sent: {} });
  });

  it('are due from the start of the day N days before, until the episode is out', () => {
    expect(dueReminders(show, 3, local(16, 23), {})).toEqual([]);
    expect(dueReminders(show, 3, local(17, 0, 1), {}).map((d) => d.videoId)).toEqual(['e5']);
    expect(dueReminders(show, 0, local(20, 22), {}).map((d) => d.videoId)).toEqual(['e5']);
    expect(dueReminders(show, 0, local(21, 0, 1), {})).toEqual([]);
    // With the exact time: on its day until 21:00, not after.
    expect(dueReminders(show, 1, local(26, 8), {}).map((d) => [d.videoId, d.exact])).toEqual([['e6', true]]);
    expect(dueReminders(show, 1, local(27, 21, 1), {})).toEqual([]);
  });

  it('remind each episode once, and never for specials', () => {
    expect(dueReminders(show, 7, local(20, 9), { e5: local(13) }).map((d) => d.videoId)).toEqual(['e6']);
  });

  it('say when it’s out', async () => {
    await setClock('24');
    const [e6] = dueReminders(show, 1, local(26, 8), {});
    expect(reminderText(e6!, local(26, 8))).toBe('S2 · E6 is out tomorrow at 21:00.');
    expect(reminderText(e6!, local(27, 8))).toBe('S2 · E6 is out today at 21:00.');
    const [e5] = dueReminders(show, 7, local(13, 9), {});
    expect(reminderText(e5!, local(13, 9))).toBe('S2 · E5 is out in 7 days.');
  });

  it('refuse a new show past the most kept, instead of losing it on restart', async () => {
    expect(await setReminder({ id: 'tt1', name: 'One too many' }, 3)).toBe(false);
    expect(reminderFor('tt1')).toBeNull();
    // A show already reminded can still be changed or removed.
    expect(await setReminder({ id: 'tt100', name: 'Show 0' }, 7)).toBe(true);
    expect(reminderFor('tt100')).toBe(7);
    expect(await setReminder({ id: 'tt101', name: 'Show 1' }, null)).toBe(true);
    expect(await setReminder({ id: 'tt1', name: 'Now there’s room' }, 3)).toBe(true);
  });
});
