import { describe, expect, it } from 'vitest';
import { ManifestSchema, parseWith } from '../addons/schema';
import type { UsableAddon } from '../addons/types';
import { addRecent, MAX_RECENT, matchTier, mergeResults, parseRecent, queryYear, recentSearches, rankResults, searchableCatalogs, lenientQuery, searchLeniently } from './search';
import type { Title } from './titles';

const addon = (key: string, catalogs: object[]): UsableAddon => ({
  key,
  manifest: parseWith(ManifestSchema, { id: key, version: '1.0.0', name: key, types: ['movie', 'series'], resources: ['catalog'], catalogs }),
  displayHost: `${key}.example`,
  enabled: true,
  installedAt: 0,
  urlReadable: true,
  builtIn: false,
  owned: true,
  shared: false,
  sharedBy: null,
});

const title = (id: string, origin: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [{ key: origin, name: origin }] });

describe('searchableCatalogs', () => {
  it('keeps movie/series catalogs with a search extra and no other required input', () => {
    const refs = searchableCatalogs([
      addon('a', [
        { type: 'movie', id: 'top', extra: [{ name: 'search' }, { name: 'genre' }] },
        { type: 'series', id: 'search', extra: [{ name: 'search', isRequired: true }] },
        { type: 'movie', id: 'year', extra: [{ name: 'genre', isRequired: true }] },
        { type: 'movie', id: 'needs-both', extra: [{ name: 'search' }, { name: 'region', isRequired: true }] },
        { type: 'channel', id: 'tv', extra: [{ name: 'search' }] },
      ]),
    ]);
    expect(refs.map((r) => `${r.catalog.type}/${r.catalog.id}`)).toEqual(['movie/top', 'series/search']);
  });

  it('asks anime addons (Kitsu, MyAnimeList) too: their "anime" catalogs are TV shows', () => {
    const refs = searchableCatalogs([addon('kitsu', [{ type: 'anime', id: 'kitsu-anime-list', extra: [{ name: 'search', isRequired: true }] }])]);
    expect(refs.map((r) => `${r.catalog.type}/${r.catalog.id}`)).toEqual(['anime/kitsu-anime-list']);
  });
});

describe('mergeResults', () => {
  it('dedupes by id in addon order and records every source', () => {
    const merged = mergeResults([
      [title('tt1', 'cinemeta'), title('tt2', 'cinemeta')],
      [title('tt2', 'other'), title('tt3', 'other')],
    ]);
    expect(merged.map((t) => t.id)).toEqual(['tt1', 'tt2', 'tt3']);
    expect(merged[1]!.origins.map((o) => o.key)).toEqual(['cinemeta', 'other']);
  });
});

describe('recent searches', () => {
  it('drops malformed stored values', () => {
    expect(parseRecent('nope')).toEqual([]);
    expect(parseRecent(['dune', 3, '  ', null, 'alien'])).toEqual(['dune', 'alien']);
  });

  it('moves a repeated query to the front, ignoring case, and caps the list', () => {
    expect(addRecent(['dune', 'alien'], ' Alien ')).toEqual(['Alien', 'dune']);
    expect(addRecent(['dune'], '   ')).toEqual(['dune']);
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `q${i}`);
    expect(addRecent(full, 'new')).toEqual(['new', ...full.slice(0, MAX_RECENT - 1)]);
  });

  it('keeps a search made before the saved list has loaded', async () => {
    let load!: (saved: { key: string; value: unknown }) => void;
    const saves: [string, string[]][] = [];
    const recent = recentSearches(new Promise((resolve) => (load = resolve)), async (key, list) => void saves.push([key, list]));
    const added = recent.add('new');
    load({ key: 'search.recent.p1', value: ['old'] });
    await added;
    expect(recent.list).toEqual(['new', 'old']);
    expect(saves).toEqual([['search.recent.p1', ['new', 'old']]]);
    await recent.set([]);
    expect(recent.list).toEqual([]);
    expect(saves.at(-1)).toEqual(['search.recent.p1', []]);
  });
});

