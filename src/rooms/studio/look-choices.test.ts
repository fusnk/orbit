import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/locales/en';
import { APPEARANCE_DEFAULTS, parseAppearance } from '../../theme/appearance';
import { LOOK_APPEARANCE } from '../../theme/engine';
import { CORNERS, DETAIL_BACKGROUND, FONTS, GLOW, HERO_STYLE, POSTER_SIZE, TINT } from './look-choices';

const CHOICES = [GLOW, CORNERS, POSTER_SIZE, HERO_STYLE, DETAIL_BACKGROUND];

describe('look choices (one definition for Theme Studio and Settings)', () => {
  it('covers every appearance field Theme Studio edits', () => {
    expect([...CHOICES.map((c) => c.field), 'tint'].sort()).toEqual([...LOOK_APPEARANCE].sort());
  });

  it('offers only values a saved appearance keeps, including the default', () => {
    for (const choice of CHOICES) {
      const values = choice.options.map(([value]) => value);
      for (const value of values) expect(parseAppearance({ [choice.field]: value })[choice.field], `${choice.field}: ${value}`).toBe(value);
      expect(values, choice.field).toContain(APPEARANCE_DEFAULTS[choice.field]);
    }
  });

  it('names everything in English, with distinct Studio keys', () => {
    for (const choice of CHOICES) for (const key of [choice.label, choice.hint, ...choice.options.map(([, label]) => label)]) expect(en[key].trim(), key).not.toBe('');
    for (const key of [...Object.values(TINT), ...Object.values(FONTS)]) expect(en[key].trim(), key).not.toBe('');
    expect(new Set(CHOICES.map((c) => c.key)).size).toBe(CHOICES.length);
  });
});
