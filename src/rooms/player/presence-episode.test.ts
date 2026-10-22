import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));

import { invoke } from '@tauri-apps/api/core';
import type { Episode, Title } from '../../catalog/titles';
import { createPresence } from './presence';

it('an episode without a name shows as "S1 · E2", without a dangling separator', () => {
  const presence = createPresence();
  presence.configure(true);
  const title: Title = { id: 'tt1', type: 'series', name: 'A Show', genres: [], origins: [] };
  const episode = { id: 'tt1:1:2', number: 2, title: '' } as Episode;
  presence.update(title, { season: 1, episode }, { timePos: 10, duration: 100, paused: false, speed: 1 });
  const sent = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'discord_set_activity');
  expect((sent?.[1] as { presence: { state: string } }).presence.state).toBe('S1 · E2');
});
