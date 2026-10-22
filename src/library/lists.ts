/**
 * Custom lists ("Date night", "Halloween"…), each a profile's own, persisted
 * in SQLite (Rust) with a display snapshot per title like My Library. Loaded
 * at startup; reads are synchronous from memory and every change reloads
 * from storage, so memory never drifts from what was saved.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import type { Title } from '../catalog/titles';
import { withDialog } from '../lib/ipc';
import type { ImportedList } from './list-file';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

export interface CustomList {
  id: string;
  name: string;
  /** Empty when it has none. */
  description: string;
  createdAt: number;
  /** Newest first. */
  titles: Title[];
  /** When each title was added, by id. */
  addedAt: Map<string, number>;
}

/** Stored rows are validated like addon data: the snapshots' fields came from addons. */
const ListSchema = v.object({
  id: v.string(),
  name: v.string(),
  description: v.fallback(v.string(), ''),
  createdAt: v.number(),
  items: v.array(v.object({ titleId: v.string(), addedAt: v.number(), title: v.unknown() })),
});

let lists: CustomList[] = [];
const listeners = new Set<() => void>();

let loads = 0;
/** Why the last read failed, or null: My Library shows that, rather than no lists. */
let loadError: unknown = null;
export const listsLoadError = (): unknown => loadError;

export async function loadLists(): Promise<void> {
  // Reloads can overlap (quick changes); an older answer mustn't replace a newer one.
  const generation = ++loads;
  let rows: unknown[];
  try {
    rows = await invoke<unknown[]>('list_all');
  } catch (err) {
    if (generation === loads) {
      loadError = err;
      for (const listener of listeners) listener();
    }
    throw err;
  }
  if (generation !== loads) return;
  loadError = null;
  lists = rows.flatMap((raw) => {
    const row = v.safeParse(ListSchema, raw);
    if (!row.success) return [];
    // A title that no longer validates is skipped, not fatal.
    const titles = row.output.items.flatMap((item) => {
      const s = v.safeParse(SnapshotSchema, item.title);
      return s.success ? [fromSnapshot(s.output)] : [];
    });
    const addedAt = new Map(row.output.items.map((item) => [item.titleId, item.addedAt]));
    return [{ id: row.output.id, name: row.output.name, description: row.output.description, createdAt: row.output.createdAt, titles, addedAt }];
  });
  for (const listener of listeners) listener();
}

/** Lists, oldest first. */
export const customLists = (): CustomList[] => lists;
export const findList = (id: string): CustomList | undefined => lists.find((l) => l.id === id);

/** Calls `listener` whenever lists change; returns an unsubscribe function. */
export function onListsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs a change, then reloads; errors (e.g. "List names are 1 to 40 characters.") reach the caller. */
async function change<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await loadLists().catch((err: unknown) => console.error('Could not reload lists', err));
  }
}

export const createList = (name: string) => change(() => invoke<string>('list_create', { name }));
export const renameList = (id: string, name: string) => change(() => invoke<void>('list_rename', { id, name }));
export const describeList = (id: string, description: string) => change(() => invoke<void>('list_describe', { id, description }));
export const deleteList = (id: string) => change(() => invoke<void>('list_delete', { id }));
/** Saves one list's export where the person picks (Downloads suggested); resolves to its path, or `null` if cancelled. */
export const saveListExport = (text: string) => withDialog('list_export_save', { text });
/** Creates a list from an imported file (already checked by list-file.ts); returns its id. */
export const importList = (list: ImportedList) => change(() => invoke<string>('list_import', { name: list.name, description: list.description, items: list.items }));
export const addToList = (listId: string, title: Title) => change(() => invoke<void>('list_add', { listId, titleId: title.id, title: snapshot(title) }));
export const removeFromList = (listId: string, titleId: string) => change(() => invoke<void>('list_remove', { listId, titleId }));
