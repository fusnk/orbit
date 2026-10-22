import { describe, expect, it } from 'vitest';
import page from '../../src-tauri/src/remote/page/remote.js?raw';
import { en } from '../i18n/locales/en';
import { foundTitles, MAX_REMOTE_RESULTS, parseRemoteCommand, phoneKeys, pickDetails, pickTitle, qrPath } from './remote';

describe('phone remote commands', () => {
  it('reads every command Rust sends', () => {
    expect(parseRemoteCommand({ kind: 'pause', on: true })).toEqual({ kind: 'pause', on: true });
    expect(parseRemoteCommand({ kind: 'seek-by', seconds: -10 })).toEqual({ kind: 'seek-by', seconds: -10 });
    expect(parseRemoteCommand({ kind: 'subtitle', id: null })).toEqual({ kind: 'subtitle', id: null });
    expect(parseRemoteCommand({ kind: 'nav', key: 'ok' })).toEqual({ kind: 'nav', key: 'ok' });
    expect(parseRemoteCommand({ kind: 'search', id: 3, query: 'dune' })).toEqual({ kind: 'search', id: 3, query: 'dune' });
    expect(parseRemoteCommand({ kind: 'open', search: 3, index: 0, play: true })).toEqual({ kind: 'open', search: 3, index: 0, play: true });
  });

  it('refuses anything else', () => {
    for (const payload of [
      null,
      'stop',
      {},
      { kind: 'eval', code: '1' },
      { kind: 'nav', key: 'home' },
      { kind: 'volume', level: 400 },
      { kind: 'seek-to', seconds: -5 },
      { kind: 'seek-by', seconds: Number.NaN },
      { kind: 'audio', id: 1.5 },
      { kind: 'open', search: 1, index: -1, play: true },
      { kind: 'search', id: 1, query: '' },
    ]) {
      expect(parseRemoteCommand(payload), JSON.stringify(payload)).toBeNull();
    }
  });
});

describe('phone remote picker commands', () => {
  it('reads the picker’s commands', () => {
    expect(parseRemoteCommand({ kind: 'browse', id: 4 })).toEqual({ kind: 'browse', id: 4 });
    expect(parseRemoteCommand({ kind: 'mood', id: 5, mood: 'feel-good' })).toEqual({ kind: 'mood', id: 5, mood: 'feel-good' });
    expect(parseRemoteCommand({ kind: 'surprise', id: 6, media: 'series' })).toEqual({ kind: 'surprise', id: 6, media: 'series' });
    expect(parseRemoteCommand({ kind: 'details', id: 7, from: 'home', shelf: 4, row: 1, index: 2 })).toEqual({ kind: 'details', id: 7, from: 'home', shelf: 4, row: 1, index: 2 });
    expect(parseRemoteCommand({ kind: 'pick', from: 'mood', shelf: 5, row: 0, index: 3, action: 'add' })).toEqual({ kind: 'pick', from: 'mood', shelf: 5, row: 0, index: 3, action: 'add' });
  });

  it('refuses odd ones', () => {
    for (const payload of [
      { kind: 'browse' },
      { kind: 'browse', id: -1 },
      { kind: 'mood', id: 1, mood: '' },
      { kind: 'mood', id: 1, mood: 'x'.repeat(33) },
      { kind: 'surprise', id: 1, media: 'episode' },
      { kind: 'details', id: 1, from: 'library', shelf: 1, row: 0, index: 0 },
      { kind: 'details', id: 1, from: 'home', shelf: 1, row: 0.5, index: 0 },
      { kind: 'pick', from: 'home', shelf: 1, row: 0, index: 0, action: 'delete' },
      { kind: 'pick', from: 'home', row: 0, index: 0, action: 'play' },
    ]) {
      expect(parseRemoteCommand(payload), JSON.stringify(payload)).toBeNull();
    }
  });
});

