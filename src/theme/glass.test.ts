/**
 * Text on the Glass theme's see-through surfaces holds WCAG AA (4.5:1) over
 * the worst backdrop: a white poster behind the glass, dimmed by the blur's
 * brightness, then the tint, the lit top and the grain over it. The alpha,
 * brightness and fill values are read from glass.css itself, so retuning the
 * material there is checked too. Composited in sRGB, which is close enough
 * for these dark colours (the browser mixes the tint in OKLab).
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio, mix } from './accent';
import { findPreset, isLight } from './palette';
import css from './glass.css?raw';

/** The first `:root[data-theme-style='glass'] { … }` block: the dark material. */
const material = /:root\[data-theme-style='glass'\] \{([^}]*)\}/.exec(css)![1]!;
const token = (name: string): number => {
  const match = new RegExp(`${name}: ([\\d.]+)(%?);`).exec(material);
  if (!match) throw new Error(`${name} not found in glass.css`);
  return Number(match[1]) / (match[2] ? 100 : 1);
};
const plate = /--glass-plate: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(material)!;
const hex = (...rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Average grain over the surface: the tile's white at .07 × noise that averages one half. */
const GRAIN = 0.035;
const WHITE = '#ffffff';
/** "Tint with my accent" (the Glass Look turns it on) mixes 10% accent into panels (tokens.css). */
const TINT = 0.1;

/** The colour behind text on a surface of `tint` at `alpha`, over a white backdrop at `bright`, lit by `fill` at its top. */
function surface(tint: string, alpha: number, bright: number, fill: number): string {
  const backdrop = hex(255 * bright, 255 * bright, 255 * bright);
  return mix(mix(mix(backdrop, tint, alpha), WHITE, fill), WHITE, GRAIN);
}

const glass = findPreset('glass')!;
const c = glass.colors;
const bright = token('--glass-bright');
const fill = token('--glass-fill');

describe('Glass theme contrast over the worst backdrop', () => {
  it('is a dark theme with the glass style', () => {
    expect(glass.style).toBe('glass');
    expect(isLight(c)).toBe(false);
  });

  for (const tinted of [false, true]) {
    const panel = tinted ? mix(c.panel, c.accent, TINT) : c.panel;
    const on = (fg: string, bg: string) => Math.round(contrastRatio(fg, bg) * 100) / 100;
    const label = tinted ? ' (accent tint on)' : '';

    it(`panels hold body text${label}`, () => {
      const bg = surface(panel, token('--glass-panel-alpha'), bright, fill);
      const dangerText = mix(c.danger, c.text, 0.5);
      for (const [name, fg] of [['text', c.text], ['muted', c.muted], ['faint', c.faint], ['error', dangerText]] as const) {
        expect([name, on(fg, bg) >= 4.5, on(fg, bg)]).toEqual([name, true, on(fg, bg)]);
      }
    });

    it(`the nav's labels read through its clearer glass${label}`, () => {
      const bg = surface(panel, token('--glass-nav-alpha'), bright, fill);
      // glass.css: inactive names are color-mix(text 82%, muted).
      const inactive = mix(c.muted, c.text, 0.82);
      expect(on(c.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(on(inactive, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`the focus ring shows on the nav and panels${label}`, () => {
      // A page's ring (styles.css .nav-item:focus-visible) touches the bar's glass; a menu item's touches the panel.
      for (const alpha of ['--glass-nav-alpha', '--glass-panel-alpha']) {
        const bg = surface(panel, token(alpha), bright, fill);
        expect([alpha, on(c.accent, bg) >= 3, on(c.accent, bg)]).toEqual([alpha, true, on(c.accent, bg)]);
      }
    });

    it(`white labels on the clear buttons over artwork${label}`, () => {
      const bg = surface(panel, token('--glass-clear-alpha'), bright, fill);
      expect(on(WHITE, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('player plates keep white text readable over a white frame of video (no blur to dim it)', () => {
    const [, r, g, b, a] = plate.map(Number) as [number, number, number, number, number];
    const bg = mix(mix(WHITE, hex(r, g, b), a), WHITE, 0.08);
    expect(contrastRatio(WHITE, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps faint quieter than muted', () => {
    expect(contrastRatio(c.faint, c.bg)).toBeLessThan(contrastRatio(c.muted, c.bg));
  });
});
