import { describe, expect, it } from 'vitest';
import { parseWindowMode, WINDOW_MODES } from './window-mode';

describe('window mode at launch', () => {
  it('opens maximized unless another mode was picked', () => {
    expect(parseWindowMode(undefined)).toBe('maximized');
    expect(parseWindowMode(null)).toBe('maximized');
    for (const mode of WINDOW_MODES) expect(parseWindowMode(mode)).toBe(mode);
  });

  it('treats anything else as unset, like the Rust shell does', () => {
    for (const odd of ['Fullscreen', 'full screen', '', true, 1, {}, ['normal']]) expect(parseWindowMode(odd)).toBe('maximized');
  });
});
