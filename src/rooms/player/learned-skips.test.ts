import { describe, expect, it } from 'vitest';
import { addSeek, learnedFor, learnIntro, MAX_HITS, MAX_SHOWS, offeredIntro, parseLearned, RUN_GAP_MS, sameIntro, skippedIntro, type Learned, type SeekRun } from './learned-skips';

/** Seeks one after another (each `gap` ms apart), as [from, to]. */
function seeks(list: [number, number][], gap = 500): SeekRun | undefined {
  let run: SeekRun | undefined;
  list.forEach(([from, to], i) => (run = addSeek(run, from, to, i * gap)));
  return run;
}

describe('a skip in progress', () => {
  it('adds up forward seeks in quick succession (→ pressed a few times)', () => {
    expect(seeks([[60, 70], [70, 80], [80, 90], [90, 100]])).toEqual({ from: 60, to: 100, at: 1500 });
  });

  it('starts over once the seeks are far enough apart', () => {
    expect(seeks([[60, 70], [200, 210]], RUN_GAP_MS + 1)).toEqual({ from: 200, to: 210, at: RUN_GAP_MS + 1 });
  });

  it('trims an overshoot stepped back within it', () => {
    expect(seeks([[60, 180], [180, 150]])).toEqual({ from: 60, to: 150, at: 500 });
  });

  it('is no skip when it goes back before where it started, or starts backwards', () => {
    expect(seeks([[60, 120], [120, 40]])).toBeUndefined();
    expect(seeks([[120, 90]])).toBeUndefined();
  });
});

describe('what a skip teaches', () => {
  it('learns a skip across a stretch near the start', () => {
    expect(skippedIntro({ from: 62.34, to: 151.98 })).toEqual({ start: 62.3, end: 152 });
    expect(skippedIntro({ from: 0, to: 90 })).toEqual({ start: 0, end: 90 });
  });

  it('ignores nudges, long jumps and skips from past the first ten minutes', () => {
    expect(skippedIntro({ from: 60, to: 75 })).toBeNull();
    expect(skippedIntro({ from: 60, to: 1300 })).toBeNull();
    expect(skippedIntro({ from: 650, to: 740 })).toBeNull();
    expect(skippedIntro({ from: Number.NaN, to: 90 })).toBeNull();
  });
});

describe('matching between episodes', () => {
  it('counts intros a few seconds apart as the same one', () => {
    expect(sameIntro({ start: 60, end: 150 }, { start: 68, end: 155 })).toBe(true);
    expect(sameIntro({ start: 60, end: 150 }, { start: 60, end: 175 })).toBe(false);
    expect(sameIntro({ start: 60, end: 150 }, { start: 95, end: 150 })).toBe(false);
  });

  it('confirms a matching skip, taking its newer times', () => {
    const once = learnIntro([], 'tt1', { start: 60, end: 150 });
    expect(once).toEqual([['tt1', 60, 150, 1]]);
    expect(learnIntro(once, 'tt1', { start: 63, end: 152 })).toEqual([['tt1', 63, 152, 2]]);
  });

  it('replaces an unconfirmed intro, but a confirmed one only gets less sure from one odd skip', () => {
    expect(learnIntro([['tt1', 60, 150, 1]], 'tt1', { start: 200, end: 290 })).toEqual([['tt1', 200, 290, 1]]);
    expect(learnIntro([['tt1', 60, 150, 3]], 'tt1', { start: 200, end: 290 })).toEqual([['tt1', 60, 150, 2]]);
  });

  it('stops counting confirmations at the cap', () => {
    expect(learnIntro([['tt1', 60, 150, MAX_HITS]], 'tt1', { start: 60, end: 150 })).toEqual([['tt1', 60, 150, MAX_HITS]]);
  });

  it('keeps the series used most recently, up to the cap', () => {
    const full: Learned[] = Array.from({ length: MAX_SHOWS }, (_, i) => [`tt${i}`, 60, 150, 1]);
    const next = learnIntro(full, 'tt-new', { start: 30, end: 90 });
    expect(next).toHaveLength(MAX_SHOWS);
    expect(next[0]![0]).toBe('tt1');
    expect(next.at(-1)).toEqual(['tt-new', 30, 90, 1]);
    // Learning again moves a series to the end.
    expect(learnIntro([['a', 60, 150, 1], ['b', 60, 150, 1]], 'a', { start: 60, end: 150 }).map(([id]) => id)).toEqual(['b', 'a']);
  });

  it('offers Skip a little before the learned start, to its end', () => {
    expect(offeredIntro({ start: 60, end: 150 })).toEqual({ kind: 'intro', start: 50, end: 150 });
    expect(offeredIntro({ start: 4, end: 90 })).toEqual({ kind: 'intro', start: 0, end: 90 });
    expect(learnedFor([['tt1', 60, 150, 2]], 'tt1')).toEqual({ start: 60, end: 150 });
    expect(learnedFor([['tt1', 60, 150, 2]], 'tt2')).toBeUndefined();
  });
});

describe('reading what was saved', () => {
  it('keeps valid entries in order, the newest of a duplicate', () => {
    expect(
      parseLearned([
        ['tt1', 60, 150, 1],
        ['tt2', 0, 45, 2],
        ['tt1', 70, 160, 3],
      ]),
    ).toEqual([
      ['tt2', 0, 45, 2],
      ['tt1', 70, 160, 3],
    ]);
  });

  it('drops junk and implausible times', () => {
    expect(parseLearned({ tt1: [60, 150] })).toEqual([]);
    expect(parseLearned(null)).toEqual([]);
    expect(
      parseLearned([
        ['', 60, 150, 1],
        ['x'.repeat(101), 60, 150, 1],
        ['tt1', -5, 50, 1],
        ['tt1', 60, 70, 1],
        ['tt1', 700, 790, 1],
        ['tt1', 60, 1000, 1],
        ['tt1', 60, 150, 0],
        ['tt1', 60, 150, 1.5],
        ['tt1', 60, 150, MAX_HITS + 1],
        ['tt1', '60', 150, 1],
        ['tt1', 60, Number.POSITIVE_INFINITY, 1],
        ['tt1', 60, 150],
        'tt1',
      ]),
    ).toEqual([]);
  });

  it('keeps at most the cap, the most recent ones', () => {
    const many: Learned[] = Array.from({ length: MAX_SHOWS + 20 }, (_, i) => [`tt${i}`, 60, 150, 1]);
    const parsed = parseLearned(many);
    expect(parsed).toHaveLength(MAX_SHOWS);
    expect(parsed[0]![0]).toBe('tt20');
  });
});
