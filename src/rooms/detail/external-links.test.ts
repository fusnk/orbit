import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../lib/browser', () => ({ openInBrowser: vi.fn() }));

const { externalLinks } = await import('./external-links');

describe('externalLinks', () => {
  it('links a film to IMDb, TMDB and Letterboxd', () => {
    expect(externalLinks({ id: 'tt0133093', type: 'movie' }, 603)).toEqual([
      { site: 'imdb', url: 'https://www.imdb.com/title/tt0133093/' },
      { site: 'tmdb', url: 'https://www.themoviedb.org/movie/603' },
      { site: 'letterboxd', url: 'https://letterboxd.com/tmdb/603/' },
    ]);
  });

  it('links a show to TMDB TV and leaves out Letterboxd', () => {
    expect(externalLinks({ id: 'tt0944947', type: 'series' }, 1399).map((l) => l.url)).toEqual(['https://www.imdb.com/title/tt0944947/', 'https://www.themoviedb.org/tv/1399']);
  });

  it('finds a film on Letterboxd by IMDb id without a TMDB id', () => {
    expect(externalLinks({ id: 'tt0133093', type: 'movie' }, null).map((l) => l.site)).toEqual(['imdb', 'letterboxd']);
    expect(externalLinks({ id: 'tt0133093', type: 'movie' }, null)[1]!.url).toBe('https://letterboxd.com/imdb/tt0133093/');
  });

  it('builds nothing from ids that are not checked ids', () => {
    expect(externalLinks({ id: 'kitsu:123', type: 'series' }, null)).toEqual([]);
    expect(externalLinks({ id: 'tt1/../evil', type: 'movie' }, 0.5)).toEqual([]);
    expect(externalLinks({ id: 'tt123', type: 'tv' }, 5).map((l) => l.site)).toEqual(['imdb']);
  });
});
