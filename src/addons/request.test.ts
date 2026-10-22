import { describe, expect, it } from 'vitest';
import { buildPath } from './request';

describe('buildPath', () => {
  it('builds a plain resource path', () => {
    expect(buildPath({ resource: 'meta', type: 'movie', id: 'tt0111161' })).toBe('/meta/movie/tt0111161.json');
  });

  it('encodes ids and extras so they cannot add path segments', () => {
    expect(buildPath({ resource: 'stream', type: 'series', id: 'tt1:1:2' })).toBe('/stream/series/tt1%3A1%3A2.json');
    expect(buildPath({ resource: 'meta', type: 'movie', id: '../../admin' })).toBe('/meta/movie/..%2F..%2Fadmin.json');
  });

  it('appends extras in order, URL-encoded', () => {
    const path = buildPath({
      resource: 'catalog',
      type: 'movie',
      id: 'top',
      extra: [
        ['search', 'a/b & c'],
        ['skip', '100'],
      ],
    });
    expect(path).toBe('/catalog/movie/top/search=a%2Fb%20%26%20c&skip=100.json');
  });
  it('encodes a search cut inside an emoji instead of throwing', () => {
    // A lone surrogate makes encodeURIComponent throw, which would fail the whole search.
    expect(buildPath({ resource: 'catalog', type: 'movie', id: 'top', extra: [['search', 'a\uD83D']] })).toBe('/catalog/movie/top/search=a%EF%BF%BD.json');
    expect(buildPath({ resource: 'meta', type: 'movie', id: '\uDC00x' })).toBe('/meta/movie/%EF%BF%BDx.json');
  });
});
