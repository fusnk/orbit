/**
 * Custom collections, each a profile's own, in the person's order (SQLite,
 * see src-tauri/src/collections.rs). A collection is either a fixed set of
 * titles (added from any title's menu) or one or more dynamic sources Orbit
 * resolves when it shows them: an installed addon's catalog, or a TMDB
 * collection, list, company, network, person or discover query (with a TMDB
 * token). Trakt lists are kept from imported files (for exporting back) but
 * can't be shown: Trakt's API needs a key.
 *
 * Loaded on first use; reads are synchronous from memory and every change
 * reloads from storage, like lists.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { httpsUrl } from '../addons/schema';
import { withDialog } from '../lib/ipc';
import type { Title } from '../catalog/titles';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

export const MAX_NAME = 60;
export const MAX_SOURCES = 20;
export const MAX_COLLECTIONS = 250;

export const SHAPES = ['poster', 'landscape', 'square'] as const;
export type Shape = (typeof SHAPES)[number];

export const TMDB_KINDS = ['collection', 'list', 'company', 'network', 'person', 'director', 'discover'] as const;
export type TmdbKind = (typeof TMDB_KINDS)[number];
/** Kinds that name one TMDB thing by its id (discover is filters only). */
export const TMDB_ID_KINDS: readonly TmdbKind[] = ['collection', 'list', 'company', 'network', 'person', 'director'];
export const TMDB_SORTS = ['original', 'popularity.desc', 'vote_average.desc', 'vote_count.desc', 'primary_release_date.desc', 'first_air_date.desc'] as const;

// Every control character, as Rust's `char::is_control` refuses them all (C1 too).
const CONTROL = /\p{Cc}/gu;
/** Text from a file or the page: control characters dropped, trimmed, capped. */
const Text = (max: number) =>
  v.pipe(
    v.string(),
    // Capped by whole characters: half an emoji is refused by Rust.
    v.transform((s) => [...s.replace(CONTROL, '').trim()].slice(0, max).join('')),
    v.minLength(1),
  );
const optionalText = (max: number) => v.fallback(v.optional(Text(max)), undefined);

/**
 * Only https images: anything else would be blocked by CSP or is a downgrade. Never on this
 * machine or the LAN either (as addon images, see addons/schema.ts): a shared file could
 * otherwise make the page request the router or a local service each time it's shown.
 */
export const HttpsUrl = v.pipe(httpsUrl, v.check((s) => !/\s/.test(s)));
export const isHttpsUrl = (value: unknown): value is string => v.is(HttpsUrl, value);

const idList = v.pipe(v.string(), v.maxLength(300), v.regex(/^\d{1,12}([,|]\d{1,12})*$/));
const date = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const score = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(10));
const region = v.pipe(v.string(), v.regex(/^[A-Z]{2}$/));

/** TMDB discover filters, by the names collections files use (see src-tauri/src/tmdb.rs `filter_param`). */
export const FILTERS = {
  withGenres: idList,
  withoutGenres: idList,
  withKeywords: idList,
  withoutKeywords: idList,
  withCompanies: idList,
  withoutCompanies: idList,
  withNetworks: idList,
  withWatchProviders: idList,
  withoutWatchProviders: idList,
  releaseDateGte: date,
  releaseDateLte: date,
  voteAverageGte: score,
  voteAverageLte: score,
  voteCountGte: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000_000)),
  year: v.pipe(v.number(), v.integer(), v.minValue(1870), v.maxValue(2100)),
  withOriginalLanguage: v.pipe(v.string(), v.regex(/^[a-z]{2}$/)),
  withOriginCountry: region,
  watchRegion: region,
} as const;
export type FilterKey = keyof typeof FILTERS;
export type Filters = Partial<Record<FilterKey, string | number>>;

/** Known filters with valid values; anything else (unknown keys, bad values) is dropped. */
export function cleanFilters(raw: unknown): Filters | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: Filters = {};
  for (const key of Object.keys(FILTERS) as FilterKey[]) {
    if (!Object.hasOwn(raw, key)) continue;
    let value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string') value = value.trim();
    if (value === '' || value === null || value === undefined) continue;
    // Files write numbers as strings now and then ("2020", "7.5"), and single ids as numbers.
    if (NUMERIC_FILTERS.has(key)) value = typeof value === 'string' && Number.isFinite(Number(value)) ? Number(value) : value;
    else if (typeof value === 'number') value = String(value);
    if (v.is(FILTERS[key], value)) out[key] = value as string | number;
  }
  return Object.keys(out).length ? out : undefined;
}
const NUMERIC_FILTERS = new Set<FilterKey>(['voteAverageGte', 'voteAverageLte', 'voteCountGte', 'year']);

