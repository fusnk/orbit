import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async (command) => {
  if (command === 'addon_refresh_fetch') return [];
  if (command === 'settings_get') return null;
  return undefined;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));
vi.mock('../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));

import { refreshManifestsDaily, setEnabled } from './registry';

const refreshes = () => invoke.mock.calls.filter(([command]) => command === 'addon_refresh_fetch').map(([, args]) => args);

describe('background manifest refreshes', () => {
  it('leave out the addons the person turned off', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    invoke.mockClear();
    await refreshManifestsDaily();
    expect(refreshes()).toEqual([{ enabledOnly: true }]);
    vi.unstubAllGlobals();
  });

  it('catch an addon up once it is turned back on', async () => {
    invoke.mockClear();
    await setEnabled('a', false);
    expect(refreshes()).toEqual([]);
    await setEnabled('a', true);
    await vi.waitFor(() => expect(refreshes()).toEqual([{ key: 'a' }]));
  });
});
