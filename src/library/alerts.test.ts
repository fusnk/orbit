import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadMeta } from '../catalog/service';
import type { Episode, Title } from '../catalog/titles';
import { alertItems, CHECK_INTERVAL_MS, checkIfOverdue, checkNewEpisodes, followedSeries, freshEpisodes, loadAlerts, markAllRead, parsePrefs, setAlertPrefs, toastsFor, unreadAlerts } from './alerts';
import { loadLibrary } from './library';
import { loadWatch, recordProgress, setEpisodeWatched } from './watch';

const mocked = vi.mocked(invoke);
const meta = vi.mocked(loadMeta);
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T12:00:00Z');
const day = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);
const ep = (number: number, released: string): Episode => ({ id: `tt9:2:${number}`, number, title: `Episode ${number}`, released });
const show: Title = {
  id: 'tt9',
  type: 'series',
  name: 'Show',
  poster: 'https://img.example/p.jpg',
  genres: [],
  origins: [],
  seasons: [
    { number: 0, episodes: [{ id: 'tt9:0:1', number: 1, title: 'Special', released: day(1) }] },
    { number: 2, episodes: [ep(1, day(20)), ep(2, day(3)), ep(3, day(1)), ep(4, day(-2))] },
  ],
};
const settingsStore = new Map<string, unknown>();
/** What `profile_list` answers: no content limit (alerts-limit.test.ts has one). */
const profiles: unknown[] = [];

beforeEach(async () => {
  mocked.mockReset();
  settingsStore.clear();
  mocked.mockImplementation(async (cmd, args) => {
    const a = args as { key?: string; value?: unknown };
    if (cmd === 'watch_list') return { titles: [], progress: [] };
    if (cmd === 'profile_active') return 'p1';
    if (cmd === 'profile_list') return profiles;
    if (cmd === 'settings_get') return settingsStore.get(a.key!) ?? null;
    if (cmd === 'settings_set') settingsStore.set(a.key!, a.value);
    return undefined;
  });
  meta.mockReset();
  meta.mockResolvedValue(show);
  await loadWatch();
  await loadAlerts();
});

describe('freshEpisodes', () => {
  it('lists aired, unwatched, unannounced episodes of regular seasons in the window', () => {
    const fresh = freshEpisodes(show, NOW - 7 * DAY, NOW, new Set(['tt9:2:3']));
    expect(fresh.map((f) => f.videoId)).toEqual(['tt9:2:2']);
    expect(fresh[0]).toMatchObject({ titleId: 'tt9', show: 'Show', season: 2, episode: 2, title: 'Episode 2', poster: 'https://img.example/p.jpg', read: false });
  });

  it('count a date-only air date from the start of that day locally, not UTC midnight', () => {
    const tonight = { ...show, seasons: [{ number: 2, episodes: [ep(7, '2026-10-20T00:00:00.000Z')] }] };
    // The evening before, locally: not out yet, wherever the person is.
    expect(freshEpisodes(tonight, new Date(2026, 9, 18).getTime(), new Date(2026, 9, 19, 23, 59).getTime(), new Set())).toEqual([]);
    expect(freshEpisodes(tonight, new Date(2026, 9, 18).getTime(), new Date(2026, 9, 20, 0, 1).getTime(), new Set()).map((f) => f.airedAt)).toEqual([new Date(2026, 9, 20).getTime()]);
  });

  it('lists an episode the addon lists twice once', () => {
    const twice = { ...show, seasons: [{ number: 2, episodes: [ep(2, day(3)), ep(2, day(3))] }] };
    expect(freshEpisodes(twice, NOW - 7 * DAY, NOW, new Set()).map((f) => f.videoId)).toEqual(['tt9:2:2']);
  });

  it('leaves out watched episodes', () => {
    setEpisodeWatched(show, 2, ep(2, day(3)), true);
    expect(freshEpisodes(show, NOW - 7 * DAY, NOW, new Set()).map((f) => f.videoId)).toEqual(['tt9:2:3']);
  });
});

