/**
 * The cinematic banner fades into the page. A mask is drawn in its own
 * element's (transformed) space, so a mask on the drifting art, or on the
 * trailer while it was zoomed with `transform: scale(1.3)`, was carried past
 * the banner's clipped bottom and the picture ended in a hard line there.
 * The fade belongs on the still `.hero-media` layer, and the trailer is
 * cropped with object-view-box, not scaled. Read from the sources as text, so
 * a new rule anywhere is checked.
 */
import { describe, expect, it } from 'vitest';
import hero from './hero.ts?raw';

const sheets = import.meta.glob<string>('../../**/*.css', { query: '?raw', import: 'default', eager: true });

/** Every rule in every sheet: its file, selector and declarations. */
function rules(): { file: string; selector: string; body: string }[] {
  return Object.entries(sheets).flatMap(([file, css]) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ file, selector: match[1]!.trim(), body: match[2]! })),
  );
}

describe('banner fade', () => {
  it('never scales a trailer (its fade or rounded frame would grow with it)', () => {
    for (const { file, selector, body } of rules()) {
      if (!/\.(hero|detail)-trailer\b/.test(selector)) continue;
      expect(body, `${file}: ${selector}`).not.toMatch(/(^|[\s;])(transform|scale|zoom)\s*:/);
    }
  });

  it('masks only the still layer, never the moving art or the trailer', () => {
    for (const { file, selector, body } of rules()) {
      if (!/(^|[\s;])mask(-image)?\s*:/.test(body)) continue;
      expect(selector, file).not.toMatch(/\.hero-(art|trailer|shade)\b/);
    }
  });

  it('puts the art, trailer and shade in that layer', () => {
    expect(hero).toMatch(/h\('div', \{ class: 'hero-media' \}, \.\.\.slides, \.\.\.trailer\.media, h\('div', \{ class: 'hero-shade/);
  });
});

describe('card without artwork', () => {
  it('centres its name, clear of the ratings strip along the bottom', () => {
    const noArt = rules().find((rule) => rule.selector === '.no-art');
    expect(noArt?.body).toMatch(/justify-content: center;/);
  });
});
