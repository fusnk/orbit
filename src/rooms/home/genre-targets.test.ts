import { describe, expect, it } from 'vitest';
import type { CatalogRef } from '../../catalog/titles';
import { genreTargets, matchGenre } from './genre-targets';

const CINEMETA_MOVIES = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
const TMDB_TV = ['Action & Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Kids', 'Mystery', 'News', 'Reality', 'Sci-Fi & Fantasy', 'Soap', 'Talk', 'War & Politics', 'Western'];

const ref = (addon: string, type: string, id: string, options: string[], required = false): CatalogRef =>
  ({ addon: { key: addon }, catalog: { type, id, extra: [{ name: 'genre', isRequired: required, options }] }, extra: [] }) as unknown as CatalogRef;

describe('matchGenre', () => {
  it('prefers the same name, ignoring case and spelling', () => {
    expect(matchGenre('Action', CINEMETA_MOVIES)).toBe('Action');
    expect(matchGenre('action', CINEMETA_MOVIES)).toBe('Action');
    expect(matchGenre('Science Fiction', CINEMETA_MOVIES)).toBe('Sci-Fi');
    expect(matchGenre('Sci-Fi', ['Science Fiction'])).toBe('Science Fiction');
  });

  it('finds a genre joined with another in TMDB-style show genres', () => {
    expect(matchGenre('Action', TMDB_TV)).toBe('Action & Adventure');
    expect(matchGenre('Adventure', TMDB_TV)).toBe('Action & Adventure');
    expect(matchGenre('Sci-Fi', TMDB_TV)).toBe('Sci-Fi & Fantasy');
    expect(matchGenre('Fantasy', TMDB_TV)).toBe('Sci-Fi & Fantasy');
    expect(matchGenre('War', TMDB_TV)).toBe('War & Politics');
  });

  it('splits a joined tile the other way, first part first', () => {
    expect(matchGenre('Action & Adventure', CINEMETA_MOVIES)).toBe('Action');
    expect(matchGenre('War & Politics', CINEMETA_MOVIES)).toBe('War');
  });

  it('finds nothing for a genre the catalog lacks', () => {
    expect(matchGenre('History', TMDB_TV)).toBeUndefined();
    expect(matchGenre('Horror', TMDB_TV)).toBeUndefined();
    expect(matchGenre('Biography', TMDB_TV)).toBeUndefined();
    expect(matchGenre('Action', [])).toBeUndefined();
  });
});

describe('genreTargets', () => {
  const movies = ref('cinemeta', 'movie', 'top', CINEMETA_MOVIES);
  const years = ref('cinemeta', 'series', 'year', ['2026', '2025'], true);
  const tmdbShows = ref('tmdb', 'series', 'popular', TMDB_TV);

  it('maps a tile to each type in that type’s own words', () => {
    const targets = genreTargets('Sci-Fi', [movies, tmdbShows], 'cinemeta');
    expect(targets.movie).toEqual({ ref: movies, genre: 'Sci-Fi' });
    expect(targets.series).toEqual({ ref: tmdbShows, genre: 'Sci-Fi & Fantasy' });
  });

  it('leaves out a type that has no such genre', () => {
    expect(Object.keys(genreTargets('History', [movies, tmdbShows], 'cinemeta'))).toEqual(['movie']);
  });

  it('prefers the tile’s own addon, then the person’s order, and skips required genres (years)', () => {
    const cinemetaShows = ref('cinemeta', 'series', 'top', ['Action', 'Horror', 'History']);
    expect(genreTargets('Action', [tmdbShows, years, cinemetaShows], 'cinemeta').series).toEqual({ ref: cinemetaShows, genre: 'Action' });
    expect(genreTargets('Action', [tmdbShows, cinemetaShows], 'other').series).toEqual({ ref: tmdbShows, genre: 'Action & Adventure' });
    expect(genreTargets('2026', [years])).toEqual({});
  });
});