describe('rankResults', () => {
  const named = (...names: string[]) => names.map((name, i) => ({ ...title(`id${i}`, 'a'), name }));

  it('puts exact and prefix matches first, keeping addon order for the rest', () => {
    const ranked = rankResults(named('Interstellar', 'Santee', 'Sintel: The Making Of', 'Sintel', 'The Sintel Story'), 'sintel');
    expect(ranked.map((t) => t.name)).toEqual(['Sintel', 'The Sintel Story', 'Sintel: The Making Of', 'Interstellar', 'Santee']);
  });

  it('within a tier, puts known titles first, then the ones that add the fewest words', () => {
    const titles = [
      { ...title('a', 'a'), name: 'Game of Thrones: The Last Watch' },
      { ...title('b', 'a'), name: 'Game of Thrones: The IMAX Experience' },
      { ...title('c', 'a'), name: 'Game of Thrones: A Day in the Life', rating: '7.8' },
      { ...title('d', 'a'), name: 'Unaired Game of Thrones Prequel Pilot' },
      { ...title('e', 's'), name: 'Game of Thrones', rating: '9.2' },
    ];
    expect(rankResults(titles, 'game of thr').map((t) => t.id)).toEqual(['e', 'c', 'a', 'b', 'd']);
    expect(rankResults(titles, 'game of t')[0]?.id).toBe('e');
  });

  it('ignores case, accents and punctuation', () => {
    expect(rankResults(named('Other', 'Amélie'), 'amelie')[0]?.name).toBe('Amélie');
    expect(rankResults(named('Other', 'Spider-Man'), 'spider man')[0]?.name).toBe('Spider-Man');
  });

  it('ranks exact, then without a leading article, prefix, phrase and all words', () => {
    const ranked = rankResults(named('Knight and Day', 'Dark Night', 'The Dark Knight Rises', 'Batman: The Dark Knight', 'Knight Dark', 'The Dark Knight', 'Dark Knight'), 'dark knight');
    expect(ranked.map((t) => t.name)).toEqual(['Dark Knight', 'The Dark Knight', 'The Dark Knight Rises', 'Batman: The Dark Knight', 'Knight Dark', 'Knight and Day', 'Dark Night']);
    expect(matchTier('Matrix', 'the matrix')).toBe(1);
  });

  it('puts the year asked for first among matching titles', () => {
    const titles = [
      { ...title('a', 'a'), name: 'Dune', year: '1984' },
      { ...title('b', 'a'), name: 'Dune', year: '2021' },
      { ...title('c', 'a'), name: 'Other', year: '2021' },
    ];
    expect(rankResults(titles, 'dune 2021', 2026).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(rankResults(titles, '2021 dune', 2026).map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps a title named by the whole query, year and all, above the year boost', () => {
    const titles = [
      { ...title('a', 'a'), name: 'Office Space', year: '1999' },
      { ...title('b', 'a'), name: 'Space: 1999', year: '1975' },
    ];
    expect(rankResults(titles, 'space 1999', 2026).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('only treats plausible years beside other words as a year', () => {
    expect(queryYear('dune 2021', 2026)).toEqual({ rest: 'dune', year: '2021' });
    expect(queryYear('2012', 2026)).toBeNull();
    expect(queryYear('Blade Runner 2049', 2026)).toBeNull();
    expect(matchTier('Blade Runner 2049', 'blade runner 2049', 2026)).toBe(0);
  });
});

describe('lenientQuery', () => {
  it('drops a year, or accents and punctuation', () => {
    expect(lenientQuery('Dune 2021', 2026)).toBe('dune');
    expect(lenientQuery('Amélie', 2026)).toBe('amelie');
    expect(lenientQuery('spider-man: no way home', 2026)).toBe('spider man no way home');
  });

  it('gives nothing when it would search the same again', () => {
    expect(lenientQuery('dune', 2026)).toBeNull();
    expect(lenientQuery('  Heat ', 2026)).toBeNull();
    expect(lenientQuery('!!!', 2026)).toBeNull();
  });
});

describe('searchLeniently', () => {
  it('tries a looser query once when nothing was found', async () => {
    const asked: string[] = [];
    const found = await searchLeniently('Amélie', async (words) => {
      asked.push(words);
      return { titles: words === 'amelie' ? ['hit'] : [], allFailed: false };
    });
    expect(asked).toEqual(['Amélie', 'amelie']);
    expect(found.titles).toEqual(['hit']);
  });

  it("doesn't ask again when every addon failed (offline, all timing out)", async () => {
    const asked: string[] = [];
    await searchLeniently('Amélie', async (words) => {
      asked.push(words);
      return { titles: [], allFailed: true };
    });
    expect(asked).toEqual(['Amélie']);
  });
});

describe('non-Latin searches', () => {
  it('keeps the marks that are part of a word in other scripts', () => {
    // Japanese voicing marks, Hindi vowel signs and Korean syllables aren't accents to drop.
    expect(lenientQuery('ガンダム', 2026)).toBeNull();
    expect(lenientQuery('दंगल', 2026)).toBeNull();
    expect(lenientQuery('기생충', 2026)).toBeNull();
    expect(lenientQuery('ガンダム 1979', 2026)).toBe('ガンダム');
    expect(lenientQuery('기생충 2019', 2026)).toBe('기생충');
  });

  it("doesn't match a different word that only differs by those marks", () => {
    // ガンダム (Gundam) and カンタム aren't the same title.
    expect(matchTier('カンタム', 'ガンダム')).toBe(5);
    expect(matchTier('ガンダム', 'ガンダム')).toBe(0);
  });
});

describe('searches in scripts written without spaces', () => {
  it('counts a title containing the words as a match', () => {
    // 巨人 is a word inside 進撃の巨人 (Attack on Titan), which a search for it should find before loose matches.
    expect(matchTier('進撃の巨人', '巨人')).toBe(3);
    const ranked = rankResults([{ name: 'Unrelated' }, { name: '進撃の巨人' }, { name: '巨人の星' }], '巨人');
    expect(ranked.map((t) => t.name)).toEqual(['巨人の星', '進撃の巨人', 'Unrelated']);
  });
});
