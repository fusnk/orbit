/**
 * Letterboxd, from the person's public profile (Settings → Integrations):
 * their recent diary with stars, and their watchlist when it's public. Rust
 * reads letterboxd.com and matches films to IMDb ids (see letterboxd.rs);
 * only the username is stored, as a setting per profile, since it's public anyway.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { settings } from '../lib/ipc';
import { profileSetting } from '../library/profiles';
import type { Title } from './titles';

export const LETTERBOXD_KEY = 'letterboxd.profile';
/** Dispatched on `document` when the profile is connected or disconnected. */
export const LETTERBOXD_CHANGED = 'orbit:letterboxd';

const ProfileSchema = v.object({ user: v.pipe(v.string(), v.regex(/^\w{1,40}$/)), name: v.pipe(v.string(), v.maxLength(300)) });
export type LetterboxdProfile = v.InferOutput<typeof ProfileSchema>;

const FilmSchema = v.object({
  imdbId: v.pipe(v.string(), v.regex(/^tt\d+$/)),
  name: v.string(),
  poster: v.nullable(v.pipe(v.string(), v.startsWith('https://'))),
  background: v.nullable(v.pipe(v.string(), v.startsWith('https://'))),
  year: v.nullable(v.string()),
  overview: v.nullable(v.string()),
  rating: v.nullable(v.number()),
  liked: v.boolean(),
});

export interface LetterboxdFilm {
  title: Title;
  /** The person's stars, 0.5–5. */
  rating: number | null;
  liked: boolean;
}

/** The saved profile, or null. */
export async function letterboxdProfile(): Promise<LetterboxdProfile | null> {
  const parsed = v.safeParse(ProfileSchema, (await profileSetting(LETTERBOXD_KEY)).value);
  return parsed.success ? parsed.output : null;
}

/** Checks a username or profile link with Letterboxd, then saves it. */
export async function connectLetterboxd(input: string): Promise<LetterboxdProfile> {
  const profile = v.parse(ProfileSchema, await invoke('letterboxd_profile', { input }));
  await settings.set((await profileSetting(LETTERBOXD_KEY)).key, profile);
  document.dispatchEvent(new Event(LETTERBOXD_CHANGED));
  return profile;
}

export async function disconnectLetterboxd(): Promise<void> {
  await settings.set((await profileSetting(LETTERBOXD_KEY)).key, null);
  document.dispatchEvent(new Event(LETTERBOXD_CHANGED));
}

function toFilms(raw: unknown): LetterboxdFilm[] {
  return v.parse(v.array(FilmSchema), raw).map((f) => ({
    title: { id: f.imdbId, type: 'movie', name: f.name, poster: f.poster ?? undefined, background: f.background ?? undefined, year: f.year ?? undefined, description: f.overview ?? undefined, genres: [], origins: [] },
    rating: f.rating,
    liked: f.liked,
  }));
}

/** Recently logged films, newest first. */
export const letterboxdDiary = async (user: string) => toFilms(await invoke('letterboxd_diary', { user }));

/** The watchlist, most recently added first; null when Letterboxd doesn't show it publicly. */
export async function letterboxdWatchlist(user: string): Promise<LetterboxdFilm[] | null> {
  const raw = await invoke<unknown>('letterboxd_watchlist', { user });
  return raw === null ? null : toFilms(raw);
}

/** A public Letterboxd list: its owner's username and its slug. */
export interface LetterboxdListRef {
  owner: string;
  slug: string;
}

/**
 * A list's owner and slug from its address. Only
 * `https://letterboxd.com/{user}/list/{slug}/` passes (Rust checks it again).
 */
export function parseListUrl(input: string): LetterboxdListRef | null {
  const match = /^https:\/\/letterboxd\.com\/(\w{1,40})\/list\/([A-Za-z0-9-]{1,200})\/?$/.exec(input.trim());
  return match ? { owner: match[1]!.toLowerCase(), slug: match[2]! } : null;
}

const ListInfoSchema = v.object({ owner: v.pipe(v.string(), v.regex(/^\w{1,40}$/)), slug: v.pipe(v.string(), v.regex(/^[A-Za-z0-9-]{1,200}$/)), name: v.pipe(v.string(), v.minLength(1), v.maxLength(600)) });
export type LetterboxdListInfo = v.InferOutput<typeof ListInfoSchema>;

/** Checks a pasted list address with Letterboxd; rejects with a message to show. */
export async function letterboxdListInfo(url: string): Promise<LetterboxdListInfo> {
  return v.parse(ListInfoSchema, await invoke('letterboxd_list_info', { url }));
}

/** One page (up to 100 films) of a public list, in its order; films Orbit couldn't match are left out. */
export async function letterboxdList(list: LetterboxdListRef, page: number): Promise<Title[]> {
  return toFilms(await invoke('letterboxd_list', { owner: list.owner, slug: list.slug, page })).map((film) => film.title);
}

/** Letterboxd lists have at most five pages Orbit reads (src-tauri/src/letterboxd.rs). */
export const LIST_PAGES = 5;

/**
 * A list's page `n` for a grid, with `allow` (the profile's content limit)
 * applied. The list ends after its last page or at one Letterboxd couldn't
 * fill, not at one the limit emptied: later pages may hold titles it allows.
 */
export async function letterboxdListPage(list: LetterboxdListRef, n: number, allow: (titles: Title[]) => Promise<Title[]>): Promise<{ titles: Title[]; done: boolean }> {
  const found = await letterboxdList(list, n);
  return { titles: await allow(found), done: n >= LIST_PAGES || found.length === 0 };
}

const ReviewSchema = v.object({
  // Rust caps these in characters; an emoji takes two of JavaScript's.
  author: v.pipe(v.string(), v.minLength(1), v.maxLength(600)),
  avatar: v.nullable(v.pipe(v.string(), v.maxLength(1024), v.regex(/^https:\/\/[as]\.ltrbxd\.com\//))),
  rating: v.nullable(v.pipe(v.number(), v.minValue(0.5), v.maxValue(5))),
  liked: v.boolean(),
  spoilers: v.boolean(),
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(3000)),
  url: v.pipe(v.string(), v.maxLength(400), v.startsWith('https://letterboxd.com/')),
});
export type LetterboxdReview = v.InferOutput<typeof ReviewSchema>;

const ReviewsSchema = v.object({ url: v.pipe(v.string(), v.maxLength(400), v.startsWith('https://letterboxd.com/film/')), reviews: v.array(ReviewSchema) });
export type LetterboxdReviews = v.InferOutput<typeof ReviewsSchema>;

/**
 * A film's popular reviews from its public Letterboxd page (no account
 * needed), or null for titles Letterboxd doesn't list.
 */
export async function letterboxdReviews(title: Pick<Title, 'id' | 'type'>): Promise<LetterboxdReviews | null> {
  if (title.type !== 'movie' || !/^tt\d+$/.test(title.id)) return null;
  const raw = await invoke<unknown>('letterboxd_reviews', { imdbId: title.id });
  return raw === null ? null : v.parse(ReviewsSchema, raw);
}

/** 3.5 as "★★★½". */
export function stars(rating: number): string {
  const halves = Math.round(Math.min(5, Math.max(0, rating)) * 2);
  return '★'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '½' : '');
}
