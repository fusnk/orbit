/**
 * Stremio's record of which episodes of a series are watched: one bit per
 * video, in the series' episode order, zlib-compressed and base64'd, after
 * the id of the last watched video and how many videos it covered:
 * "{video id}:{length}:{base64}" (the id may itself contain colons). The
 * anchor lets the bits line up again after episodes are added or removed.
 * (stremio-core: stremio-watched-bitfield.)
 */
import type { Title } from '../catalog/titles';

/** Every video of a series in Stremio's order: season, episode, then release date (specials first). */
export function videoOrder(title: Title): string[] {
  const released = (iso: string | undefined) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return (title.seasons ?? [])
    .flatMap((season) => season.episodes.map((episode) => ({ id: episode.id, season: season.number, number: episode.number, at: released(episode.released) })))
    .sort((a, b) => a.season - b.season || a.number - b.number || a.at - b.at)
    .map((v) => v.id);
}

async function through(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Plenty for any series; a field that inflates past it isn't a real one. */
const MAX_BYTES = 64 * 1024;

/** The watched video ids in `field`, matched against `videos` (from `videoOrder`). */
export async function decodeWatched(field: string, videos: readonly string[]): Promise<Set<string>> {
  return (await readWatched(field, videos)) ?? new Set();
}

/** Like `decodeWatched`, but null when `field` is junk or doesn't line up with `videos` (its anchor isn't one of them). */
export async function readWatched(field: string, videos: readonly string[]): Promise<Set<string> | null> {
  const parts = field.split(':');
  const data = parts.pop();
  const length = Number(parts.pop());
  const anchor = parts.join(':');
  const at = videos.indexOf(anchor);
  if (!data || !Number.isInteger(length) || length < 1 || at < 0) return null;
  let bytes: Uint8Array;
  try {
    bytes = await through(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), new DecompressionStream('deflate'));
  } catch {
    return null;
  }
  if (bytes.length > MAX_BYTES) return null;
  const offset = length - at - 1;
  const watched = new Set<string>();
  videos.forEach((id, i) => {
    const bit = i + offset;
    if (bit >= 0 && bit < bytes.length * 8 && (bytes[bit >> 3]! >> (bit & 7)) & 1) watched.add(id);
  });
  return watched;
}

/** `watched` as Stremio's field, against `videos` (from `videoOrder`). */
export async function encodeWatched(watched: ReadonlySet<string>, videos: readonly string[]): Promise<string> {
  const bytes = new Uint8Array(Math.ceil(videos.length / 8));
  let last = 0;
  videos.forEach((id, i) => {
    if (!watched.has(id)) return;
    bytes[i >> 3]! |= 1 << (i & 7);
    last = i;
  });
  const packed = await through(bytes, new CompressionStream('deflate'));
  return `${videos[last] ?? 'undefined'}:${last + 1}:${btoa(String.fromCharCode(...packed))}`;
}
