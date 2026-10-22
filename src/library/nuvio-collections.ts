/**
 * Collections files in Nuvio's format, which Nuvio itself imports and
 * exports and which community builders produce: an array of collections
 * (each shown as a Home row there), each with folders (tiles), each folder
 * with one or more sources:
 *
 *   [{ "id": "…", "title": "Studios", "folders": [{
 *       "id": "…", "title": "Pixar", "coverImageUrl": "https://…", "tileShape": "LANDSCAPE",
 *       "sources": [{ "provider": "tmdb", "tmdbSourceType": "COMPANY", "tmdbId": 3, "mediaType": "MOVIE", "sortBy": "popularity.desc" }],
 *       "catalogSources": [{ "addonId": "…", "type": "movie", "catalogId": "…" }] }] }]
 *
 * Each folder becomes one Orbit collection, in its collection's group.
 * Files are untrusted: the text is capped, every field is checked, only https
 * images are kept, and sources Orbit can't use are reported, not kept.
 * Older and hand-made files come in other shapes too ({ collections: […] },
 * one collection, or a bare list of folders); all are read.
 *
 * Exports use the same format (so Nuvio and others can read them back), with
 * a fixed collection's titles in an extra `orbitTitles` field that other apps
 * ignore.
 */
import * as v from 'valibot';
import type { Title } from '../catalog/titles';
import { cleanFilters, HttpsUrl, MAX_NAME, MAX_SOURCES, normalizeType, SourceSchema, TMDB_KINDS, TMDB_SORTS, type Collection, type CollectionDraft, type CollectionSource, type Shape } from './collections';
import { fromSnapshot, snapshot, snapshotFits, SnapshotSchema } from './snapshot';

/**
 * Files bigger than this aren't read (builders' biggest are well under it).
 * Matches Rust's `MAX_EXPORT_BYTES`, so a file Orbit exported can be imported again.
 */
export const MAX_FILE_CHARS = 8 * 1024 * 1024;
/** Folders read from one file; the rest are left out (and counted). */
export const MAX_FOLDERS = 1000;
const MAX_GROUPS = 200;
const MAX_TITLES = 1000;

export type CollectionsFileProblem = 'too-large' | 'not-json' | 'not-collections';

export class CollectionsFileError extends Error {
  constructor(readonly problem: CollectionsFileProblem) {
    super(problem);
  }
}

/** A source the file has that Orbit can't use, said by its provider and name. */
export interface DroppedSource {
  provider: string;
  label?: string | undefined;
}

export interface ImportedFolder extends CollectionDraft {
  /** Unique within the file, for picking. */
  key: string;
  shape: Shape;
  titles: Title[];
  dropped: DroppedSource[];
}

export interface ParsedFile {
  folders: ImportedFolder[];
  /** Folders left out: no name, or past the cap. */
  skipped: number;
}

// Every control character, as Rust's `char::is_control` refuses them all (C1 too).
const CONTROL = /\p{Cc}/gu;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string field, cleaned and capped; undefined if missing or blank. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Capped by whole characters: half an emoji is refused by Rust and fails the whole import.
  const clean = [...value.replace(CONTROL, '').trim()].slice(0, max).join('');
  return clean || undefined;
}

const https = (value: unknown) => (v.is(HttpsUrl, value) ? value : undefined);

