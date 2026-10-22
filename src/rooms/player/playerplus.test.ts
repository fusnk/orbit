import { describe, expect, it, vi } from 'vitest';
import { createHoldSpeed, HOLD_MS } from './hold-speed';
import { escCount } from './unlock';
import { gather, GATHER_MS } from './seek-bubble';
import { parseSkipModes, runsToEnd } from './skip';
import { parseSoundMode } from './sound';
import { fadeFor, searchList, sourcesFrom } from './search-list';
import { finishTime, nextTimeMode, parseTimeMode, timeReadout } from './time-readout';

describe('time readout', () => {
  it('cycles time left, elapsed, finish time, and back', () => {
    expect([nextTimeMode('remaining'), nextTimeMode('elapsed'), nextTimeMode('finish')]).toEqual(['elapsed', 'finish', 'remaining']);
    expect(parseTimeMode('finish')).toBe('finish');
    expect(parseTimeMode('junk')).toBe('remaining');
  });

  it('finishes later at slower speeds and sooner at faster ones', () => {
    const now = Date.UTC(2026, 9, 5, 21, 0);
    expect(finishTime(now, 600, 1200, 1)).toBe(now + 600_000);
    expect(finishTime(now, 600, 1200, 2)).toBe(now + 300_000);
    expect(finishTime(now, 600, 1200, 0.5)).toBe(now + 1_200_000);
    // A missing or broken speed counts as normal.
    expect(finishTime(now, 600, 1200, 0)).toBe(now + 600_000);
    expect(finishTime(now, 1300, 1200, 1)).toBe(now);
  });

  it('writes each mode, with the clock in the locale’s format', () => {
    const now = new Date(2026, 9, 5, 22, 0).getTime();
    expect(timeReadout('remaining', 60, 3600, 1, now, 'en-US')).toBe('-59:00');
    expect(timeReadout('elapsed', 60, 3600, 1, now, 'en-US')).toBe('1:00 / 1:00:00');
    expect(timeReadout('finish', 1800, 3600, 1, now, 'en-US')).toBe('-30:00 left · Finish at 10:30 PM');
    expect(timeReadout('finish', 1800, 3600, 1, now, 'de-DE')).toContain('22:30');
    // A live channel has no length: just where it is.
    expect(timeReadout('finish', 75, 0, 1, now, 'en-US')).toBe('1:15');
  });

  it('writes the finish time as the Clock setting says, like the player’s clock', async () => {
    const { setClock } = await import('../../lib/clock');
    const now = new Date(2026, 9, 5, 22, 0).getTime();
    // Saving the setting needs Tauri; the choice is in use before it's saved.
    await setClock('24').catch(() => {});
    try {
      expect(timeReadout('finish', 1800, 3600, 1, now, 'en-US')).toContain('22:30');
    } finally {
      await setClock('system').catch(() => {});
    }
  });
});

describe('hold for 2×', () => {
  const setup = (state: { paused?: boolean; enabled?: boolean; speed?: number } = {}) => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const hold = createHoldSpeed({
      enabled: () => state.enabled ?? true,
      actNow: () => state.paused ?? false,
      togglePause: () => calls.push('toggle'),
      speed: () => state.speed ?? 1,
      setSpeed: (s) => calls.push(`speed ${s}`),
      boosting: (on) => calls.push(on ? 'pill on' : 'pill off'),
    });
    return { hold, calls };
  };

  it('a tap pauses when it’s let go', () => {
    const { hold, calls } = setup();
    hold.press(' ');
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(HOLD_MS - 50);
    hold.release(' ');
    expect(calls).toEqual(['toggle']);
    vi.useRealTimers();
  });

  it('held, it plays at 2× and goes back to the speed it had', () => {
    const { hold, calls } = setup({ speed: 1.25 });
    hold.press('k');
    vi.advanceTimersByTime(HOLD_MS);
    hold.release('K');
    expect(calls).toEqual(['speed 2', 'pill on', 'speed 1.25', 'pill off']);
    vi.useRealTimers();
  });

  it('paused (or turned off), the key acts at once', () => {
    const paused = setup({ paused: true });
    paused.hold.press(' ');
    expect(paused.calls).toEqual(['toggle']);
    const off = setup({ enabled: false });
    off.hold.press(' ');
    expect(off.calls).toEqual(['toggle']);
    vi.useRealTimers();
  });

  it('held on the picture, the mouse speeds up; a short click is left to the click', () => {
    const { hold, calls } = setup();
    hold.press('pointer', false);
    hold.release('pointer');
    expect(calls).toEqual([]);
    hold.press('pointer', false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(hold.boosted()).toBe(true);
    hold.release('pointer');
    expect(calls).toEqual(['speed 2', 'pill on', 'speed 1', 'pill off']);
    const paused = setup({ paused: true });
    paused.hold.press('pointer', false);
    expect(paused.calls).toEqual([]);
    vi.useRealTimers();
  });

  it('leaving the picture ends only the mouse’s hold', () => {
    const { hold, calls } = setup();
    hold.press(' ');
    hold.cancel('pointer');
    vi.advanceTimersByTime(HOLD_MS);
    expect(calls).toEqual(['speed 2', 'pill on']);
    hold.cancel(' ');
    expect(calls).toEqual(['speed 2', 'pill on', 'speed 1', 'pill off']);
    vi.useRealTimers();
  });

  it('losing focus mid-hold undoes the speed without pausing', () => {
    const { hold, calls } = setup();
    hold.press(' ');
    vi.advanceTimersByTime(HOLD_MS);
    hold.cancel();
    hold.release(' ');
    expect(calls).toEqual(['speed 2', 'pill on', 'speed 1', 'pill off']);
    vi.useRealTimers();
  });
});

