import { describe, expect, it } from 'vitest';
import type { UsableAddon } from '../addons/types';
import { catalogRefFor, findSourceCatalog, showable, sourceStatus, type SourceContext } from './collection-sources';
import type { CollectionSource } from './collections';

const extra = (name: string, options?: string[], isRequired = false) => ({ name, isRequired, options, optionsLimit: 1 });

function addon(id: string, name: string, catalogs: { type: string; id: string; name?: string; extra?: ReturnType<typeof extra>[] }[]): UsableAddon {
  return { key: `k-${id}`, manifest: { id, name, catalogs: catalogs.map((c) => ({ extra: [], ...c })) }, builtIn: false } as unknown as UsableAddon;
}

const addons = [
  addon('aio-metadata', 'AIOMetadata', [
    { type: 'movie', id: 'tmdb.discover.movie.disney', name: 'Disney+', extra: [extra('genre', ['Action', 'Drama']), extra('skip')] },
    { type: 'series', id: 'needs-search', extra: [extra('search', undefined, true)] },
    { type: 'movie', id: 'by-year', extra: [extra('genre', ['2026', '2025'], true)] },
  ]),
  addon('other.copy', 'Copy', [{ type: 'series', id: 'shared-id' }]),
];
const ctx = (tmdb: boolean): SourceContext => ({ addons, tmdb });
const addonSource = (addonId: string, type: string, catalog: string, genre?: string): CollectionSource => ({ kind: 'addon', addon: addonId, type, catalog, genre, addonName: 'Some Addon', label: undefined });

describe('collection sources', () => {
  it('says how each source maps to this Orbit', () => {
    expect(sourceStatus(addonSource('aio-metadata', 'movie', 'tmdb.discover.movie.disney'), ctx(false))).toEqual({ state: 'ok' });
    expect(sourceStatus(addonSource('missing.addon', 'movie', 'x'), ctx(false))).toEqual({ state: 'needs-addon', addon: 'missing.addon', name: 'Some Addon' });
    expect(sourceStatus(addonSource('aio-metadata', 'movie', 'gone'), ctx(false))).toEqual({ state: 'missing-catalog', addonName: 'AIOMetadata' });
    // A catalog that needs a search can't fill a collection.
    expect(sourceStatus(addonSource('aio-metadata', 'series', 'needs-search'), ctx(false))).toEqual({ state: 'missing-catalog', addonName: 'AIOMetadata' });
    const tmdb: CollectionSource = { kind: 'tmdb', tmdb: 'collection', id: 10, media: 'movie', sort: undefined, filters: undefined, label: undefined };
    expect(sourceStatus(tmdb, ctx(false))).toEqual({ state: 'needs-tmdb' });
    expect(sourceStatus(tmdb, ctx(true))).toEqual({ state: 'ok' });
    expect(sourceStatus({ ...tmdb, tmdb: 'person', media: 'tv' }, ctx(true))).toEqual({ state: 'unsupported', reason: 'tmdb-shows' });
    expect(sourceStatus({ kind: 'trakt', list: 1, media: 'tv', sort: undefined, sortHow: undefined, label: undefined }, ctx(true))).toEqual({ state: 'unsupported', reason: 'trakt' });
  });

  it('finds catalogs by addon, then by catalog id', () => {
    expect(findSourceCatalog(addons, { addon: 'aio-metadata', type: 'movies', catalog: 'tmdb.discover.movie.disney' })?.catalog.id).toBe('tmdb.discover.movie.disney');
    // Another install of the addon under a different id still serves it.
    expect(findSourceCatalog(addons, { addon: 'gone', type: 'series', catalog: 'shared-id' })?.addon.manifest.id).toBe('other.copy');
    expect(findSourceCatalog(addons, { addon: 'gone', type: 'movie', catalog: 'shared-id' })).toBeUndefined();
  });

  it('asks only for genres the catalog offers', () => {
    const disney = findSourceCatalog(addons, { addon: 'aio-metadata', type: 'movie', catalog: 'tmdb.discover.movie.disney' })!;
    expect(catalogRefFor(disney, 'Drama')?.extra).toEqual([['genre', 'Drama']]);
    expect(catalogRefFor(disney, 'Westerns')?.extra).toEqual([]);
    const byYear = findSourceCatalog(addons, { addon: 'aio-metadata', type: 'movie', catalog: 'by-year' })!;
    expect(catalogRefFor(byYear, undefined)?.extra).toEqual([['genre', '2026']]);
    expect(catalogRefFor(byYear, '2025')?.extra).toEqual([['genre', '2025']]);
  });

  it('knows when a collection has something to show', () => {
    expect(showable({ sources: [], titles: [] }, ctx(true))).toBe(false);
    expect(showable({ sources: [addonSource('missing', 'movie', 'x'), addonSource('aio-metadata', 'movie', 'tmdb.discover.movie.disney')], titles: [] }, ctx(false))).toBe(true);
    expect(showable({ sources: [addonSource('missing', 'movie', 'x')], titles: [] }, ctx(false))).toBe(false);
  });
});
