import { describe, expect, it } from 'vitest';
import { fitsMood, fitsTime, pickTonight, rankTonight, type TonightCandidate, type TonightChoice, type TonightSource } from './tonight';
import type { Title } from './titles';

const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...extra });
const candidate = (id: string, from: TonightSource, minutes: number, extra: Partial<Omit<TonightCandidate, 'title'>> & { title?: Partial<Title> } = {}): TonightCandidate => {
  const { title: fields, ...rest } = extra;
  return { title: title(id, fields), from, minutes, started: from === 'continue', finished: false, ...rest };
};
const ANY: TonightChoice = { time: 120, mood: null, unwatchedOnly: false };
const ids = (list: readonly TonightCandidate[]) => list.map((c) => c.title.id);

describe('Tonight: time', () => {
  it('fits what Play would start in the time, with a little grace', () => {
    expect(fitsTime(30, 30)).toBe(true);
    expect(fitsTime(35, 30)).toBe(true);
    expect(fitsTime(36, 30)).toBe(false);
    expect(fitsTime(95, 90)).toBe(true);
    expect(fitsTime(140, 90)).toBe(false);
  });

  it('fits an unknown length only when there is no limit', () => {
    expect(fitsTime(0, 90)).toBe(false);
    expect(fitsTime(0, 120)).toBe(true);
    expect(fitsTime(240, 120)).toBe(true);
  });

  it('uses what is left of a movie in progress', () => {
    const ranked = rankTonight([candidate('half', 'continue', 25), candidate('long', 'catalog', 130)], { ...ANY, time: 30 });
    expect(ids(ranked)).toEqual(['half']);
  });
});

describe('Tonight: mood', () => {
  it('maps moods to genres, normalising how addons write them', () => {
    expect(fitsMood(['Comedy'], 'light')).toBe(true);
    expect(fitsMood(['Comedy', 'Horror'], 'light')).toBe(false);
    expect(fitsMood(['Action & Adventure'], 'intense')).toBe(true);
    expect(fitsMood(['Romance', 'Drama'], 'cozy')).toBe(true);
    expect(fitsMood(['Romance', 'Thriller'], 'cozy')).toBe(false);
    expect(fitsMood(['Science Fiction'], 'mind-bending')).toBe(true);
    expect(fitsMood(['Mystery'], 'mind-bending')).toBe(true);
    expect(fitsMood(['Drama'], 'mind-bending')).toBe(false);
  });

  it('fits any genre (or none) without a mood, and no mood without genres', () => {
    expect(fitsMood([], null)).toBe(true);
    expect(fitsMood([], 'light')).toBe(false);
  });

  it('leaves out titles outside the mood', () => {
    const pool = [candidate('fun', 'catalog', 90, { title: { genres: ['Comedy'] } }), candidate('dark', 'catalog', 90, { title: { genres: ['Horror'] } })];
    expect(ids(rankTonight(pool, { ...ANY, mood: 'light' }))).toEqual(['fun']);
    expect(ids(rankTonight(pool, { ...ANY, mood: 'intense' }))).toEqual(['dark']);
  });
});

describe('Tonight: ranking', () => {
  it('puts Continue Watching first, then My Library, then catalogs', () => {
    const pool = [candidate('cat', 'catalog', 90, { title: { rating: '9.5' } }), candidate('lib', 'library', 90), candidate('cw', 'continue', 40)];
    expect(ids(rankTonight(pool, { ...ANY, time: 90 }))).toEqual(['cw', 'lib', 'cat']);
  });

  it('weighs how much of the time it fills with its rating, then keeps the order given', () => {
    const pool = [candidate('short', 'catalog', 25, { title: { rating: '7' } }), candidate('full', 'catalog', 88, { title: { rating: '7' } }), candidate('a', 'catalog', 60, { title: { rating: '6' } }), candidate('b', 'catalog', 60, { title: { rating: '8' } }), candidate('c', 'catalog', 60, { title: { rating: '8' } })];
    expect(ids(rankTonight(pool, { ...ANY, time: 90 }))).toEqual(['full', 'b', 'c', 'a', 'short']);
    // A much better film can outweigh a closer fit.
    expect(ids(rankTonight([candidate('fits', 'catalog', 90, { title: { rating: '5' } }), candidate('great', 'catalog', 70, { title: { rating: '9' } })], { ...ANY, time: 90 }))).toEqual(['great', 'fits']);
  });

  it('counts a title once, as its strongest source', () => {
    const pool = [candidate('x', 'catalog', 90), candidate('x', 'library', 90), candidate('y', 'catalog', 90)];
    const ranked = rankTonight(pool, ANY);
    expect(ids(ranked)).toEqual(['x', 'y']);
    expect(ranked[0]!.from).toBe('library');
  });

  it('leaves out finished titles, but not a Continue Watching show with a new episode', () => {
    const pool = [candidate('done', 'library', 90, { finished: true, started: true }), candidate('new-ep', 'continue', 45, { finished: true, title: { type: 'series' } })];
    expect(ids(rankTonight(pool, ANY))).toEqual(['new-ep']);
  });

  it('leaves out anything started when only unwatched titles are wanted', () => {
    const pool = [candidate('cw', 'continue', 40), candidate('seen-some', 'library', 90, { started: true }), candidate('fresh', 'catalog', 90)];
    expect(ids(rankTonight(pool, { ...ANY, unwatchedOnly: true }))).toEqual(['fresh']);
  });

  it('only suggests movies and shows', () => {
    const pool = [candidate('ch', 'catalog', 0, { title: { type: 'tv' } }), candidate('show', 'catalog', 22, { title: { type: 'series' } })];
    expect(ids(rankTonight(pool, ANY))).toEqual(['show']);
  });
});

describe('Tonight: picks', () => {
  const pool = [candidate('cw1', 'continue', 40), candidate('cw2', 'continue', 40), candidate('cw3', 'continue', 40), candidate('lib', 'library', 90), candidate('cat', 'catalog', 90)];
  const ranked = rankTonight(pool, ANY);

  it('shows three, at most two from one source while others fit', () => {
    expect(ids(pickTonight(ranked, new Set()))).toEqual(['cw1', 'cw2', 'lib']);
  });

  it('fills up in rank order when one source is all there is', () => {
    const only = rankTonight([candidate('a', 'catalog', 90), candidate('b', 'catalog', 90), candidate('c', 'catalog', 90)], ANY);
    expect(ids(pickTonight(only, new Set()))).toEqual(['a', 'b', 'c']);
  });

  it('gives "Another" the best one not offered yet, and nothing once they run out', () => {
    expect(ids(pickTonight(ranked, new Set(['cw1', 'cw2', 'lib']), 1))).toEqual(['cw3']);
    expect(pickTonight(ranked, new Set(ids(ranked)), 1)).toEqual([]);
  });

  it('returns fewer when fewer fit', () => {
    expect(pickTonight([], new Set())).toEqual([]);
    expect(ids(pickTonight(rankTonight([candidate('one', 'catalog', 20)], { ...ANY, time: 30 }), new Set()))).toEqual(['one']);
  });
});
