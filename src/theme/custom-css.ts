/**
 * Custom CSS (Theme Studio → Code): the person's own style rules, on top of
 * Orbit's. CSS only, never HTML or script, so a shared theme can't run
 * anything. It's applied through a constructable stylesheet
 * (document.adoptedStyleSheets): no <style> element and no inline styles, so
 * the strict CSP stays as it is.
 *
 * Nor may a theme reach the network. Constructed sheets ignore @import, and
 * url() in them is still bound by the CSP: font-src is 'self', so no web
 * fonts. But img-src has to allow https: (posters and backdrops come from
 * addons), so a url() there could load a tracking pixel the moment a theme is
 * applied; every declaration that points at a picture other than a data: one
 * is dropped once the sheet is parsed (`loadsSomething`, `scrub`).
 *
 * The text is untrusted (it may come from someone else's theme file): it is
 * only ever handed to the CSS parser, never to innerHTML.
 */

/**
 * The cap, in bytes of the setting it's saved in (JSON-escaped UTF-8), which
 * keeps it within a settings row (64 KB) beside its key and quotes.
 */
export const CSS_MAX_BYTES = 62 * 1024;

const encoder = new TextEncoder();

/** What `css` takes up once saved. */
export const cssBytes = (css: string): number => encoder.encode(JSON.stringify(css)).length;

export const cssFits = (css: string): boolean => cssBytes(css) <= CSS_MAX_BYTES;

/** Control characters (bar tab and newlines) have no place in a stylesheet; dropped, with Windows line ends made plain. */
export function cleanCss(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Reads the CSS escape whose backslash is just before `at`: the character it stands for, and where it ends (`\72 ` is `r`). */
function readEscape(text: string, at: number): { char: string; end: number } {
  const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(at, at + 6))?.[0];
  if (!hex) return { char: text[at] ?? '', end: at + 1 };
  const end = at + hex.length;
  return { char: String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd), end: /\s/.test(text[end] ?? '') ? end + 1 : end };
}

/** Reads the text at `at` up to (not including) a character `stop` accepts, escapes resolved. */
function readUntil(text: string, at: number, stop: (char: string) => boolean): { text: string; end: number } {
  let out = '';
  let i = at;
  while (i < text.length && !stop(text[i]!)) {
    if (text[i] === '\\') {
      const escape = readEscape(text, i + 1);
      out += escape.char;
      i = escape.end;
    } else out += text[i++];
  }
  return { text: out, end: i };
}

/** Reads the quoted string whose quote is at `at`. A newline ends it too, as in CSS. */
function readString(text: string, at: number): { text: string; end: number } {
  const quote = text[at];
  const read = readUntil(text, at + 1, (c) => c === quote || c === '\n');
  return { text: read.text, end: read.end + 1 };
}

const NAME_CHAR = /[\w\\\u0080-￿-]/;

/** Functions that fetch whatever they're given, data: or not (url() is weighed on its own). */
const FETCHING = /(?:^|-)(?:image-set|image|src|cross-fade)$/;

/**
 * Whether a declaration's value fetches something: any url() other than an
 * inline data: picture, and any image-set(), image() or src() at all.
 *
 * It walks the value the way CSS's tokenizer does (strings, comments and
 * escapes, so `u\72l(` is `url(`) rather than matching patterns over it: a
 * pattern can be fooled by a quote inside another string into skipping a real
 * url. One pass, so a long value can't stall it.
 */
export function loadsSomething(value: string): boolean {
  let i = 0;
  while (i < value.length) {
    const c = value[i]!;
    if (c === '"' || c === "'") {
      i = readString(value, i).end;
    } else if (c === '/' && value[i + 1] === '*') {
      const close = value.indexOf('*/', i + 2);
      i = close < 0 ? value.length : close + 2;
    } else if (NAME_CHAR.test(c)) {
      const name = readUntil(value, i, (ch) => !NAME_CHAR.test(ch));
      i = name.end;
      if (value[i] !== '(') continue;
      i++;
      const fn = name.text.toLowerCase();
      if (FETCHING.test(fn)) return true;
      if (fn !== 'url') continue;
      while (/\s/.test(value[i] ?? '')) i++;
      const target = value[i] === '"' || value[i] === "'" ? readString(value, i) : readUntil(value, i, (ch) => ch === ')');
      i = target.end;
      // The URL parser drops leading spaces and controls, and tabs and newlines anywhere.
      // eslint-disable-next-line no-control-regex
      if (!/^data:/i.test(target.text.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, ''))) return true;
    } else {
      i++;
    }
  }
  return false;
}

/** What `scrub` reads of a parsed rule (a CSSRule, loosely, so it can be tested without a browser). */
export interface ScrubbedRule {
  readonly cssText: string;
  readonly style?: CSSStyleDeclaration;
  readonly cssRules?: ArrayLike<ScrubbedRule>;
  deleteRule?(index: number): void;
}

/** Drops every declaration (and @property rule) in `rules` that would fetch something. */
export function scrub(rules: ArrayLike<ScrubbedRule>, remove: (index: number) => void): void {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;
    const style = rule.style;
    if (style && loadsSomething(style.cssText)) {
      for (const property of [...style]) if (loadsSomething(style.getPropertyValue(property))) style.removeProperty(property);
      // A shorthand holding var() leaves its longhands blank until it's
      // computed, so they can't be weighed one by one; the url only shows in
      // the block as a whole. If anything there still fetches, the block goes.
      if (loadsSomething(style.cssText)) style.cssText = '';
    }
    const inner = rule.cssRules;
    if (inner) scrub(inner, (index) => rule.deleteRule?.(index));
    // A registered property's initial value applies wherever it's used, with no declaration to drop.
    else if (!style && loadsSomething(rule.cssText)) remove(i);
  }
}

let sheet: CSSStyleSheet | null = null;
let current = '';

export const currentCss = (): string => current;

/** Shows `css` (empty removes it). Text past the cap isn't applied. */
export function applyCustomCss(css: string): void {
  current = cssFits(css) ? css : '';
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  // replaceSync parses leniently: rules it can't read are skipped, the rest apply.
  sheet.replaceSync(current);
  const parsed = sheet;
  scrub(parsed.cssRules as ArrayLike<ScrubbedRule>, (index) => parsed.deleteRule(index));
}
