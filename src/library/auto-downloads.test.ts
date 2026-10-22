import { describe, expect, it } from 'vitest';
import type { Episode, Title } from '../catalog/titles';
import { hasAired, nextToQueue, parseKeepCount, parseKeepNext, seasonToQueue, watchedToDelete } from './auto-downloads';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const ep = (season: number, number: number, extra: Partial<Episode> = {}): Episode => ({ id: `tt1:${season}:${number}`, number, title: `E${number}`, ...extra });

const show: Title = {
  id: 'tt1',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [
    { number: 0, episodes: [ep(0, 1)] },
    { number: 2, episodes: [ep(2, 2), ep(2, 1), ep(2, 3, { released: '2026-07-01T00:00:00Z' })] },
    { number: 1, episodes: [ep(1, 1), ep(1, 2), ep(1, 3, { airs: 'Airs Jun 9' }), ep(1, 4)] },
  ],
};

const ids = (refs: { episode: Episode }[]) => refs.map((r) => r.episode.id);
const none = () => false;
const set = (...videoIds: string[]) => (id: string) => videoIds.includes(id);

describe('episodes to download', () => {
  it('knows what has aired', () => {
    expect(hasAired(ep(1, 1), NOW)).toBe(true);
    expect(hasAired(ep(1, 1, { airs: 'Airs Jun 9' }), NOW)).toBe(false);
    expect(hasAired(ep(1, 1, { released: '2026-07-01T00:00:00Z' }), NOW)).toBe(false);
    expect(hasAired(ep(1, 1, { released: '2026-05-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('a season: every aired episode without a download, in order', () => {
    expect(ids(seasonToQueue(show, 2, NOW, none))).toEqual(['tt1:2:1', 'tt1:2:2']);
    expect(ids(seasonToQueue(show, 1, NOW, set('tt1:1:2')))).toEqual(['tt1:1:1', 'tt1:1:4']);
    expect(seasonToQueue(show, 9, NOW, none)).toEqual([]);
  });

  it('next episodes: N aired and unwatched after the furthest watched, skipping specials', () => {
    const next = (count: number, watched: (id: string) => boolean, has: (id: string) => boolean = none) => ids(nextToQueue(show, { count, now: NOW, isWatched: watched, hasDownload: has }));
    // Nothing watched yet: from the start (season 1), not the specials.
    expect(next(1, none)).toEqual(['tt1:1:1']);
    // After 1x2: 1x3 hasn't aired, so 1x4 then season 2 in episode order.
    expect(next(3, set('tt1:1:1', 'tt1:1:2'))).toEqual(['tt1:1:4', 'tt1:2:1', 'tt1:2:2']);
    // Already downloaded ones count toward N but aren't queued again.
    expect(next(2, set('tt1:1:2'), set('tt1:1:4'))).toEqual(['tt1:2:1']);
    // Episodes watched further ahead aren't queued, and earlier unwatched ones stay behind.
    expect(next(2, set('tt1:2:1'))).toEqual(['tt1:2:2']);
    // The last aired episode watched: nothing left (2x3 airs next month).
    expect(next(3, set('tt1:2:2'))).toEqual([]);
    expect(nextToQueue({ ...show, seasons: undefined }, { count: 1, now: NOW, isWatched: none, hasDownload: none })).toEqual([]);
  });
});

describe('deleting watched episodes', () => {
  const downloads = [
    { id: 'a', titleId: 'tt1', videoId: 'tt1:1:1', season: 1, state: 'done' },
    { id: 'b', titleId: 'tt1', videoId: 'tt1:1:2', season: 1, state: 'running' },
    { id: 'c', titleId: 'tt1', videoId: 'tt1:1:4', season: 1, state: 'done' },
    { id: 'd', titleId: 'tt2', videoId: 'tt1:1:1', season: 1, state: 'done' },
    { id: 'e', titleId: 'tt1', videoId: 'tt1', season: null, state: 'done' },
  ];
  const just = new Set(['tt1:1:1', 'tt1:1:2', 'tt1']);

  it('only with the option on, only that show, only finished episode downloads just watched', () => {
    expect(watchedToDelete(downloads, 'tt1', { deleteWatched: true }, just)).toEqual(['a']);
    expect(watchedToDelete(downloads, 'tt1', { deleteWatched: false }, just)).toEqual([]);
    expect(watchedToDelete(downloads, 'tt1', undefined, just)).toEqual([]);
    expect(watchedToDelete(downloads, 'tt1', { deleteWatched: true }, new Set())).toEqual([]);
  });
});

describe('stored choices', () => {
  it('reads shows kept downloaded and drops junk', () => {
    const parsed = parseKeepNext({ tt1: { deleteWatched: true }, 'kitsu:7': {}, tt3: { deleteWatched: 'yes' }, bad: 1, '': {}, ' x': {}, arr: [] });
    expect([...parsed]).toEqual([
      ['tt1', { deleteWatched: true }],
      ['kitsu:7', { deleteWatched: false }],
      ['tt3', { deleteWatched: false }],
    ]);
    for (const junk of [null, undefined, 0, 'tt1', [], true, JSON.parse('{"__proto__": {"deleteWatched": true}}')]) expect(parseKeepNext(junk).size).toBe(0);
  });

  it('caps how many shows are read', () => {
    const many = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`tt${i}`, {}]));
    expect(parseKeepNext(many).size).toBe(500);
  });

  it('reads how many to keep ahead', () => {
    expect(parseKeepCount(2)).toBe(2);
    for (const junk of [0, 4, '2', null, 1.5]) expect(parseKeepCount(junk)).toBe(1);
  });
});
