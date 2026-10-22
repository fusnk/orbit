/**
 * WCAG AA contrast on the phone remote's page (src-tauri/src/remote/page),
 * read from its stylesheet: text 4.5:1, the focus ring 3:1, in its dark look
 * and in the light one a phone set to light mode gets.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio, mix } from '../theme/accent';
import css from '../../src-tauri/src/remote/page/remote.css?raw';

const LIGHT = '@media (prefers-color-scheme: light)';

/** The stylesheet's colours for a look: the light block's own, else the dark ones it doesn't change. */
const tokens = (theme: 'dark' | 'light') => {
  const start = css.indexOf(LIGHT);
  if (theme === 'light' && start < 0) throw new Error('no light look in remote.css');
  const light = theme === 'light' ? css.slice(start, css.indexOf('\n}', start)) : '';
  return (name: string): string => {
    const find = (text: string) => new RegExp(`--${name}: (#[0-9a-f]{6}|#[0-9a-f]{3}|rgba\\([^)]*\\));`).exec(text)?.[1];
    const value = find(light) ?? find(css);
    if (!value) throw new Error(`--${name} not found in remote.css`);
    return value;
  };
};

/** A hex colour, or an rgba() one laid over `under`. */
const solid = (value: string, under: string): string => {
  const rgba = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(value);
  if (!rgba) return value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join('')}` : value;
  const hex = `#${[rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return mix(under, hex, Number(rgba[4]));
};

/** The custom property each var() in `selector`'s `property` names. */
const used = (selector: string, property: string): string => {
  const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()'*]/g, '\\$&')}[,\\s][^{]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!);
  const name = blocks.map((block) => new RegExp(`(?:^|\\s)${property}: var\\(--([a-z0-9-]+)\\)`).exec(block)?.[1]).find(Boolean);
  if (!name) throw new Error(`${selector} { ${property} } not found in remote.css`);
  return name;
};

const ratio = (fg: string, bg: string) => Math.round(contrastRatio(fg, bg) * 100) / 100;

describe.each(['dark', 'light'] as const)('phone remote contrast (WCAG AA), %s', (theme) => {
  const token = tokens(theme);
  const bg = solid(token('bg'), '#ffffff');
  const surface = solid(token('surface'), bg);
  const surface2 = solid(token('surface-2'), bg);

  it('labels on the accent fills read', () => {
    for (const selector of ['.primary', '.badge', '.pad-ok', '.icon-button.big', ".chip[aria-pressed='true']", '.surprise-icon']) {
      const fill = solid(token(used(selector, 'background')), surface);
      const label = solid(token(used(selector, 'color')), fill);
      expect([selector, ratio(label, fill) >= 4.5, ratio(label, fill)]).toEqual([selector, true, ratio(label, fill)]);
    }
  });

  it('"Open on TV" reads on the surprise pick (its wash over the red-washed card)', () => {
    const pick = solid(token(used('.surprise-pick', 'background')), mix(surface, solid(token('accent'), surface), 0.22));
    expect(ratio(solid(token(used('.surprise-more', 'color')), pick), pick)).toBeGreaterThanOrEqual(4.5);
  });

  it('text and muted text read on the page and its surfaces', () => {
    for (const where of [bg, surface, surface2]) {
      expect(ratio(token('text'), where)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('muted'), where)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(token(used('.sheet-description', 'color')), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('notices read on their tint', () => {
    for (const selector of ['.offline', '.notice']) {
      const tint = solid(token(used(selector, 'background')), bg);
      expect([selector, ratio(token(used(selector, 'color')), tint) >= 4.5]).toEqual([selector, true]);
    }
  });

  it('the tab bar labels read on it', () => {
    const bar = solid(token(used('.tabs', 'background')), bg);
    expect(ratio(token(used('.tab', 'color')), bar)).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring shows on the page and its surfaces', () => {
    for (const where of [bg, surface, surface2]) expect(ratio(token('accent'), where)).toBeGreaterThanOrEqual(3);
  });
});
