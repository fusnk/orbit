import { describe, expect, it } from 'vitest';
import type { ManifestCatalog, UsableAddon } from '../../addons/types';
import { animeRequest, isAnimeCatalog, pageSources, positionIn, sameGridView, TMDB_ANIME, tmdbAnimeSource, type PageSetup } from './sources';

const genre = (options: string[], isRequired = false) => ({ name: 'genre', isRequired, options, optionsLimit: 1 });
const catalog = (type: string, id: string, extra: ManifestCatalog['extra'] = []): ManifestCatalog => ({ type, id, name: id, extra });
const addon = (key: string, id: string, catalogs: ManifestCatalog[]) => ({ key, manifest: { id, name: key, catalogs } }) as unknown as UsableAddon;

const cinemeta = addon('Cinemeta', 'com.linvo.cinemeta', [
  catalog('movie', 'top', [genre(['Action', 'Animation'])]),
  catalog('series', 'top', [genre(['Action', 'Animation'])]),
  catalog('movie', 'year', [genre(['2026', '2025'], true)]),
  catalog('series', 'imdbRating', [genre(['Animation'])]),
  catalog('series', 'calendar-videos', [{ name: 'calendarVideosIds', isRequired: true, options: undefined, optionsLimit: 1 }]),
]);
const kitsu = addon('Anime Kitsu', 'org.stremio.animekitsu', [catalog('anime', 'kitsu-anime-trending', [genre(['Action'])]), catalog('anime', 'kitsu-anime-airing')]);
const streams = addon('Streams', 'org.example.streams', [catalog('other', 'mal-like'), catalog('movie', 'animal-planet')]);

const ANIME: PageSetup = { types: ['series', 'movie'], genre: 'Animation', anime: true };

describe('Discover sources', () => {
  it('Movies and TV Shows browse their own type, without catalogs that need more than a genre', () => {
    const [movies] = pageSources({ types: ['movie'] }, [cinemeta], true);
    expect(movies?.catalogs.map((c) => c.id)).toEqual(['top', 'year']);
    expect(movies?.genre).toBeUndefined();
    expect(pageSources({ types: ['series'] }, [cinemeta, kitsu], true).map((s) => s.key)).toEqual(['Cinemeta']);
  });

  it('Anime prefers anime addons, then TMDB, and never mixes in Cinemeta then', () => {
    const sources = pageSources(ANIME, [cinemeta, kitsu, streams], true);
    expect(sources.map((s) => s.key)).toEqual(['Anime Kitsu', TMDB_ANIME]);
    expect(sources[0]?.catalogs.map((c) => c.id)).toEqual(['kitsu-anime-trending', 'kitsu-anime-airing']);
    expect(sources.every((s) => s.genre === undefined)).toBe(true);
    expect(pageSources(ANIME, [cinemeta], true).map((s) => s.key)).toEqual([TMDB_ANIME]);
  });

  it('Anime without TMDB or an anime addon falls back to Cinemeta, locked to Animation, shows first', () => {
    const [fallback, ...rest] = pageSources(ANIME, [cinemeta, streams], false);
    expect(rest).toEqual([]);
    expect(fallback?.genre).toBe('Animation');
    // "New" is keyed by year (no Animation option), so it isn't offered.
    expect(fallback?.catalogs.map((c) => `${c.type}:${c.id}`)).toEqual(['series:top', 'series:imdbRating', 'movie:top']);
  });

  it('recognises anime catalogs by type or by an anime database name, not by look-alike words', () => {
    expect(isAnimeCatalog(catalog('anime', 'x'), streams)).toBe(true);
    expect(isAnimeCatalog(catalog('series', 'mal_airing'), streams)).toBe(true);
    expect(isAnimeCatalog(catalog('series', 'anilist.trending'), streams)).toBe(true);
    expect(isAnimeCatalog(catalog('movie', 'animal-planet'), streams)).toBe(false);
    expect(isAnimeCatalog(catalog('series', 'normal'), streams)).toBe(false);
    expect(isAnimeCatalog(catalog('other', 'mal-like'), streams)).toBe(false);
  });

  it("TMDB's anime: shows first, each catalog with genres to pick", () => {
    const source = tmdbAnimeSource();
    expect(source.catalogs.map((c) => c.id)).toEqual(['anime-tv-popular', 'anime-tv-airing', 'anime-tv-top', 'anime-tv-new', 'anime-movie-popular', 'anime-movie-top', 'anime-movie-new']);
    expect(source.catalogs[0]?.type).toBe('series');
    expect(source.catalogs[4]?.type).toBe('movie');
    const options = source.catalogs[0]?.extra[0]?.options ?? [];
    expect(options).toContain('Action');
    expect(options).not.toContain('Animation');
    // TMDB's shows have no Horror genre; its films do.
    expect(options).not.toContain('Horror');
    expect(source.catalogs[4]?.extra[0]?.options).toContain('Horror');
  });

  it('asks TMDB for animation with the anime keyword, plus the picked genre', () => {
    expect(animeRequest('anime-tv-popular', undefined, '2026-10-07')).toEqual({ kind: 'discover', media: 'tv', sort: 'popularity.desc', filters: { withGenres: '16', withKeywords: '210024', withoutKeywords: '155477,198385,256466,325693,378816' } });
    expect(animeRequest('anime-tv-airing', 'Action', '2026-10-07')).toEqual({
      kind: 'discover',
      media: 'tv',
      sort: 'popularity.desc',
      filters: { withGenres: '16,10759', withKeywords: '210024', withoutKeywords: '155477,198385,256466,325693,378816', airDateGte: '2026-10-07', airDateLte: '2026-10-14' },
    });
    expect(animeRequest('anime-movie-new', 'Romance', '2026-10-07')?.filters).toMatchObject({ withGenres: '16,10749', withKeywords: '210024', releaseDateGte: '2025-10-07', releaseDateLte: '2026-10-07' });
    expect(animeRequest('anime-movie-top', undefined, '2026-10-07')).toMatchObject({ media: 'movie', sort: 'vote_average.desc', filters: { voteCountGte: 150 } });
    // A genre it didn't offer, or an unknown catalog, asks for nothing.
    expect(animeRequest('anime-tv-popular', 'Horror', '2026-10-07')).toBeNull();
    expect(animeRequest('top', undefined, '2026-10-07')).toBeNull();
  });
});

