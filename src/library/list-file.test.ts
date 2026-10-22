import { describe, expect, it } from 'vitest';
import type { Title } from '../catalog/titles';
import { freeListName, listFile, ListFileError, MAX_LIST_FILE_BYTES, parseListFile, sortListTitles } from './list-file';

const title = (id: string, name: string, year?: string, rating?: string): Title => ({ id, type: 'movie', name, genres: [], origins: [], ...(year ? { year } : {}), ...(rating ? { rating } : {}) });
const NOW = Date.parse('2026-10-14T12:00:00Z');

const problem = (text: string) => {
  try {
    parseListFile(text, NOW);
  } catch (err) {
    return err instanceof ListFileError ? err.problem : 'other';
  }
  return null;
};

describe('a list as a file', () => {
  it('reads back what it wrote', () => {
    const text = listFile({ name: 'Noir', description: 'Shadows and rain', titles: [title('tt1', 'Laura', '1944'), title('tt2', 'Gilda', '1946')], addedAt: new Map([['tt1', 5]]) }, NOW);
    const read = parseListFile(text, NOW);
    expect(read.name).toBe('Noir');
    expect(read.description).toBe('Shadows and rain');
    expect(read.skipped).toBe(0);
    expect(read.items.map((i) => [i.titleId, i.addedAt, i.title.meta.name])).toEqual([
      ['tt1', 5, 'Laura'],
      ['tt2', NOW, 'Gilda'],
    ]);
  });

  it('refuses what isn’t a list file', () => {
    expect(problem('not json')).toBe('not-json');
    expect(problem('{"name":"x","items":[]}')).toBe('not-a-list');
    expect(problem('{"orbitList":1,"name":"   ","items":[]}')).toBe('not-a-list');
    expect(problem('{"orbitList":2,"name":"x","items":[]}')).toBe('not-a-list');
    expect(problem('{"orbitList":1,"name":"x","items":[]}')).toBe('empty');
    expect(problem(' '.repeat(MAX_LIST_FILE_BYTES + 1))).toBe('too-large');
  });

  it('treats a file as untrusted: drops titles that don’t pass, cleans the text', () => {
    const good = { id: 'tt1', addedAt: 1, title: { meta: { id: 'tt1', type: 'movie', name: 'Film' } } };
    const text = JSON.stringify({
      orbitList: 1,
      name: `  Bad\nname ${'x'.repeat(80)}`,
      description: 'Line one\r\nline two',
      items: [
        good,
        good,
        // An insecure poster (kept without it); a title with no name, a snapshot of another title, and no id at all.
        { id: 'tt2', title: { meta: { id: 'tt2', type: 'movie', name: 'Two', poster: 'http://example.com/p.jpg' } } },
        { id: 'tt6', title: { meta: { id: 'tt6' } } },
        { id: 'tt3', title: { meta: { id: 'tt9', type: 'movie', name: 'Three' } } },
        { title: { meta: { id: 'tt4', type: 'movie', name: 'Four' } } },
        { id: 'tt8', addedAt: 1700000000000.75, title: { meta: { id: 'tt8', type: 'movie', name: 'Eight' } } },
        { id: 'tt5', addedAt: NOW * 2, title: { meta: { id: 'tt5', type: 'movie', name: 'Five' } } },
        // Valid, but larger than Rust stores one title: left out, not the whole list refused.
        { id: 'tt7', title: { meta: { id: 'tt7', type: 'movie', name: 'Seven' }, origins: [{ key: 'k', name: 'x'.repeat(20_000) }] } },
      ],
    });
    const read = parseListFile(text, NOW);
    expect(read.name.length).toBeLessThanOrEqual(40);
    expect(read.name.startsWith('Bad name')).toBe(true);
    expect(read.description).toBe('Line one line two');
    expect(read.items.map((i) => i.titleId)).toEqual(['tt1', 'tt2', 'tt8', 'tt5']);
    expect(read.items[1]!.title.meta.poster).toBeUndefined();
    expect(read.items[2]!.addedAt).toBe(1700000000000);
    expect(read.items[3]!.addedAt).toBe(NOW);
    expect(read.skipped).toBe(4);
  });

  it('numbers a name already in use', () => {
    expect(freeListName('Noir', ['Comedy'])).toBe('Noir');
    expect(freeListName('Noir', ['noir', 'Noir (2)'])).toBe('Noir (3)');
    expect(freeListName('x'.repeat(40), ['x'.repeat(40)])).toBe(`${'x'.repeat(36)} (2)`);
  });
});

describe('sorting a list', () => {
  const titles = [title('a', 'Zodiac', '2007', '7.7'), title('b', 'alien', '1979', '8.5'), title('c', 'Brick'), title('d', 'Arrival', '2016', '7.9')];
  const ids = (list: Title[]) => list.map((t) => t.id).join('');

  it('keeps the order added, or sorts by name, year or rating with unknowns last', () => {
    expect(ids(sortListTitles(titles, 'added', 'en'))).toBe('abcd');
    expect(ids(sortListTitles(titles, 'title', 'en'))).toBe('bdca');
    expect(ids(sortListTitles(titles, 'year', 'en'))).toBe('dabc');
    expect(ids(sortListTitles(titles, 'rating', 'en'))).toBe('bdac');
  });
});