describe('followedSeries', () => {
  const lib: Title = { id: 'tt1', type: 'series', name: 'Saved', genres: [], origins: [] };
  const film: Title = { id: 'tt2', type: 'movie', name: 'Film', genres: [], origins: [] };
  it('is the watched series only, or the library too', () => {
    expect(followedSeries('watching', [lib, film], [show]).map((t) => t.id)).toEqual(['tt9']);
    expect(followedSeries('library', [lib, film, show], [show]).map((t) => t.id)).toEqual(['tt9', 'tt1']);
  });
});

describe('toastsFor', () => {
  const item = (n: number, s = 'Show') => ({ videoId: `v${n}`, titleId: 't', show: s, season: 2, episode: n, title: `Ep ${n}`, airedAt: NOW, read: false });
  it('is one toast per episode, or one for four or more', () => {
    expect(toastsFor([item(1), item(2)])).toEqual([
      { title: 'Show', body: 'S2E1 ‘Ep 1’ is out' },
      { title: 'Show', body: 'S2E2 ‘Ep 2’ is out' },
    ]);
    const grouped = toastsFor([item(1), item(2), item(3, 'Other'), item(4)]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.body).toBe('4 new episodes from shows you follow: Show, Other');
  });

  // The Japanese catalog is compiled on first import; alongside the rest of the suite that alone can pass the time limit.
  it('lists the shows as the language writes a list', { timeout: 60_000 }, async () => {
    const { setLanguage } = await import('../i18n');
    await setLanguage('ja').catch(() => {});
    try {
      expect(toastsFor([item(1), item(2), item(3, 'Other'), item(4)])[0]!.body).toContain('Show、Other');
    } finally {
      await setLanguage('en').catch(() => {});
    }
  });
});