describe('following an addon change', () => {
  const view = (addons: UsableAddon[], catalogId: string, genre?: string) => {
    const source = pageSources({ types: ['movie'] }, addons, false)[0]!;
    return { source, catalog: source.catalogs.find((c) => c.id === catalogId), genre };
  };

  it('keeps the grid when another addon came or went and its own catalog is as it was', () => {
    // Rebuilt from fresh manifests: equal by value, not the same objects.
    const fresh = addon('Cinemeta', 'com.linvo.cinemeta', [catalog('movie', 'top', [genre(['Action', 'Animation'])]), catalog('movie', 'year', [genre(['2026', '2025'], true)])]);
    expect(sameGridView(view([cinemeta], 'top', 'Action'), view([fresh, kitsu], 'top', 'Action'))).toBe(true);
  });

  it('starts the grid over when the source, catalog, its definition or the genre changed', () => {
    const before = view([cinemeta], 'top', 'Action');
    expect(sameGridView(before, view([streams, cinemeta], 'animal-planet'))).toBe(false);
    expect(sameGridView(before, view([cinemeta], 'year', 'Action'))).toBe(false);
    expect(sameGridView(before, view([cinemeta], 'top'))).toBe(false);
    const changed = addon('Cinemeta', 'com.linvo.cinemeta', [catalog('movie', 'top', [genre(['Action'])])]);
    expect(sameGridView(before, view([changed], 'top', 'Action'))).toBe(false);
  });
});

describe('opening at a position', () => {
  const other = addon('Other', 'org.example.other', [catalog('movie', 'top', [genre(['Drama'])]), catalog('movie', 'new', [genre(['Comedy'])])]);
  const sources = pageSources({ types: ['movie'] }, [cinemeta, other], false);
  const at = (view: ReturnType<typeof positionIn>) => view && [view.source.key, view.catalog?.id, view.genre];

  it("opens the addon's catalog on the genre asked for", () => {
    expect(at(positionIn(sources, { addonKey: 'Other', catalogId: 'new', genre: 'Comedy' }))).toEqual(['Other', 'new', 'Comedy']);
  });

  it("falls back without the missing addon's catalog or genre", () => {
    // Cinemeta has a "top" too, but not this addon's Comedy.
    expect(at(positionIn(sources, { addonKey: 'Gone', catalogId: 'new', genre: 'Comedy' }))).toEqual(['Cinemeta', 'top', undefined]);
    expect(at(positionIn(sources, { addonKey: 'Gone', catalogId: 'year' }, { source: sources[1]!, catalog: sources[1]!.catalogs[1] }))).toEqual(['Other', 'new', undefined]);
  });

  it('keeps a genre only where the catalog shown offers it', () => {
    expect(at(positionIn(sources, { addonKey: 'Other', catalogId: 'missing', genre: 'Comedy' }))).toEqual(['Other', 'top', undefined]);
    expect(at(positionIn(sources, { addonKey: 'Other', catalogId: 'missing', genre: 'Drama' }))).toEqual(['Other', 'top', 'Drama']);
  });

  it('without an addon, picks within the current one', () => {
    expect(at(positionIn(sources, { catalogId: 'new' }, { source: sources[1]!, catalog: sources[1]!.catalogs[0] }))).toEqual(['Other', 'new', undefined]);
    expect(positionIn([], { catalogId: 'new' })).toBeNull();
  });
});
