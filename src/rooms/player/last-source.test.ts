import { describe, expect, it } from 'vitest';
import { findLast, lastIn, lastSourceOf, MAX_LAST_SOURCES, nameDigest, parseLastSources, rememberLast } from './last-source';
import type { PlayableSource } from './panels';

const source = (id: string, url: string, extra: Partial<PlayableSource> = {}): PlayableSource => ({ id, url, addon: 'Addon D', label: '1080p', meta: 'HDR10 · 4.2 GB', ...extra });

describe('last source', () => {
  it('never keeps the address, only digests and what the picker shows', () => {
    const entry = lastSourceOf('tt1/', source('n1', 'https://debrid.example/resolve/SECRETKEY/abc', { filename: 'Movie.2024.1080p-GRP.mkv', videoSize: 4_200_000_000 }), 1000);
    expect(JSON.stringify(entry)).not.toContain('SECRETKEY');
    expect(JSON.stringify(entry)).not.toContain('debrid.example');
    expect(entry).toMatchObject({ where: 'tt1/', addon: 'Addon D', label: '1080p', meta: 'HDR10 · 4.2 GB', filename: 'Movie.2024.1080p-GRP.mkv', at: 1000 });
    expect(entry.digest).toMatch(/^[0-9a-f]+$/);
    expect(entry.name).toMatch(/^[0-9a-f]+$/);
  });

  it('finds the same source again by address, else by release when links change', () => {
    const last = lastSourceOf('tt1/', source('n1', 'https://a/1', { filename: 'Movie-GRP.mkv', videoSize: 5 }), 1);
    const again = [source('n1', 'https://a/0'), source('n2', 'https://a/1')];
    expect(findLast(again, last)?.id).toBe('n2');
    const changed = [source('n1', 'https://a/new', { filename: 'Movie-GRP.mkv', videoSize: 6 }), source('n2', 'https://a/newer', { filename: 'Movie-GRP.mkv', videoSize: 5 })];
    expect(findLast(changed, last)?.id).toBe('n2');
    expect(findLast([source('n1', 'https://a/2')], last)).toBeUndefined();
    // Without a file name there's nothing to recognise a changed link by.
    expect(nameDigest('A', undefined, 5)).toBe('');
    expect(findLast([source('n1', 'https://a/2')], lastSourceOf('tt1/', source('n1', 'https://a/1'), 1))).toBeUndefined();
  });

  it('keeps one entry per movie or episode, the newest, up to the cap', () => {
    let list = rememberLast([], lastSourceOf('a/', source('1', 'u1'), 1));
    list = rememberLast(list, lastSourceOf('a/', source('2', 'u2'), 2));
    expect(list).toHaveLength(1);
    expect(lastIn(list, 'a/')?.at).toBe(2);
    for (let i = 0; i < MAX_LAST_SOURCES + 10; i++) list = rememberLast(list, lastSourceOf(`t${i}/`, source('1', 'u'), i));
    expect(list).toHaveLength(MAX_LAST_SOURCES);
    expect(lastIn(list, 'a/')).toBeUndefined();
  });

  it('drops junk when reading', () => {
    const good = lastSourceOf('tt1/', source('1', 'u'), 5);
    for (const junk of [null, 'x', {}, [1, 'a', null]]) expect(parseLastSources(junk)).toEqual([]);
    expect(parseLastSources([{ ...good, digest: 'not hex' }, good])).toEqual([good]);
    expect(parseLastSources([good, { ...good, at: 9 }])).toEqual([{ ...good, at: 9 }]);
  });
});
