import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/ipc', () => ({ settings: { get: async (key: string) => saved.get(key) ?? null, set: async (key: string, value: unknown) => void saved.set(key, value) } }));

const { invoke } = await import('@tauri-apps/api/core');
const { airTimeLabel, exactAirTime, loadAirTimes, loadAirTimesSetting, lookupId, setAirTimesOn } = await import('./air-times');
const { setClock } = await import('../lib/clock');
const mocked = vi.mocked(invoke);

const show = { id: 'tt0944947', type: 'series' };
const at = new Date(2026, 9, 14, 21, 0).getTime();

describe('exact air times', () => {
  beforeEach(async () => {
    saved.clear();
    mocked.mockReset();
    await loadAirTimesSetting();
    await setClock('24');
  });

  it('asks nothing while the setting is off', async () => {
    expect(await loadAirTimes(show)).toBe(false);
    expect(mocked).not.toHaveBeenCalled();
    expect(exactAirTime(show.id, 1, 1)).toBeUndefined();
  });

  it('looks a series up once by its id, and knows each episode’s time', async () => {
    await setAirTimesOn(true);
    mocked.mockResolvedValue([{ season: 1, episode: 1, at }]);
    expect(await loadAirTimes(show)).toBe(true);
    expect(await loadAirTimes(show)).toBe(true);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked).toHaveBeenCalledWith('tvmaze_air_times', { id: 'tt0944947' });
    expect(exactAirTime(show.id, 1, 1)).toBe(at);
    expect(exactAirTime(show.id, 1, 2)).toBeUndefined();
  });

  it('keeps a bounded number of shows, letting the one looked up longest ago go', async () => {
    // Every series page opened over a long session used to stay here, with all its episodes' times.
    await setAirTimesOn(true);
    mocked.mockResolvedValue([{ season: 1, episode: 1, at }]);
    for (let i = 1; i <= 1000; i++) await loadAirTimes({ id: `tt${i}`, type: 'series' });
    expect(exactAirTime('tt1', 1, 1)).toBeUndefined();
    expect(exactAirTime('tt1000', 1, 1)).toBe(at);
  });

  it('matches by air date when TVmaze numbers the episode differently', async () => {
    await setAirTimesOn(true);
    const pilot = Date.UTC(2026, 9, 6, 1, 0);
    const second = Date.UTC(2026, 9, 13, 1, 0);
    const third = Date.UTC(2026, 9, 20, 1, 0);
    // TVmaze calls the addon's 1×2 (5 Oct) 1×1, and so on; it also has two episodes on 27 Oct.
    mocked.mockResolvedValue([
      { season: 1, episode: 1, at: pilot, day: '2026-10-05' },
      { season: 1, episode: 2, at: second, day: '2026-10-12' },
      { season: 1, episode: 3, at: third, day: '2026-10-19' },
      { season: 1, episode: 4, at: third + 7 * 86_400_000, day: '2026-10-26' },
      { season: 1, episode: 5, at: third + 7 * 86_400_000 + 3_600_000, day: '2026-10-26' },
    ]);
    await loadAirTimes({ id: 'tt3', type: 'series' });
    // Numbers and dates agree (TVmaze's local date, or the UTC date of its time): the numbered one.
    expect(exactAirTime('tt3', 1, 1, '2026-10-05T00:00:00.000Z')).toBe(pilot);
    expect(exactAirTime('tt3', 1, 1, '2026-10-06T00:00:00.000Z')).toBe(pilot);
    // Numbers disagree: the one episode TVmaze has that day.
    expect(exactAirTime('tt3', 1, 3, '2026-10-12T00:00:00.000Z')).toBe(second);
    expect(exactAirTime('tt3', 1, 9, '2026-10-19')).toBe(third);
    // No single match that day, or no date to check: nothing rather than a wrong time.
    expect(exactAirTime('tt3', 1, 6, '2026-10-26T00:00:00.000Z')).toBeUndefined();
    expect(exactAirTime('tt3', 1, 2, '2026-11-30T00:00:00.000Z')).toBeUndefined();
    expect(exactAirTime('tt3', 1, 2)).toBe(second);
  });

  it('ignores what isn’t a series, an id TVmaze can’t look up, and answers that don’t pass', async () => {
    await setAirTimesOn(true);
    expect(await loadAirTimes({ id: 'tt1', type: 'movie' })).toBe(false);
    expect(await loadAirTimes({ id: 'kitsu:12', type: 'series' })).toBe(false);
    expect(mocked).not.toHaveBeenCalled();
    mocked.mockResolvedValue([{ season: 1, episode: 0, at }]);
    expect(await loadAirTimes({ id: 'tt2', type: 'series' })).toBe(false);
    expect(lookupId('tvdb:121361')).toBe('tvdb:121361');
    expect(lookupId('tt12&x')).toBeNull();
  });

  it('says when, to the minute, in local time', () => {
    const morning = new Date(2026, 9, 14, 9, 30).getTime();
    expect(airTimeLabel(at, morning)).toBe('Out today at 21:00');
    expect(airTimeLabel(at, morning - 24 * 60 * 60 * 1000)).toBe('Out tomorrow at 21:00');
    expect(airTimeLabel(at, morning - 3 * 24 * 60 * 60 * 1000)).toMatch(/^Out .*14.* at 21:00$/);
  });
});
