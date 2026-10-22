import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./service', () => ({ loadMeta: vi.fn() }));
vi.mock('./parental', () => ({ allowedTitles: async (titles: unknown[]) => titles }));

const { parseTitleRef, resolveTitleRef } = await import('./title-ref');
const { invoke } = await import('@tauri-apps/api/core');
const { loadMeta } = await import('./service');

describe('parseTitleRef', () => {
  it('reads IMDb ids and links', () => {
    expect(parseTitleRef('tt0133093')).toEqual({ kind: 'imdb', id: 'tt0133093' });
    expect(parseTitleRef('  TT0133093 ')).toEqual({ kind: 'imdb', id: 'tt0133093' });
    expect(parseTitleRef('https://www.imdb.com/title/tt0133093/')).toEqual({ kind: 'imdb', id: 'tt0133093' });
    expect(parseTitleRef('imdb.com/title/tt0133093/?ref_=nv_sr_1')).toEqual({ kind: 'imdb', id: 'tt0133093' });
    expect(parseTitleRef('https://m.imdb.com/title/tt0944947/episodes')).toEqual({ kind: 'imdb', id: 'tt0944947' });
    // IMDb's localized pages put the language first.
    expect(parseTitleRef('https://www.imdb.com/de/title/tt0133093/')).toEqual({ kind: 'imdb', id: 'tt0133093' });
    expect(parseTitleRef('https://m.imdb.com/pt-br/title/tt0944947/')).toEqual({ kind: 'imdb', id: 'tt0944947' });
    expect(parseTitleRef('https://www.imdb.com/name/title/tt0133093/')).toBeNull();
  });

  it('reads TMDB ids and links', () => {
    expect(parseTitleRef('tmdb:603')).toEqual({ kind: 'tmdb', id: 603, media: undefined });
    expect(parseTitleRef('tmdb:1399:tv')).toEqual({ kind: 'tmdb', id: 1399, media: 'tv' });
    expect(parseTitleRef('TMDB:603:movie')).toEqual({ kind: 'tmdb', id: 603, media: 'movie' });
    expect(parseTitleRef('https://www.themoviedb.org/movie/603-the-matrix')).toEqual({ kind: 'tmdb', id: 603, media: 'movie' });
    expect(parseTitleRef('themoviedb.org/tv/1399?language=fr')).toEqual({ kind: 'tmdb', id: 1399, media: 'tv' });
  });

  it('reads Letterboxd film links', () => {
    expect(parseTitleRef('https://letterboxd.com/film/parasite-2019/')).toEqual({ kind: 'letterboxd', slug: 'parasite-2019' });
    expect(parseTitleRef('letterboxd.com/film/the-matrix')).toEqual({ kind: 'letterboxd', slug: 'the-matrix' });
  });

  it('leaves ordinary searches and look-alikes alone', () => {
    for (const query of [
      'the matrix',
      'tt',
      'tt123',
      'Dune 2021',
      'tmdb:0',
      'tmdb:abc',
      'tmdb:603:anime',
      'https://evil.example/title/tt0133093/',
      'https://imdb.com.evil.example/title/tt0133093/',
      'https://www.themoviedb.org/person/287',
      'https://letterboxd.com/someone/list/x/',
      'javascript:alert(1)//imdb.com/title/tt0133093/',
      'ftp://imdb.com/title/tt0133093/',
      'https://user:pw@imdb.com/title/tt0133093/',
      'https://www.themoviedb.org/movie/99999999999',
    ]) {
      expect(parseTitleRef(query), query).toBeNull();
    }
  });
});

describe('resolveTitleRef', () => {
  const offline = 'error sending request: dns error';

  it('throws for an IMDb id when neither TMDB nor any addon could be asked (offline), rather than saying there is no such title', async () => {
    vi.mocked(invoke).mockRejectedValue(offline);
    vi.mocked(loadMeta).mockRejectedValue({ kind: 'network', message: offline });
    await expect(resolveTitleRef({ kind: 'imdb', id: 'tt0133093' })).rejects.toEqual({ kind: 'network', message: offline });
  });

  it('is null when the addons answered but none knows the id', async () => {
    vi.mocked(invoke).mockRejectedValue(offline);
    vi.mocked(loadMeta).mockReset();
    vi.mocked(loadMeta).mockRejectedValueOnce({ kind: 'timeout' }).mockResolvedValueOnce(null);
    await expect(resolveTitleRef({ kind: 'imdb', id: 'tt0133093' })).resolves.toBeNull();
  });
});
