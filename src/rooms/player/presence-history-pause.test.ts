import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string, args?: { key?: string }) => (cmd === 'profile_active' ? 'p1' : cmd === 'settings_get' && args?.key === 'history.paused.p1' ? true : null)) }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../../catalog/titles';
import { historyPaused, loadHistoryPause } from '../../library/history-pause';
import { createPresence } from './presence';

it('Discord hears nothing while "Pause watch history" is on', async () => {
  await loadHistoryPause();
  expect(historyPaused()).toBe(true);
  const presence = createPresence();
  presence.configure(true);
  const title: Title = { id: 'tt1', type: 'movie', name: 'Secret Film', genres: [], origins: [] };
  presence.update(title, undefined, { timePos: 10, duration: 100, paused: false, speed: 1 });
  const sent = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'discord_set_activity');
  expect(sent).toEqual([]);
});
