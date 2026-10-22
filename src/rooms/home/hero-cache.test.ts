import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import { decodeHero, encodeHero, heroKey } from './hero-cache';
import type { HeroPick } from './hero-mix';

const title = (id: string, fields: Partial<Title> = {}): Title => ({ id, type: 'movie', name: `Name ${id}`, genres: ['Drama'], origins: [], background: `https://img.example/${id}.jpg`, description: 'About it', ...fields });

describe('the saved banner', () => {
  const a = title('tt1');
  const b = title('tt2', { type: 'series' });
  const reasons = new Map<Title, HeroPick['reason']>([
    [a, { kind: 'trending', rank: 1 }],
    [b, { kind: 'because', seed: 'Ronin' }],
  ]);

  it('reads back the same titles, in order, with their reasons', () => {
    const picks = decodeHero(encodeHero(7, 6, [a, b], reasons), 7, 6);
    expect(picks?.map((p) => [p.title.id, p.title.type, p.title.name, p.title.background, p.reason])).toEqual([
      ['tt1', 'movie', 'Name tt1', 'https://img.example/tt1.jpg', { kind: 'trending', rank: 1 }],
      ['tt2', 'series', 'Name tt2', 'https://img.example/tt2.jpg', { kind: 'because', seed: 'Ronin' }],
    ]);
  });

  it('is used only on the day, and for the count of featured titles, it was made for', () => {
    const saved = encodeHero(7, 6, [a, b], reasons);
    expect(decodeHero(saved, 8, 6)).toBeNull();
    expect(decodeHero(saved, 7, 10)).toBeNull();
  });

  it('is nothing when missing, empty or not a banner Orbit wrote', () => {
    expect(decodeHero(null, 7, 6)).toBeNull();
    expect(decodeHero(encodeHero(7, 6, [], reasons), 7, 6)).toBeNull();
    for (const junk of ['', '{', 'null', '[]', '{"seed":7,"count":6,"picks":"x"}', '{"seed":7,"count":6,"picks":[{"title":{"meta":{"id":"tt1"}}}]}']) {
      expect(decodeHero(junk, 7, 6), junk).toBeNull();
    }
  });

  it('is checked like addon data: artwork that isn’t https is dropped', () => {
    const raw = encodeHero(7, 6, [title('tt3', { background: 'http://lan.example/x.jpg' })], new Map());
    expect(decodeHero(raw, 7, 6)?.[0]?.title.background).toBeUndefined();
  });

  it('tells banners apart by their titles', () => {
    expect(heroKey([a, b])).toBe(heroKey([title('tt1'), title('tt2')]));
    expect(heroKey([a, b])).not.toBe(heroKey([b, a]));
  });
});
