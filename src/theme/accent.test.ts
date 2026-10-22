import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { ACCENT_PRESETS, accentPalette, contrastRatio, effectiveAccent, mix, normalizeAccentChoice, parseAccentChoice, parseHex, THEME_ACCENT } from './accent';

describe('parseHex', () => {
  it.each([
    ['#E5484D', '#e5484d'],
    ['e5484d', '#e5484d'],
    [' #abc ', '#aabbcc'],
  ])('normalizes %s', (input, expected) => expect(parseHex(input)).toBe(expected));

  it.each(['', '#12345', '#ggg', 'red', 'url(x)', 42, null])('rejects %s', (input) => {
    expect(parseHex(input)).toBeNull();
  });
});

describe('accentPalette', () => {
  it('derives lighter and darker shades', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    const p = accentPalette('#e5484d');
    expect(p.hi > p.accent && p.lo < p.accent).toBe(true);
  });

  it('keeps white text and the accent itself where white already reads (4.5:1)', () => {
    for (const hex of ['#2f6fde', '#e3101e', '#7b5bf5', '#000000']) {
      expect(accentPalette(hex)).toMatchObject({ strong: hex, contrast: '#ffffff' });
    }
  });

  it("keeps white on Orbit's red by deepening the fill a touch", () => {
    const p = accentPalette('#e5484d');
    expect(p.contrast).toBe('#ffffff');
    expect(p.strong).toBe('#d93b43');
    expect(contrastRatio(p.strong, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // Only just: a hair lighter would fail, so the red changes no more than it must.
    expect(contrastRatio(mix(p.strong, '#ffffff', 0.02), '#ffffff')).toBeLessThan(4.5);
    // The decorative accent and its shades are untouched.
    expect(p.accent).toBe('#e5484d');
  });

  it('uses dark text on the accent itself when white would need a different colour', () => {
    for (const hex of ['#f5a524', '#3e9bff', '#46c28e', '#5b8cff', '#ffffff']) {
      expect(accentPalette(hex)).toMatchObject({ strong: hex, contrast: '#0b0a09' });
    }
  });

  it('never gives text that reads worse than the other choice would on the accent', () => {
    for (const hex of ['#7b5bf5', '#3e9bff', '#808080', '#767676', '#00ff00', '#1a1a1a', '#ff7a45', '#e5484d']) {
      const p = accentPalette(hex);
      const other = p.contrast === '#ffffff' ? '#0b0a09' : '#ffffff';
      expect(contrastRatio(p.strong, p.contrast)).toBeGreaterThanOrEqual(Math.min(4.5, contrastRatio(p.accent, other)));
    }
  });

  it('keeps every preset label readable (WCAG AA for normal text)', () => {
    for (const { hex } of ACCENT_PRESETS) {
      const p = accentPalette(hex);
      expect(contrastRatio(p.strong, p.contrast)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the default for invalid input', () => {
    expect(accentPalette('nope').accent).toBe(ACCENT_PRESETS[0].hex);
  });
});

describe('accent choice', () => {
  it("reads nothing, null and the sentinel as the theme's colour, and keeps saved hex codes", () => {
    for (const value of [undefined, null, 'theme']) expect(parseAccentChoice(value)).toBe(THEME_ACCENT);
    expect(parseAccentChoice('#3E9BFF')).toBe('#3e9bff');
    for (const junk of ['red', 42, {}, '#12345']) expect(parseAccentChoice(junk)).toBeNull();
  });

  it("treats the theme's own colour as the theme's colour", () => {
    expect(normalizeAccentChoice('#e3101e', '#e3101e')).toBe(THEME_ACCENT);
    expect(normalizeAccentChoice('#3e9bff', '#e3101e')).toBe('#3e9bff');
    expect(normalizeAccentChoice(THEME_ACCENT, '#e3101e')).toBe(THEME_ACCENT);
  });

  it('shows the theme accent unless a colour was picked', () => {
    expect(effectiveAccent(THEME_ACCENT, '#ff9157')).toBe('#ff9157');
    expect(effectiveAccent('#46c28e', '#ff9157')).toBe('#46c28e');
  });
});
