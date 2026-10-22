import { describe, expect, it } from 'vitest';
import { edgeShift } from './seek-hover';

describe('seek hover box', () => {
  it('stays centred away from the edges', () => {
    expect(edgeShift(500, 200, 1000)).toBe(0);
  });

  it('moves in from either edge, keeping the margin', () => {
    expect(edgeShift(20, 200, 1000)).toBe(96);
    expect(edgeShift(990, 200, 1000)).toBe(-106);
  });

  it('keeps its start inside when the window is too narrow for it', () => {
    expect(edgeShift(100, 300, 320)).toBe(66);
  });
});
