import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusedKeys, heldKeys, installGamepad, padEvents, REPEAT_DELAY_MS, REPEAT_MS, UNFOCUSED_POLL_MS, type Key } from './gamepad';

const pad = (pressed: number[], axes: number[] = [0, 0, 0, 0]) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

describe('heldKeys', () => {
  it('maps the D-pad, A, B and Y to arrows, Enter, Escape and the Menu key', () => {
    expect([...heldKeys(pad([12]))]).toEqual(['ArrowUp']);
    expect([...heldKeys(pad([15]))]).toEqual(['ArrowRight']);
    expect([...heldKeys(pad([0]))]).toEqual(['Enter']);
    expect([...heldKeys(pad([1]))]).toEqual(['Escape']);
    expect([...heldKeys(pad([3]))]).toEqual(['ContextMenu']);
  });

  it('ignores stick drift and other buttons', () => {
    expect(heldKeys(pad([2, 9], [0.3, -0.4, 0, 0])).size).toBe(0);
  });

  it('reads the left stick along its stronger axis', () => {
    expect([...heldKeys(pad([], [-0.9, 0.2]))]).toEqual(['ArrowLeft']);
    expect([...heldKeys(pad([], [0.6, 0.8]))]).toEqual(['ArrowDown']);
    expect([...heldKeys(pad([], [0.1, -0.7]))]).toEqual(['ArrowUp']);
  });
});

describe('padEvents', () => {
  it('presses once, repeats a held direction after a pause, and lets go', () => {
    const before = new Map();
    const down = new Set(['ArrowDown'] as const);
    expect(padEvents(before, down, 0)).toEqual([{ type: 'keydown', key: 'ArrowDown', repeat: false }]);
    expect(padEvents(before, down, REPEAT_DELAY_MS - 1)).toEqual([]);
    expect(padEvents(before, down, REPEAT_DELAY_MS)).toEqual([{ type: 'keydown', key: 'ArrowDown', repeat: true }]);
    expect(padEvents(before, down, REPEAT_DELAY_MS + REPEAT_MS - 1)).toEqual([]);
    expect(padEvents(before, down, REPEAT_DELAY_MS + REPEAT_MS)).toEqual([{ type: 'keydown', key: 'ArrowDown', repeat: true }]);
    expect(padEvents(before, new Set(), 2000)).toEqual([{ type: 'keyup', key: 'ArrowDown', repeat: false }]);
  });

  it('never repeats A, B or Y', () => {
    const before = new Map();
    const a = new Set(['Enter'] as const);
    padEvents(before, a, 0);
    expect(padEvents(before, a, 5000)).toEqual([]);
    const menu = new Map();
    const y = new Set(['ContextMenu'] as const);
    expect(padEvents(menu, y, 0)).toEqual([{ type: 'keydown', key: 'ContextMenu', repeat: false }]);
    expect(padEvents(menu, y, 5000)).toEqual([]);
  });
});

describe('focusedKeys', () => {
  it('acts on nothing while another app has focus, and ignores those presses until let go', () => {
    const ignored = new Set<Key>();
    expect(focusedKeys(new Set<Key>(['Enter', 'ArrowUp']), ignored, false).size).toBe(0);
    // Back in Orbit with A still held: not a press here.
    expect([...focusedKeys(new Set<Key>(['Enter', 'ArrowUp']), ignored, true)]).toEqual([]);
    expect([...focusedKeys(new Set<Key>(['Enter']), ignored, true)]).toEqual([]);
    // Let go, then pressed again while focused: that one counts.
    expect([...focusedKeys(new Set<Key>(), ignored, true)]).toEqual([]);
    expect([...focusedKeys(new Set<Key>(['Enter', 'ArrowUp']), ignored, true)]).toEqual(['Enter', 'ArrowUp']);
  });

  it('passes everything through while focused', () => {
    expect([...focusedKeys(new Set<Key>(['ArrowLeft']), new Set(), true)]).toEqual(['ArrowLeft']);
  });
});

describe('installGamepad', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reads a connected pad every frame only while the window has focus, and a few times a second otherwise', () => {
    vi.useFakeTimers();
    let focused = true;
    let reads = 0;
    const frames: FrameRequestCallback[] = [];
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('navigator', { getGamepads: () => (reads++, [pad([])]) });
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
    vi.stubGlobal('document', { hasFocus: () => focused, visibilityState: 'visible', addEventListener: () => {} });
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));

    installGamepad();
    frames.shift()!(0);
    expect(frames).toHaveLength(1);
    // Another app has focus: no more frames, only a slow check.
    focused = false;
    frames.shift()!(16);
    expect(frames).toHaveLength(0);
    const before = reads;
    vi.advanceTimersByTime(UNFOCUSED_POLL_MS * 4);
    expect(frames).toHaveLength(0);
    expect(reads - before).toBe(4);
    // Back: every frame again, and the slow check stops.
    focused = true;
    listeners.get('focus')!();
    expect(frames).toHaveLength(1);
    vi.advanceTimersByTime(UNFOCUSED_POLL_MS * 4);
    expect(reads - before).toBe(5);
  });
});
