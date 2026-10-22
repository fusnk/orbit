import { describe, expect, it } from 'vitest';
import { parsePastedLink } from './pasted-link';

const HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

describe('parsePastedLink', () => {
  it('reads web video addresses, named by their file or else their host', () => {
    expect(parsePastedLink('https://cdn.example.com/films/The.Matrix.1999.1080p.mkv')).toEqual({ kind: 'web', url: 'https://cdn.example.com/films/The.Matrix.1999.1080p.mkv', host: 'cdn.example.com', name: 'The Matrix (1999)' });
    expect(parsePastedLink('  http://192.168.1.5:8096/live/index.m3u8?token=abc  ')).toEqual({ kind: 'web', url: 'http://192.168.1.5:8096/live/index.m3u8?token=abc', host: '192.168.1.5:8096', name: '192.168.1.5:8096' });
    expect(parsePastedLink('HTTPS://Example.com/watch')).toMatchObject({ kind: 'web', host: 'example.com', name: 'example.com' });
    expect(parsePastedLink('https://example.com/a/My%20Film.mp4')).toMatchObject({ name: 'My Film' });
  });

  it('never shows a key in the path, query or login', () => {
    const link = parsePastedLink('https://user:secret@dl.example.com/d/SECRETKEY/index.m3u8?key=SECRET');
    expect(link).toMatchObject({ kind: 'web', host: 'dl.example.com', name: 'dl.example.com' });
    expect(JSON.stringify({ ...link, url: '' })).not.toMatch(/secret/i);
  });

  it('reads magnet links with a hex or base32 info hash', () => {
    expect(parsePastedLink(`magnet:?xt=urn:btih:${HASH}&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.example%3A80`)).toEqual({ kind: 'magnet', url: `magnet:?xt=urn:btih:${HASH}&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.example%3A80`, name: 'Big Buck Bunny' });
    expect(parsePastedLink('magnet:?xt=urn:btih:ZHNHGRVR3G5DJCFH7ZZ2YNEHAR4ZY6SA')).toMatchObject({ kind: 'magnet', name: null });
    // The scheme is given to Rust in lower case.
    expect(parsePastedLink(`MAGNET:?xt=urn:btih:${HASH}`)?.url).toBe(`magnet:?xt=urn:btih:${HASH}`);
  });

  it('refuses magnets without a usable info hash', () => {
    for (const text of ['magnet:?dn=Nothing', 'magnet:?xt=urn:btih:1234', 'magnet:?xt=urn:sha1:' + HASH, 'magnet:' + HASH]) expect(parsePastedLink(text), text).toBeNull();
  });

  it('refuses other schemes, searches and malformed text', () => {
    for (const text of [
      '',
      'the matrix',
      'tt0133093',
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'ftp://example.com/a.mkv',
      'rtmp://example.com/live',
      'data:video/mp4;base64,AAAA',
      'example.com/video.mp4',
      'https://',
      'https://exa mple.com/a.mkv',
      'https://example.com/a\tb.mkv',
      'ht\ttp://example.com/a.mkv',
      'https://example.com/a.mkv\nhttps://other.example/b.mkv',
    ]) {
      expect(parsePastedLink(text), JSON.stringify(text)).toBeNull();
    }
  });

  it('refuses addresses longer than the player accepts', () => {
    expect(parsePastedLink(`https://example.com/${'a'.repeat(8200)}`)).toBeNull();
  });

  it('strips control characters from a magnet name and caps its length', () => {
    const link = parsePastedLink(`magnet:?xt=urn:btih:${HASH}&dn=${'x'.repeat(300)}%07`);
    expect(link).toMatchObject({ kind: 'magnet' });
    expect(link?.name).toBe('x'.repeat(120));
  });
});
