/**
 * The phone remote's pure parts (see src-tauri/src/remote/ and app/remote.ts):
 * reading the commands Rust hands over, what search results the phone gets,
 * the phone page's strings, and drawing the pairing QR code.
 */
import * as v from 'valibot';

const NavKey = v.picklist(['up', 'down', 'left', 'right', 'ok', 'back']);
const Seconds = v.pipe(v.number(), v.finite());
const Id = v.pipe(v.number(), v.integer(), v.minValue(0));
const Shelf = v.picklist(['home', 'mood', 'surprise']);

/** A command from a paired phone, already checked by Rust (`remote://command`); read again here all the same. */
const CommandSchema = v.variant('kind', [
  v.object({ kind: v.literal('pause'), on: v.boolean() }),
  v.object({ kind: v.literal('seek-by'), seconds: Seconds }),
  v.object({ kind: v.literal('seek-to'), seconds: v.pipe(Seconds, v.minValue(0)) }),
  v.object({ kind: v.literal('volume'), level: v.pipe(Seconds, v.minValue(0), v.maxValue(150)) }),
  v.object({ kind: v.literal('mute'), on: v.boolean() }),
  v.object({ kind: v.literal('next') }),
  v.object({ kind: v.literal('subtitle'), id: v.nullable(v.pipe(v.number(), v.integer())) }),
  v.object({ kind: v.literal('audio'), id: v.pipe(v.number(), v.integer()) }),
  v.object({ kind: v.literal('stop') }),
  v.object({ kind: v.literal('nav'), key: NavKey }),
  v.object({ kind: v.literal('search'), id: v.pipe(v.number(), v.integer()), query: v.pipe(v.string(), v.minLength(1), v.maxLength(200)) }),
  v.object({ kind: v.literal('open'), search: v.pipe(v.number(), v.integer()), index: v.pipe(v.number(), v.integer(), v.minValue(0)), play: v.boolean() }),
  // The picker's (see app/remote-picker.ts).
  v.object({ kind: v.literal('browse'), id: Id }),
  v.object({ kind: v.literal('mood'), id: Id, mood: v.pipe(v.string(), v.minLength(1), v.maxLength(32)) }),
  v.object({ kind: v.literal('surprise'), id: Id, media: v.picklist(['movie', 'series']) }),
  v.object({ kind: v.literal('details'), id: Id, from: Shelf, shelf: Id, row: Id, index: Id }),
  v.object({ kind: v.literal('pick'), from: Shelf, shelf: Id, row: Id, index: Id, action: v.picklist(['play', 'add']) }),
]);

export type RemoteCommand = v.InferOutput<typeof CommandSchema>;
export type RemoteNavKey = v.InferOutput<typeof NavKey>;
export type PickerShelf = v.InferOutput<typeof Shelf>;

export function parseRemoteCommand(payload: unknown): RemoteCommand | null {
  const parsed = v.safeParse(CommandSchema, payload);
  return parsed.success ? parsed.output : null;
}

/** The arrow pad's keys, as the keys a keyboard or controller would press. */
export const NAV_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape' } as const satisfies Record<RemoteNavKey, string>;

/** Results the phone gets for a search. */
export const MAX_REMOTE_RESULTS = 20;

/** A search result as the phone sees it (Rust fetches `poster` for it; the phone never gets the address). */
export interface FoundTitle {
  name: string;
  year: string | null;
  kind: string;
  poster: string | null;
}

export function foundTitles(titles: readonly { name: string; year?: string | undefined; type: string; poster?: string | undefined }[]): FoundTitle[] {
  return titles.slice(0, MAX_REMOTE_RESULTS).map((title) => ({ name: title.name, year: title.year ?? null, kind: title.type, poster: title.poster ?? null }));
}

/** The picker's limits (Rust refuses more; src-tauri/src/remote/picker.rs). */
export const MAX_PICKER_ROWS = 12;
export const MAX_PICKER_TITLES = 20;
export const MAX_PICKER_MOODS = 16;
const MAX_SEASONS = 60;
const MAX_EPISODES = 1000;

/** A title as the picker hands it to Rust (which fetches `poster` itself; the phone never gets it). */
export interface PickTitle {
  name: string;
  year: string | null;
  kind: string;
  rating: string | null;
  poster: string | null;
}

interface PickableTitle {
  name: string;
  year?: string | undefined;
  type: string;
  rating?: string | undefined;
  poster?: string | undefined;
}

export const pickTitle = (title: PickableTitle): PickTitle => ({ name: title.name, year: title.year ?? null, kind: title.type, rating: title.rating ?? null, poster: title.poster ?? null });

/** A title's details for the phone's sheet: runtime in the interface's words, the episode list capped as Rust caps it. */
export interface PickDetails extends PickTitle {
  runtime: string | null;
  description: string | null;
  inLibrary: boolean;
  seasons: { number: number; episodes: { number: number; name: string }[] }[];
}

export function pickDetails(
  title: PickableTitle & { description?: string | undefined; seasons?: readonly { number: number; episodes: readonly { number: number; title: string }[] }[] | undefined },
  runtime: string | undefined,
  inLibrary: boolean,
): PickDetails {
  let budget = MAX_EPISODES;
  // Rust reads the numbers as whole, unsigned ones.
  const whole = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
  const seasons = (title.seasons ?? []).filter((season) => whole(season.number)).slice(0, MAX_SEASONS).map((season) => {
    const episodes = season.episodes.filter((episode) => whole(episode.number)).slice(0, budget).map((episode) => ({ number: episode.number, name: episode.title }));
    budget -= episodes.length;
    return { number: season.number, episodes };
  });
  return { ...pickTitle(title), runtime: runtime ?? null, description: title.description ?? null, inLibrary, seasons };
}

/** The keys of the phone page's strings, among all of Orbit's. */
export const PHONE_PREFIX = 'remote.phone.';
export const phoneKeys = (keys: readonly string[]): string[] => keys.filter((key) => key.startsWith(PHONE_PREFIX));

/**
 * The QR code as one SVG path: a 1×1 square per dark module, with runs along
 * a row joined. `cells` holds `size` rows of '1' (dark) and '0'.
 */
export function qrPath(size: number, cells: string): string {
  if (size <= 0 || cells.length !== size * size) return '';
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (cells[y * size + x] !== '1') {
        x++;
        continue;
      }
      const start = x;
      while (x < size && cells[y * size + x] === '1') x++;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join('');
}
