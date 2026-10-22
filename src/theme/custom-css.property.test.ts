import fc from 'fast-check';
import { expect, it } from 'vitest';
import { cleanCss, cssBytes, cssFits, CSS_MAX_BYTES, loadsSomething } from './custom-css';

const options = { seed: 20261007, numRuns: 300 };
const functionName = fc.constantFrom('url', 'image-set', '-webkit-image-set', 'image', 'src');
const encodedName = functionName.chain((name) => fc.array(fc.constantFrom('plain', 'upper', 'simple', 'hex', 'padded'), { minLength: name.length, maxLength: name.length }).map((forms) => [...name].map((char, index) => {
  switch (forms[index]) {
    case 'upper': return char.toUpperCase();
    case 'simple': return /^[a-f]$/i.test(char) ? `\\${char.charCodeAt(0).toString(16)} ` : `\\${char}`;
    case 'hex': return `\\${char.charCodeAt(0).toString(16)} `;
    case 'padded': return `\\${char.charCodeAt(0).toString(16).padStart(6, '0')}`;
    default: return char;
  }
}).join('')));

it('detects generated network functions despite identifier escapes, case and quoted arguments', () => {
  fc.assert(fc.property(encodedName, fc.constantFrom('', '"', "'"), fc.constantFrom('', ' ', '\t', '\n'), fc.constantFrom('', '/*outer*/', 'linear-gradient(red,blue), '), (name, quote, space, prefix) => {
    expect(loadsSomething(`${prefix}${name}(${space}${quote}https://example.test/pixel${quote}${space})`)).toBe(true);
  }), options);
});

it('an inline data image never hides another generated network fetch', () => {
  fc.assert(fc.property(encodedName, fc.constantFrom('"', "'"), (name, quote) => {
    expect(loadsSomething(`url(${quote}data:image/png;base64,AAAA${quote}), ${name}(${quote}https://example.test/pixel${quote})`)).toBe(true);
  }), options);
});

it('cleaning arbitrary CSS is idempotent and saved UTF-8 size controls admission', () => {
  fc.assert(fc.property(fc.string({ maxLength: 2000 }), (value) => {
    const cleaned = cleanCss(value);
    expect(cleanCss(cleaned)).toBe(cleaned);
    expect(cleaned).not.toContain('\r');
    // eslint-disable-next-line no-control-regex
    expect(cleaned).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    expect(cssBytes(value)).toBe(new TextEncoder().encode(JSON.stringify(value)).length);
    expect(cssFits(value)).toBe(cssBytes(value) <= CSS_MAX_BYTES);
  }), options);
});