describe('phone remote picker titles', () => {
  it('keeps what the phone shows, and the poster for Rust to fetch', () => {
    expect(pickTitle({ name: 'Dune', type: 'movie', year: '2021', rating: '8.0', poster: 'https://img.example/d.jpg' })).toEqual({ name: 'Dune', year: '2021', kind: 'movie', rating: '8.0', poster: 'https://img.example/d.jpg' });
    expect(pickTitle({ name: 'Show', type: 'series' })).toEqual({ name: 'Show', year: null, kind: 'series', rating: null, poster: null });
  });

  it('caps the episode list as Rust does, and leaves out numbers Rust can’t read', () => {
    const seasons = Array.from({ length: 80 }, (_, s) => ({ number: s + 1, episodes: Array.from({ length: 30 }, (_, e) => ({ number: e + 1, title: `E${e + 1}` })) }));
    seasons.unshift({ number: -1, episodes: [{ number: 1, title: 'Odd' }] }, { number: 0, episodes: [{ number: 1.5, title: 'Half' }, { number: 1, title: 'Special' }] });
    const details = pickDetails({ name: 'Show', type: 'series', description: 'About it', seasons }, '45 min', true);
    expect(details.seasons).toHaveLength(60);
    expect(details.seasons[0]).toEqual({ number: 0, episodes: [{ number: 1, name: 'Special' }] });
    expect(details.seasons.reduce((n, s) => n + s.episodes.length, 0)).toBe(1000);
    expect(details).toMatchObject({ name: 'Show', runtime: '45 min', description: 'About it', inLibrary: true });
    const many = [{ number: 1, episodes: Array.from({ length: 1500 }, (_, e) => ({ number: e + 1, title: 'x' })) }, { number: 2, episodes: [{ number: 1, title: 'y' }] }];
    expect(pickDetails({ name: 'Long', type: 'series', seasons: many }, undefined, false).seasons.map((s) => s.episodes.length)).toEqual([1000, 0]);
  });
});

describe('phone remote search results', () => {
  it('keeps the name, year, kind and poster, at most the cap', () => {
    const titles = Array.from({ length: 30 }, (_, i) => ({ id: `tt${i}`, name: `Film ${i}`, type: 'movie', year: '2020', poster: 'https://img.example/p.jpg', genres: [] }));
    const found = foundTitles(titles);
    expect(found).toHaveLength(MAX_REMOTE_RESULTS);
    expect(found[0]).toEqual({ name: 'Film 0', year: '2020', kind: 'movie', poster: 'https://img.example/p.jpg' });
    expect(foundTitles([{ name: 'Show', type: 'series' }])).toEqual([{ name: 'Show', year: null, kind: 'series', poster: null }]);
  });
});

describe('phone remote strings', () => {
  it('sends the phone only its own strings, and enough of them', () => {
    const keys = phoneKeys(Object.keys(en));
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.every((k) => k.startsWith('remote.phone.'))).toBe(true);
    expect(keys).not.toContain('remote.settings.heading');
    // Rust takes up to 120, each key at most 64 characters of [a-z0-9._-].
    expect(keys.length).toBeLessThanOrEqual(120);
    expect(keys.every((k) => k.length <= 64 && /^[a-z0-9._-]+$/.test(k))).toBe(true);
  });

  it('has every word the phone page asks for (it would show the bare key)', () => {
    const asked = [...page.matchAll(/\bt\('([a-z0-9-]+)'/g)].map((m) => `remote.phone.${m[1]}`);
    expect(asked.length).toBeGreaterThan(20);
    expect(asked.filter((key) => !Object.hasOwn(en, key))).toEqual([]);
  });
});

describe('pairing QR code', () => {
  it('draws one square per run of dark modules', () => {
    expect(qrPath(2, '1101')).toBe('M0 0h2v1h-2zM1 1h1v1h-1z');
    expect(qrPath(3, '000000000')).toBe('');
    expect(qrPath(3, '1')).toBe('');
  });
});
