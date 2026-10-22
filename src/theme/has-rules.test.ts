import { describe, expect, it } from 'vitest';

/**
 * A `:not()` inside a `:has()` argument makes Chromium look again at that rule's subjects after any
 * change anywhere in them, however unrelated, and restyle what follows them. Seventeen such rules
 * (`.rail:has(.rail-track:not(.more-before))`, `#app:has(.outlet:not(.scrolled) > .home)`, …) made
 * every row filling in or card focused on a TV's Home restyle about 650 elements across the page:
 * 70 ms a change on a Shield, the most of a held key's stutter. `X:not(:has(Y))` says the same
 * cheaply. These few watch a handful of elements and stay as they are.
 */
const ALLOWED = [
  '.nav:not(:has(.nav-item:not([hidden])))',
  '.explore-section:not(:has(> :not([hidden])))',
  '.layout-badges:not(:has(> :not([hidden])))',
  '.home-rails.paired > .home-row:not(:has(> :not([hidden], :empty)))',
  '.discover-bar:has(> .discover-bar-row:not(.explore-grid-bar) > .genre-picker[hidden]):not(:has(.source-picker:not([hidden]))):not(:has(> .discover-bar-row > .segments:not([hidden])))',
];

const sheets = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true });

/** Each `:has(` argument in `selector`, with its brackets balanced. */
function hasArguments(selector: string): string[] {
  const found: string[] = [];
  for (let at = selector.indexOf(':has('); at >= 0; at = selector.indexOf(':has(', at + 1)) {
    let depth = 0;
    for (let i = at + 4; i < selector.length; i++) {
      if (selector[i] === '(') depth++;
      else if (selector[i] === ')' && --depth === 0) {
        found.push(selector.slice(at + 5, i));
        break;
      }
    }
  }
  return found;
}

/** The selectors of every rule in `css` (comments dropped, selector lists split by rule, not by comma). */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim()).filter((s) => !s.startsWith('@'));
}

describe(':has() rules', () => {
  it('put no :not() inside a :has() argument', () => {
    const offending: string[] = [];
    for (const [file, css] of Object.entries(sheets)) {
      for (const selector of selectors(css)) {
        for (const part of selector.split(/,(?![^(]*\))/)) {
          const trimmed = part.trim();
          if (ALLOWED.some((ok) => trimmed.includes(ok))) continue;
          if (hasArguments(trimmed).some((arg) => arg.includes(':not('))) offending.push(`${file}: ${trimmed}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it('finds :has() arguments, nested brackets and all', () => {
    expect(hasArguments('.a:has(.b:not(.c)) .d')).toEqual(['.b:not(.c)']);
    expect(hasArguments('.a:not(:has(.b.c))')).toEqual(['.b.c']);
  });
});
