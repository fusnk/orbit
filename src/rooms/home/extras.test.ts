import { describe, expect, it } from 'vitest';
import { cardTag, CHIPS, chipFallback, chipQuery, dayPart, episodeCode, latestEpisode, NEW_EPISODE_MS } from './extras';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 6, 12);
const aired = (titleId: string, season: number, episode: number, daysAgo: number) => ({ titleId, season, episode, airedAt: NOW - daysAgo * DAY });

describe('dayPart', () => {
  it('splits the day into four greetings', () => {
    expect([0, 4, 5, 11, 12, 16, 17, 21, 22, 23].map(dayPart)).toEqual(['night', 'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night']);
  });
});

describe('cardTag', () => {
  it('marks a series with an episode from the last week', () => {
    expect(cardTag('tt1', [aired('tt1', 3, 4, 2)], NOW)).toBe('new-episode');
  });

  it('prefers "New season" for a later season’s premiere', () => {
    expect(cardTag('tt1', [aired('tt1', 3, 2, 1), aired('tt1', 3, 1, 6)], NOW)).toBe('new-season');
    // A first season's first episode is a new show, not a new season.
    expect(cardTag('tt1', [aired('tt1', 1, 1, 1)], NOW)).toBe('new-episode');
  });

  it('ignores old, future and other titles’ episodes', () => {
    expect(cardTag('tt1', [aired('tt1', 2, 1, 8)], NOW)).toBeNull();
    expect(cardTag('tt1', [{ ...aired('tt1', 2, 1, 0), airedAt: NOW + DAY }], NOW)).toBeNull();
    expect(cardTag('tt1', [aired('tt2', 2, 1, 1)], NOW)).toBeNull();
    expect(cardTag('tt1', [{ ...aired('tt1', 2, 5, 0), airedAt: NOW - NEW_EPISODE_MS }], NOW)).toBe('new-episode');
  });
});

describe('latestEpisode', () => {
  it('picks the most recently aired episode of the title', () => {
    const items = [aired('tt1', 14, 18, 9), aired('tt1', 14, 19, 2), aired('tt2', 1, 1, 0), { ...aired('tt1', 14, 20, 0), airedAt: NOW + DAY }];
    expect(latestEpisode('tt1', items, NOW)).toMatchObject({ season: 14, episode: 19 });
    expect(latestEpisode('tt3', items, NOW)).toBeNull();
  });

  it('breaks a same-day tie by episode number', () => {
    expect(latestEpisode('tt1', [aired('tt1', 1, 2, 1), aired('tt1', 1, 3, 1)], NOW)).toMatchObject({ episode: 3 });
  });

  it('writes the code as S14.E19', () => {
    expect(episodeCode({ season: 14, episode: 19 })).toBe('S14.E19');
  });
});

describe('mood chips', () => {
  it('ask TMDB for films only, known ones, popular first', () => {
    for (const chip of CHIPS) {
      const query = chipQuery(chip, 'FR');
      expect(query.kind).toBe('discover');
      expect(query.media).toBe('movie');
      expect(Number(query.filters.voteCountGte)).toBeGreaterThan(0);
    }
    expect(chipQuery('action', 'US')).toEqual({ kind: 'discover', media: 'movie', sort: 'popularity.desc', filters: { voteCountGte: 200, withGenres: '28' } });
  });

  it('map each mood to its filters', () => {
    expect(chipQuery('feel-good', 'US').filters).toMatchObject({ withGenres: '35|10751|16', withoutGenres: '27,53,10752' });
    expect(chipQuery('short', 'US').filters).toMatchObject({ runtimeGte: 60, runtimeLte: 90 });
    expect(chipQuery('greats', 'US')).toMatchObject({ sort: 'vote_average.desc', filters: { voteCountGte: 5000 } });
    expect(chipQuery('country', 'JP').filters).toMatchObject({ withOriginCountry: 'JP' });
  });

  it('fall back to catalogs without TMDB, except the country chip', () => {
    expect(chipFallback('scare')).toEqual({ genre: /horror/i });
    expect(chipFallback('mind-bending')).toEqual({ mood: 'mind-bending' });
    expect(chipFallback('short')).toEqual({ maxMinutes: 90 });
    expect(chipFallback('country')).toBeNull();
    expect(CHIPS.filter((chip) => chipFallback(chip) === null)).toEqual(['country']);
  });
});
