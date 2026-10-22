import { describe, expect, it } from 'vitest';
import { MAX_HEADER_VALUE, MAX_PROXY_HEADERS, allowedHeader, requestHeaders } from './proxy-headers';

describe('requestHeaders', () => {
  it('keeps plain headers as given', () => {
    expect(requestHeaders({ Referer: 'https://site.example/watch?v=1', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', Origin: 'https://site.example' })).toEqual({
      Referer: 'https://site.example/watch?v=1',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
      Origin: 'https://site.example',
    });
  });

  it('is undefined for anything but an object with headers left', () => {
    for (const raw of [undefined, null, 'Referer: x', 42, ['Referer', 'x'], {}, { Host: 'evil.example' }]) expect(requestHeaders(raw)).toBeUndefined();
  });

  it('drops values that could end a header line or carry odd bytes', () => {
    for (const value of ['a\r\nHost: evil', 'a\nb', 'a\rb', 'a\0b', 'a\tb', 'a\u007f', 'café', ' padded', 'padded ', '', 7, null, { x: 1 }]) {
      expect(requestHeaders({ Referer: value, 'X-Ok': '1' })).toEqual({ 'X-Ok': '1' });
    }
  });

  it('drops names that are not HTTP tokens', () => {
    for (const name of ['Bad Name', 'Bad:Name', 'X\r\nY', 'Ünicode', 'a(b)', 'a/b', '']) expect(allowedHeader(name, 'x')).toBe(false);
  });

  it('refuses connection-control, request-steering and credential headers in any case', () => {
    for (const name of ['Host', 'content-length', 'Transfer-Encoding', 'Connection', 'keep-alive', 'Upgrade', 'TE', 'Range', 'Expect', 'Proxy-Authorization', 'proxy-connection', 'Cookie', 'AUTHORIZATION', 'Accept-Encoding']) {
      expect(allowedHeader(name, 'x')).toBe(false);
    }
    expect(allowedHeader('Accept-Language', 'en')).toBe(true);
  });

  it('keeps the first of names repeated in another case', () => {
    expect(requestHeaders({ Referer: 'https://a.example/', referer: 'https://b.example/' })).toEqual({ Referer: 'https://a.example/' });
  });

  it('caps how many and how long', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`X-H${i}`, 'v']));
    expect(Object.keys(requestHeaders(many) ?? {})).toHaveLength(MAX_PROXY_HEADERS);
    expect(requestHeaders({ 'X-Long': 'v'.repeat(MAX_HEADER_VALUE + 1) })).toBeUndefined();
    expect(requestHeaders({ ['X'.repeat(65)]: 'v' })).toBeUndefined();
    // 4 KB in all: four near-1 KB headers fit, the fifth doesn't.
    const big = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`X-H${i}`, 'v'.repeat(MAX_HEADER_VALUE - 10)]));
    expect(Object.keys(requestHeaders(big) ?? {})).toHaveLength(4);
  });

  it('keeps a "__proto__" name as a plain key', () => {
    const raw = JSON.parse('{"__proto__": "x", "Referer": "https://a.example/"}') as unknown;
    const headers = requestHeaders(raw);
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
    expect(Object.keys(headers ?? {})).toEqual(['__proto__', 'Referer']);
  });
});
