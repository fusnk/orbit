/**
 * The "See all" tile at a rail's end takes its shape from a class. When that
 * class was a bare `poster`, the detail page's `.poster` rule (width: 100%,
 * 2:3) made the tile as wide as the row, and every rail with one thousands of
 * pixels tall. The tile's classes may only be styled together with
 * `.see-all-tile`. Read from the sources as text, so a new rule anywhere is checked.
 */
import { describe, expect, it } from 'vitest';
import cards from './cards.ts?raw';

const sheets = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });

/** The tile's classes, one per shape. */
function tileClasses(): string[] {
  const template = /class: `see-all-tile ([^`]*)`/.exec(cards)?.[1];
  if (!template) throw new Error("see-all tile's class not found in cards.ts");
  return ['poster', 'landscape', 'ranked'].map((shape) => template.replace('${shape}', shape));
}

/** Every compound selector (`a.b:hover`) in a sheet's rules. */
function compounds(css: string): string[] {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{};]+(?=\{)/g) ?? [];
  return selectors.flatMap((selector) => selector.split(/[\s,>+~()]+/)).filter(Boolean);
}

describe('see-all tile', () => {
  it('carries no class another rule styles on its own', () => {
    const classes = tileClasses();
    expect(classes).toHaveLength(3);
    const own = new Set(['see-all-tile', ...classes]);
    for (const [file, css] of Object.entries(sheets)) {
      for (const compound of compounds(css)) {
        // A compound made only of the tile's classes (a pseudo-class aside) matches the tile.
        const named = [...compound.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
        if (!named.length || /^[\w*#[]/.test(compound) || !named.every((name) => own.has(name))) continue;
        expect(named, `${file}: ${compound}`).toContain('see-all-tile');
      }
    }
  });
});
