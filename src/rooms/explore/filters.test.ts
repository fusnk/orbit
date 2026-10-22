import { describe, expect, it, vi } from 'vitest';

vi.mock('../../library/profiles', () => ({ profileSetting: async () => ({ key: 'explore.filters.main', value: null }) }));

import { whatsNewQuery } from '../../catalog/whats-new';
import { activeCount, decadeYears, DEFAULT_FILTERS, discoverQuery, fixedBy, parseFilters, type DiscoverFilters, type DiscoverSpec } from './filters';

const spec = (filters: Record<string, string | number> = {}, sort = 'popularity.desc'): DiscoverSpec => ({ filters: () => filters, sort: () => sort });
const ctx = { today: '2026-10-05', certifications: { country: 'GB', certifications: ['U', 'PG', '12A', '15', '18'] } };
const with_ = (patch: Partial<DiscoverFilters>): DiscoverFilters => ({ ...DEFAULT_FILTERS, ...patch });

describe('discover filters', () => {
  it('keeps only valid saved values', () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters('junk')).toEqual(DEFAULT_FILTERS);
    expect(
      parseFilters({ ratingMin: 6.5, ratingMax: 9, minVotes: 200, decade: 1990, year: 1994, certification: ' PG-13 ', language: 'ja', genres: ['drama', 'nope', 'drama', 'horror'], genreMatch: 'any', sort: 'rating', hideWatched: true }),
    ).toEqual({ ...DEFAULT_FILTERS, ratingMin: 6.5, ratingMax: 9, minVotes: 200, decade: 1990, year: 1994, certification: 'PG-13', language: 'ja', genres: ['drama', 'horror'], genreMatch: 'any', sort: 'rating', hideWatched: true });
    expect(
      parseFilters({ ratingMin: 6.3, ratingMax: 11, minVotes: 7, decade: 1995, year: 1994, certification: 'PG&x=1', language: 'xx', genres: 'drama', genreMatch: 'some', sort: 'revenue', hideWatched: 'yes' }),
    ).toEqual(DEFAULT_FILTERS);
    // A maximum under the minimum, or a year outside its decade, is dropped.
    expect(parseFilters({ ratingMin: 8, ratingMax: 5 }).ratingMax).toBe(10);
    expect(parseFilters({ decade: 2020, year: 2031 }, 2026)).toMatchObject({ decade: 2020, year: null });
    expect(parseFilters({ year: 2001 }).year).toBeNull();
  });

  it('keeps only valid year ranges, runtimes and people', () => {
    expect(parseFilters({ yearFrom: 1980, yearTo: 1999, runtimeMin: 90, runtimeMax: 120, cast: { id: 31, name: ' Tom Hanks ' }, director: { id: 488, name: 'Steven Spielberg' } }, 2026)).toMatchObject({
      yearFrom: 1980,
      yearTo: 1999,
      runtimeMin: 90,
      runtimeMax: 120,
      cast: { id: 31, name: 'Tom Hanks' },
      director: { id: 488, name: 'Steven Spielberg' },
    });
    // A decade wins over a range; a backwards or out-of-range one is dropped.
    expect(parseFilters({ decade: 1990, yearFrom: 1980, yearTo: 1999 }, 2026)).toMatchObject({ decade: 1990, yearFrom: null, yearTo: null });
    expect(parseFilters({ yearFrom: 2000, yearTo: 1990 }, 2026)).toMatchObject({ yearFrom: 2000, yearTo: null });
    expect(parseFilters({ yearFrom: 1800, yearTo: 2031 }, 2026)).toMatchObject({ yearFrom: null, yearTo: null });
    // Runtimes come in the slider's steps, and a maximum isn't under the minimum.
    expect(parseFilters({ runtimeMin: 95, runtimeMax: 300 })).toMatchObject({ runtimeMin: 0, runtimeMax: 240 });
    expect(parseFilters({ runtimeMin: 120, runtimeMax: 90 })).toMatchObject({ runtimeMin: 120, runtimeMax: 240 });
    for (const bad of [{ id: 0, name: 'x' }, { id: 1.5, name: 'x' }, { id: '31', name: 'x' }, { id: 31, name: '  ' }, { id: 31, name: 'x'.repeat(201) }, 'Tom Hanks']) expect(parseFilters({ cast: bad }).cast).toBeNull();
  });

  it('narrows by a range of years, runtime and people (people for movies only)', () => {
    expect(discoverQuery(spec(), 'movie', with_({ yearFrom: 1980, yearTo: 1999 }), ctx)?.filters).toEqual({ releaseDateGte: '1980-01-01', releaseDateLte: '1999-12-31' });
    expect(discoverQuery(spec({ releaseDateGte: '1990-06-01' }), 'movie', with_({ yearFrom: 1980 }), ctx)?.filters).toEqual({ releaseDateGte: '1990-06-01' });
    expect(discoverQuery(spec({ releaseDateGte: '2024-10-05' }), 'movie', with_({ yearTo: 2000 }), ctx)).toBeNull();
    expect(discoverQuery(spec({ runtimeLte: 90 }), 'movie', with_({ runtimeMin: 60, runtimeMax: 120 }), ctx)?.filters).toEqual({ runtimeGte: 60, runtimeLte: 90 });
    expect(discoverQuery(spec({ runtimeLte: 90 }), 'movie', with_({ runtimeMin: 120 }), ctx)).toBeNull();
    const people = with_({ cast: { id: 31, name: 'Tom Hanks' }, director: { id: 488, name: 'Steven Spielberg' } });
    expect(discoverQuery(spec(), 'movie', people, ctx)?.filters).toEqual({ withCast: '31', withCrew: '488' });
    expect(discoverQuery(spec(), 'series', people, ctx)?.filters).toEqual({});
    expect(activeCount(with_({ yearFrom: 1980, runtimeMax: 120, cast: { id: 31, name: 'Tom Hanks' } }), 'movie')).toBe(3);
    // Shows can't be filtered by people or certification, so those don't count there.
    expect(activeCount(with_({ yearFrom: 1980, certification: 'PG' }), 'series')).toBe(1);
    expect(activeCount(people, 'series')).toBe(0);
    expect(activeCount(people, 'movie')).toBe(2);
  });

  it('lists a decade’s years up to this one', () => {
    expect(decadeYears(2020, 2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020]);
    expect(decadeYears(1990, 2026)).toHaveLength(10);
  });

  it('counts the filters that are set', () => {
    expect(activeCount(DEFAULT_FILTERS, 'movie')).toBe(0);
    expect(activeCount(with_({ ratingMin: 7, ratingMax: 9, genres: ['drama'], sort: 'title', hideWatched: true }), 'movie')).toBe(3);
  });

  it('leaves out filters the grid’s own query ignores', () => {
    const picked = with_({ language: 'ja', cast: { id: 31, name: 'Tom Hanks' }, director: { id: 488, name: 'Steven Spielberg' }, genres: ['drama'] });
    expect(activeCount(picked, 'movie', fixedBy(spec({ withOriginalLanguage: 'ko' }), 'movie'))).toBe(3);
    expect(activeCount(picked, 'movie', fixedBy(spec({ withCast: '31', withCrew: '488' }), 'movie'))).toBe(2);
    // A genre grid adds the picked genres to its own, so they still count.
    expect(activeCount(picked, 'movie', fixedBy(spec({ withGenres: '27' }), 'movie'))).toBe(4);
  });

  it('leaves the grid’s own query alone without filters', () => {
    expect(discoverQuery(spec({ withGenres: '27', voteCountGte: 20 }), 'movie', DEFAULT_FILTERS, ctx)).toEqual({ sort: 'popularity.desc', filters: { withGenres: '27', voteCountGte: 20 } });
  });

  it('only ever narrows the grid’s bounds', () => {
    const gems = spec({ voteAverageGte: 7.5, voteCountGte: 80, voteCountLte: 600 }, 'vote_average.desc');
    expect(discoverQuery(gems, 'movie', with_({ ratingMin: 6, ratingMax: 9, minVotes: 200 }), ctx)?.filters).toEqual({ voteAverageGte: 7.5, voteAverageLte: 9, voteCountGte: 200, voteCountLte: 600 });
    // Its own rating sort keeps its own vote floor.
    expect(discoverQuery(gems, 'movie', DEFAULT_FILTERS, ctx)?.filters.voteCountGte).toBe(80);
    // More votes than the grid allows, or a range that can't hold anything: nothing can match.
    expect(discoverQuery(gems, 'movie', with_({ minVotes: 1000 }), ctx)).toBeNull();
    expect(discoverQuery(gems, 'movie', with_({ ratingMax: 7 }), ctx)).toBeNull();
    const critics = spec({ releaseDateGte: '2024-10-05' });
    expect(discoverQuery(critics, 'movie', with_({ decade: 2020 }), ctx)?.filters).toEqual({ releaseDateGte: '2024-10-05', releaseDateLte: '2029-12-31' });
    expect(discoverQuery(critics, 'movie', with_({ decade: 1990, year: 1994 }), ctx)).toBeNull();
  });

  it('maps the sort, with enough votes for a rating sort and nothing unreleased when newest', () => {
    expect(discoverQuery(spec(), 'series', with_({ sort: 'rating' }), ctx)).toEqual({ sort: 'vote_average.desc', filters: { voteCountGte: 100 } });
    expect(discoverQuery(spec(), 'movie', with_({ sort: 'newest', decade: 2020, year: 2026 }), ctx)).toEqual({ sort: 'primary_release_date.desc', filters: { releaseDateGte: '2020-01-01', releaseDateLte: '2026-10-05', year: 2026 } });
    // Upcoming and Airing this week look ahead: Newest sorts them without dropping what isn't out yet.
    expect(discoverQuery(spec(whatsNewQuery('upcoming', ctx.today, 'GB').filters), 'movie', with_({ sort: 'newest' }), ctx)?.filters.releaseDateLte).toBeUndefined();
    expect(discoverQuery(spec(whatsNewQuery('airing-week', ctx.today, 'GB').filters), 'series', with_({ sort: 'newest' }), ctx)?.filters.releaseDateLte).toBeUndefined();
    expect(discoverQuery(spec(whatsNewQuery('in-cinemas', ctx.today, 'GB').filters), 'movie', with_({ sort: 'newest' }), ctx)?.filters.releaseDateLte).toBe(ctx.today);
    expect(discoverQuery(spec(), 'movie', with_({ sort: 'oldest' }), ctx)?.sort).toBe('primary_release_date.asc');
    expect(discoverQuery(spec(), 'movie', with_({ sort: 'title' }), ctx)?.sort).toBe('title.asc');
  });

  it('filters by certification for movies only, from the offered list', () => {
    expect(discoverQuery(spec(), 'movie', with_({ certification: '12A' }), ctx)?.filters).toEqual({ certificationLte: '12A', certificationCountry: 'GB' });
    expect(discoverQuery(spec(), 'series', with_({ certification: '12A' }), ctx)?.filters).toEqual({});
    // Picked in another country (the region changed since): ignored.
    expect(discoverQuery(spec(), 'movie', with_({ certification: 'PG-13' }), ctx)?.filters).toEqual({});
  });

  it('combines genres with all or any, per kind', () => {
    expect(discoverQuery(spec(), 'movie', with_({ genres: ['action', 'comedy'] }), ctx)?.filters.withGenres).toBe('28,35');
    expect(discoverQuery(spec(), 'movie', with_({ genres: ['action', 'comedy'], genreMatch: 'any' }), ctx)?.filters.withGenres).toBe('28|35');
    // Action and Adventure are one TV genre; Horror isn't one at all.
    expect(discoverQuery(spec(), 'series', with_({ genres: ['action', 'adventure', 'horror'], genreMatch: 'any' }), ctx)?.filters.withGenres).toBe('10759');
    expect(discoverQuery(spec(), 'series', with_({ genres: ['action', 'horror'] }), ctx)).toBeNull();
    expect(discoverQuery(spec(), 'series', with_({ genres: ['horror'], genreMatch: 'any' }), ctx)).toBeNull();
    // A genre grid keeps its genre and adds the picks to it.
    const horror = spec({ withGenres: '27' });
    expect(discoverQuery(horror, 'movie', with_({ genres: ['comedy', 'horror', 'thriller'], genreMatch: 'any' }), ctx)?.filters.withGenres).toBe('27,35,53');
    expect(fixedBy(horror, 'movie')).toEqual({ language: false, genres: true, cast: false, director: false });
  });

  it('keeps a person grid’s own person', () => {
    const people = with_({ cast: { id: 31, name: 'Tom Hanks' }, director: { id: 488, name: 'Steven Spielberg' } });
    const actor = spec({ withCast: '500' });
    expect(discoverQuery(actor, 'movie', people, ctx)?.filters).toEqual({ withCast: '500', withCrew: '488' });
    expect(fixedBy(actor, 'movie')).toEqual({ language: false, genres: false, cast: true, director: false });
    const director = spec({ withCrew: '138' });
    expect(discoverQuery(director, 'movie', people, ctx)?.filters).toEqual({ withCast: '31', withCrew: '138' });
    expect(fixedBy(director, 'movie')).toEqual({ language: false, genres: false, cast: false, director: true });
  });

  it('keeps a language grid’s language', () => {
    const korean = spec({ withOriginalLanguage: 'ko' });
    expect(discoverQuery(korean, 'movie', with_({ language: 'ko' }), ctx)?.filters).toEqual({ withOriginalLanguage: 'ko' });
    expect(discoverQuery(korean, 'movie', with_({ language: 'ja' }), ctx)?.filters).toEqual({ withOriginalLanguage: 'ko' });
    expect(discoverQuery(spec(), 'series', with_({ language: 'ja' }), ctx)?.filters).toEqual({ withOriginalLanguage: 'ja' });
  });
});
