import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CastMember, TitleHit } from '../catalog/tmdb';

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));

import { anilistCharacters, castChoices, charactersFor } from './avatar-characters';

const POSTER = 'https://image.tmdb.org/t/p/w185/poster.jpg';
const hit = (animated: boolean): TitleHit => ({ id: 42, kind: 'series', name: 'Show', year: '2020', poster: POSTER, imdbId: null, animated });
const drawn = { id: 7, name: 'Lead Hero', image: 'https://s4.anilist.co/file/anilistcdn/character/large/b7.png' };
const member = (over: Partial<CastMember>): CastMember => ({ id: 1, name: 'Actor One', character: 'Hero', photo: 'https://image.tmdb.org/t/p/w185/head.jpg', ...over });

/** Answers each command from `replies` (a function throws, like a failed request). */
function answer(replies: Record<string, unknown>): void {
  mock.invoke.mockImplementation(async (command: string) => {
    const reply = replies[command];
    if (typeof reply === 'function') return (reply as () => unknown)();
    return reply;
  });
}

beforeEach(() => mock.invoke.mockReset());

describe('castChoices', () => {
  it('prefers a still of the title over the headshot', () => {
    const [choice] = castChoices([member({ still: 'https://image.tmdb.org/t/p/w300/still.jpg' })], hit(false));
    expect(choice).toMatchObject({ source: 'still', image: 'https://image.tmdb.org/t/p/w300/still.jpg', name: 'Hero', actor: 'Actor One', key: 'tmdb-1' });
  });

  it('falls back to the actor’s headshot for live action, marked as the actor’s', () => {
    expect(castChoices([member({ still: null })], hit(false))).toEqual([
      { key: 'tmdb-1', name: 'Hero', actor: 'Actor One', named: true, image: 'https://image.tmdb.org/t/p/w185/head.jpg', source: 'actor' },
    ]);
    // Without a character, the actor's own name is the tile's.
    expect(castChoices([member({ character: null })], hit(false))[0]).toMatchObject({ name: 'Actor One', actor: null, named: false, source: 'actor' });
    expect(castChoices([member({ photo: null })], hit(false))).toEqual([]);
  });

  it('never offers a voice actor’s face for a cartoon: the poster, with the character’s name', () => {
    expect(castChoices([member({})], hit(true))).toEqual([{ key: 'tmdb-1', name: 'Hero', actor: 'Actor One', named: true, image: POSTER, source: 'poster' }]);
    // No character name, or no poster: nothing to show.
    expect(castChoices([member({ character: null })], hit(true))).toEqual([]);
    expect(castChoices([member({})], { animated: true, poster: null })).toEqual([]);
    // A tagged still of the cartoon is the character, drawn.
    expect(castChoices([member({ still: 'https://image.tmdb.org/t/p/w300/frame.jpg' })], hit(true))[0]?.source).toBe('still');
  });
});

describe('charactersFor', () => {
  it('uses AniList’s drawings for an anime, and doesn’t ask TMDB', async () => {
    answer({ anilist_characters: [drawn] });
    expect(await charactersFor(hit(true))).toEqual({
      from: 'anilist',
      choices: [{ key: 'anilist-7', name: 'Lead Hero', actor: null, named: true, image: drawn.image, source: 'anilist' }],
    });
    expect(mock.invoke).toHaveBeenCalledWith('anilist_characters', { tmdbId: 42, kind: 'series' });
    expect(mock.invoke).not.toHaveBeenCalledWith('tmdb_cast_by_id', expect.anything());
  });

  it('uses TMDB for a cartoon AniList doesn’t know, or can’t be reached for', async () => {
    for (const anilist of [null, [], () => Promise.reject(new Error('network'))]) {
      mock.invoke.mockReset();
      answer({ anilist_characters: anilist, tmdb_cast_by_id: [member({})] });
      expect(await charactersFor(hit(true))).toMatchObject({ from: 'tmdb', choices: [{ source: 'poster' }] });
    }
  });

  it('doesn’t look live action up on AniList', async () => {
    answer({ tmdb_cast_by_id: [member({})] });
    expect(await charactersFor(hit(false))).toMatchObject({ from: 'tmdb', choices: [{ source: 'actor' }] });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledWith('tmdb_cast_by_id', { id: 42, kind: 'series' });
  });

  it('is null without a TMDB token', async () => {
    answer({ tmdb_cast_by_id: null });
    expect(await charactersFor(hit(false))).toBeNull();
  });
});

describe('anilistCharacters', () => {
  it('refuses pictures from anywhere but AniList’s character CDN', async () => {
    answer({ anilist_characters: [{ ...drawn, image: 'https://evil.test/a.png' }] });
    await expect(anilistCharacters(hit(true))).rejects.toThrow();
    // And charactersFor then uses TMDB.
    answer({ anilist_characters: [{ ...drawn, image: 'https://evil.test/a.png' }], tmdb_cast_by_id: [] });
    expect(await charactersFor(hit(true))).toEqual({ from: 'tmdb', choices: [] });
  });

  it('refuses nameless characters', async () => {
    answer({ anilist_characters: [{ ...drawn, name: '' }] });
    await expect(anilistCharacters(hit(true))).rejects.toThrow();
  });
});
