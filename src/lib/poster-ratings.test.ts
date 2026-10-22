import { describe, expect, it } from 'vitest';
import { posterScores, shownScores } from './poster-ratings';

describe('poster scores', () => {
  it('orders IMDb, TMDB, Letterboxd, with one decimal', () => {
    expect(posterScores({ imdb: '8.12', tmdb: 7.85, letterboxd: 3.87 })).toEqual([
      { site: 'imdb', value: '8.1', outOf: 10 },
      { site: 'tmdb', value: '7.9', outOf: 10 },
      { site: 'letterboxd', value: '3.9', outOf: 5 },
    ]);
    expect(posterScores({ imdb: ' 7 ' })).toEqual([{ site: 'imdb', value: '7.0', outOf: 10 }]);
  });

  it('leaves out missing, zero and out-of-range scores', () => {
    expect(posterScores({})).toEqual([]);
    expect(posterScores({ imdb: '', tmdb: 0, letterboxd: null })).toEqual([]);
    expect(posterScores({ imdb: 'N/A', tmdb: 11, letterboxd: 5.5 })).toEqual([]);
    expect(posterScores({ imdb: '-1', tmdb: Number.NaN, letterboxd: Number.POSITIVE_INFINITY })).toEqual([]);
    // A Letterboxd average is out of 5; 9 can't be one.
    expect(posterScores({ letterboxd: 9 })).toEqual([]);
    expect(posterScores({ tmdb: 10, letterboxd: 5 }).map((s) => s.value)).toEqual(['10.0', '5.0']);
  });

  it('shows none, the first, or all', () => {
    const all = posterScores({ imdb: '8', tmdb: 7, letterboxd: 4 });
    expect(shownScores(all, 'off')).toEqual([]);
    expect(shownScores(all, 'minimal').map((s) => s.site)).toEqual(['imdb']);
    expect(shownScores(posterScores({ tmdb: 7, letterboxd: 4 }), 'minimal').map((s) => s.site)).toEqual(['tmdb']);
    expect(shownScores(all, 'full')).toHaveLength(3);
    expect(shownScores([], 'minimal')).toEqual([]);
  });
});
