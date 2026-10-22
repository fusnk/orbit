/**
 * What the avatar picker offers for a title's characters: a picture of the
 * character, not of whoever plays them.
 *
 * - Anime: AniList's drawings of its characters (Rust maps the TMDB title to
 *   AniList through the id list sync uses).
 * - Anything else: a still of the title TMDB tagged with the actor, i.e. them
 *   in the role. Without one, live action falls back to the actor's headshot,
 *   labelled as theirs; animation to the title's poster, since a voice actor's
 *   face isn't the character at all, and the poster usually draws the cast.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { castById, type CastMember, type TitleHit } from '../catalog/tmdb';

/** Where a choice's picture comes from, which says how the picker labels it. */
export type CharacterSource = 'anilist' | 'still' | 'actor' | 'poster';

export interface CharacterChoice {
  /** For the gradient behind it (`avatarGradient`), stable per character. */
  key: string;
  /** The character's name, or the actor's when TMDB names no character. */
  name: string;
  /** The actor, when TMDB names one. */
  actor: string | null;
  /** True when `name` is a character (not just the actor's name). */
  named: boolean;
  image: string;
  source: CharacterSource;
}

const AniListCharacterSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  // Rust checks these in full (anilist.rs `valid_character_image`); this keeps the page honest too.
  image: v.pipe(v.string(), v.maxLength(300), v.startsWith('https://s4.anilist.co/file/anilistcdn/character/')),
});

/** An anime's characters from AniList, or null when it isn't one AniList's id list knows. */
export async function anilistCharacters(hit: Pick<TitleHit, 'id' | 'kind'>): Promise<CharacterChoice[] | null> {
  const raw = await invoke<unknown>('anilist_characters', { tmdbId: hit.id, kind: hit.kind });
  if (raw === null) return null;
  return v.parse(v.pipe(v.array(AniListCharacterSchema), v.maxLength(25)), raw).map((c) => ({
    key: `anilist-${c.id}`,
    name: c.name,
    actor: null,
    named: true,
    image: c.image,
    source: 'anilist',
  }));
}

/** One choice per cast member, picking each one's best picture (see the module comment). */
export function castChoices(cast: readonly CastMember[], hit: Pick<TitleHit, 'animated' | 'poster'>): CharacterChoice[] {
  return cast.flatMap((member): CharacterChoice[] => {
    const named = !!member.character;
    const base = { key: `tmdb-${member.id}`, name: member.character ?? member.name, actor: named ? member.name : null, named };
    if (member.still) return [{ ...base, image: member.still, source: 'still' }];
    if (!hit.animated) return member.photo ? [{ ...base, image: member.photo, source: 'actor' }] : [];
    // A poster with only an actor's name on it would picture no one in particular.
    return named && hit.poster ? [{ ...base, image: hit.poster, source: 'poster' }] : [];
  });
}

/**
 * `hit`'s characters to choose from, and who drew them; null without a TMDB
 * token (and no AniList match). Animated titles try AniList first; AniList
 * being unreachable just means TMDB's cast.
 */
export async function charactersFor(hit: TitleHit): Promise<{ choices: CharacterChoice[]; from: 'anilist' | 'tmdb' } | null> {
  if (hit.animated) {
    const drawn = await anilistCharacters(hit).catch(() => null);
    if (drawn?.length) return { choices: drawn, from: 'anilist' };
  }
  const cast = await castById(hit);
  return cast === null ? null : { choices: castChoices(cast, hit), from: 'tmdb' };
}
