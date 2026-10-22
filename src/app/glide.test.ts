import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clamp, glide, scrollRange, settled, springStep, stopGlides, type Motion } from './glide';

describe('springStep', () => {
  const run = (from: Motion, target: number, seconds: number, dt = 1 / 60) => {
    const path: Motion[] = [];
    let m = from;
    for (let t = 0; t < seconds; t += dt) path.push((m = springStep(m, target, dt)));
    return path;
  };

  it('gets there in about a quarter of a second, without overshooting', () => {
    const path = run({ pos: 0, velocity: 0 }, 200, 0.4);
    expect(path.every((m) => m.pos <= 200 + 1e-9)).toBe(true);
    // Most of the way within 0.15 s (a remote's step reads as prompt), at rest by 0.4 s.
    expect(path[8]!.pos).toBeGreaterThan(150);
    expect(settled(path.at(-1)!, 200)).toBe(true);
  });

  it('only ever moves toward the target', () => {
    const path = run({ pos: 0, velocity: 0 }, 300, 0.5);
    for (let i = 1; i < path.length; i++) expect(path[i]!.pos).toBeGreaterThanOrEqual(path[i - 1]!.pos);
  });

  it('a long frame neither overshoots nor blows up', () => {
    const m = springStep({ pos: 0, velocity: 3000 }, 100, 0.5);
    expect(m.pos).toBeLessThanOrEqual(100.5);
    expect(Number.isFinite(m.velocity)).toBe(true);
  });

  it('keeps its speed when a held key moves the target on (one motion, not a restart from a standstill)', () => {
    let m: Motion = { pos: 0, velocity: 0 };
    for (let i = 0; i < 6; i++) m = springStep(m, 200, 1 / 60);
    const before = m.velocity;
    // The next row: the target moves on while the glide is still going.
    const next = springStep(m, 400, 1 / 60);
    expect(before).toBeGreaterThan(0);
    expect(next.velocity).toBeGreaterThan(before * 0.9);
  });
});

describe('scrollRange and clamp', () => {
  it('runs from 0 to what overflows, or down from 0 right to left', () => {
    expect(scrollRange({ scroll: 1000, client: 400 }, false)).toEqual([0, 600]);
    expect(scrollRange({ scroll: 1000, client: 400 }, true)).toEqual([-600, 0]);
    expect(scrollRange({ scroll: 300, client: 400 }, false)).toEqual([0, 0]);
  });

  it('keeps a target inside the range', () => {
    expect(clamp(-20, [0, 600])).toBe(0);
    expect(clamp(700, [0, 600])).toBe(600);
    expect(clamp(-700, [-600, 0])).toBe(-600);
  });
});

describe('glide', () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;
  const flush = (ms = 16) => {
    now += ms;
    const run = frames;
    frames = [];
    for (const f of run) f(now);
  };
  const scroller = (top = 0) => ({ scrollTop: top, scrollLeft: 0, scrollHeight: 5000, clientHeight: 500, scrollWidth: 0, clientWidth: 0, isConnected: true }) as unknown as HTMLElement;
  /** Aims `el` at the absolute position `at()`. */
  const toward = (el: HTMLElement, at: () => number) => () => at() - el.scrollTop;

  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('document', { addEventListener: () => {} });
  });
  afterEach(() => {
    stopGlides();
    vi.unstubAllGlobals();
  });

  it('glides to where it aims and stops there', () => {
    const el = scroller();
    glide(el, 'y', toward(el, () => 400), false);
    for (let i = 0; i < 40 && frames.length; i++) flush();
    expect(el.scrollTop).toBe(400);
    expect(frames).toHaveLength(0);
  });

  it('a new aim mid-glide carries on from where it is, never backing up', () => {
    const el = scroller();
    let target = 220;
    glide(el, 'y', toward(el, () => target), false);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      flush();
      seen.push(el.scrollTop);
    }
    target = 440;
    glide(el, 'y', toward(el, () => target), false);
    for (let i = 0; i < 40 && frames.length; i++) {
      flush();
      seen.push(el.scrollTop);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(el.scrollTop).toBe(440);
  });

  it('stays within what the page can scroll', () => {
    const el = scroller(4400);
    glide(el, 'y', toward(el, () => 9000), false);
    for (let i = 0; i < 40 && frames.length; i++) flush();
    expect(el.scrollTop).toBe(4500);
  });

  it('jumps at once with reduced motion', () => {
    const el = scroller();
    glide(el, 'y', toward(el, () => 300), true);
    expect(el.scrollTop).toBe(300);
    expect(frames).toHaveLength(0);
  });

  it('leaves a scroller already in place still', () => {
    const el = scroller(100);
    glide(el, 'y', toward(el, () => 102), false);
    expect(frames).toHaveLength(0);
    expect(el.scrollTop).toBe(100);
  });

  it('goes on from where the browser moved it (content drawn above) rather than pulling it back', () => {
    const el = scroller();
    let target = 300;
    glide(el, 'y', toward(el, () => target), false);
    flush();
    flush();
    // Scroll anchoring: a row above grew by 120 px, the browser shifted the page and the aim with it.
    el.scrollTop += 120;
    target += 120;
    const after = el.scrollTop;
    flush();
    expect(el.scrollTop).toBeGreaterThanOrEqual(after);
    for (let i = 0; i < 40 && frames.length; i++) flush();
    expect(el.scrollTop).toBe(420);
  });

  it('stops when what it follows is gone', () => {
    const el = scroller();
    let gone = false;
    glide(el, 'y', () => (gone ? null : 400 - el.scrollTop), false);
    flush();
    gone = true;
    const at = el.scrollTop;
    flush();
    expect(el.scrollTop).toBe(at);
    expect(frames).toHaveLength(0);
  });
});
