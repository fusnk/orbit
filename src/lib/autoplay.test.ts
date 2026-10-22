import { describe, expect, it, vi } from 'vitest';
import { autoCandidates, autoplayGate, collectDeadline, collectForAutoplay, isTopQuality, NO_AUTOPLAY_LIMITS, parseAutoplayLimits, withinLimits, type AutoplayGate, type CollectState } from './autoplay';
import type { SourceTraits } from './ranking-fallback';

const src = (traits: SourceTraits, largestGB?: number) => ({ traits, largestGB });

describe('parseAutoplayLimits', () => {
  it('defaults to no limits, field by field', () => {
    expect(parseAutoplayLimits(null)).toEqual(NO_AUTOPLAY_LIMITS);
    expect(parseAutoplayLimits({ minQuality: '1080p', maxQuality: '8K', maxSizeGB: 999 })).toEqual({ minQuality: '1080p', maxQuality: null, maxSizeGB: 0 });
    expect(parseAutoplayLimits({ maxQuality: '2160p', maxSizeGB: 12 })).toEqual({ minQuality: null, maxQuality: '2160p', maxSizeGB: 12 });
    expect(parseAutoplayLimits({ maxSizeGB: 2.5 }).maxSizeGB).toBe(0);
  });
});

describe('withinLimits', () => {
  it('lets everything through by default', () => {
    expect(withinLimits(src({}), NO_AUTOPLAY_LIMITS)).toBe(true);
    expect(withinLimits(src({ resolution: '2160p', sizeGB: 80 }), NO_AUTOPLAY_LIMITS)).toBe(true);
  });

  it('keeps to the lowest and highest quality; an unknown quality never meets a minimum', () => {
    const limits = { ...NO_AUTOPLAY_LIMITS, minQuality: '1080p' as const, maxQuality: '1080p' as const };
    expect(withinLimits(src({ resolution: '1080p' }), limits)).toBe(true);
    expect(withinLimits(src({ resolution: '720p' }), limits)).toBe(false);
    expect(withinLimits(src({ resolution: '2160p' }), limits)).toBe(false);
    expect(withinLimits(src({}), limits)).toBe(false);
    expect(withinLimits(src({}), { ...limits, minQuality: null })).toBe(true);
  });

  it('caps the size by the larger of the hinted and shown sizes; no size passes', () => {
    const limits = { ...NO_AUTOPLAY_LIMITS, maxSizeGB: 10 };
    expect(withinLimits(src({ sizeGB: 9.96 }, 10.04), limits)).toBe(false);
    expect(withinLimits(src({ sizeGB: 9.5 }, 9.5), limits)).toBe(true);
    expect(withinLimits(src({ sizeGB: 12 }), limits)).toBe(false);
    expect(withinLimits(src({}), limits)).toBe(true);
  });
});

describe('autoplayGate', () => {
  it('never lets an uncached source through, whatever the limits', () => {
    expect(autoplayGate(src({ uncached: true, resolution: '1080p' }), NO_AUTOPLAY_LIMITS)).toBe('uncached');
    expect(autoplayGate(src({ resolution: '720p' }), { ...NO_AUTOPLAY_LIMITS, minQuality: '1080p' })).toBe('outside-limits');
    expect(autoplayGate(src({ cached: true }), NO_AUTOPLAY_LIMITS)).toBeUndefined();
  });
});

describe('autoCandidates', () => {
  const s = (id: string, autoplay?: AutoplayGate) => ({ id, autoplay });

  it('keeps the ranked order of the sources that fit', () => {
    expect(autoCandidates([s('a', 'outside-limits'), s('b'), s('c', 'uncached'), s('d')])).toEqual({ list: [s('b'), s('d')], fellBack: false });
  });

  it('falls back to the best that may autoplay at all, saying so', () => {
    expect(autoCandidates([s('a', 'uncached'), s('b', 'outside-limits')])).toEqual({ list: [s('b', 'outside-limits')], fellBack: true });
  });

  it('has nothing when every source is uncached', () => {
    expect(autoCandidates([s('a', 'uncached')])).toEqual({ list: [], fellBack: false });
  });
});

describe('collect window', () => {
  it('ends after the window, or soon after a top-quality source', () => {
    expect(collectDeadline(1000, undefined)).toBe(3000);
    expect(collectDeadline(1000, 1200)).toBe(1650);
    expect(collectDeadline(1000, 2900)).toBe(3000);
  });

  it('treats 4K, or the highest-quality limit, as top quality', () => {
    expect(isTopQuality({ resolution: '2160p' }, NO_AUTOPLAY_LIMITS)).toBe(true);
    expect(isTopQuality({ resolution: '1080p' }, NO_AUTOPLAY_LIMITS)).toBe(false);
    expect(isTopQuality({ resolution: '1080p' }, { ...NO_AUTOPLAY_LIMITS, maxQuality: '1080p' })).toBe(true);
  });

  /** Events arriving at `times` (ms from the start), each saying what's in so far. */
  function feed(events: { at: number; state: CollectState }[]) {
    const start = Date.now();
    let i = 0;
    const iterator: AsyncIterator<CollectState> = {
      next: async () => {
        const event = events[i++];
        if (!event) return { done: true, value: undefined };
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, start + event.at - Date.now())));
        return { done: false, value: event.state };
      },
    };
    return iterator;
  }

  // Fake time, so a busy machine can't make a 40 ms answer arrive after a 120 ms window.
  const run = async (events: { at: number; state: CollectState }[], options = { windowMs: 120, graceMs: 30 }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const seen: number[] = [];
      let stopped = false;
      const start = Date.now();
      const done = collectForAutoplay(feed(events), (state) => (seen.push(Date.now() - start), state), () => (stopped = true), options);
      await vi.runAllTimersAsync();
      await done;
      return { seen: seen.length, stopped };
    } finally {
      vi.useRealTimers();
    }
  };

  it('reads every answer that comes within the window', async () => {
    expect(await run([{ at: 10, state: { candidate: true, top: false } }, { at: 40, state: { candidate: true, top: false } }])).toEqual({ seen: 2, stopped: false });
  });

  it('stops at the window with something to play, not waiting for slow addons', async () => {
    expect(await run([{ at: 10, state: { candidate: true, top: false } }, { at: 400, state: { candidate: true, top: true } }])).toEqual({ seen: 1, stopped: true });
  });

  it('waits only briefly once a top-quality source is in', async () => {
    expect(await run([{ at: 5, state: { candidate: true, top: true } }, { at: 90, state: { candidate: true, top: false } }])).toEqual({ seen: 1, stopped: true });
  });

  it('keeps waiting past the window while nothing can be played', async () => {
    expect(await run([{ at: 10, state: { candidate: false, top: false } }, { at: 200, state: { candidate: true, top: false } }])).toEqual({ seen: 2, stopped: true });
  });
});
