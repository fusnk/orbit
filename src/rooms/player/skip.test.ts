import { describe, expect, it } from 'vitest';
import { activeSegment, autoSkipLeft, chapterSegments, merge, normalize, parseAutoSkipDelay, tucked, undoOffered } from './skip';

describe('chapterSegments', () => {
  it('names intros, recaps and credits by chapter title, up to the next chapter', () => {
    const chapters = [
      { title: 'Previously on', time: 0 },
      { title: 'Opening Credits', time: 50 },
      { title: 'Chapter 2', time: 140 },
      { title: 'End Credits', time: 2500 },
      { title: 'Edward', time: 100 },
    ];
    expect(chapterSegments(chapters, 2700)).toEqual([
      { kind: 'recap', start: 0, end: 50 },
      { kind: 'intro', start: 50, end: 100 },
      { kind: 'credits', start: 2500, end: 2700 },
    ]);
  });
});

describe('normalize', () => {
  it('fills open ends from the duration', () => {
    expect(normalize([{ kind: 'intro', start: null, end: 38 }, { kind: 'credits', start: 2839, end: null }], 2900)).toEqual([
      { kind: 'intro', start: 0, end: 38 },
      { kind: 'credits', start: 2839, end: 2900 },
    ]);
  });

  it('drops tiny, overlong and early-credits segments', () => {
    expect(normalize([{ kind: 'intro', start: 10, end: 11 }, { kind: 'intro', start: 0, end: 600 }, { kind: 'credits', start: 100, end: 200 }], 2900)).toEqual([]);
    expect(normalize([{ kind: 'intro', start: 0, end: 30 }], 0)).toEqual([]);
  });
});

describe('merge', () => {
  it('keeps the preferred segment where two overlap', () => {
    const chapters = [{ kind: 'intro' as const, start: 50, end: 100 }];
    const online = [{ kind: 'intro' as const, start: 55, end: 98 }, { kind: 'credits' as const, start: 2500, end: 2700 }];
    expect(merge(chapters, online)).toEqual([chapters[0], online[1]]);
  });
});

describe('activeSegment', () => {
  it('is active from the start until just before the end', () => {
    const segments = [{ kind: 'intro' as const, start: 50, end: 100 }];
    expect(activeSegment(segments, 49)).toBeUndefined();
    expect(activeSegment(segments, 50)).toBe(segments[0]);
    expect(activeSegment(segments, 99.5)).toBeUndefined();
  });
});

describe('automatic skip delay', () => {
  it('keeps only the offered delays', () => {
    for (const delay of [0, 2, 3, 5]) expect(parseAutoSkipDelay(delay)).toBe(delay);
    for (const other of [1, 4, 10, -2, 2.5, '3', null, undefined]) expect(parseAutoSkipDelay(other)).toBe(0);
  });

  it('skips at once without a delay', () => {
    expect(autoSkipLeft(50, 50, 0)).toBe(0);
    expect(autoSkipLeft(50, 50.2, 0)).toBe(0);
  });

  it('counts whole seconds down in playback time, then skips', () => {
    // Reached the intro at 50 s with a 3 s wait.
    expect(autoSkipLeft(50, 50, 3)).toBe(3);
    expect(autoSkipLeft(50, 50.4, 3)).toBe(3);
    expect(autoSkipLeft(50, 51.1, 3)).toBe(2);
    expect(autoSkipLeft(50, 52.9, 3)).toBe(1);
    expect(autoSkipLeft(50, 53, 3)).toBe(0);
    expect(autoSkipLeft(50, 60, 5)).toBe(0);
  });

  it('never counts up when playback is behind where it started (a seek back)', () => {
    expect(autoSkipLeft(50, 40, 5)).toBe(5);
  });
});

describe('after a skip', () => {
  const undo = { key: 'intro@30', to: 30, landed: 90, until: 5000 };

  it('offers going back for a few seconds, near where it landed', () => {
    expect(undoOffered(undo, 91, 1000)).toBe(true);
    expect(undoOffered(undo, null, 1000)).toBe(true);
    expect(undoOffered(undo, 91, 5000)).toBe(false);
  });

  it('stops offering it after a seek elsewhere', () => {
    expect(undoOffered(undo, 40, 1000)).toBe(false);
    expect(undoOffered(undo, 300, 1000)).toBe(false);
  });

  it('steps a button back with the controls after ten seconds up', () => {
    expect(tucked(100, 109)).toBe(false);
    expect(tucked(100, 110)).toBe(true);
    expect(tucked(100, 85)).toBe(true);
  });
});
