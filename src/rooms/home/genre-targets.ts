/**
 * Where a Home genre tile leads for movies and for shows. The tiles are one
 * catalog's genre names (Cinemeta's movie list, usually), and other catalogs
 * spell genres their own way: TMDB-style show catalogs join some
 * ("Action & Adventure", "Sci-Fi & Fantasy", "War & Politics"), and some
 * genres don't exist for a type at all. Kept pure so it's testable.
 */
import type { CatalogRef } from '../../catalog/titles';

export type GenreKind = 'movie' | 'series';

export interface GenreTarget {
  ref: CatalogRef;
  /** The genre as this catalog names it. */
  genre: string;
}

/** Spellings that mean the same genre, folded to one word. */
const SAME: Record<string, string> = { sciencefiction: 'scifi', musical: 'music', kids: 'family' };

const fold = (name: string): string => {
  const word = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return SAME[word] ?? word;
};

/** A genre name's parts: "Sci-Fi & Fantasy" is both Sci-Fi and Fantasy. */
const parts = (name: string): string[] => name.split(/\s*(?:&|\+|\/|,|\band\b)\s*/i).map(fold).filter(Boolean);

/**
 * The option of `options` that names `genre`: the same name first, else one
 * sharing a part with it (Adventure → "Action & Adventure", "War & Politics"
 * → War); none when the catalog has no such genre.
 */
export function matchGenre(genre: string, options: readonly string[]): string | undefined {
  const exact = options.find((option) => option.trim().toLowerCase() === genre.trim().toLowerCase());
  if (exact) return exact;
  const whole = fold(genre);
  const same = options.find((option) => fold(option) === whole);
  if (same) return same;
  // The tile's own parts in order, so "Action & Adventure" prefers Action over Adventure.
  for (const part of parts(genre)) {
    const found = options.find((option) => parts(option).includes(part));
    if (found) return found;
  }
  return undefined;
}

/** A catalog's genre choices, when it can be asked for any one of them (not a required one, like Cinemeta's years). */
const genreOptions = (ref: CatalogRef): readonly string[] => {
  const extra = ref.catalog.extra.find((e) => e.name === 'genre');
  return extra && !extra.isRequired ? (extra.options ?? []) : [];
};

/**
 * For each type, the first catalog offering the genre: the tile's own addon
 * first, then the rest in the person's order. A type left out has no such genre.
 */
export function genreTargets(genre: string, refs: readonly CatalogRef[], preferAddon?: string): Partial<Record<GenreKind, GenreTarget>> {
  const ordered = [...refs.filter((ref) => ref.addon.key === preferAddon), ...refs.filter((ref) => ref.addon.key !== preferAddon)];
  const targets: Partial<Record<GenreKind, GenreTarget>> = {};
  for (const kind of ['movie', 'series'] as const) {
    for (const ref of ordered) {
      if (ref.catalog.type !== kind) continue;
      const found = matchGenre(genre, genreOptions(ref));
      if (found) {
        targets[kind] = { ref, genre: found };
        break;
      }
    }
  }
  return targets;
}
