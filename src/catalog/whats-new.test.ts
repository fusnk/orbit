import { describe, expect, it } from 'vitest';
import { daysFrom, seasonalList, seasonalQuery, whatsNewQuery } from './whats-new';

describe('whatsNewQuery', () => {
  it('asks for films in cinemas in the region over the last six weeks', () => {
    expect(whatsNewQuery('in-cinemas', '2026-10-14', 'GB')).toEqual({
      media: 'movie',
      sort: 'popularity.desc',
      filters: { withReleaseType: '2|3', region: 'GB', regionReleaseDateGte: '2026-09-02', regionReleaseDateLte: '2026-10-14' },
    });
  });

  it('asks for digital releases, shows airing this week, and films still to come', () => {
    expect(whatsNewQuery('new-to-stream', '2026-10-14', 'US').filters).toMatchObject({ withReleaseType: '4', region: 'US', regionReleaseDateLte: '2026-10-14' });
    expect(whatsNewQuery('airing-week', '2026-12-28', 'US')).toEqual({ media: 'tv', sort: 'popularity.desc', filters: { airDateGte: '2026-12-28', airDateLte: '2027-01-04' } });
    expect(whatsNewQuery('upcoming', '2026-10-14', 'FR').filters).toMatchObject({ regionReleaseDateGte: '2026-10-15', regionReleaseDateLte: '2027-01-12' });
  });

  it('moves days across month and year ends', () => {
    expect(daysFrom('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysFrom('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('seasonalList', () => {
  it('follows the time of year', () => {
    expect(seasonalList(new Date(2026, 9, 1)).id).toBe('halloween');
    expect(seasonalList(new Date(2026, 9, 31)).id).toBe('halloween');
    expect(seasonalList(new Date(2026, 11, 24)).id).toBe('christmas');
    expect(seasonalList(new Date(2026, 10, 15)).id).toBe('true-story');
    expect(seasonalList(new Date(2027, 0, 2)).id).toBe('true-story');
  });

  it('asks TMDB for the list by keyword', () => {
    expect(seasonalQuery(seasonalList(new Date(2026, 9, 14)), 'movie').filters).toEqual({ withKeywords: '3335', voteCountGte: 50 });
  });
});
