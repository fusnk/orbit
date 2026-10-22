import { describe, expect, it } from 'vitest';
import { isEligible } from './routing';
import { ManifestSchema, parseWith } from './schema';
import type { InstalledAddon } from './types';

function addon(manifest: object, overrides: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    key: 'k',
    manifest: parseWith(ManifestSchema, { id: 'x', version: '1.0.0', name: 'X', ...manifest }),
    displayHost: 'x.example',
    enabled: true,
    installedAt: 0,
    urlReadable: true,
    builtIn: false,
    owned: true,
    shared: false,
    sharedBy: null,
    ...overrides,
  };
}

const streams = addon({ types: ['movie'], idPrefixes: ['tt'], resources: ['stream'] });

describe('isEligible', () => {
  it('matches resource, type, and id prefix', () => {
    expect(isEligible(streams, { resource: 'stream', type: 'movie', id: 'tt1' })).toBe(true);
    expect(isEligible(streams, { resource: 'meta', type: 'movie', id: 'tt1' })).toBe(false);
    expect(isEligible(streams, { resource: 'stream', type: 'series', id: 'tt1' })).toBe(false);
    expect(isEligible(streams, { resource: 'stream', type: 'movie', id: 'kitsu:1' })).toBe(false);
  });

  it('accepts any id when the resource declares no prefixes', () => {
    const a = addon({ types: ['movie'], idPrefixes: ['tt'], resources: [{ name: 'stream', types: ['movie'] }] });
    expect(isEligible(a, { resource: 'stream', type: 'movie', id: 'kitsu:1' })).toBe(true);
  });

  it('accepts any id when the prefix list is empty, as stremio-core does', () => {
    const short = addon({ types: ['movie'], idPrefixes: [], resources: ['stream'] });
    const full = addon({ types: ['movie'], resources: [{ name: 'stream', types: ['movie'], idPrefixes: [] }] });
    for (const a of [short, full]) expect(isEligible(a, { resource: 'stream', type: 'movie', id: 'kitsu:1' })).toBe(true);
  });

  it('skips disabled, unreadable, and invalid addons', () => {
    const req = { resource: 'stream', type: 'movie', id: 'tt1' } as const;
    expect(isEligible({ ...streams, enabled: false }, req)).toBe(false);
    expect(isEligible({ ...streams, urlReadable: false }, req)).toBe(false);
    expect(isEligible({ ...streams, manifest: null }, req)).toBe(false);
  });

  describe('catalogs', () => {
    const a = addon({
      types: ['movie'],
      resources: ['catalog'],
      catalogs: [
        { type: 'movie', id: 'top', extra: [{ name: 'genre' }, { name: 'skip' }] },
        { type: 'movie', id: 'search', extra: [{ name: 'search', isRequired: true }] },
      ],
    });

    it('requires a declared catalog id and type', () => {
      expect(isEligible(a, { resource: 'catalog', type: 'movie', id: 'top' })).toBe(true);
      expect(isEligible(a, { resource: 'catalog', type: 'series', id: 'top' })).toBe(false);
      expect(isEligible(a, { resource: 'catalog', type: 'movie', id: 'other' })).toBe(false);
    });

    it('requires required extras and rejects undeclared ones', () => {
      expect(isEligible(a, { resource: 'catalog', type: 'movie', id: 'search' })).toBe(false);
      expect(isEligible(a, { resource: 'catalog', type: 'movie', id: 'search', extra: [['search', 'x']] })).toBe(true);
      expect(isEligible(a, { resource: 'catalog', type: 'movie', id: 'top', extra: [['skip', '100']] })).toBe(true);
      expect(isEligible(a, { resource: 'catalog', type: 'movie', id: 'top', extra: [['search', 'x']] })).toBe(false);
    });
  });
});
