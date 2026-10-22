/**
 * What Discover knows about the person's taste, per profile: titles they
 * gave a thumbs up (seeds whose recommendations Discover mixes in), titles
 * never to feature again (thumbs down), titles they're not interested in
 * (hidden from Discover everywhere), and Letterboxd lists they added. Plus
 * the reading of their history: favourite genres, the actor they keep
 * watching, and how recommendations are pooled.
 */
import * as v from 'valibot';
import { settings } from '../lib/ipc';
import { profileSetting } from '../library/profiles';
import { dayNumber, genreKeyOf, GENRES, type GenreKey } from './explore';
import type { LetterboxdListRef } from './letterboxd';
import type { Title } from './titles';

const TASTE_KEY = 'explore.taste';
/** Caps that keep the setting well under its size limit. */
export const MAX_SEEDS = 40;
export const MAX_DOWN = 500;
export const MAX_HIDDEN = 1000;
export const MAX_LISTS = 20;

const ImdbId = v.pipe(v.string(), v.regex(/^tt\d{1,10}$/));
const SeedSchema = v.object({ id: ImdbId, type: v.picklist(['movie', 'series']), name: v.pipe(v.string(), v.maxLength(300)) });
export type Seed = v.InferOutput<typeof SeedSchema>;
const ListSchema = v.object({
  owner: v.pipe(v.string(), v.regex(/^\w{1,40}$/)),
  slug: v.pipe(v.string(), v.regex(/^[A-Za-z0-9-]{1,200}$/)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(600)),
});
export type SavedList = v.InferOutput<typeof ListSchema>;

export interface Taste {
  /** Thumbs up, newest first. */
  up: Seed[];
  /** Thumbs down: never featured again. */
  down: string[];
  /** Not interested: left out of Discover everywhere. */
  hidden: string[];
  lists: SavedList[];
  /** The "Tune your recommendations" hint was dismissed. */
  hintDone: boolean;
}

/** Each part of a saved taste that validates, item by item; junk falls back to empty. */
export function parseTaste(value: unknown): Taste {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const items = <T>(list: unknown, schema: v.GenericSchema<unknown, T>, max: number, key: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return (Array.isArray(list) ? list : [])
      .flatMap((raw) => {
        const parsed = v.safeParse(schema, raw);
        if (!parsed.success || seen.has(key(parsed.output))) return [];
        seen.add(key(parsed.output));
        return [parsed.output];
      })
      .slice(0, max);
  };
  return {
    up: items(saved.up, SeedSchema, MAX_SEEDS, (s) => s.id),
    down: items(saved.down, ImdbId, MAX_DOWN, (id) => id),
    hidden: items(saved.hidden, ImdbId, MAX_HIDDEN, (id) => id),
    lists: items(saved.lists, ListSchema, MAX_LISTS, (l) => `${l.owner}/${l.slug}`),
    hintDone: saved.hintDone === true,
  };
}

let current: Promise<Taste> | null = null;
/** Saves one change at a time, so an older one can't land after a newer one. */
let saving: Promise<unknown> = Promise.resolve();

/** The active profile's taste (read once; profiles switch by reloading the window). */
export function taste(): Promise<Taste> {
  current ??= profileSetting(TASTE_KEY).then(({ value }) => parseTaste(value));
  return current;
}

/** Applies `change` and saves it; the result is the current taste at once. */
export async function updateTaste(change: (taste: Taste) => Taste): Promise<Taste> {
  const next = taste().then((t) => parseTaste(change(t)));
  current = next;
  const done = saving.then(async () => settings.set((await profileSetting(TASTE_KEY)).key, await next));
  saving = done.catch(() => {});
  await done;
  return next;
}

/** Newest first, without an older copy of the same id, capped. */
const prepend = (list: readonly string[], id: string, max: number) => [id, ...list.filter((other) => other !== id)].slice(0, max);

/** Thumbs up: a taste seed (and no longer thumbed down). */
export const withUp = (t: Taste, title: Pick<Title, 'id' | 'type' | 'name'>): Taste =>
  title.type !== 'movie' && title.type !== 'series'
    ? t
    : { ...t, up: [{ id: title.id, type: title.type === 'series' ? ('series' as const) : ('movie' as const), name: title.name.slice(0, 300) }, ...t.up.filter((s) => s.id !== title.id)].slice(0, MAX_SEEDS), down: t.down.filter((id) => id !== title.id) };
