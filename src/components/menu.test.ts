import { describe, expect, it } from 'vitest';
import { placeMenu } from './menu';

const view = { width: 1280, height: 800 };
const size = { width: 220, height: 160 };
const button = (left: number, top: number) => ({ left, right: left + 40, top, bottom: top + 40 });

describe('placeMenu', () => {
  it('opens below the anchor, from its start edge', () => {
    expect(placeMenu(button(100, 100), 8, size, view, false)).toEqual({ left: 100, top: 148 });
  });

  it('lines up with the right edge in a right-to-left layout', () => {
    expect(placeMenu(button(600, 100), 8, size, view, true)).toEqual({ left: 640 - 220, top: 148 });
  });

  it('lines up with the end edge for a value at the end of a row', () => {
    expect(placeMenu(button(600, 100), 8, size, view, false, 'end')).toEqual({ left: 640 - 220, top: 148 });
    expect(placeMenu(button(600, 100), 8, size, view, true, 'end')).toEqual({ left: 600, top: 148 });
  });

  it('flips above an anchor near the bottom of the window', () => {
    // Clamping alone would cover the ⋯ button that opened it.
    expect(placeMenu(button(100, 740), 8, size, view, false)).toEqual({ left: 100, top: 740 - 8 - 160 });
  });

  it('stays inside the window near the right edge', () => {
    expect(placeMenu(button(1250, 100), 8, size, view, false).left).toBe(1280 - 220 - 8);
    expect(placeMenu(button(10, 100), 8, size, view, true).left).toBe(8);
  });

  it('keeps a menu taller than the room above and below on screen', () => {
    const tall = { width: 220, height: 700 };
    expect(placeMenu(button(100, 380), 8, tall, view, false).top).toBe(800 - 700 - 8);
  });

  it('opens a context menu at the pointer, and above it near the bottom', () => {
    const point = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
    expect(placeMenu(point(300, 200), 0, size, view, false)).toEqual({ left: 300, top: 200 });
    expect(placeMenu(point(300, 200), 0, size, view, true)).toEqual({ left: 80, top: 200 });
    expect(placeMenu(point(300, 780), 0, size, view, false)).toEqual({ left: 300, top: 620 });
  });
});
