import { describe, expect, it } from 'vitest';
import { CATALOG_NAMES_SHOWN, installedSource, reviewManifest, sourceOf } from './review';
import { ManifestSchema, parseWith } from './schema';

const manifest = (extra: Record<string, unknown> = {}) =>
  parseWith(ManifestSchema, { id: 'org.example', version: '1.2.3', name: 'Example', types: ['movie'], resources: ['stream'], ...extra });

describe('reviewManifest', () => {
  it('lists what a stream addon provides', () => {
    const r = reviewManifest(manifest({ idPrefixes: ['tt', 'kitsu:', 'custom-'] }), { host: 'a.example', local: false });
    expect(r).toMatchObject({
      name: 'Example',
      version: '1.2.3',
      source: { host: 'a.example', local: false },
      streams: true,
      meta: false,
      subtitles: false,
      catalogs: { count: 0, names: [], types: [] },
      addonCatalogs: 0,
      types: ['movie'],
      ids: { known: ['IMDb', 'Kitsu'], other: ['custom-'] },
      needsSetup: false,
      configurable: false,
      p2p: false,
      adult: false,
    });
  });

  it('collects catalogs, types from resources, and unknown resources', () => {
    const catalogs = Array.from({ length: CATALOG_NAMES_SHOWN + 3 }, (_, i) => ({ type: i % 2 ? 'series' : 'movie', id: `c${i}`, name: i === 0 ? undefined : `Catalog ${i}` }));
    const r = reviewManifest(
      manifest({
        catalogs,
        addonCatalogs: [{ type: 'all', id: 'more' }],
        resources: ['catalog', 'meta', { name: 'subtitles', types: ['anime'], idPrefixes: ['mal:'] }, 'weird_thing'],
      }),
      null,
    );
    expect(r.catalogs.count).toBe(CATALOG_NAMES_SHOWN + 3);
    expect(r.catalogs.names).toHaveLength(CATALOG_NAMES_SHOWN);
    // A catalog without a name is shown by its id.
    expect(r.catalogs.names[0]).toBe('c0');
    expect(r.catalogs.types).toEqual(['movie', 'series']);
    expect(r.addonCatalogs).toBe(1);
    expect(r).toMatchObject({ meta: true, subtitles: true, streams: false, otherResources: ['weird_thing'] });
    expect(r.types).toEqual(['movie', 'anime']);
    expect(r.ids).toEqual({ known: ['MyAnimeList'], other: [] });
  });

  it('reports setup, P2P and adult flags', () => {
    const r = reviewManifest(manifest({ behaviorHints: { configurationRequired: true, p2p: true, adult: true } }), null);
    expect(r).toMatchObject({ needsSetup: true, configurable: true, p2p: true, adult: true });
    expect(reviewManifest(manifest({ behaviorHints: { configurable: true } }), null)).toMatchObject({ needsSetup: false, configurable: true });
  });

  it('ignores fields Orbit does not act on, such as stremioAddonsConfig', () => {
    const r = reviewManifest(manifest({ stremioAddonsConfig: { issuer: 'https://x.example', signature: 'abc' } }), null);
    expect(JSON.stringify(r)).not.toContain('signature');
  });
});

describe('sources', () => {
  it('keeps only the host of an install URL', () => {
    expect(sourceOf('https://a.example/secret-key/manifest.json?token=x')).toEqual({ host: 'a.example', local: false });
    expect(sourceOf('stremio://a.example:8443/cfg/manifest.json')).toEqual({ host: 'a.example:8443', local: false });
    expect(sourceOf('http://127.0.0.1:7000/manifest.json')).toEqual({ host: '127.0.0.1:7000', local: true });
    expect(sourceOf('file:///C:/manifest.json')).toBeNull();
    expect(sourceOf('not a url')).toBeNull();
  });

  it('marks installed local addons', () => {
    expect(installedSource('127.0.0.1:7000').local).toBe(true);
    expect(installedSource('127.0.0.1.evil.example').local).toBe(false);
    expect(installedSource('a.example').local).toBe(false);
  });
});
