import { describe, expect, it } from 'vitest';
import { buildFeed, slideRole, stepTo, trailerId, withoutAt } from './shorts';
import type { Title } from './titles';

const title = (id: string, type = 'movie'): Title => ({ id, type, name: id, genres: [], origins: [] });
const none = { seen: () => false, unwanted: new Set<string>() };

describe('buildFeed', () => {
  it('takes movies, shows and genres in turn, each title once', () => {
    const movies = [title('tt1'), title('tt2')];
    const shows = [title('tt3', 'series'), title('tt1')];
    const genre = [title('tt4'), title('tt5')];
    expect(buildFeed([movies, shows, genre], none).map((t) => t.id)).toEqual(['tt1', 'tt3', 'tt4', 'tt2', 'tt5']);
  });

  it('leaves out what was watched or started, unwanted, not a movie or show, or without an IMDb id', () => {
    const list = [title('tt1'), title('tt2'), title('tt3'), title('tt4', 'channel'), title('kitsu:5'), title('tt6', 'series')];
    const skip = { seen: (t: Title) => t.id === 'tt1', unwanted: new Set(['tt2']) };
    expect(buildFeed([list], skip).map((t) => t.id)).toEqual(['tt3', 'tt6']);
  });

  it('stops at the limit', () => {
    const list = Array.from({ length: 10 }, (_, i) => title(`tt${i + 1}`));
    expect(buildFeed([list], none, 4)).toHaveLength(4);
  });

  it('is empty with nothing to show', () => {
    expect(buildFeed([], none)).toEqual([]);
    expect(buildFeed([[], []], none)).toEqual([]);
  });
});

describe('trailerId', () => {
  it('takes the first YouTube id', () => {
    expect(trailerId({ trailers: ['nope', 'cdx31ak4KbQ', 'a-b_c123456'] })).toBe('cdx31ak4KbQ');
    expect(trailerId({ trailers: ['https://youtu.be/cdx31ak4KbQ', '--exec=calc'] })).toBeUndefined();
    expect(trailerId({})).toBeUndefined();
  });
});

describe('slideRole', () => {
  it('plays the one on screen, readies the next, and lets go of the rest', () => {
    expect([0, 1, 2, 3, 4].map((i) => slideRole(i, 2))).toEqual(['off', 'off', 'play', 'preload', 'off']);
    expect(slideRole(0, 0)).toBe('play');
    expect(slideRole(1, 0)).toBe('preload');
  });
});

describe('stepTo', () => {
  it('moves one slide at a time within the feed', () => {
    expect(stepTo(0, 1, 5)).toBe(1);
    expect(stepTo(0, -1, 5)).toBe(0);
    expect(stepTo(4, 1, 5)).toBe(4);
    expect(stepTo(2, -1, 5)).toBe(1);
    expect(stepTo(0, 1, 1)).toBe(0);
  });
});

describe('withoutAt', () => {
  const feed = ['a', 'b', 'c', 'd'];

  it('shows the next title in the same place when the one on screen leaves', () => {
    expect(withoutAt(feed, 1, 1)).toEqual({ feed: ['a', 'c', 'd'], current: 1 });
  });

  it('keeps the one on screen when a later title leaves', () => {
    expect(withoutAt(feed, 3, 1)).toEqual({ feed: ['a', 'b', 'c'], current: 1 });
  });

  it('keeps the one on screen when an earlier title leaves', () => {
    expect(withoutAt(feed, 0, 2)).toEqual({ feed: ['b', 'c', 'd'], current: 1 });
  });

  it('lands on the end card when the last title leaves', () => {
    expect(withoutAt(feed, 3, 3)).toEqual({ feed: ['a', 'b', 'c'], current: 3 });
    expect(withoutAt(['a'], 0, 0)).toEqual({ feed: [], current: 0 });
  });

  it('ignores a place outside the feed', () => {
    expect(withoutAt(feed, 9, 1)).toEqual({ feed, current: 1 });
  });
});
