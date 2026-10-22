import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import { daySeed, mixHero, seededShuffle, type HeroPick, type MixInput } from './hero-mix';

const title = (id: string, fields: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], background: `https://img/${id}`, description: 'About it', ...fields });
const trending = (n: number) => Array.from({ length: n }, (_, i) => ({ title: title(`t${i + 1}`), rank: i + 1 }));
const because = (id: string, seed = 'Ronin'): HeroPick => ({ title: title(id), reason: { kind: 'because', seed } });
const input = (fields: Partial<MixInput>): MixInput => ({ trending: trending(12), personal: [], exclude: new Set(), count: 6, seed: 42, ...fields });
const ids = (picks: HeroPick[]) => picks.map((p) => p.title.id);

describe('daySeed', () => {
  it('is the same all day and changes with the day and the profile', () => {
    const morning = new Date(2026, 9, 6, 8);
    expect(daySeed(morning, 'main')).toBe(daySeed(new Date(2026, 9, 6, 23, 59), 'main'));
    expect(daySeed(morning, 'main')).not.toBe(daySeed(new Date(2026, 9, 7, 8), 'main'));
    expect(daySeed(morning, 'main')).not.toBe(daySeed(morning, 'kids'));
  });
});

describe('seededShuffle', () => {
  it('shuffles the same way for the same seed, keeping every item', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(items, 7)).toEqual(seededShuffle(items, 7));
    expect(seededShuffle(items, 7)).not.toEqual(seededShuffle(items, 8));
    expect([...seededShuffle(items, 7)].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('mixHero', () => {
  it('deduplicates repeated trending items without personal recommendations', () => {
    const item = title('same');
    expect(ids(mixHero(input({ trending: [{ title: item, rank: 1 }, { title: item, rank: 2 }], personal: [] })))).toEqual(['same']);
  });

  it('is the popular titles in order when there are no personal picks', () => {
    expect(ids(mixHero(input({})))).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
  });

  it('takes turns, popular first, about half each', () => {
    const picks = mixHero(input({ personal: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => because(id)) }));
    expect(picks).toHaveLength(6);
    expect(picks.map((p) => p.reason.kind)).toEqual(['trending', 'because', 'trending', 'because', 'trending', 'because']);
    // Popular ones keep their rank order, from a pool twice the banner's size.
    const ranks = picks.flatMap((p) => (p.reason.kind === 'trending' ? [p.reason.rank] : []));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(Math.max(...ranks)).toBeLessThanOrEqual(12);
  });

  it('fills up with popular titles when there are few personal ones, and the other way round', () => {
    expect(mixHero(input({ personal: [because('p1')] })).map((p) => p.reason.kind)).toEqual(['trending', 'because', 'trending', 'trending', 'trending', 'trending']);
    const few = mixHero(input({ trending: trending(2), personal: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => because(id)) }));
    expect(few).toHaveLength(6);
    expect(few.filter((p) => p.reason.kind === 'trending')).toHaveLength(2);
  });

  it('leaves out repeats, finished and in-progress titles, and titles without art', () => {
    const picks = mixHero(
      input({
        personal: [because('t1'), because('p1'), because('p1'), because('done'), { title: title('bare', { background: undefined }), reason: { kind: 'watchlist' } }],
        exclude: new Set(['done', 't2']),
      }),
    );
    expect(ids(picks)).not.toContain('done');
    expect(ids(picks)).not.toContain('t2');
    expect(ids(picks)).not.toContain('bare');
    expect(new Set(ids(picks)).size).toBe(picks.length);
    // A popular title that's also a personal pick is shown once, as the personal one.
    expect(picks.find((p) => p.title.id === 't1')?.reason.kind ?? 'because').toBe('because');
  });

  it('is stable for a seed and varies across seeds', () => {
    const personal = Array.from({ length: 10 }, (_, i) => because(`p${i}`));
    expect(ids(mixHero(input({ personal, seed: 1 })))).toEqual(ids(mixHero(input({ personal, seed: 1 }))));
    const days = new Set(Array.from({ length: 6 }, (_, seed) => ids(mixHero(input({ personal, seed }))).join()));
    expect(days.size).toBeGreaterThan(1);
  });
});
