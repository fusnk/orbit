import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ paused: false, set: vi.fn(async () => {}) }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => undefined, set: mock.set } }));
vi.mock('../../library/profiles', () => ({ activeProfileId: async () => 'p1' }));
vi.mock('../../library/history-pause', () => ({ historyPaused: () => mock.paused }));

import { profileStore } from './profile-store';

describe('profileStore', () => {
  beforeEach(() => {
    mock.paused = false;
    mock.set.mockClear();
  });

  it('records and saves while watch history runs', async () => {
    const store = profileStore('player.test', (value) => (Array.isArray(value) ? (value as string[]) : []));
    await store.record((list) => [...list, 'a']);
    expect(store.get()).toEqual(['a']);
    expect(mock.set).toHaveBeenCalledWith('player.test.p1', ['a']);
  });

  it('records nothing, in memory or saved, while watch history is paused', async () => {
    const store = profileStore('player.test', (value) => (Array.isArray(value) ? (value as string[]) : []));
    mock.paused = true;
    await store.record((list) => [...list, 'a']);
    expect(store.get()).toEqual([]);
    expect(mock.set).not.toHaveBeenCalled();
  });

  it('still applies changes made by hand while paused', async () => {
    const store = profileStore('player.test', (value) => (Array.isArray(value) ? (value as string[]) : []));
    mock.paused = true;
    await store.update(() => []);
    expect(mock.set).toHaveBeenCalledWith('player.test.p1', []);
  });
});
