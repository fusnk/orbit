import { describe, expect, it, vi } from 'vitest';
import { SAFE_MODE_HOLD_MS, shiftHoldWatcher } from './safe-mode-key';

const down = (key: string, timeStamp: number) => ({ type: 'keydown', key, timeStamp });
const up = (key: string, timeStamp: number) => ({ type: 'keyup', key, timeStamp });

function watch(...events: ReturnType<typeof down>[]) {
  const held = vi.fn();
  const handle = shiftHoldWatcher(held);
  for (const event of events) handle(event);
  return held;
}

describe('safe mode key (Shift held alone)', () => {
  it('fires on a repeated Shift keydown a second after the first (Windows)', () => {
    expect(watch(down('Shift', 100), down('Shift', 600), down('Shift', 100 + SAFE_MODE_HOLD_MS))).toHaveBeenCalledOnce();
  });

  it('fires on the Shift keyup a second after the keydown (macOS and Linux)', () => {
    expect(watch(down('Shift', 100), up('Shift', 1200))).toHaveBeenCalledOnce();
  });

  it('fires once only', () => {
    expect(watch(down('Shift', 0), down('Shift', 1000), down('Shift', 1100), up('Shift', 1200), down('Shift', 2000), up('Shift', 3500))).toHaveBeenCalledOnce();
  });

  it('ignores a short press', () => {
    expect(watch(down('Shift', 0), down('Shift', 500), up('Shift', 900))).not.toHaveBeenCalled();
  });

  it('ignores Shift+Tab and capital letters, even held long', () => {
    expect(watch(down('Shift', 0), down('Tab', 200), down('Shift', 1500), up('Shift', 1600))).not.toHaveBeenCalled();
    expect(watch(down('Shift', 0), down('A', 300), up('Shift', 2000))).not.toHaveBeenCalled();
  });

  it('counts a fresh hold after an earlier spoiled one, and keys typed without Shift', () => {
    expect(watch(down('a', 0), down('Shift', 100), down('Tab', 200), up('Shift', 300), down('Shift', 400), up('Shift', 1500))).toHaveBeenCalledOnce();
  });
});
