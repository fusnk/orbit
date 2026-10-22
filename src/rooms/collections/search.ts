/**
 * Finding a collection by name (the Collections page), and a title within a
 * long collection: accent- and case-blind, like My Library's name filter.
 */
import { fold } from '../../library/filters';

/** A fixed collection with at least this many titles gets a search field. */
export const LONG_COLLECTION = 12;

/** Whether `query` (as typed) is in any of `texts`; an empty query matches everything. */
export function matchesQuery(query: string, ...texts: (string | null | undefined)[]): boolean {
  const q = fold(query.trim());
  return !q || texts.some((text) => !!text && fold(text).includes(q));
}

/** Collections whose name or group holds `query`, in their order. */
export function findCollections<T extends { name: string; group?: string | null | undefined }>(collections: readonly T[], query: string): T[] {
  return collections.filter((c) => matchesQuery(query, c.name, c.group));
}
