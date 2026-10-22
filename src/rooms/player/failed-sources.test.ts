import { describe, expect, it } from 'vitest';
import { addFailure, failedIn, failedLast, failuresIn, FAILURE_TTL_MS, parseFailures, removeFailure, sourceDigest, whereKey, type Failure } from './failed-sources';

const NOW = 1_800_000_000_000;

describe('sourceDigest', () => {
  it('never holds the URL, and tells sources apart', () => {
    const url = 'https://debrid.example/resolve/SECRETKEY123/abc/file.mkv';
    const digest = sourceDigest('Addon A', url);
    expect(digest).toMatch(/^[0-9a-f]{1,16}$/);
    expect(digest).not.toContain('SECRET');
    expect(sourceDigest('Addon A', url)).toBe(digest);
    expect(sourceDigest('Other', url)).not.toBe(digest);
    expect(sourceDigest('Addon A', `${url}?x`)).not.toBe(digest);
  });

  it('knows a torrent by its info hash, whatever trackers its magnet lists', () => {
    const a = 'magnet:?xt=urn:btih:ABCDEF0123&tr=udp://one';
    const b = 'magnet:?xt=urn:btih:abcdef0123&tr=udp://two&tr=udp://three';
    expect(sourceDigest('T', a)).toBe(sourceDigest('T', b));
  });
});

describe('whereKey', () => {
  it('names a movie or episode, hashing very long ids', () => {
    expect(whereKey('tt1', 'tt1:1:2')).toBe('tt1/tt1:1:2');
    expect(whereKey('tt1')).toBe('tt1/');
    expect(whereKey('x'.repeat(200))).toMatch(/^#[0-9a-f]+$/);
  });
});

describe('failure memory', () => {
  it('remembers failures per movie or episode, and forgets them after six hours', () => {
    let list: Failure[] = addFailure([], 'tt1/e1', 'aa', NOW);
    list = addFailure(list, 'tt1/e2', 'bb', NOW);
    expect([...failedIn(list, 'tt1/e1', NOW)]).toEqual(['aa']);
    expect([...failedIn(list, 'tt1/e1', NOW + FAILURE_TTL_MS - 1)]).toEqual(['aa']);
    expect(failedIn(list, 'tt1/e1', NOW + FAILURE_TTL_MS).size).toBe(0);
    expect([...failedIn(removeFailure(list, 'tt1/e2', 'bb'), 'tt1/e2', NOW)]).toEqual([]);
  });

  it('renews a repeated failure instead of adding it twice', () => {
    const list = addFailure(addFailure([], 'w', 'aa', NOW), 'w', 'aa', NOW + 5);
    expect(list).toEqual([['w', 'aa', NOW + 5]]);
  });

  it('remembers how a source failed, and renews it with the latest reason', () => {
    let list = addFailure([], 'w', 'aa', NOW, 'slow');
    list = addFailure(list, 'w', 'bb', NOW);
    expect(list).toEqual([
      ['w', 'aa', NOW, 'slow'],
      ['w', 'bb', NOW],
    ]);
    list = addFailure(list, 'w', 'aa', NOW + 5, 'placeholder');
    expect([...failuresIn(list, 'w', NOW + 5)]).toEqual([
      ['bb', undefined],
      ['aa', 'placeholder'],
    ]);
    expect(failuresIn(list, 'w', NOW + FAILURE_TTL_MS + 5).size).toBe(0);
    expect(failuresIn(list, 'other', NOW).size).toBe(0);
  });

  it('keeps the order but moves failed sources last', () => {
    expect(failedLast(['a', 'b', 'c', 'd'], (s) => s === 'a' || s === 'c')).toEqual(['b', 'd', 'a', 'c']);
    expect(failedLast(['a', 'b'], () => false)).toEqual(['a', 'b']);
  });
});

describe('parseFailures', () => {
  it('falls back to nothing on junk', () => {
    for (const junk of [null, undefined, 0, 'junk', true, {}, [1, 'a', null], JSON.parse('{"__proto__": {"x": 1}}')]) expect(parseFailures(junk, NOW)).toEqual([]);
  });

  it('drops bad, expired and future entries', () => {
    const saved = [
      ['tt1/', 'aa', NOW - 1000],
      ['tt1/', 'https://x', NOW],
      ['tt1/', 'bb', NOW - FAILURE_TTL_MS],
      ['tt1/', 'cc', NOW + 60_000],
      ['', 'dd', NOW],
      ['tt2/', 'ee', 'yesterday'],
      ['tt3/', 'ff', NOW],
    ];
    expect(parseFailures(saved, NOW)).toEqual([
      ['tt1/', 'aa', NOW - 1000],
      ['tt3/', 'ff', NOW],
    ]);
  });

  it('reads failures saved before reasons were kept, and keeps the reasons it knows', () => {
    const saved = [
      ['tt1/', 'aa', NOW],
      ['tt1/', 'bb', NOW, 'stalled'],
      ['tt1/', 'cc', NOW, 'exploded'],
      ['tt1/', 'dd', NOW, 42],
      ['tt1/', 'ee', NOW, 'failed', 'extra'],
    ];
    expect(parseFailures(saved, NOW)).toEqual([
      ['tt1/', 'aa', NOW],
      ['tt1/', 'bb', NOW, 'stalled'],
      ['tt1/', 'cc', NOW],
      ['tt1/', 'dd', NOW],
      ['tt1/', 'ee', NOW, 'failed'],
    ]);
  });
});