/** A positive whole number, also from a string ("8687275"), as files write both. */
function positiveId(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d{1,13}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function shapeOf(value: unknown): Shape {
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  if (lower === 'landscape' || lower === 'wide') return 'landscape';
  if (lower === 'square') return 'square';
  return 'poster';
}

/** Nuvio's genre: blank or "none" means no genre. */
function genreOf(value: unknown): string | undefined {
  const genre = text(value, 100);
  return genre && genre.toLowerCase() !== 'none' ? genre : undefined;
}

/** One source of a folder as Orbit's, or why it can't be used. */
export function mapSource(raw: unknown): { source: CollectionSource } | { dropped: DroppedSource } {
  if (!isRecord(raw)) return { dropped: { provider: '?' } };
  const provider = (text(raw.provider, 30) ?? 'addon').toLowerCase();
  const label = text(raw.title, 100) ?? text(raw.catalogName, 100) ?? text(raw.name, 100);
  const media = ['tv', 'series', 'show', 'shows'].includes(String(raw.mediaType ?? raw.type ?? '').toLowerCase()) ? 'tv' : 'movie';
  let candidate: unknown;
  if (provider === 'addon') {
    const type = text(raw.type, 64);
    candidate = { kind: 'addon', addon: raw.addonId, type: type && normalizeType(type), catalog: raw.catalogId, genre: genreOf(raw.genre), addonName: text(raw.addonName, 100), label };
  } else if (provider === 'tmdb') {
    const kind = String(raw.tmdbSourceType ?? '').toLowerCase();
    const sort = typeof raw.sortBy === 'string' && (TMDB_SORTS as readonly string[]).includes(raw.sortBy) ? raw.sortBy : undefined;
    candidate = (TMDB_KINDS as readonly string[]).includes(kind) ? { kind: 'tmdb', tmdb: kind, id: positiveId(raw.tmdbId), media, sort, filters: cleanFilters(raw.filters), label } : null;
  } else if (provider === 'trakt') {
    candidate = { kind: 'trakt', list: positiveId(raw.traktListId), media, sort: text(raw.sortBy, 20), sortHow: raw.sortHow === 'desc' ? 'desc' : raw.sortHow === 'asc' ? 'asc' : undefined, label };
  }
  const parsed = v.safeParse(SourceSchema, candidate);
  return parsed.success ? { source: parsed.output } : { dropped: { provider, label } };
}

/** A fixed collection's titles, from `orbitTitles` (Orbit's own exports). */
function titlesOf(raw: unknown): Title[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TITLES).flatMap((item) => {
    const parsed = v.safeParse(SnapshotSchema, item);
    if (!parsed.success) return [];
    const title = fromSnapshot(parsed.output);
    // Rust would refuse one too large, and with it the whole import.
    return snapshotFits(snapshot(title)) ? [title] : [];
  });
}

function mapFolder(raw: unknown, group: string | undefined, key: string): ImportedFolder | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.title, MAX_NAME) ?? text(raw.name, MAX_NAME);
  if (!name) return null;
  // Nuvio reads `sources`, and older files' `catalogSources` when there are none.
  const listed = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : Array.isArray(raw.catalogSources) ? raw.catalogSources.map((s: unknown) => (isRecord(s) ? { ...s, provider: 'addon' } : s)) : [];
  const sources: CollectionSource[] = [];
  const dropped: DroppedSource[] = [];
  const seen = new Set<string>();
  for (const entry of listed.slice(0, MAX_SOURCES * 2)) {
    const mapped = mapSource(entry);
    if ('dropped' in mapped) dropped.push(mapped.dropped);
    else if (sources.length < MAX_SOURCES && !seen.has(JSON.stringify(mapped.source))) {
      seen.add(JSON.stringify(mapped.source));
      sources.push(mapped.source);
    }
  }
  return {
    key,
    name,
    group,
    cover: https(raw.coverImageUrl),
    backdrop: https(raw.heroBackdropUrl) ?? https(raw.backdropImageUrl),
    shape: shapeOf(raw.tileShape),
    sources,
    titles: sources.length ? [] : titlesOf(raw.orbitTitles),
    dropped,
  };
}

/** The file's collections, whatever shape it came in: each with a group name and folders. */
function collectionsOf(json: unknown): { title?: string | undefined; folders: unknown[] }[] {
  const isFolder = (x: unknown) => isRecord(x) && !Array.isArray(x.folders) && ('sources' in x || 'catalogSources' in x || 'coverImageUrl' in x || 'orbitTitles' in x);
  const asCollection = (x: unknown) => (isRecord(x) && Array.isArray(x.folders) ? [{ title: text(x.title, MAX_NAME) ?? text(x.name, MAX_NAME), folders: x.folders }] : []);
  if (Array.isArray(json)) {
    if (json.length && json.every(isFolder)) return [{ folders: json }];
    return json.slice(0, MAX_GROUPS).flatMap(asCollection);
  }
  if (isRecord(json)) {
    if (Array.isArray(json.collections)) return collectionsOf(json.collections);
    if (Array.isArray(json.folders)) return asCollection(json);
  }
  return [];
}

