import { describe, expect, it } from 'vitest';
import { effectsSwitchValue, lowEndReason } from './auto-effects';

describe('Reduce visual effects → Auto', () => {
  it('keeps the full look on a capable PC', () => {
    expect(lowEndReason({ android: false, cores: 16, memoryGb: 8, fps: 144 })).toBeNull();
    expect(lowEndReason({ android: false, cores: 8 })).toBeNull();
  });

  it('turns the effects down on Android TV, few cores, little memory or a low frame rate, saying which', () => {
    expect(lowEndReason({ android: true, cores: 16 })).toEqual({ kind: 'tv' });
    expect(lowEndReason({ android: false, cores: 4, memoryGb: 2 })).toEqual({ kind: 'cores', count: 4 });
    expect(lowEndReason({ android: false, cores: 8, memoryGb: 4 })).toEqual({ kind: 'memory', gigabytes: 4 });
    expect(lowEndReason({ android: false, cores: 8, memoryGb: 8, fps: 24.4 })).toEqual({ kind: 'frames', fps: 24 });
  });

  it('ignores signals the WebView doesn’t give', () => {
    expect(lowEndReason({ android: false, cores: 0, memoryGb: undefined, fps: undefined })).toBeNull();
    expect(lowEndReason({ android: false, cores: 12, fps: 30 })).toBeNull();
  });

  it('goes back to Auto, not Off, when the Quick settings switch is turned off on a capable device', () => {
    expect(effectsSwitchValue(true, false)).toBe('reduced');
    expect(effectsSwitchValue(false, false)).toBe('auto');
    // Auto would turn them down here: only Off keeps the full look.
    expect(effectsSwitchValue(false, true)).toBe('full');
  });
});
