import { expect, it } from 'vitest';

const sources = import.meta.glob<string>(['../**/*.ts', '../**/*.css', '../**/*.html', '../../index.html', '../../src-tauri/src/**/*.rs', '!./source-encoding.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
/**
 * UTF-8 read as Windows-1252 once saved again: "·" turns into "Â·", "…" and "—" into "â€¦" and "â€"",
 * "é" into "Ã©", Cyrillic into "Ð…"/"Ñ…"; and a byte-order mark saved into the middle of a file.
 */
const MOJIBAKE = /Â[\u00a0-\u00bf]|â€|Ã[\u0080-\u00bf]|[ÐÑ][\u0080-\u00bf]|ï»¿|.\ufeff/su;
/**
 * Characters that don't show in an editor: control characters (other than tab and line breaks), a decoding
 * failure's "\ufffd", and bidi overrides and isolates, which can make code read differently from how it runs.
 * Where one is meant, the source writes it as an escape (`\u2068`), so it's visible.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd\u202a-\u202e\u2066-\u2069]/u;

// Text shown in the interface (and read by screen readers) comes straight from these files.
it('keeps source files free of text garbled by a wrong encoding', () => {
  const garbled = Object.entries(sources)
    .filter(([, text]) => MOJIBAKE.test(text))
    .map(([file]) => file);
  expect(Object.keys(sources).length).toBeGreaterThan(100);
  expect(garbled).toEqual([]);
});

it('keeps invisible characters out of source files (escaped where one is meant)', () => {
  const hidden = Object.entries(sources)
    .filter(([, text]) => INVISIBLE.test(text))
    .map(([file]) => file);
  expect(hidden).toEqual([]);
});
