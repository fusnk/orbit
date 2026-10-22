import { describe, expect, it, vi } from 'vitest';
import { createSubtitleLift, liftFor, MAX_LIFT } from './subtitle-lift';

describe('subtitle lift', () => {
  it('raises subtitles by the share of the window the controls cover, less mpv’s own margin', () => {
    expect(liftFor(0, 1000)).toBe(0);
    expect(liftFor(120, 1000)).toBe(10);
    expect(liftFor(900, 1000)).toBe(MAX_LIFT);
    expect(liftFor(10, 0)).toBe(0);
  });

  it('waits for the controls to settle, and sends only changes', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const lift = createSubtitleLift((n) => sent.push(n));
    lift.want(10);
    lift.want(0);
    lift.want(10);
    vi.advanceTimersByTime(200);
    lift.want(10);
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([10]);
    lift.reset();
    expect(sent).toEqual([10, 0]);
    lift.reset();
    expect(sent).toEqual([10, 0]);
    vi.useRealTimers();
  });
});