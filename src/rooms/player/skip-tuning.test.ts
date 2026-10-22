import { describe, expect, it } from 'vitest';
import { merge, normalize, type LooseSegment } from './skip';
import { aniSkipFits, aniSkipSegments, buttonDue, landing, parseAniSkip, parseSegmentColors, parseSkipButtonDelay, parseSkipLanding, parseSmoothSkip } from './skip-tuning';

describe('skip settings', () => {
  it('keeps AniSkip off and the smooth skip on unless chosen otherwise', () => {
    expect(parseAniSkip(undefined)).toBe(false);
    expect(parseAniSkip('true')).toBe(false);
    expect(parseAniSkip(true)).toBe(true);
    expect(parseSmoothSkip(undefined)).toBe(true);
    expect(parseSmoothSkip(false)).toBe(false);
  });

  it('keeps only the offered waits and landings', () => {
    expect(parseSkipButtonDelay(5)).toBe(5);
    expect(parseSkipButtonDelay(3)).toBe(0);
    expect(parseSkipLanding(4)).toBe(4);
    expect(parseSkipLanding(9)).toBe(0);
    expect(parseSkipLanding('2')).toBe(0);
  });

  it('keeps known colours per kind, and the default for anything else', () => {
    expect(parseSegmentColors({ intro: 'mint', recap: 'nope', credits: 'toString', extra: 'rose' })).toEqual({ intro: 'mint', recap: 'default', credits: 'default', preview: 'default' });
    expect(parseSegmentColors(['mint'])).toEqual({ intro: 'default', recap: 'default', credits: 'default', preview: 'default' });
  });
});

describe('landing', () => {
  const intro = { kind: 'intro' as const, start: 60, end: 150 };

  it('lands the chosen seconds before the end, never before the start', () => {
    expect(landing(intro, 1500, 0)).toBe(150);
    expect(landing(intro, 1500, 3)).toBe(147);
    expect(landing({ kind: 'recap', start: 0, end: 2 }, 1500, 5)).toBe(0);
  });

  it('still goes to the very end of credits that run to the end', () => {
    expect(landing({ kind: 'credits', start: 1400, end: 1500 }, 1500, 3)).toBe(1500);
    expect(landing({ kind: 'credits', start: 1300, end: 1400 }, 1500, 3)).toBe(1397);
  });
});

describe('the Skip button wait', () => {
  it('waits the chosen playback seconds after the segment is reached', () => {
    expect(buttonDue(60, 60, 0)).toBe(true);
    expect(buttonDue(60, 61.9, 2)).toBe(false);
    expect(buttonDue(60, 62, 2)).toBe(true);
  });
});

describe('AniSkip times', () => {
  const op: LooseSegment = { kind: 'intro', start: 90, end: 180, length: 1420 };

  it('are dropped when taken from a cut of another length', () => {
    expect(aniSkipFits([op], 1430)).toEqual([op]);
    expect(aniSkipFits([op], 1500)).toEqual([]);
    expect(aniSkipFits([{ ...op, length: null }], 1500)).toHaveLength(1);
  });

  it('only fill what the chapters and TheIntroDB left open', () => {
    const duration = 1420;
    const theIntroDb = normalize([{ kind: 'intro', start: 85, end: 175 }], duration);
    const ed: LooseSegment = { kind: 'credits', start: 1300, end: 1390, length: 1421 };
    const merged = merge(theIntroDb, aniSkipSegments([op, ed], duration));
    expect(merged).toEqual([
      { kind: 'intro', start: 85, end: 175 },
      { kind: 'credits', start: 1300, end: 1390 },
    ]);
  });
});
