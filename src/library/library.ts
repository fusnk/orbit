/**
 * My Library: saved titles, persisted in SQLite (Rust) with a display
 * snapshot each so the page renders without the network. Loaded once at
 * startup; reads are synchronous from memory, writes update memory first and
 * roll back if saving fails.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { activeProfileId } from './profiles';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

export interface LibraryEntry {
  title: Title;
  /** Milliseconds since the epoch. */
  addedAt: number;
}

/** Stored rows are validated like addon data: the snapshot's fields came from addons. */
const RowSchema = v.object({
  id: v.string(),
  addedAt: v.number(),
  title: SnapshotSchema,
});

const entries = new Map<string, LibraryEntry>();
const listeners = new Set<() => void>();
let writes: Promise<unknown> = Promise.resolve();
/**
 * The profile these titles were read for. Every save names it, and Rust refuses
 * one for a profile that's no longer active: a save still queued when the person
 * switches profile (a found genre, a quick toggle) lands just before the window
 * reloads, and would otherwise put this profile's title in the next one's library.
 */
let profile: string | null = null;
const forProfile = <T extends object>(args: T): T & { profile?: string } => (profile ? { ...args, profile } : args);

function changed(): void {
  for (const listener of listeners) listener();
}

/** Why the last load failed, or null: My Library shows that, not an empty library. */
let loadError: unknown = null;
export const libraryLoadError = (): unknown => loadError;

/** Reads the library from storage; call once before the first page renders. */
export async function loadLibrary(): Promise<void> {
  let rows: unknown[];
  try {
    [rows, profile] = await Promise.all([invoke<unknown[]>('library_list'), activeProfileId().catch(() => null)]);
  } catch (err) {
    // Nothing kept from before (e.g. another profile's titles), and listeners redraw to show the error.
    loadError = err;
    entries.clear();
    changed();
    throw err;
  }
  loadError = null;
  entries.clear();
  for (const raw of rows) {
    const row = v.safeParse(RowSchema, raw);
    // A row that no longer validates (e.g. an http poster) is skipped, not fatal.
    if (row.success) entries.set(row.output.id, { title: fromSnapshot(row.output.title), addedAt: row.output.addedAt });
  }
  changed();
}

export function inLibrary(id: string): boolean {
  return entries.has(id);
}

/** Saved titles, most recently added first. */
export function libraryEntries(): LibraryEntry[] {
  return [...entries.values()].sort((a, b) => b.addedAt - a.addedAt);
}

/** Calls `listener` whenever the library changes; returns an unsubscribe function. */
export function onLibraryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Gives saved titles that had no genres the ones found for them
 * (genre-fill.ts), saved with each title's snapshot; when each was added
 * stays as it was. Listeners aren't called: it's nothing the person did, and
 * My Library, which looked them up, updates its own genre filter.
 */
export function addLibraryGenres(found: ReadonlyMap<string, readonly string[]>): void {
  for (const [id, genres] of found) {
    const entry = entries.get(id);
    if (!entry || entry.title.genres.length || !genres.length) continue;
    const title = { ...entry.title, genres: [...genres] };
    entries.set(id, { ...entry, title });
    writes = writes.then(() => invoke('library_add', forProfile({ id, title: snapshot(title) }))).catch((err: unknown) => console.error('Could not save a saved title’s genres', err));
  }
}

/** The saved entry for `id`, if it's in My Library. */
export const libraryEntry = (id: string): LibraryEntry | undefined => entries.get(id);

/**
 * Adds or removes `title`. Resolves true once the change is saved; on
 * failure the change is undone, the user is told, and it resolves false.
 */
export function toggleLibrary(title: Title): Promise<boolean> {
  const previous = entries.get(title.id);
  return update(title, previous, previous ? undefined : { title, addedAt: Date.now() });
}

/**
 * Undo for a removal: puts `entry` back as it was, with when it was first
 * added, so it returns to its place in "Recently added" rather than to the
 * top. Nothing changes if the title was saved again meanwhile.
 */
export function restoreLibrary(entry: LibraryEntry): Promise<boolean> {
  if (entries.has(entry.title.id)) return Promise.resolve(true);
  return update(entry.title, undefined, entry);
}

/** Removes `previous` (when `next` is undefined) or saves `next`, as `toggleLibrary` describes. */
async function update(title: Title, previous: LibraryEntry | undefined, next: LibraryEntry | undefined): Promise<boolean> {
  if (next) entries.set(title.id, next);
  else entries.delete(title.id);
  changed();
  // Saved one after another: two quick toggles reach storage in the order they were made.
  const write = writes.then(() => (next ? invoke('library_add', forProfile({ id: title.id, title: snapshot(next.title), addedAt: next.addedAt })) : invoke('library_remove', forProfile({ id: title.id }))));
  writes = write.catch(() => {});
  try {
    await write;
    return true;
  } catch (err) {
    console.error('Could not update My Library', err);
    if (previous) entries.set(title.id, previous);
    else entries.delete(title.id);
    changed();
    toast(t(next ? 'titles.library.update-failed-add' : 'titles.library.update-failed-remove', { name: title.name }));
    return false;
  }
}
