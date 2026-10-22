import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { alertItems, checkNewEpisodes, loadAlerts } from './alerts';
import { loadWatch, recordProgress } from './watch';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-05T12:00:00Z');
const store = new Map<string, unknown>([
  ['alerts.prefs.p1', { toasts: true }],
  ['alerts.seen.p1', { checkedAt: NOW - 3 * DAY, items: [] }],
]);
const certs: Record<string, string> = { tt8: 'TV-Y', tt9: 'TV-MA' };
const series = (id: string): Title => ({
  id,
  type: 'series',
  name: id,
  genres: [],
  origins: [],
  seasons: [{ number: 1, episodes: [{ id: `${id}:1:1`, number: 1, title: 'Pilot', released: new Date(NOW - 2 * DAY).toISOString() }] }],
});

it('a kids profile is not told about series its content limit hides', async () => {
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const a = args as { key?: string; value?: unknown; titles?: { id: string }[] };
    if (cmd === 'watch_list') return { titles: [], progress: [] };
    if (cmd === 'profile_active') return 'p1';
    if (cmd === 'profile_list') return [{ id: 'p1', name: 'Kid', color: '#46c28e', hasPin: false, contentLimit: { level: 'kids', allowUnrated: false, allowLiveTv: false } }];
    if (cmd === 'tmdb_token_saved') return true;
    if (cmd === 'tmdb_certifications') return a.titles!.map(({ id }) => ({ id, certs: { US: certs[id]! }, adult: false }));
    if (cmd === 'settings_get') return store.get(a.key!) ?? null;
    if (cmd === 'settings_set') store.set(a.key!, a.value);
    return undefined;
  });
  vi.mocked(loadMeta).mockImplementation(async (_t, id) => series(id));
  await loadWatch();
  await loadAlerts();
  for (const id of ['tt8', 'tt9']) recordProgress(series(id), { season: 1, episode: { id: `${id}:1:0`, number: 0, title: 'x' } }, 100, 1000);
  await checkNewEpisodes(NOW);
  expect(alertItems().map((i) => i.videoId)).toEqual(['tt8:1:1']);
  expect(vi.mocked(loadMeta)).not.toHaveBeenCalledWith('series', 'tt9');
  const notified = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'alerts_notify');
  expect(notified).toEqual([['alerts_notify', { title: 'tt8', body: expect.stringContaining('S1E1') }]]);
});
