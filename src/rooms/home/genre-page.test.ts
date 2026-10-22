import { describe, expect, it, vi } from 'vitest';
import type { CatalogRef, Title } from '../../catalog/titles';
import type { GenreTarget } from './genre-targets';

const loadCatalog = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../catalog/service', () => ({ loadCatalog }));
vi.mock('../../catalog/parental', () => ({ allowedTitles: async (titles: Title[]) => titles }));
vi.mock('../explore/grid', () => ({ createGridPage: vi.fn() }));

const { catalogPages } = await import('./genre-page');

const target = { genre: 'Drama', ref: { addon: { key: 'a' }, catalog: { type: 'movie', id: 'top', extra: [{ name: 'genre' }, { name: 'skip' }] }, extra: [] } } as unknown as GenreTarget & { ref: CatalogRef };
const titles = (...ids: string[]) => ids.map((id) => ({ id }) as Title);

describe('a genre page of an addon catalog', () => {
  it('stops when an addon ignores skip and sends the same page again', async () => {
    loadCatalog.mockReset().mockResolvedValue(titles('tt1', 'tt2'));
    const load = catalogPages(target);
    expect(await load('movie', 1)).toMatchObject({ done: false });
    // The same titles again: no further page would bring anything new, so asking again would never end.
    expect(await load('movie', 2)).toMatchObject({ done: true });
  });

  it('keeps paging while pages bring new titles', async () => {
    loadCatalog.mockReset().mockResolvedValueOnce(titles('tt1', 'tt2')).mockResolvedValueOnce(titles('tt2', 'tt3')).mockResolvedValueOnce([]);
    const load = catalogPages(target);
    expect(await load('movie', 1)).toMatchObject({ done: false });
    expect(await load('movie', 2)).toMatchObject({ done: false });
    expect(loadCatalog).toHaveBeenLastCalledWith(expect.anything(), [['genre', 'Drama'], ['skip', '2']]);
    expect(await load('movie', 3)).toMatchObject({ done: true });
  });

  it('pages again after the grid starts over (switching to TV Shows and back)', async () => {
    loadCatalog.mockReset().mockImplementation(async (_ref: unknown, extra: [string, string][]) => (extra.some(([name]) => name === 'skip') ? titles('tt3', 'tt4') : titles('tt1', 'tt2')));
    const load = catalogPages(target);
    expect(await load('movie', 1)).toMatchObject({ done: false });
    expect(await load('movie', 2)).toMatchObject({ done: false });
    // Back on Movies, the grid asks for its first page again: it isn't the end of the catalog.
    expect(await load('movie', 1)).toMatchObject({ titles: titles('tt1', 'tt2'), done: false });
  });
});
