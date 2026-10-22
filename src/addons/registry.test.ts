import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let readable = true;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => {
    calls.push(command);
    if (command === 'addon_install') return { key: 'a', manifest: null, urlReadable: true };
    return command === 'addon_list' ? [{ key: 'a', manifest: null, urlReadable: readable }] : undefined;
  },
}));

import type { InstalledAddon, Manifest } from './types';
import { forgetList, inOneChange, install, reconfigures, list, move, onAddonsChange, refreshDue, remove, restore, setAllShared, setEnabled, setShared } from './registry';

describe('the installed list', () => {
  it('is asked for once, and again after a change', async () => {
    calls.length = 0;
    const [first, second] = await Promise.all([list(), list()]);
    await list();
    expect(calls).toEqual(['addon_list']);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    await setEnabled('a', false);
    await list();
    expect(calls).toEqual(['addon_list', 'addon_set_enabled', 'addon_list']);
  });

  it('is asked for again while an addon URL couldn’t be read', async () => {
    readable = false;
    forgetList();
    calls.length = 0;
    await list();
    await list();
    expect(calls).toEqual(['addon_list', 'addon_list']);
    readable = true;
  });
});

describe('addon change listeners', () => {
  it('hear each install, removal, enabling or disabling, move and restore once', async () => {
    const heard = vi.fn();
    const stop = onAddonsChange(heard);
    await install('https://example.org/manifest.json', {} as never);
    await remove('a');
    await setEnabled('a', false);
    await move('a', 0);
    await restore('a');
    expect(heard).toHaveBeenCalledTimes(5);
    stop();
  });

  it('hear a bundle’s installs once, when the last is done', async () => {
    const heard = vi.fn();
    const stop = onAddonsChange(heard);
    await inOneChange(async () => {
      await install('https://example.org/one/manifest.json', {} as never);
      await install('https://example.org/two/manifest.json', {} as never);
      await install('https://example.org/three/manifest.json', {} as never);
      expect(heard).not.toHaveBeenCalled();
    });
    expect(heard).toHaveBeenCalledTimes(1);
    // A batch that fails part way still announces what it changed.
    await expect(inOneChange(async () => {
      await remove('a');
      throw new Error('stopped');
    })).rejects.toThrow('stopped');
    expect(heard).toHaveBeenCalledTimes(2);
    // And one with no change says nothing.
    await inOneChange(async () => {});
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('don’t hear sharing, which doesn’t change what the profile uses', async () => {
    const heard = vi.fn();
    const stop = onAddonsChange(heard);
    await setShared('a', true);
    await setAllShared(false);
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});

describe('daily addon refresh', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  const hour = 60 * 60 * 1000;

  it('runs at most once a day', () => {
    expect(refreshDue(now - hour, now)).toBe(false);
    expect(refreshDue(now - 23 * hour, now)).toBe(false);
    expect(refreshDue(now - 24 * hour, now)).toBe(true);
  });

  it('runs when it never has, or the saved time is junk or in the future', () => {
    for (const last of [null, undefined, 'yesterday', Number.NaN, Infinity, {}]) expect(refreshDue(last, now)).toBe(true);
    expect(refreshDue(now + hour, now)).toBe(true);
  });
});

describe('re-running an addon’s setup', () => {
  const addon = (key: string, id: string, extra: Partial<InstalledAddon> = {}): InstalledAddon =>
    ({ key, manifest: { id } as Manifest, displayHost: 'streams.example', enabled: true, installedAt: 0, urlReadable: true, builtIn: false, owned: true, shared: false, sharedBy: null, ...extra });
  const url = 'https://streams.example/new-config/manifest.json';

  it('finds this profile’s own copy of the same addon to update', () => {
    const installed = [addon('cin', 'com.linvo.cinemeta', { builtIn: true, owned: false }), addon('t1', 'streams-a'), addon('t2', 'streams-a')];
    expect(reconfigures(installed, { id: 'streams-a' } as Manifest, url)?.key).toBe('t1');
    expect(reconfigures(installed, { id: 'streams-b' } as Manifest, url)).toBeUndefined();
  });

  it('never a built-in or another profile’s shared addon', () => {
    expect(reconfigures([addon('cin', 'com.linvo.cinemeta', { builtIn: true })], { id: 'com.linvo.cinemeta' } as Manifest, url)).toBeUndefined();
    expect(reconfigures([addon('k', 'streams-a', { owned: false, sharedBy: 'Kid' })], { id: 'streams-a' } as Manifest, url)).toBeUndefined();
  });

  it('never one at another host, whatever id the manifest claims', () => {
    const installed = [addon('t1', 'streams-a')];
    expect(reconfigures(installed, { id: 'streams-a' } as Manifest, 'https://evil.example/manifest.json')).toBeUndefined();
    expect(reconfigures(installed, { id: 'streams-a' } as Manifest, 'https://streams.example:8443/manifest.json')).toBeUndefined();
    expect(reconfigures(installed, { id: 'streams-a' } as Manifest, 'not a url')).toBeUndefined();
    expect(reconfigures(installed, { id: 'streams-a' } as Manifest, 'stremio://streams.example/x/manifest.json')?.key).toBe('t1');
  });
});
