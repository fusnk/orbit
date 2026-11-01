import { describe, expect, it } from 'vitest';
import { createRotation, FUN_DEFAULTS, holidayOn, parseFun, rouletteReel, seasonOn } from './fun';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe('seasonOn', () => {
  const on = (month: number, day: number) => seasonOn(new Date(2026, month - 1, day, 12));

  it('is Halloween from 15 to 31 October', () => {
    expect(on(10, 14)).toBeNull();
    expect(on(10, 15)).toBe('halloween');
    expect(on(10, 31)).toBe('halloween');
  });

  // November had nothing at all: Halloween's bat went on the 31st and Thanksgiving was skipped.
  it('is Thanksgiving through November', () => {
    expect(on(11, 1)).toBe('thanksgiving');
    expect(on(11, 26)).toBe('thanksgiving');
    expect(on(11, 30)).toBe('thanksgiving');
  });

  it('is Christmas through December', () => {
    expect(on(12, 1)).toBe('christmas');
    expect(on(12, 25)).toBe('christmas');
    expect(on(12, 31)).toBe('christmas');
    expect(on(1, 1)).toBeNull();
  });

  it('is nothing the rest of the year', () => {
    expect(on(3, 20)).toBeNull();
    expect(on(7, 4)).toBeNull();
  });

  it('follows the local date, not UTC', () => {
    expect(seasonOn(new Date(2026, 9, 15, 0, 5))).toBe('halloween');
    expect(seasonOn(new Date(2026, 9, 31, 23, 55))).toBe('halloween');
    expect(seasonOn(new Date(2026, 10, 1, 0, 5))).toBe('thanksgiving');
  });
});

describe('holidayOn', () => {
  it('is Thanksgiving on the fourth Thursday of November only', () => {
    // 2026: 26 November; 2025: 27th; 2029 (1 November is a Thursday): 22nd; 2027 (a Monday): 25th.
    expect(holidayOn(new Date(2026, 10, 26, 9))).toBe('thanksgiving');
    expect(holidayOn(new Date(2026, 10, 25, 9))).toBeNull();
    expect(holidayOn(new Date(2026, 10, 19, 9))).toBeNull();
    expect(holidayOn(new Date(2025, 10, 27, 9))).toBe('thanksgiving');
    expect(holidayOn(new Date(2029, 10, 22, 9))).toBe('thanksgiving');
    expect(holidayOn(new Date(2027, 10, 25, 9))).toBe('thanksgiving');
  });

  it('is Christmas on the 24th and 25th of December', () => {
    expect(holidayOn(new Date(2026, 11, 23, 9))).toBeNull();
    expect(holidayOn(new Date(2026, 11, 24, 9))).toBe('christmas');
    expect(holidayOn(new Date(2026, 11, 25, 23, 50))).toBe('christmas');
    expect(holidayOn(new Date(2026, 11, 26, 9))).toBeNull();
  });
});

describe('parseFun', () => {
  it('turns everything on by default and on junk', () => {
    for (const junk of [null, undefined, 0, 'x', [], [false], { intro: 'no' }, { intro: 0 }]) expect(parseFun(junk)).toEqual(FUN_DEFAULTS);
  });

  it('keeps switches saved off', () => {
    expect(parseFun({ intro: false, quips: false, extra: true })).toEqual({ ...FUN_DEFAULTS, intro: false, quips: false });
  });
});

describe('createRotation', () => {
  it('shows every line once per round', () => {
    const next = createRotation(5, seeded(7));
    for (let round = 0; round < 4; round++) {
      const seen = Array.from({ length: 5 }, next);
      expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('never shows the same line twice in a row, across rounds too', () => {
    for (let seed = 1; seed < 40; seed++) {
      const next = createRotation(3, seeded(seed));
      let previous = next();
      for (let i = 0; i < 60; i++) {
        const current = next();
        expect(current).not.toBe(previous);
        previous = current;
      }
    }
  });

  it('copes with one line or none', () => {
    expect(createRotation(1)()).toBe(0);
    expect(createRotation(0)()).toBe(0);
  });
});

describe('rouletteReel', () => {
  it('ends on the pick and has the asked length', () => {
    const reel = rouletteReel('pick', ['a', 'b', 'c'], 12, seeded(3));
    expect(reel).toHaveLength(12);
    expect(reel.at(-1)).toBe('pick');
    expect(reel.slice(0, -1).every((x) => x !== 'pick')).toBe(true);
  });

  it('never puts the same title side by side', () => {
    for (let seed = 1; seed < 40; seed++) {
      const reel = rouletteReel('pick', ['a', 'b'], 15, seeded(seed));
      for (let i = 1; i < reel.length; i++) expect(reel[i]).not.toBe(reel[i - 1]);
    }
  });

  it('is just the pick when there is nothing else', () => {
    expect(rouletteReel('pick', [], 10)).toEqual(['pick']);
  });
});
