import { describe, expect, it } from 'vitest';
import { EMPTY_TTL_MS, linkTtl, SIGNED_TTL_MS, STREAM_TTL_MS, streamTtl } from './stream-cache';

const NOW = Date.parse('2026-10-05T12:00:00Z');

describe('stream result lifetimes', () => {
  it('keeps plain links for hours', () => {
    expect(linkTtl('https://addon.example/resolve/realdebrid/abc/1/file.mkv', NOW)).toBe(STREAM_TTL_MS);
    expect(linkTtl('magnet:?xt=urn:btih:abc&tr=udp://x', NOW)).toBe(STREAM_TTL_MS);
    expect(linkTtl('https://cdn.example/file.mkv?quality=1080', NOW)).toBe(STREAM_TTL_MS);
  });

  it('keeps signed or expiring links briefly', () => {
    for (const query of ['token=abc', 'sig=1', 'Signature=x&Key-Pair-Id=y', 'X-Amz-Signature=z', 'exp=soon', 'Expires=tomorrow']) {
      expect(linkTtl(`https://cdn.example/file.mkv?${query}`, NOW)).toBe(SIGNED_TTL_MS);
    }
  });

  it('drops a link a few minutes before the expiry it states', () => {
    const inTenMinutes = Math.floor((NOW + 10 * 60_000) / 1000);
    expect(linkTtl(`https://cdn.example/f.mkv?expires=${inTenMinutes}`, NOW)).toBe(5 * 60_000);
    const gone = Math.floor((NOW - 60_000) / 1000);
    expect(linkTtl(`https://cdn.example/f.mkv?exp=${gone}`, NOW)).toBe(0);
    // A far expiry still keeps it no longer than any signed link.
    expect(linkTtl(`https://cdn.example/f.mkv?expires=${Math.floor(NOW / 1000) + 86_400}`, NOW)).toBe(SIGNED_TTL_MS);
  });

  it('lets the shortest-lived link decide, and keeps nothing found for a minute', () => {
    expect(streamTtl(['https://a.example/1.mkv', 'https://b.example/2.mkv?token=x'], NOW)).toBe(SIGNED_TTL_MS);
    expect(streamTtl(['https://a.example/1.mkv'], NOW)).toBe(STREAM_TTL_MS);
    expect(streamTtl([], NOW)).toBe(EMPTY_TTL_MS);
  });
});