/** A thumbs up taken back: no longer a seed. */
export const withoutUp = (t: Taste, id: string): Taste => ({ ...t, up: t.up.filter((s) => s.id !== id) });
/** Thumbs down: never featured again (and no longer a seed). */
export const withDown = (t: Taste, id: string): Taste => ({ ...t, down: prepend(t.down, id, MAX_DOWN), up: t.up.filter((s) => s.id !== id) });
export const withHidden = (t: Taste, id: string): Taste => ({ ...t, hidden: prepend(t.hidden, id, MAX_HIDDEN), up: t.up.filter((s) => s.id !== id) });
export const withoutHidden = (t: Taste, id: string): Taste => ({ ...t, hidden: t.hidden.filter((other) => other !== id) });
export const withList = (t: Taste, list: SavedList): Taste =>
  t.lists.some((l) => l.owner === list.owner && l.slug === list.slug) || t.lists.length >= MAX_LISTS ? t : { ...t, lists: [...t.lists, list] };
export const withoutList = (t: Taste, list: LetterboxdListRef): Taste => ({ ...t, lists: t.lists.filter((l) => l.owner !== list.owner || l.slug !== list.slug) });

/** Discover's genres the titles list, most common first (ties in the genre table's order). */
export function favouriteGenres(titles: readonly Pick<Title, 'genres'>[]): GenreKey[] {
  const counts = new Map<GenreKey, number>();
  for (const title of titles) {
    // A title counts once per genre, however its addon spelled it.
    for (const key of new Set(title.genres.map(genreKeyOf).filter((k): k is GenreKey => !!k))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = GENRES.map((g) => g.key as GenreKey);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0])).map(([key]) => key);
}

/** Two of the favourite genres for "Genre mix", a different pair each day; null with fewer than two. */
export function genrePairOfDay(favourites: readonly GenreKey[], now: number): [GenreKey, GenreKey] | null {
  const top = favourites.slice(0, 4);
  const pairs: [GenreKey, GenreKey][] = [];
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push([top[i]!, top[j]!]);
  return pairs.length ? pairs[dayNumber(now) % pairs.length]! : null;
}

/** Billed cast that count towards a favourite: the leads, not the whole credits list. */
const LEADS = 5;

/**
 * The actor who leads the most of the titles' casts (each cast in billing
 * order), if one leads at least `min` of them; ties go to whoever's first
 * met, the most recently watched title's lead.
 */
export function favouriteActor(casts: readonly (readonly { id: number; name: string }[])[], min = 2): { id: number; name: string; count: number } | null {
  const counts = new Map<number, { id: number; name: string; count: number }>();
  for (const cast of casts) {
    for (const person of new Map(cast.slice(0, LEADS).map((p) => [p.id, p])).values()) {
      const entry = counts.get(person.id) ?? { id: person.id, name: person.name, count: 0 };
      entry.count++;
      counts.set(person.id, entry);
    }
  }
  let best: { id: number; name: string; count: number } | null = null;
  for (const entry of counts.values()) if (entry.count >= min && (!best || entry.count > best.count)) best = entry;
  return best;
}

/** Lists merged a title from each in turn, each title once, leaving out `skip`. */
export function interleave(lists: readonly (readonly Title[])[], skip: (title: Title) => boolean = () => false, limit = Infinity): Title[] {
  const out: Title[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const list of lists) {
      const title = list[i];
      if (!title || seen.has(title.id) || skip(title)) continue;
      seen.add(title.id);
      out.push(title);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Seeds for recommendations: thumbs up first, then recently watched and saved titles, each once. */
export function seedsFrom(up: readonly Seed[], recent: readonly Pick<Title, 'id' | 'type' | 'name'>[], max: number): Pick<Title, 'id' | 'type' | 'name'>[] {
  const seen = new Set<string>();
  return [...up, ...recent.filter((t) => /^tt\d+$/.test(t.id) && (t.type === 'movie' || t.type === 'series'))].filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, max);
}
