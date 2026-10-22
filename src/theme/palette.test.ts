import { describe, expect, it } from 'vitest';
import { accentPalette, contrastRatio } from './accent';
import { cleanName, findPreset, isLight, isTrueBlack, parseMyThemes, parseThemeFile, parseThemeStyle, PRESETS, readabilityWarnings, THEME_FILE_MAX_BYTES, themeFile } from './palette';
import { DEFAULT_FONTS } from './fonts';
import { DEFAULT_SEEK_BAR } from './seekbar';
import { LOOKS } from './looks';

describe('theme presets', () => {
  it('are all readable', () => {
    for (const preset of PRESETS) expect([preset.id, readabilityWarnings(preset.colors)]).toEqual([preset.id, []]);
  });

  it("keep the Looks' faint text readable on the background and panels (WCAG AA)", () => {
    for (const id of new Set(LOOKS.map((look) => look.theme))) {
      const c = findPreset(id)!.colors;
      expect([id, contrastRatio(c.faint, c.bg) >= 4.5, contrastRatio(c.faint, c.panel) >= 4.5]).toEqual([id, true, true]);
    }
  });

  it('know light from dark', () => {
    expect(PRESETS.filter((p) => isLight(p.colors)).map((p) => p.id)).toEqual(['light', 'sky']);
  });

  it('give Crimson its style, true black and white on its red', () => {
    const crimson = findPreset('crimson')!;
    expect(crimson.style).toBe('crimson');
    expect(isTrueBlack(crimson.colors)).toBe(true);
    expect(contrastRatio(crimson.colors.accent, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(crimson.colors.accent, crimson.colors.bg)).toBeGreaterThanOrEqual(3);
    expect(PRESETS.filter((p) => p.style).map((p) => p.id)).toEqual(['crimson', 'afterglow', 'glass']);
  });

  it('give Afterglow its style, ivory text and dark text on its copper', () => {
    const afterglow = findPreset('afterglow')!;
    expect(afterglow.style).toBe('afterglow');
    expect(isLight(afterglow.colors)).toBe(false);
    expect(contrastRatio(afterglow.colors.text, afterglow.colors.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(afterglow.colors.muted, afterglow.colors.raised)).toBeGreaterThanOrEqual(4.5);
    // The current page's name is drawn in the accent, so it must read as text.
    expect(contrastRatio(afterglow.colors.accent, afterglow.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(accentPalette(afterglow.colors.accent).contrast).toBe('#0b0a09');
  });
});

describe('theme styles', () => {
  it('know their own and nothing else', () => {
    expect(parseThemeStyle('crimson')).toBe('crimson');
    expect(parseThemeStyle('afterglow')).toBe('afterglow');
    for (const bad of ['Crimson', 'Afterglow', 'neon', '', null, 1, { style: 'crimson' }]) expect(parseThemeStyle(bad)).toBeUndefined();
  });
});

describe('readability warnings', () => {
  it('flag text that disappears into the background', () => {
    const colors = { ...PRESETS[0]!.colors, text: '#1a1a1a' };
    expect(contrastRatio(colors.text, colors.bg)).toBeLessThan(4.5);
    expect(readabilityWarnings(colors)[0]).toMatch(/Text is hard to read/);
  });
});

describe('theme files', () => {
  const theme = { name: 'Late night', colors: PRESETS[3]!.colors, fonts: 'editorial' as const };

  it('round-trip', () => {
    expect(parseThemeFile(themeFile(theme))).toEqual(theme);
  });

  it('refuse a file over the size cap in bytes, not characters', () => {
    // Two bytes a character in UTF-8: fewer characters than the cap, more bytes.
    const big = JSON.stringify({ ...JSON.parse(themeFile(theme)), pad: 'é'.repeat(Math.ceil(THEME_FILE_MAX_BYTES * 0.6)) });
    expect(big.length).toBeLessThan(THEME_FILE_MAX_BYTES);
    expect(() => parseThemeFile(big)).toThrow();
  });

  it('hold colours and fonts only, for themes without Theme Studio parts', () => {
    const file = JSON.parse(themeFile(theme));
    expect(Object.keys(file).sort()).toEqual(['colors', 'fonts', 'name', 'orbitTheme']);
    // Anything unknown in a file someone shares is dropped, not applied.
    const extra = parseThemeFile(JSON.stringify({ ...file, script: 'alert(1)', html: '<img onerror=x>', colors: { ...file.colors, x: 'url(evil)' } }));
    expect(extra).toEqual(theme);
  });

  it('carry Theme Studio’s layout, seek bar and CSS, but not pictures from this PC', () => {
    const layout = { position: 'sidebar' as const, side: 'end' as const, align: 'start' as const, place: 'top-end' as const, items: [{ id: 'anime', label: 'Animé', hidden: true }] };
    const seekbar = { ...DEFAULT_SEEK_BAR, style: 'rainbow' as const, dot: 'image' as const, dotImage: 'upload-0123456789abcdef', barImage: 'upload-0123456789abcdef' };
    const parsed = parseThemeFile(themeFile({ ...theme, tagline: 'Neon nights', layout, seekbar, css: '.nav { gap: 0 }' }));
    expect(parsed).toEqual({ ...theme, tagline: 'Neon nights', layout, seekbar: { ...seekbar, dot: 'circle', dotImage: null, barImage: null }, css: '.nav { gap: 0 }' });
  });

  it('carry a style, and drop one this Orbit doesn’t know (from a newer one) without rejecting the file', () => {
    expect(parseThemeFile(themeFile({ ...theme, style: 'crimson' }))).toEqual({ ...theme, style: 'crimson' });
    const file = JSON.parse(themeFile(theme));
    expect(parseThemeFile(JSON.stringify({ ...file, style: 'neon' }))).toEqual(theme);
    expect(parseThemeFile(JSON.stringify({ ...file, style: { evil: true } }))).toEqual(theme);
  });

  it('carry Theme Studio’s Type & finish, leaving out fields that are wrong or unknown', () => {
    const appearance = { glow: 'strong' as const, corners: 'round' as const, posterSize: 'large' as const, heroStyle: 'split' as const, tint: true, detailBackground: 'blur' as const };
    expect(parseThemeFile(themeFile({ ...theme, appearance }))).toEqual({ ...theme, appearance });
    const file = JSON.parse(themeFile(theme));
    expect(parseThemeFile(JSON.stringify({ ...file, appearance: { glow: 'blinding', corners: 'sharp', scale: 300, wallpaper: 'x' } }))).toEqual({ ...theme, appearance: { corners: 'sharp' } });
    expect(parseThemeFile(JSON.stringify({ ...file, appearance: 'junk' }))).toEqual(theme);
  });

  it('reject Theme Studio parts that are there but wrong', () => {
    const file = JSON.parse(themeFile(theme));
    for (const bad of [
      { layout: { position: 'floating' } },
      { layout: { position: 'top', items: [{ id: '../x' }] } },
      { seekbar: { ...DEFAULT_SEEK_BAR, height: 400 } },
      { seekbar: { ...DEFAULT_SEEK_BAR, color: 'url(https://tracker)' } },
      { seekbar: { ...DEFAULT_SEEK_BAR, dotImage: '../../secret' } },
      { css: 42 },
      { css: 'a'.repeat(70_000) },
    ]) {
      expect(() => parseThemeFile(JSON.stringify({ ...file, ...bad }))).toThrow();
    }
  });

  it('reject anything that isn’t a colour', () => {
    for (const bad of ['red', 'url(https://x)', 'var(--a)', '#12345', 'expression(alert(1))']) {
      expect(() => parseThemeFile(JSON.stringify({ orbitTheme: 1, name: 'x', colors: { ...theme.colors, bg: bad }, fonts: 'orbit' }))).toThrow();
    }
    expect(() => parseThemeFile('not json')).toThrow();
    expect(() => parseThemeFile(JSON.stringify({ orbitTheme: 2, name: 'x', colors: theme.colors }))).toThrow();
    expect(() => parseThemeFile('x'.repeat(200_000))).toThrow(/too large/);
  });

  it('fall back to the default fonts and a plain name', () => {
    const parsed = parseThemeFile(JSON.stringify({ orbitTheme: 1, name: '\u202e\u0000  ', colors: { ...theme.colors, bg: '#ABC' }, fonts: 'comic-sans' }));
    expect(parsed).toEqual({ name: 'My theme', colors: { ...theme.colors, bg: '#aabbcc' }, fonts: DEFAULT_FONTS });
  });
});

describe('saved themes', () => {
  it('keep only valid ones', () => {
    const good = { id: 'mine-0a1b2c3d', name: 'Mine', colors: PRESETS[0]!.colors, fonts: 'orbit' };
    expect(parseMyThemes([good, { ...good, id: '../x' }, null, 'x'])).toEqual([good]);
    expect(parseMyThemes('junk')).toEqual([]);
  });

  it('keep Theme Studio parts, and fall back for unreadable ones', () => {
    const good = { id: 'mine-0a1b2c3d', name: 'Mine', colors: PRESETS[0]!.colors, fonts: 'orbit', tagline: 'Hi', layout: { position: 'dock', side: 'start', align: 'center', items: [] }, seekbar: DEFAULT_SEEK_BAR };
    // Saved before the floating pill could move: where it was, at the bottom in the middle.
    expect(parseMyThemes([good])).toEqual([{ ...good, layout: { ...good.layout, place: 'bottom' } }]);
    // Saved before the top bar's alignment existed: centred.
    expect(parseMyThemes([{ ...good, layout: { position: 'top', side: 'start', items: [] } }])).toEqual([{ ...good, layout: { position: 'top', side: 'start', align: 'center', place: 'bottom', items: [] } }]);
    expect(parseMyThemes([{ ...good, appearance: { glow: 'subtle', heroStyle: 'nope' } }])).toEqual([{ ...good, layout: { ...good.layout, place: 'bottom' }, appearance: { glow: 'subtle' } }]);
    expect(parseMyThemes([{ ...good, layout: 'junk', seekbar: { style: 'neon' } }])).toEqual([{ ...good, layout: { position: 'top', side: 'start', align: 'center', place: 'bottom', items: [] }, seekbar: DEFAULT_SEEK_BAR }]);
  });

  it('keep a known style and drop others', () => {
    const good = { id: 'mine-0a1b2c3d', name: 'Mine', colors: PRESETS[0]!.colors, fonts: 'orbit' };
    expect(parseMyThemes([{ ...good, style: 'crimson' }])).toEqual([{ ...good, style: 'crimson' }]);
    expect(parseMyThemes([{ ...good, style: 'neon' }])).toEqual([good]);
  });

  it('names are single-line and short', () => {
    expect(cleanName('a\nb')).toBe('ab');
    expect(cleanName('x'.repeat(80))).toHaveLength(40);
  });
});
