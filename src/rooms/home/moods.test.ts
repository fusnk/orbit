import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import { genreTags, runtimeMinutes, selectMood, stillOnList, type MoodInput } from './moods';

const title = (id: string, fields: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...fields });
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 3);

const input = (fields: Partial<MoodInput>): MoodInput => ({ pool: [], finished: [], seen: new Set(), now: NOW, ...fields });
const pool = (...titles: Title[]) => titles.map((t, rank) => ({ title: t, rank }));
const ids = (titles: Title[]) => titles.map((t) => t.id);

describe('runtimeMinutes', () => {
  it('reads the ways addons write runtimes', () => {
    expect(runtimeMinutes('98 min')).toBe(98);
    expect(runtimeMinutes('1h 38min')).toBe(98);
    expect(runtimeMinutes('1h38m')).toBe(98);
    expect(runtimeMinutes('2 h')).toBe(120);
    expect(runtimeMinutes('45')).toBe(45);
    expect(runtimeMinutes('')).toBeNull();
    expect(runtimeMinutes(undefined)).toBeNull();
    expect(runtimeMinutes('N/A')).toBeNull();
  });
});

describe('genreTags', () => {
  it('matches genre names however catalogs spell them', () => {
    expect([...genreTags(['Sci-Fi', 'Science Fiction', 'Sci-Fi & Fantasy'])]).toEqual(['scifi']);
    expect([...genreTags(['Kids', 'Animation', 'War'])].sort()).toEqual(['animation', 'family', 'war']);
    // "Software" isn't war, "Drama" isn't anything here.
    expect([...genreTags(['Software', 'Drama'])]).toEqual([]);
  });
});

describe('selectMood', () => {
  it('Something short: movies under 100 minutes and shows with short episodes', () => {
    const titles = pool(
      title('short-movie', { runtime: '88 min' }),
      title('long-movie', { runtime: '2h 10min' }),
      title('sitcom', { type: 'series', runtime: '22 min' }),
      title('drama-series', { type: 'series', runtime: '55 min' }),
      title('unknown'),
    );
    expect(ids(selectMood('short', input({ pool: titles })))).toEqual(['short-movie', 'sitcom']);
  });

  it('leaves out what the person has started or finished', () => {
    const titles = pool(title('a', { runtime: '80 min' }), title('b', { runtime: '80 min' }));
    expect(ids(selectMood('short', input({ pool: titles, seen: new Set(['a']) })))).toEqual(['b']);
  });

  it('Mind-bending needs a mix of sci-fi, mystery and thriller', () => {
    const titles = pool(title('mix', { genres: ['Sci-Fi', 'Thriller'] }), title('plain-scifi', { genres: ['Sci-Fi'] }), title('mystery-thriller', { genres: ['Mystery', 'Thriller'] }));
    expect(ids(selectMood('mind-bending', input({ pool: titles })))).toEqual(['mix', 'mystery-thriller']);
  });

  it('Late night is horror and thrillers; Feel-good keeps them out', () => {
    const titles = pool(title('scary', { genres: ['Horror'] }), title('tense', { genres: ['Thriller'] }), title('funny', { genres: ['Comedy'] }), title('dark-comedy', { genres: ['Comedy', 'Horror'] }), title('cartoon', { genres: ['Animation'] }));
    expect(ids(selectMood('late-night', input({ pool: titles })))).toEqual(['scary', 'tense', 'dark-comedy']);
    expect(ids(selectMood('feel-good', input({ pool: titles })))).toEqual(['funny', 'cartoon']);
  });

  it('dedupes titles across catalogs and interleaves by position', () => {
    const a = [title('a1', { genres: ['Horror'] }), title('a2', { genres: ['Horror'] })];
    const b = [title('b1', { genres: ['Horror'] }), title('a1', { genres: ['Horror'] })];
    expect(ids(selectMood('late-night', input({ pool: [...pool(...a), ...pool(...b)] })))).toEqual(['a1', 'b1', 'a2']);
  });

  it('Hidden gems: well rated and never near the top of a catalog', () => {
    const filler = Array.from({ length: 20 }, (_, i) => title(`f${i}`, { rating: '5.0' }));
    const titles = pool(title('famous', { rating: '8.8' }), ...filler, title('gem', { rating: '7.9' }), title('meh', { rating: '6.1' }), title('better-gem', { rating: '8.1' }));
    expect(ids(selectMood('hidden-gems', input({ pool: titles })))).toEqual(['better-gem', 'gem']);
    // A title that's also high up in another catalog isn't hidden.
    const elsewhere = [...titles, { title: title('gem', { rating: '7.9' }), rank: 3 }];
    expect(ids(selectMood('hidden-gems', input({ pool: elsewhere })))).toEqual(['better-gem']);
  });

  it('Comfort rewatch: kept titles finished more than six months ago, newest first', () => {
    const finished = [
      { title: title('recent'), finishedAt: NOW - 30 * DAY, loved: true },
      { title: title('old-loved'), finishedAt: NOW - 400 * DAY, loved: true },
      { title: title('older-loved'), finishedAt: NOW - 800 * DAY, loved: true },
      { title: title('old-meh'), finishedAt: NOW - 400 * DAY, loved: false },
    ];
    expect(ids(selectMood('comfort', input({ finished, seen: new Set(['old-loved', 'older-loved']) })))).toEqual(['old-loved', 'older-loved']);
  });

  it('caps the row and is empty when nothing fits', () => {
    const many = pool(...Array.from({ length: 50 }, (_, i) => title(`m${i}`, { runtime: '90 min' })));
    expect(selectMood('short', input({ pool: many }), 20)).toHaveLength(20);
    expect(selectMood('late-night', input({ pool: many }))).toEqual([]);
  });
});

describe('stillOnList', () => {
  it('lists saved titles never started, the longest waiting first', () => {
    const saved = [
      { title: title('new'), addedAt: 300 },
      { title: title('started'), addedAt: 100 },
      { title: title('old'), addedAt: 200 },
    ];
    expect(stillOnList(saved, new Set(['started'])).map((t) => t.id)).toEqual(['old', 'new']);
    expect(stillOnList(saved, new Set(), 1).map((t) => t.id)).toEqual(['started']);
  });
});
