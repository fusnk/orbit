/**
 * One custom list as a file (a list page's Export and My Lists' Import):
 * its name, description and titles, each title as the same small snapshot
 * My Library keeps. Pure, so it can be tested; lists.ts saves and loads.
 *
 * An imported file is untrusted (someone else may have made it, or edited
 * it by hand): it's size-capped before it's read, every title is checked
 * with the addon schemas (snapshot.ts) and dropped if it doesn't pass, and
 * Rust checks names, ids, sizes and limits again before writing anything.
 */
import * as v from 'valibot';
import type { Title } from '../catalog/titles';
import { nameOrder } from './filters';
import { snapshot, snapshotFits, SnapshotSchema, type Snapshot } from './snapshot';

/** Marks the file as one of Orbit's list exports, and its version. */
export const LIST_FILE_FORMAT = 1;
/** Larger files aren't read at all (a full list of 1000 titles is well under this). */
export const MAX_LIST_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_LIST_ITEMS = 1000;
export const MAX_LIST_NAME = 40;
export const MAX_LIST_DESCRIPTION = 300;

export class ListFileError extends Error {
  constructor(readonly problem: 'too-large' | 'not-json' | 'not-a-list' | 'empty') {
    super(problem);
  }
}

export interface ImportedList {
  name: string;
  description: string;
  items: { titleId: string; addedAt: number; title: Snapshot }[];
  /** Titles left out because they didn't pass the checks. */
  skipped: number;
}

/** The file's text for `list` (titles newest first, as the list keeps them). */
export function listFile(list: { name: string; description: string; titles: readonly Title[]; addedAt?: ReadonlyMap<string, number> }, now = Date.now()): string {
  return JSON.stringify(
    {
      orbitList: LIST_FILE_FORMAT,
      name: list.name,
      description: list.description,
      exportedAt: now,
      items: list.titles.map((title) => ({ id: title.id, addedAt: list.addedAt?.get(title.id) ?? now, title: snapshot(title) })),
    },
    null,
    2,
  );
}

/** Text with control characters (line breaks included) made into spaces, trimmed and cut to `max` characters. */
const plain = (text: string, max: number) => [...text.replace(/\p{Cc}+/gu, ' ').trim()].slice(0, max).join('').trim();

const FileSchema = v.object({
  orbitList: v.literal(LIST_FILE_FORMAT),
  name: v.pipe(v.string(), v.maxLength(1000)),
  description: v.fallback(v.pipe(v.string(), v.maxLength(10_000)), ''),
  items: v.pipe(v.array(v.unknown()), v.maxLength(MAX_LIST_ITEMS * 2)),
});

const ItemSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.check((id) => !/\p{Cc}/u.test(id))),
  // Whole milliseconds: Rust stores an integer and refuses the whole import over a fraction.
  addedAt: v.fallback(v.pipe(v.number(), v.finite(), v.minValue(0), v.transform(Math.floor)), 0),
  title: v.pipe(SnapshotSchema, v.check((s) => snapshotFits(s))),
});

/** Reads a list file: throws `ListFileError` when it isn't one; titles that don't pass are counted, not kept. */
export function parseListFile(text: string, now = Date.now()): ImportedList {
  if (text.length > MAX_LIST_FILE_BYTES) throw new ListFileError('too-large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ListFileError('not-json');
  }
  const file = v.safeParse(FileSchema, raw);
  if (!file.success) throw new ListFileError('not-a-list');
  const name = plain(file.output.name, MAX_LIST_NAME);
  if (!name) throw new ListFileError('not-a-list');
  const seen = new Set<string>();
  const items: ImportedList['items'] = [];
  let skipped = 0;
  for (const entry of file.output.items) {
    const item = v.safeParse(ItemSchema, entry);
    // The snapshot must describe the title it's filed under.
    if (!item.success || item.output.title.meta.id !== item.output.id || items.length >= MAX_LIST_ITEMS) {
      skipped++;
      continue;
    }
    if (seen.has(item.output.id)) continue;
    seen.add(item.output.id);
    items.push({ titleId: item.output.id, addedAt: Math.min(item.output.addedAt, now), title: item.output.title });
  }
  if (!items.length) throw new ListFileError('empty');
  return { name, description: plain(file.output.description, MAX_LIST_DESCRIPTION), items, skipped };
}

/** `name`, or "name (2)", "name (3)"… if a list is already called that, kept within the name limit. */
export function freeListName(name: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLocaleLowerCase()));
  if (!names.has(name.toLocaleLowerCase())) return name;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${[...name].slice(0, MAX_LIST_NAME - suffix.length).join('').trim()}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return name;
}

/** How a list page orders its titles: when added (newest first, as kept), by name, by year (newest first) or by rating (highest first). */
export const LIST_SORTS = ['added', 'title', 'year', 'rating'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

const yearOf = (title: Title) => Number(/\d{4}/.exec(title.year ?? '')?.[0] ?? NaN);
const ratingOf = (title: Title) => Number.parseFloat(title.rating ?? '');

/** `titles` (newest first) in `sort`'s order; titles without a year or rating go last, in the order added. */
export function sortListTitles(titles: readonly Title[], sort: ListSort, locale: string): Title[] {
  if (sort === 'added') return [...titles];
  if (sort === 'title') {
    const compare = nameOrder(locale);
    return [...titles].sort((a, b) => compare(a.name, b.name));
  }
  const value = sort === 'year' ? yearOf : ratingOf;
  const known = (title: Title) => Number.isFinite(value(title));
  return [...titles].sort((a, b) => Number(known(b)) - Number(known(a)) || (known(a) && known(b) ? value(b) - value(a) : 0));
}
