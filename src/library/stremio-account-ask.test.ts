import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';

const mocked = vi.mocked(invoke);
const asks = () => mocked.mock.calls.filter(([cmd]) => cmd === 'stremio_account').length;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The module keeps what it found out: a fresh copy for each test.
const fresh = async () => {
  vi.resetModules();
  return import('./stremio-sync');
};

beforeEach(() => mocked.mockReset());

describe('finding out whether Stremio is signed in, with sync off', () => {
  it('asks once and keeps the answer for Settings and My Library', async () => {
    const sync = await fresh();
    mocked.mockResolvedValue({ email: 'me@example.test' });
    expect(sync.stremioSyncState().signedIn).toBeNull();
    sync.askStremioAccount();
    sync.askStremioAccount();
    await settle();
    expect(sync.stremioSyncState().signedIn).toBe(true);
    sync.askStremioAccount();
    expect(asks()).toBe(1);
  });

  it('notes a signed-out account as signed out', async () => {
    const sync = await fresh();
    mocked.mockResolvedValue(null);
    sync.askStremioAccount();
    await settle();
    expect(sync.stremioSyncState().signedIn).toBe(false);
  });

  it('asks again later when Stremio couldn’t be reached', async () => {
    const sync = await fresh();
    // Rust's answer when Stremio's server can't be reached.
    mocked.mockRejectedValueOnce('err.stremio.unreachable');
    sync.askStremioAccount();
    await settle();
    expect(sync.stremioSyncState().signedIn).toBeNull();
    mocked.mockResolvedValue({ email: 'me@example.test' });
    sync.askStremioAccount();
    await settle();
    expect(sync.stremioSyncState().signedIn).toBe(true);
    expect(asks()).toBe(2);
  });
});
