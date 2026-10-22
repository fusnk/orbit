import { describe, expect, it } from 'vitest';
import { skipIntrosOn, trailerState, withSkipIntros } from './quick-state';

const modes = { intro: 'button', recap: 'button', credits: 'button', preview: 'button' } as const;

describe('Quick settings: trailers', () => {
  it('is on only when trailers play on title pages and banners', () => {
    expect(trailerState(true, true)).toBe('on');
    expect(trailerState(false, false)).toBe('off');
    expect(trailerState(undefined, null)).toBe('off');
  });

  it('is mixed, not on, when only one plays', () => {
    expect(trailerState(true, false)).toBe('mixed');
    expect(trailerState(false, true)).toBe('mixed');
  });
});

describe('Quick settings: skip intros', () => {
  it('is on when intros are skipped without asking', () => {
    expect(skipIntrosOn(modes)).toBe(false);
    expect(skipIntrosOn({ ...modes, intro: 'auto' })).toBe(true);
    expect(skipIntrosOn({ ...modes, recap: 'auto' })).toBe(false);
  });

  it('turns on automatic skipping for intros and recaps only', () => {
    expect(withSkipIntros({ ...modes, credits: 'off' }, true)).toEqual({ intro: 'auto', recap: 'auto', credits: 'off', preview: 'button' });
  });

  it('turning off brings back the button where it was automatic and leaves Off alone', () => {
    expect(withSkipIntros({ ...modes, intro: 'auto', recap: 'off', credits: 'auto' }, false)).toEqual({ intro: 'button', recap: 'off', credits: 'auto', preview: 'button' });
  });

  it('round-trips through the switch', () => {
    const on = withSkipIntros(modes, true);
    expect(skipIntrosOn(on)).toBe(true);
    expect(skipIntrosOn(withSkipIntros(on, false))).toBe(false);
  });
});
