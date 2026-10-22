import { describe, expect, it } from 'vitest';
import { createRotation, FUN_DEFAULTS, parseFun, rouletteReel, seasonOn } from './fun';

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
    expect(on(11, 1)).toBeNull();
  });

  it('is winter from 15 to 31 December', () => {
    expect(on(12, 14)).toBeNull();
    expect(on(12, 15)).toBe('winter');
    expect(on(12, 31)).toBe('winter');
    expect(on(1, 1)).toBeNull();
  });

  it('is nothing the rest of the year', () => {
    expect(on(3, 20)).toBeNull();
    expect(on(7, 4)).toBeNull();
  });

  it('follows the local date, not UTC', () => {
    expect(seasonOn(new Date(2026, 9, 15, 0, 5))).toBe('halloween');
    expect(seasonOn(new Date(2026, 9, 31, 23, 55))).toBe('halloween');
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
