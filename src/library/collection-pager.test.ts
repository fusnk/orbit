import { describe, expect, it, vi } from 'vitest';

const tmdbSourcePage = vi.fn();
const loadCatalog = vi.fn();
vi.mock('../catalog/service', () => ({ loadCatalog: (...a: unknown[]) => loadCatalog(...a) }));
vi.mock('../catalog/tmdb', () => ({ tmdbSourcePage: (...a: unknown[]) => tmdbSourcePage(...a) }));

const { pagingDone, sourcePager } = await import('./collection-sources');

const titles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `tt${i}`, type: 'movie', name: `T${i}`, genres: [], origins: [] }));

describe('collection source pager', () => {
  it('asks for the same TMDB page again after it failed', async () => {
    tmdbSourcePage.mockRejectedValueOnce(new Error('offline')).mockImplementation(async (_s: unknown, page: number) => ({ titles: titles(1), done: false, page }));
    const pager = sourcePager({ kind: 'tmdb', tmdb: 'collection', id: 10, media: 'movie', sort: undefined, filters: undefined, label: undefined }, { addons: [], tmdb: true });
    await expect(pager.next()).rejects.toThrow('offline');
    await pager.next(); // the page's "Try again"
    await pager.next();
    expect(tmdbSourcePage.mock.calls.map((c) => c[1])).toEqual([1, 1, 2]);
  });

  it("keeps paging past a page the content limit emptied, and stops on a page with nothing new or the source's end", () => {
    expect(pagingDone({ titles: [], done: false }, 0)).toBe(false);
    expect(pagingDone({ titles: titles(3), done: false }, 0)).toBe(true);
    expect(pagingDone({ titles: titles(3), done: false }, 2)).toBe(false);
    expect(pagingDone({ titles: titles(3), done: true }, 3)).toBe(true);
  });

  it("ends an addon's catalog on an empty page, so an empty page can't page forever", async () => {
    const catalog = { type: 'movie', id: 'top', extra: [{ name: 'skip', isRequired: false }] };
    const addons = [{ key: 'k', manifest: { id: 'a', name: 'A', catalogs: [catalog] }, builtIn: false }] as never;
    loadCatalog.mockResolvedValueOnce(titles(2)).mockResolvedValueOnce([]);
    const pager = sourcePager({ kind: 'addon', addon: 'a', type: 'movie', catalog: 'top', genre: undefined, addonName: 'A', label: undefined }, { addons, tmdb: false });
    expect((await pager.next()).done).toBe(false);
    expect(await pager.next()).toEqual({ titles: [], done: true });
  });
});
