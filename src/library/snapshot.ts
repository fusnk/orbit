/**
 * The small copy of a title Orbit keeps for My Library and watch history, so
 * those pages render without the network. It's the catalog-preview fields,
 * and it's validated with the addon schemas when read back, since every
 * field originally came from an addon.
 */
import * as v from 'valibot';
import { MetaPreviewSchema } from '../addons/schema';
import { fromPreview, type Title } from '../catalog/titles';
import { isJellyfinId, posterFor } from './jellyfin';
import { isPlexId, plexPosterFor } from './plex';

const DESCRIPTION_CHARS = 600;
/** The most Rust stores for one snapshot (`MAX_SNAPSHOT_BYTES` in library.rs), as UTF-8 JSON. */
export const MAX_SNAPSHOT_BYTES = 16 * 1024;
const encoder = new TextEncoder();

/**
 * Whether Rust will store `s`. A snapshot from a file can pass the schema yet be
 * larger (long descriptions, many origins): an import leaves it out rather than
 * have Rust refuse the whole list for it.
 */
export const snapshotFits = (s: unknown): boolean => encoder.encode(JSON.stringify(s)).length <= MAX_SNAPSHOT_BYTES;

export const SnapshotSchema = v.object({
  meta: MetaPreviewSchema,
  origins: v.fallback(v.array(v.object({ key: v.string(), name: v.string() })), []),
});

export type Snapshot = v.InferOutput<typeof SnapshotSchema>;

export function snapshot(title: Title) {
  return {
    meta: {
      id: title.id,
      type: title.type,
      name: title.name,
      poster: title.poster,
      background: title.background,
      logo: title.logo,
      description: title.description?.slice(0, DESCRIPTION_CHARS),
      releaseInfo: title.year,
      imdbRating: title.rating,
      runtime: title.runtime,
      genres: title.genres,
    },
    origins: title.origins,
  };
}

export function fromSnapshot(s: Snapshot): Title {
  const title = fromPreview(s.meta, s.origins);
  // Saved artwork must be https, so a Jellyfin- or Plex-only title's poster is found again from its id.
  if (title.poster) return title;
  if (isJellyfinId(title.id)) return { ...title, poster: posterFor(title.id) };
  if (isPlexId(title.id)) return { ...title, poster: plexPosterFor(title.id) };
  return title;
}
