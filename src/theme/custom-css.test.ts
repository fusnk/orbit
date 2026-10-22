import { describe, expect, it } from 'vitest';
import { cleanCss, CSS_MAX_BYTES, cssBytes, cssFits, loadsSomething, scrub, type ScrubbedRule } from './custom-css';

/** A stand-in for a parsed style rule: `longhands` is what the browser lists one by one, `cssText` the block as a whole. */
function fakeRule(cssText: string, longhands: Record<string, string>): ScrubbedRule & { removed: string[]; text: () => string } {
  let text = cssText;
  const values = { ...longhands };
  const removed: string[] = [];
  const style = {
    get cssText() {
      return text;
    },
    set cssText(value: string) {
      text = value;
      for (const key of Object.keys(values)) delete values[key];
    },
    [Symbol.iterator]: () => Object.keys(values)[Symbol.iterator](),
    getPropertyValue: (name: string) => values[name] ?? '',
    removeProperty: (name: string) => {
      removed.push(name);
      text = text.replace(new RegExp(`${name}:[^;]*;?`), '');
      delete values[name];
      return '';
    },
  } as unknown as CSSStyleDeclaration;
  return { cssText: `a { ${cssText} }`, style, removed, text: () => text };
}

describe('custom CSS', () => {
  it('is capped by its saved size, escapes included', () => {
    expect(cssFits('.nav { gap: 0 }')).toBe(true);
    expect(cssFits('a'.repeat(CSS_MAX_BYTES))).toBe(false);
    // Newlines and quotes take two bytes once saved, so the cap counts them that way.
    expect(cssBytes('\n"')).toBe(6);
    expect(cssFits('\n'.repeat(CSS_MAX_BYTES / 2))).toBe(false);
  });

  it('drops control characters and keeps tabs and newlines', () => {
    expect(cleanCss('a {\r\n\tcolor: red;\u0000\u001b }')).toBe('a {\n\tcolor: red; }');
    expect(cleanCss(42)).toBe('');
  });

  it('spots anything that would fetch a picture from somewhere', () => {
    for (const value of [
      'url("https://tracker.example/p.gif")',
      "url(//tracker.example/p.gif)",
      'URL(https://x)',
      String.raw`u\72l(https://x)`,
      String.raw`\75\72\6c(https://x)`,
      String.raw`\75 rl(https://x)`,
      String.raw`\000075 rl(https://x)`,
      'image-set("https://x/a.png" 1x)',
      '-webkit-image-set(url(https://x) 1x)',
      'image-set("data:image/png;base64,AAAA" 1x, "https://x" 2x)',
      'linear-gradient(red, blue), url(https://x)',
      'url("data:image/png;base64,AAAA"), url(https://x)',
      'src("https://x")',
      'cross-fade(url(https://x), red 50%)',
      // A quote inside another string doesn't hide what follows it.
      `"it's" image-set("https://x/a.png" 1x) 'data:'`,
      `"x'data:" image-set("https://x/a.png" 1x) "'"`,
      `"x'data:" url(https://x) "'"`,
      `'a"' image-set("https://x" 1x) "data:x"`,
      // The data: only looks like the url's start; the url itself is https.
      String.raw`url("\"data:" https://x)`,
      'url(https://x/data:image/png)',
      'url( "https://x" )',
      // A shorthand holding var(), as the whole declaration block reads.
      'background: var(--none,) url(https://x/beacon);',
      'border-image: var(--w) url("https://x") 30;',
      'color: red; --pixel: url(https://x);',
    ]) {
      expect([value, loadsSomething(value)]).toEqual([value, true]);
    }
  });

  it('lets through plain values and inline data: pictures', () => {
    for (const value of [
      'red',
      'linear-gradient(90deg, #fff, #000)',
      'url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")',
      "url(data:image/png;base64,AAAA)",
      "url(  'DATA:image/png;base64,AAAA' )",
      '"https: is just text"',
      '"url(https://x) is just text"',
      '/* url(https://x) */ red',
      'var(--seek-bar)',
      'background: var(--x) url("data:image/png;base64,AAAA");',
    ]) {
      expect([value, loadsSomething(value)]).toEqual([value, false]);
    }
  });

  it('reads a very long value in one pass', () => {
    const start = Date.now();
    expect(loadsSomething(`url(${' '.repeat(CSS_MAX_BYTES)}`)).toBe(true);
    expect(loadsSomething(`"data:${"'".repeat(CSS_MAX_BYTES)}`)).toBe(false);
    expect(loadsSomething(String.fromCharCode(92).repeat(CSS_MAX_BYTES))).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('drops a fetching declaration and keeps the rest of its rule', () => {
    const rule = fakeRule('color: red; background-image: url("https://x");', { color: 'red', 'background-image': 'url("https://x")' });
    scrub([rule], () => undefined);
    expect(rule.removed).toEqual(['background-image']);
    expect(rule.text()).toContain('color: red');
  });

  it('empties a block whose shorthand hides a url behind var()', () => {
    // The browser leaves a var() shorthand's longhands blank until it's computed.
    const rule = fakeRule('color: red; background: var(--none,) url("https://x/beacon");', { color: 'red', 'background-image': '', 'background-color': '' });
    scrub([rule], () => undefined);
    expect(rule.text()).toBe('');
  });

  it('removes a rule with no declarations that fetches, nested or not', () => {
    const removedTop: number[] = [];
    const removedInner: number[] = [];
    const property = { cssText: '@property --p { syntax: "<image>"; inherits: true; initial-value: url(https://x); }' };
    const harmless = { cssText: '@layer a, b;' };
    const group: ScrubbedRule = { cssText: '@media all { … }', cssRules: [harmless, property], deleteRule: (i) => removedInner.push(i) };
    scrub([property, group], (i) => removedTop.push(i));
    expect(removedTop).toEqual([0]);
    expect(removedInner).toEqual([1]);
  });
});
