/**
 * WCAG contrast of the colour pairs tokens.css derives from every built-in
 * theme, with and without "Tint with my accent" (a setting any theme can
 * have on, and Glass and Aurora turn on). Text needs 4.5:1; the focus ring
 * and other UI parts need 3:1 (WCAG 1.4.3 and 1.4.11).
 *
 * The derivations that live in CSS (error text, the tint) are read from
 * tokens.css itself, so changing a percentage there is checked too.
 */
import { describe, expect, it } from 'vitest';
import { accentPalette, contrastRatio, mix, mixOklab } from './accent';
import { dangerFill } from './engine';
import { DEFAULT_PRESET, isLight, PRESETS, type Colors } from './palette';
import tokens from './tokens.css?raw';
import styles from '../styles.css?raw';

/** The `n%` in each `--color-danger-text: color-mix(in srgb, var(--base-danger) n%, …)`: the dark theme's, then the light theme's. */
const dangerShares = [...tokens.matchAll(/--color-danger-text: color-mix\(in srgb, var\(--base-danger\) (\d+)%, var\(--base-text\)\)/g)].map((m) => Number(m[1]) / 100);

/** The `n%` in `--color-accent-text: color-mix(in srgb, var(--color-accent) n%, …)`, one for light and dark themes. */
const accentShares = [...tokens.matchAll(/--color-accent-text: color-mix\(in srgb, var\(--color-accent\) (\d+)%, var\(--base-text\)\)/g)].map((m) => Number(m[1]) / 100);

/** How much accent "Tint with my accent" mixes into each surface (tokens.css, :root[data-tint='on']). */
function tintShare(token: string): number {
  const block = /:root\[data-tint='on'\] \{([^}]*)\}/.exec(tokens)![1]!;
  return Number(new RegExp(`${token}: color-mix\\(in oklab, var\\(--color-accent\\) (\\d+)%`).exec(block)![1]) / 100;
}

/** The `n%` of text in `--color-surface-raised` / `--color-surface-overlay`: the dark theme's, then the light theme's. */
const surfaceShare = (token: string, light: boolean) => Number([...tokens.matchAll(new RegExp(`${token}: color-mix\\(in srgb, var\\(--base-text\\) (\\d+)%, transparent\\)`, 'g'))][light ? 1 : 0]![1]) / 100;

/** The places styles.css gives glass buttons the page's own colours on light themes (they sit on the page, not artwork). */
const lightGlassPlaces = (() => {
  const rule = /:root\[data-theme='light'\] :is\(([^)]*)\) \.button\.glass:not\(\.featured \*\) \{([^}]*)\}/.exec(styles);
  return rule && /color: var\(--color-text\)/.test(rule[2]!) && /background: var\(--color-surface-raised\)/.test(rule[2]!) ? rule[1]!.split(',').map((s) => s.trim()) : [];
})();

interface Pair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

