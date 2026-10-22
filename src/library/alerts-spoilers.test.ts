import { expect, it, vi } from 'vitest';

const store = new Map<string, unknown>([['library.spoilers.p1', { titles: true, scope: 'unwatched' }]]);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: { key?: string; value?: unknown }) => {
    if (cmd === 'profile_active') return 'p1';
    if (cmd === 'settings_get') return store.get(args!.key!) ?? null;
    if (cmd === 'settings_set') store.set(args!.key!, args!.value);
    return null;
  }),
}));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import { toastsFor, type AlertItem } from './alerts';
import { hiddenFor, loadSpoilers } from './spoilers';

it('the system notification leaves out an episode name that spoiler protection hides', async () => {
  await loadSpoilers();
  expect(hiddenFor('unwatched').title).toBe(true);
  const item: AlertItem = { videoId: 'tt9:2:3', titleId: 'tt9', show: 'Show', season: 2, episode: 3, title: 'The Twist Revealed', airedAt: 1, read: false };
  const [toast] = toastsFor([item]);
  expect(toast!.body).not.toContain('The Twist Revealed');
  expect(toast!.body).toContain('Episode 3');
});
