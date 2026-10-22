import { describe, expect, it } from 'vitest';
import { leavesFullscreen, topDragsWindow } from './fullscreen';

describe('closing the player in full screen', () => {
  it('leaves a full screen the player went into, unless Settings → Playback keeps it', () => {
    expect(leavesFullscreen({ now: true, before: false, keep: false })).toBe(true);
    expect(leavesFullscreen({ now: true, before: false, keep: true })).toBe(false);
  });

  it('keeps a window that was already in full screen when the player opened (Open as full screen)', () => {
    expect(leavesFullscreen({ now: true, before: true, keep: false })).toBe(false);
  });

  it('has nothing to leave in a window', () => {
    expect(leavesFullscreen({ now: false, before: true, keep: false })).toBe(false);
    expect(leavesFullscreen({ now: false, before: false, keep: false })).toBe(false);
  });
});

describe('the top bar as a drag region', () => {
  it('moves a window that is neither in full screen nor maximized', () => {
    expect(topDragsWindow({ fullscreen: false, maximized: false })).toBe(true);
  });

  it('is off while maximized, so a slightly moved click near Back does not restore the window', () => {
    expect(topDragsWindow({ fullscreen: false, maximized: true })).toBe(false);
  });

  it('is off in full screen', () => {
    expect(topDragsWindow({ fullscreen: true, maximized: false })).toBe(false);
    expect(topDragsWindow({ fullscreen: true, maximized: true })).toBe(false);
  });
});
