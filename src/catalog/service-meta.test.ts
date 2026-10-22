import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const registry = vi.hoisted(() => ({
  ensureBuiltins: vi.fn(() => Promise.resolve()),
  list: vi.fn(),
  request: vi.fn(),
  onAddonsChange: vi.fn(),
}));
vi.mock('../addons/registry', () => registry);
vi.mock('./parental', () => ({ withoutAdultAddons: (addons: unknown) => addons }));

import { ManifestSchema, parseWith } from '../addons/schema';
import type { InstalledAddon } from '../addons/types';
import { loadMeta } from './service';

function addon(key: string): InstalledAddon {
  return {
    key,
    manifest: parseWith(ManifestSchema, { id: key, version: '1.0.0', name: key, types: ['movie'], resources: ['meta'], catalogs: [], idPrefixes: ['tt'] }),
    displayHost: `${key}.example`,
    enabled: true,
    installedAt: 0,
    urlReadable: true,
    builtIn: false,
    owned: true,
    shared: false,
    sharedBy: null,
  };
}

const meta = { meta: { id: 'tt1', type: 'movie', name: 'Found' } };

beforeEach(() => {
  registry.request.mockReset();
  registry.list.mockResolvedValue([addon('a'), addon('b')]);
});

describe('loadMeta when some addons fail', () => {
  it("doesn't remember a title as unknown while an addon that might know it was unreachable", async () => {
    // One addon is offline, the other doesn't know the title.
    registry.request.mockImplementation((a: InstalledAddon) => (a.key === 'a' ? Promise.reject({ kind: 'network', message: 'down' }) : Promise.resolve({ meta: null })));
    expect(await loadMeta('movie', 'tt1')).toBeNull();

    // The connection is back: the next visit asks again and finds it.
    registry.request.mockImplementation((a: InstalledAddon) => Promise.resolve(a.key === 'a' ? meta : { meta: null }));
    expect((await loadMeta('movie', 'tt1'))?.name).toBe('Found');
  });

  it('remembers a title every addon answered for', async () => {
    registry.request.mockResolvedValue({ meta: null });
    expect(await loadMeta('movie', 'tt2')).toBeNull();
    registry.request.mockResolvedValue(meta);
    expect(await loadMeta('movie', 'tt2')).toBeNull();
  });
});

describe('loadMeta with a slow addon', () => {
  it("doesn't wait for addons after the one that answered", async () => {
    // The first addon knows the title; the second never answers (Rust would time it out after 15 s).
    registry.request.mockImplementation((a: InstalledAddon) => (a.key === 'a' ? Promise.resolve(meta) : new Promise(() => {})));
    expect((await loadMeta('movie', 'tt3'))?.name).toBe('Found');
  });

  it('still prefers an earlier addon that answers later', async () => {
    const later = { meta: { id: 'tt4', type: 'movie', name: 'From A' } };
    registry.request.mockImplementation((a: InstalledAddon) =>
      a.key === 'a' ? new Promise((resolve) => setTimeout(() => resolve(later), 20)) : Promise.resolve({ meta: { id: 'tt4', type: 'movie', name: 'From B' } }),
    );
    expect((await loadMeta('movie', 'tt4'))?.name).toBe('From A');
  });
});