const TmdbId = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000_000));
const Media = v.picklist(['movie', 'tv']);

export const SourceSchema = v.variant('kind', [
  // An addon's catalog, by the addon's manifest id (matched against what's installed when shown).
  v.object({
    kind: v.literal('addon'),
    addon: Text(200),
    type: Text(64),
    catalog: Text(200),
    genre: optionalText(100),
    /** The addon's name as the file gave it, to say what's missing. */
    addonName: optionalText(100),
    label: optionalText(100),
  }),
  v.pipe(
    v.object({
      kind: v.literal('tmdb'),
      tmdb: v.picklist(TMDB_KINDS),
      id: v.optional(TmdbId),
      media: Media,
      sort: v.fallback(v.optional(v.picklist(TMDB_SORTS)), undefined),
      filters: v.pipe(v.optional(v.unknown()), v.transform(cleanFilters)),
      label: optionalText(100),
    }),
    v.check((s) => s.tmdb === 'discover' || s.id !== undefined, 'needs an id'),
  ),
  // Kept for exporting back; Orbit can't show these (Trakt's API needs a key).
  v.object({
    kind: v.literal('trakt'),
    list: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1e12)),
    media: Media,
    sort: optionalText(20),
    sortHow: v.fallback(v.optional(v.picklist(['asc', 'desc'])), undefined),
    label: optionalText(100),
  }),
]);
export type CollectionSource = v.InferOutput<typeof SourceSchema>;
export type AddonSource = Extract<CollectionSource, { kind: 'addon' }>;
export type TmdbSource = Extract<CollectionSource, { kind: 'tmdb' }>;

const ArtSchema = v.object({
  cover: v.fallback(v.optional(HttpsUrl), undefined),
  backdrop: v.fallback(v.optional(HttpsUrl), undefined),
  shape: v.fallback(v.optional(v.picklist(SHAPES)), undefined),
});

export interface Collection {
  id: string;
  name: string;
  /** The group it came in (a Nuvio collection's title), if any. */
  group?: string | undefined;
  cover?: string | undefined;
  backdrop?: string | undefined;
  shape: Shape;
  /** Dynamic sources; none for a fixed set of titles. */
  sources: CollectionSource[];
  /** A fixed collection's titles, in the order they were added. */
  titles: Title[];
  createdAt: number;
}

/** What creating or editing a collection sends. */
export interface CollectionDraft {
  name: string;
  group?: string | undefined;
  cover?: string | undefined;
  backdrop?: string | undefined;
  shape?: Shape | undefined;
  sources: CollectionSource[];
}

/** Stremio's own names for what some files call "movies" or "shows". */
export function normalizeType(type: string): string {
  const lower = type.trim().toLowerCase();
  if (lower === 'movies' || lower === 'film' || lower === 'films') return 'movie';
  if (lower === 'shows' || lower === 'show') return 'series';
  return type.trim();
}

export const isDynamic = (c: Pick<Collection, 'sources'>) => c.sources.length > 0;

/** Stored rows are validated like addon data: their fields came from files and addons. */
const RowSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[0-9a-f]{16}$/)),
  name: Text(MAX_NAME),
  group: v.fallback(v.nullish(Text(MAX_NAME)), undefined),
  art: v.fallback(ArtSchema, {}),
  sources: v.fallback(v.array(v.unknown()), []),
  createdAt: v.number(),
  items: v.array(v.object({ titleId: v.string(), title: v.unknown() })),
});

/** Sources that validate (up to the cap); the rest are dropped, not fatal. */
export function parseSources(raw: readonly unknown[]): CollectionSource[] {
  return raw.slice(0, MAX_SOURCES).flatMap((s) => {
    const parsed = v.safeParse(SourceSchema, s);
    return parsed.success ? [parsed.output] : [];
  });
}

/** A stored row as a collection, or null if it doesn't validate. */
export function parseCollection(raw: unknown): Collection | null {
  const row = v.safeParse(RowSchema, raw);
  if (!row.success) return null;
  const { id, name, group, art, sources, createdAt, items } = row.output;
  const titles = items.flatMap((item) => {
    const s = v.safeParse(SnapshotSchema, item.title);
    return s.success ? [fromSnapshot(s.output)] : [];
  });
  return { id, name, group: group ?? undefined, cover: art.cover, backdrop: art.backdrop, shape: art.shape ?? 'poster', sources: parseSources(sources), titles, createdAt };
}

