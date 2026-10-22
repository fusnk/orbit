import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (command: string): Promise<unknown> => (command === 'stremio_signed_in' ? true : false));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command: string) => invoke(command) }));
vi.mock('../../addons/registry', () => ({ list: async () => [] }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../../library/library', () => ({ libraryEntries: () => [] }));
vi.mock('../../library/profiles', () => ({ listProfiles: async () => [{}] }));
vi.mock('../../library/watch', () => ({ watchHistory: () => ({ titles: [] }) }));

import { RETURN_TO_KEY } from '../../i18n';
import { rememberResume, setupSignals, takeResume } from './state';

describe('the first-run check', () => {
  it('reads the Stremio sign-in from this computer, without contacting Stremio', async () => {
    const signals = await setupSignals();
    expect(signals.stremio).toBe(true);
    // `stremio_account` asks Stremio's server for the account's email.
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('stremio_account');
  });
});

describe('a language picked during setup', () => {
  it('reopens setup after the reload, and run again from Settings, comes back to Settings', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) });
    rememberResume('first');
    expect(stored.get(RETURN_TO_KEY)).toBeUndefined();
    expect(takeResume()).toBe('first');
    rememberResume('again');
    expect(stored.get(RETURN_TO_KEY)).toBe('settings-general');
    expect(takeResume()).toBe('again');
    vi.unstubAllGlobals();
  });
});
