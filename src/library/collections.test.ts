import { describe, expect, it } from 'vitest';
import { cleanFilters, coverOf, parseCollection, parseSources, shiftedIndex, toInput, type Collection } from './collections';

const row = (over: Record<string, unknown> = {}) => ({
  id: '0123456789abcdef',
  name: 'Marvel',
  group: 'Studios',
  art: { cover: 'https://img.example/c.jpg', shape: 'landscape' },
  sources: [{ kind: 'tmdb', tmdb: 'collection', id: 86311, media: 'movie' }],
  createdAt: 1,
  items: [],
  ...over,
});

describe('stored collections', () => {
  it('caps names by whole characters and drops every control character', () => {
    expect(parseCollection(row({ name: `${'A'.repeat(59)}🎬🎬`, group: 'Studios\u0080' }))).toMatchObject({ name: `${'A'.repeat(59)}🎬`, group: 'Studios' });
  });

  it('reads valid rows', () => {
    const c = parseCollection(row())!;
    expect([c.name, c.group, c.cover, c.shape, c.sources.length]).toEqual(['Marvel', 'Studios', 'https://img.example/c.jpg', 'landscape', 1]);
    expect(parseCollection(row({ group: null }))!.group).toBeUndefined();
  });

  it('drops what doesn’t validate, field by field', () => {
    expect(parseCollection(row({ id: '../x' }))).toBeNull();
    expect(parseCollection(row({ name: '' }))).toBeNull();
    const c = parseCollection(row({ art: { cover: 'javascript:alert(1)', shape: 'circle' }, sources: [{ kind: 'eval' }, { kind: 'tmdb', tmdb: 'list', media: 'movie' }, { kind: 'addon', addon: 'a', type: 'movie', catalog: 'c' }], items: [{ titleId: 'tt1', title: { nope: true } }] }))!;
    expect([c.cover, c.shape, c.sources.map((s) => s.kind), c.titles.length]).toEqual([undefined, 'poster', ['addon'], 0]);
    expect(parseSources(Array.from({ length: 30 }, () => ({ kind: 'addon', addon: 'a', type: 'movie', catalog: 'c' }))).length).toBe(20);
  });

  it('keeps only known filters with valid values', () => {
    expect(cleanFilters({ withGenres: 28, year: '2001', voteAverageGte: '7.5', withOriginCountry: 'gb', constructor: 'x', withKeywords: '1,2|3' })).toEqual({ withGenres: '28', year: 2001, voteAverageGte: 7.5, withKeywords: '1,2|3' });
    expect(cleanFilters({})).toBeUndefined();
    expect(cleanFilters('withGenres=28')).toBeUndefined();
  });

  it('sends only https art', () => {
    expect(toInput({ name: 'A', cover: 'http://x.example/a.jpg', backdrop: 'https://x.example/b.jpg', sources: [] }).art).toEqual({ backdrop: 'https://x.example/b.jpg' });
  });

  it('picks a cover and moves within the order', () => {
    const base: Collection = { id: 'x', name: 'X', shape: 'poster', sources: [], createdAt: 0, titles: [{ id: 'tt1', type: 'movie', name: 'One', background: 'https://b.example/1.jpg', genres: [], origins: [] }, { id: 'tt2', type: 'movie', name: 'Two', poster: 'https://p.example/2.jpg', genres: [], origins: [] }] };
    expect(coverOf(base)).toBe('https://p.example/2.jpg');
    expect(coverOf({ ...base, shape: 'landscape' })).toBe('https://b.example/1.jpg');
    expect(coverOf({ ...base, cover: 'https://c.example/c.jpg' })).toBe('https://c.example/c.jpg');
    expect([shiftedIndex(['a', 'b', 'c'], 'b', -1), shiftedIndex(['a', 'b', 'c'], 'a', -1), shiftedIndex(['a', 'b', 'c'], 'c', 1), shiftedIndex(['a'], 'z', 1)]).toEqual([0, -1, -1, -1]);
  });
});

describe('collection art', () => {
  it('a cover or backdrop on this machine or the LAN is dropped', () => {
    for (const cover of ['https://192.168.1.1/cgi-bin/x', 'https://127.0.0.1:8080/a.jpg', 'https://[::1]/a.jpg', 'https://router.localhost/a.jpg']) {
      expect(parseCollection(row({ art: { cover, backdrop: cover, shape: 'poster' } }))).toMatchObject({ cover: undefined, backdrop: undefined });
    }
    expect(parseCollection(row({ art: { cover: 'https://img.example/c.jpg', shape: 'poster' } }))!.cover).toBe('https://img.example/c.jpg');
  });
});
