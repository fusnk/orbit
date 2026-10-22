import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import { SIGN_IN_CODES } from '../lib/user-error';
import { codedText, errorText, playbackText } from './state-message';

describe('coded Rust errors', () => {
  it('are shown in words, with their parameters filled', () => {
    expect(errorText('err.lists.gone')).toBe('That list no longer exists.');
    expect(errorText('err.lists.limit|max=100')).toBe('You can have up to 100 lists.');
    expect(errorText('err.collections.item-limit|max=1000')).toBe('A collection can hold up to 1,000 titles.');
    expect(errorText('err.debrid.status|provider=TorBox|status=503')).toBe('TorBox had a problem (error 503). Try again in a moment.');
    expect(errorText('err.profile.name-length|max=24')).toBe('Profile names are 1 to 24 characters.');
    expect(errorText('err.pin.locked|seconds=30')).toBe('Too many tries. Try again in 30 s.');
    expect(errorText('err.pin.locked|seconds=3601')).toBe('Too many tries. Try again in 61 min.');
    expect(playbackText('err.torrent.no-peers')).toBe('No one is sharing this torrent right now.');
  });

  it('say a sign-in to renew the same way on every page, and keep a network code’s own words', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(errorText('err.tmdb.signed-out')).toBe(en['states.auth.tmdb']);
    expect(errorText('err.debrid.signed-out|provider=TorBox')).toBe(en['states.auth.debrid']);
    expect(playbackText('err.jellyfin.signed-out')).toBe(en['states.auth.jellyfin']);
    expect(errorText('err.tmdb.unreachable')).toBe(en['errors.tmdb.unreachable']);
    expect(errorText('err.debrid.busy|provider=TorBox|seconds=12')).toBe('TorBox asked Orbit to slow down. Try again in 12 s.');
    vi.stubGlobal('navigator', { onLine: false });
    expect(errorText('err.tmdb.unreachable')).toBe(en['states.cause.offline']);
    // A sign-in or a key typed in Settings doesn't retry by itself: it says to try again.
    expect(errorText('err.stremio.unreachable', { service: 'stremio', action: true })).toBe(en['states.cause.offline-action']);
    vi.unstubAllGlobals();
  });

  it('never show an unknown code or its parameters raw', () => {
    expect(codedText('err.no.such-code|name=x')).toBeNull();
    expect(errorText('err.no.such-code|name=x')).toBe(en['states.cause.unknown']);
    expect(errorText('err.no.such-code', { fallback: 'integrations.stremio.sign-in-failed' })).toBe(en['integrations.stremio.sign-in-failed']);
  });

  it('leave other errors as they were', () => {
    expect(codedText('Use a PNG, JPEG or WebP image.')).toBeNull();
  });
});

/** Rust's sources, to check every code it can answer with has words. */
const RUST = import.meta.glob<string>('../../src-tauri/src/**/*.rs', { query: '?raw', import: 'default', eager: true });

/** Codes Rust builds from parts, which a search for literals can't see. */
const BUILT = [
  ...['setting', 'collection', 'rating', 'favourite', 'history', 'title', 'list'].map((part) => `backup.bad-${part}`),
  'collections.name',
  'collections.group-name',
];

describe('Rust error codes', () => {
  const found = new Set<string>(BUILT);
  for (const text of Object.values(RUST)) {
    for (const m of text.matchAll(/"err\.([a-z0-9.-]+)"/g)) found.add(m[1]!);
    for (const m of text.matchAll(/user_error::coded\("([a-z0-9.-]+)"/g)) found.add(m[1]!);
  }

  it('are found', () => {
    expect(found.size).toBeGreaterThan(100);
  });

  it('all have English words', () => {
    // A sign-in code is said the same way on every page (`states.auth.*`), so it needs none of its own.
    expect([...found].filter((code) => !(`errors.${code}` in en) && !(code in SIGN_IN_CODES))).toEqual([]);
  });

  it('include every sign-in code the page knows', () => {
    expect(Object.keys(SIGN_IN_CODES).filter((code) => !found.has(code))).toEqual([]);
  });
});

/** Each Rust file's lines outside its `#[cfg(test)] mod … { … }` blocks (rustfmt closes those with `}` alone). */
function productionLines(text: string): string[] {
  const lines = text.split('\n');
  const kept: string[] = [];
  let inTests = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inTests && line.trim() === '#[cfg(test)]' && /^mod \w+ \{/.test(lines[i + 1] ?? '')) inTests = true;
    else if (inTests && line.trimEnd() === '}') inTests = false;
    else if (!inTests) kept.push(line);
  }
  return kept;
}

describe('Rust errors that reach the page', () => {
  it('are codes, not English sentences', () => {
    // A sentence in an error shows in English only (see `safeSentence`), and as
    // "Something went wrong" in every other language: give it a code instead.
    const sentence = /"(\p{Lu}[^"\\]* [^"\\]*[.!?])"/u;
    const failing = /Err\(|map_err\(|ok_or(?:_else)?\(|\.into\(\)|\.to_string\(\)/;
    const found: string[] = [];
    for (const [file, text] of Object.entries(RUST)) {
      if (file.endsWith('/tests.rs')) continue;
      for (const line of productionLines(text)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || /eprintln!|println!|log::|assert/.test(trimmed) || !failing.test(trimmed)) continue;
        const match = sentence.exec(trimmed);
        if (match) found.push(`${file.replace(/^.*src-tauri\/src\//, '')}: ${match[1]}`);
      }
    }
    expect(found).toEqual([]);
  });
});

/** The page's own sources, outside tests and translations. */
const PAGE = import.meta.glob<string>(['../**/*.ts', '!../**/*.test.ts', '!../i18n/locales/**'], { query: '?raw', import: 'default', eager: true });

describe('"Something went wrong"', () => {
  it('is said only where nothing more is known', () => {
    // The general fallback, and the two lines for a crash Orbit caught (see app/errors.ts). Anything
    // else that fails should say what happened and what to do: give it its own words.
    const vague = Object.entries(en).filter(([, text]) => /went wrong/i.test(text)).map(([key]) => key);
    expect(vague.sort()).toEqual(['settings.errors.page-detail', 'settings.errors.toast', 'states.cause.unknown']);
  });

  it('is never written into the page’s code, and its key is used only by errorText', () => {
    const written = Object.entries(PAGE).filter(([, text]) => /(['"`])[^'"`\n]*went wrong[^'"`\n]*\1/i.test(text));
    const fallback = Object.entries(PAGE).filter(([, text]) => text.includes("'states.cause.unknown'"));
    expect(written.map(([file]) => file)).toEqual([]);
    expect(fallback.map(([file]) => file)).toEqual(['./state-message.ts']);
  });
});