describe('checkNewEpisodes', () => {
  it('announces the past week once, saves it per profile, and sends no toasts the first time', async () => {
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    await checkNewEpisodes(NOW);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt9:2:2']);
    expect(unreadAlerts()).toBe(2);
    expect(settingsStore.get('alerts.seen.p1')).toMatchObject({ checkedAt: NOW });
    expect(mocked).not.toHaveBeenCalledWith('alerts_notify', expect.anything());
    // The same episodes never come back, read or not.
    markAllRead();
    await checkNewEpisodes(NOW + DAY);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt9:2:2']);
    expect(unreadAlerts()).toBe(0);
  });

  it('counts an announced episode as read once it is watched', async () => {
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    await checkNewEpisodes(NOW);
    expect(unreadAlerts()).toBe(2);
    setEpisodeWatched(show, 2, ep(2, day(3)), true);
    expect(unreadAlerts()).toBe(1);
    expect(alertItems().find((i) => i.videoId === 'tt9:2:2')?.read).toBe(true);
    expect((settingsStore.get('alerts.seen.p1') as { items: { videoId: string; read: boolean }[] }).items.find((i) => i.videoId === 'tt9:2:2')?.read).toBe(true);
  });

  it('shows system notifications for episodes found after the first check when asked', async () => {
    settingsStore.set('alerts.prefs.p1', { toasts: true });
    // Saved by a version without `announced`, which looked only after `checkedAt`: tt9:2:2 aired before it.
    settingsStore.set('alerts.seen.p1', { checkedAt: NOW - 2 * DAY, items: [] });
    await loadAlerts();
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    await checkNewEpisodes(NOW);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3']);
    expect(mocked).toHaveBeenCalledWith('alerts_notify', { title: 'Show', body: 'S2E3 ‘Episode 3’ is out' });
    expect(mocked.mock.calls.filter(([cmd]) => cmd === 'alerts_notify')).toHaveLength(1);
  });

  it('fills the bell quietly when the scope widens to the whole library, rather than toasting the backlog', async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      mocked.mockImplementation(async (cmd, args) => {
        const a = args as { key?: string; value?: unknown };
        if (cmd === 'watch_list') return { titles: [], progress: [] };
        // A saved series nobody has watched: its past week is news only to the bell.
        if (cmd === 'library_list') return [{ id: 'tt9', addedAt: Date.parse(day(5)), title: { meta: { id: 'tt9', type: 'series', name: 'Show' } } }];
        if (cmd === 'profile_active') return 'p1';
        if (cmd === 'profile_list') return profiles;
        if (cmd === 'settings_get') return settingsStore.get(a.key!) ?? null;
        if (cmd === 'settings_set') settingsStore.set(a.key!, a.value);
        return undefined;
      });
      await loadLibrary();
      settingsStore.set('alerts.prefs.p1', { toasts: true, scope: 'watching' });
      settingsStore.set('alerts.seen.p1', { checkedAt: NOW - 2 * DAY, items: [], announced: {}, follows: {} });
      await loadAlerts();
      await setAlertPrefs({ scope: 'library' });
      // The check the switch started.
      await checkNewEpisodes();
      expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt9:2:2']);
      expect(mocked).not.toHaveBeenCalledWith('alerts_notify', expect.anything());
      // Episodes that come later are announced as usual.
      meta.mockResolvedValue({ ...show, seasons: [{ number: 2, episodes: [...show.seasons![1]!.episodes, ep(5, day(-1))] }] });
      await checkNewEpisodes(NOW + DAY);
      expect(mocked.mock.calls.filter(([cmd]) => cmd === 'alerts_notify')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after the upgrade, announces nothing the old version had already looked past', async () => {
    const other: Title = { ...show, id: 'tt8', name: 'Other', seasons: [{ number: 1, episodes: [{ id: 'tt8:1:1', number: 1, title: 'Pilot', released: day(4) }] }] };
    meta.mockImplementation(async (_type, id) => (id === 'tt9' ? show : other));
    const old = { videoId: 'tt9:2:2', titleId: 'tt9', show: 'Show', season: 2, episode: 2, title: 'Episode 2', airedAt: Date.parse(day(3)), read: true };
    settingsStore.set('alerts.prefs.p1', { toasts: true });
    settingsStore.set('alerts.seen.p1', { checkedAt: NOW - 2 * DAY, items: [old] });
    await loadAlerts();
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    recordProgress(other, { season: 1, episode: { id: 'tt8:1:0', number: 0, title: 'x' } }, 10, 2400);
    // Marking read before the first check keeps the old format, so that check still knows.
    markAllRead();
    expect(settingsStore.get('alerts.seen.p1')).not.toHaveProperty('announced');
    await checkNewEpisodes(NOW);
    // tt8:1:1 aired 4 days ago, before the old version's last check: not announced now.
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt9:2:2']);
    expect(mocked).toHaveBeenCalledWith('alerts_notify', { title: 'Show', body: 'S2E3 ‘Episode 3’ is out' });
    expect(mocked.mock.calls.filter(([cmd]) => cmd === 'alerts_notify')).toHaveLength(1);
    // From now on in the new format, with what the bell held remembered as announced.
    const saved = settingsStore.get('alerts.seen.p1') as { announced: Record<string, number> };
    expect(Object.keys(saved.announced).sort()).toEqual(['tt9:2:2', 'tt9:2:3']);
    await loadAlerts();
    await checkNewEpisodes(NOW + DAY);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt9:2:2']);
  });

  it('announces nothing from before a series was followed, but still a late-listed episode', async () => {
    const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
    const pilot = (released: string): Title => ({ ...show, id: 'tt7', name: 'New', seasons: [{ number: 1, episodes: [{ id: 'tt7:1:1', number: 1, title: 'Old', released: at(5 * DAY) }, { id: 'tt7:1:2', number: 2, title: 'Late', released }] }] });
    // tt9 was followed at the last check, 2 days ago; tt7 is started since.
    settingsStore.set('alerts.seen.p1', { checkedAt: NOW - 2 * DAY, items: [], announced: {}, follows: { tt9: NOW - 30 * DAY } });
    await loadAlerts();
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    const late = pilot(at(2 * DAY + 12 * 60 * 60 * 1000)); // aired before the last check, listed only now: within the day's grace
    recordProgress(late, { season: 1, episode: { id: 'tt7:1:0', number: 0, title: 'x' } }, 10, 2400);
    meta.mockImplementation(async (_type, id) => (id === 'tt9' ? show : late));
    await checkNewEpisodes(NOW);
    // tt9 keeps the whole week; tt7's episode from 5 days ago predates following it.
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt7:1:2', 'tt9:2:2']);
    // Its floor is remembered: the old episode doesn't come in a later check either.
    await checkNewEpisodes(NOW + DAY);
    expect(alertItems().map((i) => i.videoId)).not.toContain('tt7:1:1');
  });

  it('announces new episodes again after the clock was set back from the future', async () => {
    // The last check ran while the clock read a month ahead, and saved that as when tt9 was followed.
    settingsStore.set('alerts.seen.p1', { checkedAt: NOW + 30 * DAY, items: [], announced: {}, follows: { tt9: NOW + 30 * DAY } });
    await loadAlerts();
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    // The clock is right again; episode 4 airs two days from NOW.
    await checkNewEpisodes(NOW + 3 * DAY);
    expect(alertItems().map((i) => i.videoId)).toContain('tt9:2:4');
  });

  it('for a saved series (library scope), announces only what aired after it was saved', async () => {
    const saved: Title = { ...show, id: 'tt6', name: 'Saved' };
    mocked.mockImplementation(async (cmd, args) => {
      const a = args as { key?: string; value?: unknown };
      if (cmd === 'watch_list') return { titles: [], progress: [] };
      if (cmd === 'library_list') return [{ id: 'tt6', addedAt: Date.parse(day(2)), title: { meta: { id: 'tt6', type: 'series', name: 'Saved' } } }];
      if (cmd === 'profile_active') return 'p1';
      if (cmd === 'profile_list') return profiles;
      if (cmd === 'settings_get') return settingsStore.get(a.key!) ?? null;
      if (cmd === 'settings_set') settingsStore.set(a.key!, a.value);
      return undefined;
    });
    await loadLibrary();
    settingsStore.set('alerts.prefs.p1', { scope: 'library' });
    await loadAlerts();
    meta.mockResolvedValue({ ...saved, seasons: [{ number: 1, episodes: [{ id: 'tt6:1:1', number: 1, title: 'Before', released: day(3) }, { id: 'tt6:1:2', number: 2, title: 'After', released: day(1) }] }] });
    await checkNewEpisodes(NOW);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt6:1:2']);
  });

  it('does nothing while alerts are off, and keeps the clock when nothing could be looked up', async () => {
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    settingsStore.set('alerts.prefs.p1', { enabled: false });
    await loadAlerts();
    await checkNewEpisodes(NOW);
    expect(meta).not.toHaveBeenCalled();
    settingsStore.set('alerts.prefs.p1', { enabled: true });
    await loadAlerts();
    meta.mockRejectedValue(new Error('offline'));
    await checkNewEpisodes(NOW);
    expect(settingsStore.has('alerts.seen.p1')).toBe(false);
  });

  it('looks again within minutes when nothing could be looked up, not at the next timed check hours later', async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
      meta.mockRejectedValue(new Error('offline'));
      await checkNewEpisodes();
      expect(alertItems()).toEqual([]);
      // The connection is back.
      meta.mockResolvedValue(show);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt9:2:2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('looks at the whole week again for a series that failed, while the others move on', async () => {
    const other: Title = { ...show, id: 'tt8', name: 'Other', seasons: [{ number: 1, episodes: [{ id: 'tt8:1:1', number: 1, title: 'Pilot', released: day(2) }] }] };
    settingsStore.set('alerts.seen.p1', { checkedAt: NOW - 4 * DAY, items: [] });
    await loadAlerts();
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    recordProgress(other, { season: 1, episode: other.seasons![0]!.episodes[0]! }, 10, 2400);
    // tt9 fails this time; tt8 is looked up, so the clock moves on.
    meta.mockImplementation(async (_type, id) => (id === 'tt9' ? Promise.reject(new Error('down')) : other));
    await checkNewEpisodes(NOW - 2 * DAY + 1000);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt8:1:1']);
    // Next time tt9 answers: its episode from 3 days ago (before the last check) is still found.
    meta.mockImplementation(async (_type, id) => (id === 'tt9' ? show : other));
    await checkNewEpisodes(NOW);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt9:2:3', 'tt8:1:1', 'tt9:2:2']);
  });

  it('looks when the clock says a timed check is overdue (the PC slept through it), and not before', async () => {
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    await checkNewEpisodes(NOW);
    meta.mockClear();
    await checkIfOverdue(NOW + CHECK_INTERVAL_MS - 60_000);
    expect(meta).not.toHaveBeenCalled();
    await checkIfOverdue(NOW + CHECK_INTERVAL_MS + 8 * 60 * 60_000);
    expect(meta).toHaveBeenCalledWith('series', 'tt9');
    expect(settingsStore.get('alerts.seen.p1')).toMatchObject({ checkedAt: NOW + CHECK_INTERVAL_MS + 8 * 60 * 60_000 });
  });

  it('looks right away when alerts are turned on, not at the next timed check', async () => {
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    settingsStore.set('alerts.prefs.p1', { enabled: false });
    await loadAlerts();
    await setAlertPrefs({ toasts: true });
    expect(meta).not.toHaveBeenCalled();
    await setAlertPrefs({ enabled: true });
    await vi.waitFor(() => expect(meta).toHaveBeenCalledWith('series', 'tt9'));
  });
});

describe('saved alerts', () => {
  // The addon schema accepts video ids up to 512 characters (src/addons/schema.ts `id`).
  const longId = 'x'.repeat(250);
  const pilotOf = (id: string): Title => ({
    id,
    type: 'series',
    name: 'Show',
    genres: [],
    origins: [],
    seasons: [{ number: 1, episodes: [{ id: `${id}:1:1`, number: 1, title: 'Pilot', released: new Date(NOW - DAY).toISOString() }] }],
  });

  it('keeps every alert when one has a long (schema-valid) video id, and drops a bad one alone', async () => {
    const normal = pilotOf('tt1');
    const long = pilotOf(longId);
    meta.mockImplementation(async (_t, id) => (id === longId ? long : normal));
    recordProgress(normal, { season: 1, episode: { id: 'tt1:1:0', number: 0, title: 'x' } }, 100, 1000);
    recordProgress(long, { season: 1, episode: { id: `${longId}:1:0`, number: 0, title: 'x' } }, 100, 1000);
    await checkNewEpisodes(NOW - 3 * DAY);
    await checkNewEpisodes(NOW);
    expect(alertItems()).toHaveLength(2);
    await loadAlerts();
    expect(alertItems()).toHaveLength(2);
    const saved = settingsStore.get('alerts.seen.p1') as { items: unknown[] };
    settingsStore.set('alerts.seen.p1', { ...saved, items: [...saved.items, { videoId: 'y'.repeat(600) }] });
    await loadAlerts();
    expect(alertItems()).toHaveLength(2);
  });

  it('announces an episode the addon lists only after a check passed its air time', async () => {
    const base: Title = { id: 'tt5', type: 'series', name: 'Late', genres: [], origins: [], seasons: [{ number: 1, episodes: [{ id: 'tt5:1:0', number: 0, title: 'x' }] }] };
    meta.mockImplementation(async () => base);
    recordProgress(base, { season: 1, episode: { id: 'tt5:1:0', number: 0, title: 'x' } }, 100, 1000);
    await checkNewEpisodes(NOW - 3 * DAY);
    await checkNewEpisodes(NOW - DAY); // not in the metadata yet
    // The metadata catches up: the episode aired 2 days ago, before the last check, inside the lookback.
    const later: Title = { ...base, seasons: [{ number: 1, episodes: [{ id: 'tt5:1:1', number: 1, title: 'Pilot', released: new Date(NOW - 2 * DAY).toISOString() }] }] };
    meta.mockImplementation(async () => later);
    await checkNewEpisodes(NOW);
    expect(alertItems().map((i) => i.videoId)).toEqual(['tt5:1:1']);
  });

  it('announces an episode once although the bell no longer holds it', async () => {
    recordProgress(show, { season: 2, episode: ep(1, day(20)) }, 2000, 2400);
    await checkNewEpisodes(NOW);
    expect(alertItems()).toHaveLength(2);
    // Cleared out of the bell (e.g. its 60-item cap), but remembered as announced.
    const saved = settingsStore.get('alerts.seen.p1') as object;
    settingsStore.set('alerts.seen.p1', { ...saved, items: [] });
    await loadAlerts();
    await checkNewEpisodes(NOW + DAY);
    expect(alertItems()).toEqual([]);
  });
});

describe('parsePrefs', () => {
  it('fills defaults for anything missing or odd', () => {
    expect(parsePrefs(undefined)).toEqual({ enabled: true, toasts: false, scope: 'watching' });
    expect(parsePrefs({ enabled: false, scope: 'everything' })).toEqual({ enabled: false, toasts: false, scope: 'watching' });
  });
});