describe('jump bubble', () => {
  it('adds up presses in a row, the same way', () => {
    expect(gather(null, 10, 0)).toBe(10);
    expect(gather({ total: 10, at: 0 }, 10, 300)).toBe(20);
    expect(gather({ total: 20, at: 300 }, 10, 600)).toBe(30);
  });

  it('starts again after a pause or the other way', () => {
    expect(gather({ total: 30, at: 0 }, 10, GATHER_MS + 1)).toBe(10);
    expect(gather({ total: 30, at: 0 }, -10, 100)).toBe(-10);
  });
});

describe('skip modes', () => {
  it('defaults to a button for each kind', () => {
    expect(parseSkipModes(undefined, undefined)).toEqual({ intro: 'button', recap: 'button', credits: 'button', preview: 'button' });
  });

  it('carries over the old "skip intros and recaps" switch until the new setting is saved', () => {
    expect(parseSkipModes(undefined, true)).toEqual({ intro: 'auto', recap: 'auto', credits: 'button', preview: 'button' });
    expect(parseSkipModes({ intro: 'off', recap: 'button', credits: 'auto', preview: 'off' }, true)).toEqual({ intro: 'off', recap: 'button', credits: 'auto', preview: 'off' });
  });

  it('ignores junk, kind by kind', () => {
    expect(parseSkipModes({ intro: 'sometimes', credits: 'auto' }, false)).toEqual({ intro: 'button', recap: 'button', credits: 'auto', preview: 'button' });
    expect(parseSkipModes(['auto'], false).intro).toBe('button');
  });

  it('knows credits that run to the end', () => {
    expect(runsToEnd({ kind: 'credits', start: 2500, end: 2699 }, 2700)).toBe(true);
    expect(runsToEnd({ kind: 'credits', start: 2500, end: 2600 }, 2700)).toBe(false);
    expect(runsToEnd({ kind: 'intro', start: 0, end: 2700 }, 2700)).toBe(false);
  });
});

describe('sound mode', () => {
  it('reads the saved mode, or night mode’s old switch', () => {
    expect(parseSoundMode('dialogue', true)).toBe('dialogue');
    expect(parseSoundMode(undefined, true)).toBe('night');
    expect(parseSoundMode(undefined, undefined)).toBe('off');
    expect(parseSoundMode('lavfi=[volume=9]', false)).toBe('off');
  });
});

describe('source search list', () => {
  const addons = [
    { key: 'a', name: 'Alpha' },
    { key: 'b', name: 'Beta' },
    { key: 'c', name: 'Gamma' },
  ];

  it('puts answered addons first, in the order they answered, and centres the first still asking', () => {
    const answered = new Map([['c', { key: 'c', name: 'Gamma', state: 'found' as const, count: 4 }]]);
    const { rows, active } = searchList(addons, answered);
    expect(rows.map((r) => `${r.key}:${r.state}`)).toEqual(['c:found', 'a:asking', 'b:asking']);
    expect(active).toBe(1);
  });

  it('centres the last row once everyone has answered', () => {
    const answered = new Map(addons.map((a) => [a.key, { ...a, state: 'empty' as const }]));
    expect(searchList(addons, answered).active).toBe(2);
    expect(searchList([], new Map()).active).toBe(0);
  });

  it('counts what one addon brought, from the merged list', () => {
    const origin = { key: 'b', name: 'Beta' };
    const item = (keys: string[]) => ({ item: { url: 'x' }, origins: keys.map((key) => ({ key, name: key })) });
    expect(sourcesFrom({ type: 'partial', origin, items: [item(['a']), item(['a', 'b']), item(['b'])] } as never)).toBe(2);
  });

  it('fades rows with their distance from the centre', () => {
    expect(fadeFor(0)).toBe(1);
    expect(fadeFor(-1)).toBeCloseTo(0.7);
    expect(fadeFor(9)).toBe(0.12);
  });
});

describe('lock', () => {
  it('counts only the Esc presses close together', () => {
    expect(escCount([0, 500, 1000], 1200)).toBe(3);
    expect(escCount([0, 500, 1000], 1600)).toBe(2);
  });
});