/** Reads a collections file. Throws `CollectionsFileError` when it can't be. */
export function parseCollectionsFile(textValue: string): ParsedFile {
  if (textValue.length > MAX_FILE_CHARS) throw new CollectionsFileError('too-large');
  let json: unknown;
  try {
    json = JSON.parse(textValue);
  } catch {
    throw new CollectionsFileError('not-json');
  }
  const groups = collectionsOf(json);
  if (!groups.length) throw new CollectionsFileError('not-collections');
  const folders: ImportedFolder[] = [];
  let skipped = 0;
  groups.forEach((group, g) => {
    group.folders.forEach((raw, f) => {
      const folder = folders.length < MAX_FOLDERS ? mapFolder(raw, group.title, `${g}:${f}`) : null;
      if (folder) folders.push(folder);
      else skipped++;
    });
  });
  if (!folders.length) throw new CollectionsFileError('not-collections');
  return { folders, skipped };
}

// ── Export ──

const TILE_SHAPES: Record<Shape, string> = { poster: 'POSTER', landscape: 'LANDSCAPE', square: 'SQUARE' };

/** A source as Nuvio writes it. */
function exportSource(source: CollectionSource): Record<string, unknown> {
  switch (source.kind) {
    case 'addon':
      return { provider: 'addon', addonId: source.addon, type: source.type, catalogId: source.catalog, ...(source.genre ? { genre: source.genre } : {}), ...(source.addonName ? { addonName: source.addonName } : {}), ...(source.label ? { title: source.label } : {}) };
    case 'tmdb':
      return {
        provider: 'tmdb',
        tmdbSourceType: source.tmdb.toUpperCase(),
        ...(source.id ? { tmdbId: source.id } : {}),
        mediaType: source.media.toUpperCase(),
        sortBy: source.sort ?? 'original',
        ...(source.filters ? { filters: source.filters } : {}),
        ...(source.label ? { title: source.label } : {}),
      };
    case 'trakt':
      return { provider: 'trakt', traktListId: source.list, mediaType: source.media.toUpperCase(), ...(source.sort ? { sortBy: source.sort } : {}), ...(source.sortHow ? { sortHow: source.sortHow } : {}), ...(source.label ? { title: source.label } : {}) };
  }
}

/**
 * Collections as a Nuvio collections file: one collection per group (in the
 * order groups first appear; ungrouped ones under `ungrouped`), each of
 * Orbit's collections a folder.
 */
export function exportCollections(collections: readonly Collection[], ungrouped: string): unknown[] {
  const groups = new Map<string, Collection[]>();
  for (const c of collections) {
    const name = c.group ?? ungrouped;
    groups.set(name, [...(groups.get(name) ?? []), c]);
  }
  return [...groups].map(([title, members], g) => ({
    id: `orbit-group-${g + 1}`,
    title,
    backdropImageUrl: null,
    pinToTop: false,
    viewMode: 'TABBED_GRID',
    showAllTab: true,
    folders: members.map((c) => ({
      id: `orbit-${c.id}`,
      title: c.name,
      coverImageUrl: c.cover ?? null,
      heroBackdropUrl: c.backdrop ?? null,
      tileShape: TILE_SHAPES[c.shape],
      hideTitle: false,
      sources: c.sources.map(exportSource),
      catalogSources: c.sources.flatMap((s) => (s.kind === 'addon' ? [{ addonId: s.addon, type: s.type, catalogId: s.catalog, ...(s.genre ? { genre: s.genre } : {}) }] : [])),
      ...(c.sources.length ? {} : { orbitTitles: c.titles.slice(0, MAX_TITLES).map(snapshot) }),
    })),
  }));
}
