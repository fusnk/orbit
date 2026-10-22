/**
 * The profile's own ratings and notes: 0.5–5 stars in half steps, a "liked"
 * heart and a private note per title, kept in SQLite (Rust, see ratings.rs).
 * Only Orbit's: nothing here goes to Stremio or Letterboxd. Loaded at
 * startup; reads are synchronous from memory and every change reloads from
 * storage, like lists.ts.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';

/** Rust caps notes at this many characters (counted as code points). */
export const MAX_NOTE_CHARS = 2000;

export interface UserRating {
  /** 0.5–5 in half steps; null when only liked or noted. */
  rating: number | null;
  liked: boolean;
  note: string | null;
  updatedAt: number;
}

export type RatingChange = Partial<Pick<UserRating, 'rating' | 'liked' | 'note'>>;

const RowSchema = v.object({
  titleId: v.string(),
  rating: v.nullable(v.pipe(v.number(), v.minValue(0.5), v.maxValue(5))),
  liked: v.boolean(),
  note: v.nullable(v.pipe(v.string(), v.maxLength(MAX_NOTE_CHARS * 2))),
  updatedAt: v.number(),
});

let entries = new Map<string, UserRating>();
const listeners = new Set<() => void>();
let loads = 0;

export async function loadRatings(): Promise<void> {
  // Reloads can overlap (quick changes); an older answer mustn't replace a newer one.
  const generation = ++loads;
  const rows = await invoke<unknown[]>('rating_all');
  if (generation !== loads) return;
  const next = new Map<string, UserRating>();
  for (const raw of rows) {
    const row = v.safeParse(RowSchema, raw);
    if (row.success) next.set(row.output.titleId, { rating: row.output.rating, liked: row.output.liked, note: row.output.note, updatedAt: row.output.updatedAt });
  }
  entries = next;
  for (const listener of listeners) listener();
}

/** The profile's rating, heart and note for a title, if any. */
export const userRating = (titleId: string): UserRating | undefined => entries.get(titleId);

/** Whether the profile has rated anything with stars. */
export const hasRatings = (): boolean => [...entries.values()].some((e) => e.rating !== null);

/** Calls `listener` whenever ratings change; returns an unsubscribe function. */
export function onRatingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Each title's latest change, so the next one waits for it. */
const writes = new Map<string, Promise<void>>();

/**
 * Changes some of a title's rating, heart and note (the rest stay), then
 * reloads. Errors (e.g. a note that's too long) reach the caller. Changes to
 * one title go out one after another, each merged onto the one before, so a
 * quick second change (stars, then the heart) can't undo the first.
 */
export function setUserRating(titleId: string, change: RatingChange): Promise<void> {
  const write = (writes.get(titleId) ?? Promise.resolve()).catch(() => undefined).then(() => saveRating(titleId, change));
  writes.set(titleId, write);
  const forget = () => {
    if (writes.get(titleId) === write) writes.delete(titleId);
  };
  write.then(forget, forget);
  return write;
}

async function saveRating(titleId: string, change: RatingChange): Promise<void> {
  const next = { ...emptyRating(), ...entries.get(titleId), ...change };
  try {
    await invoke<void>('rating_set', { titleId, rating: next.rating, liked: next.liked, note: cleanNote(next.note) });
    // Saved: the next change merges onto this even if the reload below is overtaken by another.
    entries = new Map(entries).set(titleId, { ...next, note: cleanNote(next.note) });
  } finally {
    await loadRatings().catch((err: unknown) => console.error('Could not reload ratings', err));
  }
}

const emptyRating = (): UserRating => ({ rating: null, liked: false, note: null, updatedAt: 0 });

/** A note as it's saved: trimmed, and null when empty. */
export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/** A note's length as Rust counts it (code points, so an emoji is one). */
export const noteLength = (note: string): number => [...note].length;

/** Any value as a rating: half steps from 0.5 to 5, or null for none (0 and below). */
export function clampRating(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const halves = Math.round(Math.min(5, value) * 2);
  return halves >= 1 ? halves / 2 : null;
}

/**
 * The rating a pointer picks along the stars: `at` is how far along it is
 * from the start side (0–1). Each star has two halves; the half under the
 * pointer counts, so the very start is half a star.
 */
export function ratingAt(at: number): number {
  const halves = Math.ceil(Math.max(0, Math.min(1, at)) * 10);
  return Math.max(1, halves) / 2;
}

/** How full star `index` (0–4) is for `rating`. */
export function starFill(rating: number | null, index: number): 'full' | 'half' | 'empty' {
  const left = (rating ?? 0) - index;
  return left >= 1 ? 'full' : left >= 0.5 ? 'half' : 'empty';
}