/** What Rust stores for a draft (`CollectionInput` in collections.rs); unset art is left out. */
export function toInput(draft: CollectionDraft) {
  const art: { cover?: string; backdrop?: string; shape?: Shape } = {};
  if (draft.cover && isHttpsUrl(draft.cover)) art.cover = draft.cover;
  if (draft.backdrop && isHttpsUrl(draft.backdrop)) art.backdrop = draft.backdrop;
  if (draft.shape) art.shape = draft.shape;
  return { name: draft.name, group: draft.group ?? null, art, sources: draft.sources.slice(0, MAX_SOURCES) };
}

/** The art a tile shows: its own cover, else a poster (or backdrop) from its titles. */
export function coverOf(c: Collection): string | undefined {
  if (c.cover) return c.cover;
  if (c.shape === 'landscape') return c.backdrop ?? c.titles.find((t) => t.background)?.background ?? c.titles.find((t) => t.poster)?.poster;
  return c.titles.find((t) => t.poster)?.poster ?? c.backdrop;
}

/** `ids` with `id` moved one place earlier (-1) or later (1); the index it lands at, or -1. */
export function shiftedIndex(ids: readonly string[], id: string, step: -1 | 1): number {
  const from = ids.indexOf(id);
  const to = from + step;
  return from < 0 || to < 0 || to >= ids.length ? -1 : to;
}

// ── The active profile's collections ──

let collections: Collection[] = [];
let loaded: Promise<void> | null = null;
let loads = 0;
const listeners = new Set<() => void>();

/** Why the last read failed, or null: Collections says so rather than "No collections yet". */
let loadError: unknown = null;
export const collectionsLoadError = (): unknown => loadError;

async function reload(): Promise<void> {
  // Reloads can overlap (quick changes); an older answer mustn't replace a newer one.
  const generation = ++loads;
  let rows: unknown[];
  try {
    rows = await invoke<unknown[]>('collection_all');
  } catch (err) {
    if (generation === loads) loadError = err;
    throw err;
  }
  if (generation !== loads) return;
  loadError = null;
  collections = rows.flatMap((raw) => parseCollection(raw) ?? []);
  for (const listener of listeners) listener();
}

/** Loads them once (switching profile reloads the window); later calls wait for the first. */
export function loadCollections(): Promise<void> {
  return (loaded ??= reload().catch((err: unknown) => {
    loaded = null;
    console.warn('Could not read collections', err);
  }));
}

/** Collections, in the person's order. */
export const customCollections = (): readonly Collection[] => collections;
export const findCollection = (id: string): Collection | undefined => collections.find((c) => c.id === id);
/** The groups collections came in, in order of first appearance. */
export const collectionGroups = (): string[] => [...new Set(collections.flatMap((c) => (c.group ? [c.group] : [])))];

/** Calls `listener` whenever collections change; returns an unsubscribe function. */
export function onCollectionsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs a change, then reloads; errors ("Collection names are 1 to 60 characters.") reach the caller. */
async function change<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await reload().catch((err: unknown) => console.error('Could not reload collections', err));
  }
}

export const createCollection = (draft: CollectionDraft) => change(() => invoke<string>('collection_create', { collection: toInput(draft) }));
export const updateCollection = (id: string, draft: CollectionDraft) => change(() => invoke<void>('collection_update', { id, collection: toInput(draft) }));
export const deleteCollection = (id: string) => change(() => invoke<void>('collection_delete', { id }));
export const moveCollection = (id: string, to: number) => change(() => invoke<void>('collection_move', { id, to }));
let moves: Promise<unknown> = Promise.resolve();
/**
 * Moves `id` one place earlier (-1) or later (1) from where it is when the
 * move runs, not where it was when the button was drawn: moves wait for the
 * one before, so a quick second press moves it again.
 */
export function shiftCollection(id: string, step: -1 | 1): Promise<void> {
  const run = moves.catch(() => undefined).then(async () => {
    const to = shiftedIndex(collections.map((c) => c.id), id, step);
    if (to >= 0) await moveCollection(id, to);
  });
  moves = run;
  return run;
}
export const addToCollection = (collectionId: string, title: Title) => change(() => invoke<void>('collection_add', { collectionId, titleId: title.id, title: snapshot(title) }));
export const removeFromCollection = (collectionId: string, titleId: string) => change(() => invoke<void>('collection_remove', { collectionId, titleId }));
/** Creates several at once (an imported file), all or none; resolves to how many. */
export const importCollections = (drafts: readonly (CollectionDraft & { titles?: readonly Title[] })[]) =>
  change(() => invoke<number>('collection_import', { collections: drafts.map((d) => ({ ...toInput(d), items: (d.titles ?? []).map((t) => ({ titleId: t.id, title: snapshot(t) })) })) }));
/** Saves an export where the person picks (Downloads suggested); resolves to its path, or `null` if cancelled. */
export const saveExport = (text: string) => withDialog('collection_export_save', { text });