/** Every pair worth checking in one theme, as tokens.css and theme/ put them on screen. */
function pairs(c: Colors, tint: boolean): Pair[] {
  const bg = tint ? mixOklab(c.bg, c.accent, tintShare('--color-bg')) : c.bg;
  const panel = tint ? mixOklab(c.panel, c.accent, tintShare('--color-panel')) : c.panel;
  const raised = tint ? mixOklab(c.raised, c.accent, tintShare('--color-panel-2')) : c.raised;
  // color-mix(danger n%, text) is `text` moved toward danger by n, i.e. danger moved toward text by 1 − n.
  const dangerText = mix(c.danger, c.text, 1 - dangerShares[isLight(c) ? 1 : 0]!);
  const accentText = mix(c.accent, c.text, 1 - accentShares[0]!);
  // A toast (--color-glass: the panel at 88–90% over the page) and its action button's wash of the text colour (styles.css .toast-action).
  const toast = mix(bg, panel, isLight(c) ? 0.9 : 0.88);
  const toastAction = mix(toast, c.text, 0.08);
  const toastActionLit = mix(toast, c.text, 0.2);
  const accent = accentPalette(c.accent);
  const danger = dangerFill(c.danger);
  // A glass button in a drawer (Connect's remote, Surprise Me) on a light theme: the raised surface over the panel.
  const drawerButton = mix(panel, c.text, surfaceShare('--color-surface-raised', isLight(c)));
  const drawerButtonLit = mix(panel, c.text, surfaceShare('--color-surface-overlay', isLight(c)));
  const lightGlass = isLight(c)
    ? [
        { name: 'text on a glass button in a drawer', fg: c.text, bg: drawerButton, min: 4.5 },
        { name: 'text on a glass button in a drawer, pointed at', fg: c.text, bg: drawerButtonLit, min: 4.5 },
      ]
    : [];
  return [
    ...lightGlass,
    ...[bg, panel, raised].flatMap((surface, i) => {
      const where = ['background', 'panel', 'raised'][i];
      return [
        { name: `text on ${where}`, fg: c.text, bg: surface, min: 4.5 },
        { name: `muted text on ${where}`, fg: c.muted, bg: surface, min: 4.5 },
      ];
    }),
    // Faint text (dates, hints, episode details) is read, so it's body text. Raised is only the artwork frame's fill, under pictures.
    { name: 'faint text on background', fg: c.faint, bg, min: 4.5 },
    { name: 'faint text on panel', fg: c.faint, bg: panel, min: 4.5 },
    { name: 'error text on background', fg: dangerText, bg, min: 4.5 },
    { name: 'error text on panel', fg: dangerText, bg: panel, min: 4.5 },
    // Accent-coloured words: a landscape card's latest episode, "Only on <service>", Press again, a guide's times, a toast's Undo.
    { name: 'accent text on background', fg: accentText, bg, min: 4.5 },
    { name: 'accent text on panel', fg: accentText, bg: panel, min: 4.5 },
    { name: "accent text on a toast's action", fg: accentText, bg: toastAction, min: 4.5 },
    { name: "text on a toast's action, pointed at or focused", fg: c.text, bg: toastActionLit, min: 4.5 },
    { name: 'label on accent fill', fg: accent.contrast, bg: accent.strong, min: 4.5 },
    { name: 'label on armed Delete', fg: danger.contrast, bg: danger.strong, min: 4.5 },
    // The ring sits on a 2px gap of the background (--focus-ring); the menu's own ring touches the bar, a panel at most.
    { name: 'focus ring on background', fg: c.accent, bg, min: 3 },
    { name: 'focus ring on panel', fg: c.accent, bg: panel, min: 3 },
  ];
}

const failures = (c: Colors, tint: boolean) =>
  pairs(c, tint)
    .map((pair) => ({ ...pair, ratio: Math.round(contrastRatio(pair.fg, pair.bg) * 100) / 100 }))
    .filter((pair) => pair.ratio < pair.min)
    .map(({ name, ratio, min }) => `${name}: ${ratio} < ${min}`);

describe('theme contrast (WCAG AA)', () => {
  it('reads its derivations from tokens.css', () => {
    expect(dangerShares).toHaveLength(2);
    expect(accentShares).toHaveLength(1);
    for (const token of ['--color-bg', '--color-panel', '--color-panel-2']) expect(tintShare(token)).toBeGreaterThan(0);
  });

  for (const preset of PRESETS) {
    it(`${preset.name} (${preset.id}) passes`, () => {
      expect(failures(preset.colors, false)).toEqual([]);
    });

    it(`${preset.name} (${preset.id}) passes with the accent tint`, () => {
      expect(failures(preset.colors, true)).toEqual([]);
    });
  }

  it("gives glass buttons in drawers the page's own text colour on light themes (white text would vanish)", () => {
    expect(lightGlassPlaces).toContain('.drawer');
  });

  it('keeps faint text quieter than muted text, so the order between them holds', () => {
    for (const { id, colors: c } of PRESETS) expect([id, contrastRatio(c.faint, c.bg) < contrastRatio(c.muted, c.bg)]).toEqual([id, true]);
  });

  it("starts with Orbit's own colours before a theme loads (tokens.css defaults)", () => {
    const base = (key: string) => new RegExp(`--base-${key}: (#[0-9a-f]{6});`).exec(tokens)?.[1];
    for (const key of ['bg', 'panel', 'raised', 'text', 'muted', 'faint', 'danger'] as const) expect([key, base(key)]).toEqual([key, DEFAULT_PRESET.colors[key]]);
    const fill = dangerFill(DEFAULT_PRESET.colors.danger);
    expect(/--color-danger-strong: (#[0-9a-f]{6});/.exec(tokens)?.[1]).toBe(fill.strong);
    expect(/--color-danger-contrast: (#[0-9a-f]{6});/.exec(tokens)?.[1]).toBe(fill.contrast);
  });
});
