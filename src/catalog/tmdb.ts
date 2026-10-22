/**
 * TMDB lists and recommendations, when the person has saved a TMDB token
 * (Settings → Integrations). Rust does the requests; results come back with
 * IMDb ids so they open like any other title.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { allowedTitles } from './parental';
import type { ContentLimit } from './ratings';
import type { Title } from './titles';

/** Rust builds every artwork URL from TMDB's image host; anything else is refused. */
const TmdbImage = v.nullable(v.pipe(v.string(), v.maxLength(300), v.startsWith('https://image.tmdb.org/')));

const TmdbTitleSchema = v.object({
  imdbId: v.pipe(v.string(), v.regex(/^tt\d+$/)),
  kind: v.picklist(['movie', 'series']),
  name: v.string(),
  poster: TmdbImage,
  background: TmdbImage,
  year: v.nullable(v.string()),
  overview: v.nullable(v.string()),
  released: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)))),
  rating: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(10)))),
});

/** TMDB's average (out of 10) for titles TMDB lists have shown, by IMDb id; the oldest go past MAX_RATINGS. */
const ratings = new Map<string, number>();
const MAX_RATINGS = 5000;
/** TMDB's average for a title, when a TMDB list has shown it this session. */
export const tmdbRating = (id: string): number | undefined => ratings.get(id);

/** Whether a TMDB token is saved. */
export const tmdbConnected = () => invoke<boolean>('tmdb_token_saved').catch(() => false);

/** Dispatched on `document` when a TMDB token is saved or removed. */
export const TMDB_CHANGED = 'orbit:tmdb-changed';
export const noteTmdbChanged = (): void => void document.dispatchEvent(new Event(TMDB_CHANGED));

/** Recommendations asked for lately, shared by Home's banner and its "Because you watched…" rows. */
// TMDB's answers, before the profile's content limit (applied on every call).
const recommended = new Map<string, { at: number; value: Promise<unknown> }>();
const RECOMMENDED_TTL_MS = 30 * 60 * 1000;
/** Every title page asks for its own, so a long session would otherwise keep them all. */
const MAX_RECOMMENDED = 100;

/** Titles like `title`, or null without a TMDB token (or for titles TMDB can't look up). */
export function recommendationsFor(title: Pick<Title, 'id' | 'type'>): Promise<Title[] | null> {
  if (!/^tt\d+$/.test(title.id) || (title.type !== 'movie' && title.type !== 'series')) return Promise.resolve(null);
  const key = `${title.type}|${title.id}`;
  const hit = recommended.get(key);
  const fresh = hit && Date.now() - hit.at < RECOMMENDED_TTL_MS ? hit : null;
  const entry = fresh ?? { at: Date.now(), value: invoke<unknown>('tmdb_recommendations', { imdbId: title.id, kind: title.type }) };
  if (!fresh) {
    // Expired answers go, then the oldest (a Map keeps insertion order).
    for (const [k, e] of recommended) if (entry.at - e.at >= RECOMMENDED_TTL_MS) recommended.delete(k);
    while (recommended.size >= MAX_RECOMMENDED) recommended.delete(recommended.keys().next().value!);
    recommended.set(key, entry);
    // Failures aren't kept, so Retry (or the next Home) asks again.
    entry.value.catch(() => recommended.get(key) === entry && recommended.delete(key));
  }
  return entry.value.then((raw) => allowedOrNull(toTitles(raw)));
}

const ServiceSchema = v.object({ key: v.string(), name: v.string(), logo: v.nullable(v.string()) });
export type StreamingService = v.InferOutput<typeof ServiceSchema>;

/**
 * The streaming services Orbit has catalogs for, with logos; null without a
 * TMDB token. With a `region`, only those offered there, in that country's order.
 */
export async function streamingServices(region?: string): Promise<StreamingService[] | null> {
  const raw = await invoke<unknown>('tmdb_services', region ? { region } : {});
  return raw === null ? null : v.parse(v.array(ServiceSchema), raw);
}

/** `tmdb_streaming` calls in flight, by service and region: Home can ask for one row twice as it starts. */
const streaming = new Map<string, Promise<unknown>>();

/** Popular on `service` in `region` (movies and shows), or null without a TMDB token. */
export async function streamingCatalog(service: string, region: string): Promise<Title[] | null> {
  const key = `${service}|${region}`;
  let raw = streaming.get(key);
  if (!raw) {
    const current = invoke<unknown>('tmdb_streaming', { service, region });
    const done = () => streaming.get(key) === current && streaming.delete(key);
    current.then(done, done);
    streaming.set(key, current);
    raw = current;
  }
  return allowedOrNull(toTitles(await raw));
}

const ServicePageSchema = v.object({ titles: v.array(TmdbTitleSchema), done: v.boolean() });

/** One page of a service's movies or shows (optionally one genre), or null without a TMDB token. */
export async function servicePage(service: string, region: string, kind: 'movie' | 'series', genre: string | undefined, page: number): Promise<{ titles: Title[]; done: boolean } | null> {
  const raw = await invoke<unknown>('tmdb_service_page', { service, region, kind, genre: genre ?? null, page });
  if (raw === null) return null;
  const result = v.parse(ServicePageSchema, raw);
  return { titles: await allowedTitles(toTitles(result.titles) ?? []), done: result.done };
}

const CastSchema = v.object({
  id: v.number(),
  name: v.string(),
  character: v.nullable(v.string()),
  photo: v.nullable(v.string()),
  /** The avatar picker's only: a still of this title showing them in the role. */
  still: v.optional(TmdbImage),
});
export type CastMember = v.InferOutput<typeof CastSchema>;

/** A title's cast with photos, or null without a TMDB token (or for titles TMDB can't look up). */
export async function castFor(title: Pick<Title, 'id' | 'type'>): Promise<CastMember[] | null> {
  if (!/^tt\d+$/.test(title.id) || (title.type !== 'movie' && title.type !== 'series')) return null;
  const raw = await invoke<unknown>('tmdb_cast', { imdbId: title.id, kind: title.type });
  return raw === null ? null : v.parse(v.array(CastSchema), raw);
}

const PersonSchema = v.object({
  name: v.string(),
  biography: v.nullable(v.string()),
  birthday: v.nullable(v.string()),
  deathday: v.nullable(v.string()),
  placeOfBirth: v.nullable(v.string()),
  photo: v.nullable(v.string()),
  knownFor: v.unknown(),
});
export type Person = Omit<v.InferOutput<typeof PersonSchema>, 'knownFor'> & { knownFor: Title[] };

/** A person's page, or null without a TMDB token. */
export async function personDetails(id: number): Promise<Person | null> {
  const raw = await invoke<unknown>('tmdb_person', { id });
  if (raw === null) return null;
  const person = v.parse(PersonSchema, raw);
  return { ...person, knownFor: await allowedTitles(toTitles(person.knownFor) ?? []) };
}

const PersonHitSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.maxLength(200)),
  photo: TmdbImage,
  knownFor: v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(5)),
});
export type PersonHit = v.InferOutput<typeof PersonHitSchema>;

/** People whose name matches `query` (Search), or null without a TMDB token. */
export async function searchPeople(query: string): Promise<PersonHit[] | null> {
  const raw = await invoke<unknown>('tmdb_search_people', { query });
  return raw === null ? null : v.parse(v.pipe(v.array(PersonHitSchema), v.maxLength(20)), raw);
}

const TitleHitSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  kind: v.picklist(['movie', 'series']),
  name: v.pipe(v.string(), v.maxLength(200)),
  year: v.nullable(v.pipe(v.string(), v.maxLength(4))),
  poster: TmdbImage,
  /** For content limits; null when TMDB has none (the hit then counts as unrated). */
  imdbId: v.nullable(v.pipe(v.string(), v.regex(/^tt\d{1,10}$/))),
  /** In TMDB's Animation genre. */
  animated: v.optional(v.boolean(), false),
});
export type TitleHit = v.InferOutput<typeof TitleHitSchema>;

/**
 * Hits from Rust that the active profile's content limit allows, and `also`
 * (the limit of the profile whose avatar is being chosen); null without a TMDB token.
 */
async function allowedHits(raw: unknown, also?: ContentLimit): Promise<TitleHit[] | null> {
  if (raw === null) return null;
  const hits = v.parse(v.pipe(v.array(TitleHitSchema), v.maxLength(20)), raw);
  // Only IMDb ids are rated: a hit without one is looked at as unrated.
  const rated = hits.map((hit) => ({ hit, id: hit.imdbId ?? `tmdb:${hit.id}`, type: hit.kind }));
  return (await allowedTitles(rated, undefined, also)).map(({ hit }) => hit);
}

/** Movies and shows whose name matches `query` (the avatar picker), by TMDB id, or null without a TMDB token. */
export async function searchTitles(query: string, also?: ContentLimit): Promise<TitleHit[] | null> {
  return allowedHits(await invoke<unknown>('tmdb_search_titles', { query }), also);
}

/** This week's most popular shows (the avatar picker's quick picks), or null without a TMDB token. */
export async function trendingShows(also?: ContentLimit): Promise<TitleHit[] | null> {
  return allowedHits(await invoke<unknown>('tmdb_trending_shows'), also);
}

/** The cast of a title found by `searchTitles`, each with a still of them in it when TMDB has one; null without a TMDB token. */
export async function castById(hit: Pick<TitleHit, 'id' | 'kind'>): Promise<CastMember[] | null> {
  const raw = await invoke<unknown>('tmdb_cast_by_id', { id: hit.id, kind: hit.kind });
  return raw === null ? null : v.parse(v.pipe(v.array(CastSchema), v.maxLength(40)), raw);
}

/** TMDB's lists Orbit shows on Home. */
export type TmdbList = 'movies-today' | 'series-today' | 'trending-week';

/** One of TMDB's lists, or null without a TMDB token. */
export async function tmdbList(list: TmdbList): Promise<Title[] | null> {
  return allowedOrNull(toTitles(await invoke<unknown>('tmdb_list', { list })));
}

const FranchiseSchema = v.object({
  id: v.number(),
  name: v.string(),
  overview: v.nullable(v.string()),
  poster: v.nullable(v.string()),
  backdrop: v.nullable(v.string()),
  parts: v.unknown(),
});
/** A TMDB collection (a franchise), its films in release order. */
export type Franchise = Omit<v.InferOutput<typeof FranchiseSchema>, 'parts'> & { parts: Title[] };

async function toFranchise(raw: unknown): Promise<Franchise> {
  const franchise = v.parse(FranchiseSchema, raw);
  return { ...franchise, parts: await allowedTitles(toTitles(franchise.parts) ?? []) };
}

/**
 * The franchise a movie belongs to: null without a TMDB token, undefined when
 * TMDB puts it in none (or it isn't a movie TMDB can look up).
 */
export async function titleCollection(title: Pick<Title, 'id' | 'type'>): Promise<Franchise | null | undefined> {
  if (!/^tt\d+$/.test(title.id) || title.type !== 'movie') return undefined;
  const raw = await invoke<unknown>('tmdb_title_collection', { imdbId: title.id });
  if (raw === null) return null;
  const { franchise } = v.parse(v.object({ franchise: v.unknown() }), raw);
  return franchise === null || franchise === undefined ? undefined : toFranchise(franchise);
}

/** A TMDB collection by id, or null without a TMDB token. */
export async function tmdbCollection(id: number): Promise<Franchise | null> {
  const raw = await invoke<unknown>('tmdb_collection', { id });
  return raw === null ? null : toFranchise(raw);
}

/** A custom collection's TMDB source, as src-tauri/src/tmdb.rs `SourceRequest` reads it. */
export interface TmdbSourceRequest {
  kind: string;
  id?: number | undefined;
  media: 'movie' | 'tv';
  sort?: string | undefined;
  filters?: Record<string, string | number> | undefined;
}

/** One page of a custom collection's TMDB source, or null without a TMDB token. */
export async function tmdbSourcePage(source: TmdbSourceRequest, page: number): Promise<{ titles: Title[]; done: boolean } | null> {
  const raw = await invoke<unknown>('tmdb_source_page', { source: { ...source, id: source.id ?? null, sort: source.sort ?? null, filters: source.filters ?? {} }, page });
  if (raw === null) return null;
  const result = v.parse(ServicePageSchema, raw);
  return { titles: await allowedTitles(toTitles(result.titles) ?? []), done: result.done };
}

const GenreArtSchema = v.record(v.pipe(v.string(), v.regex(/^\d{1,6}$/)), v.array(v.pipe(v.string(), v.maxLength(300), v.startsWith('https://image.tmdb.org/'))));

/** A few backdrops of each genre's popular films, by TMDB movie genre id; null without a TMDB token. */
export async function genreArt(genres: readonly number[]): Promise<Map<number, string[]> | null> {
  const raw = await invoke<unknown>('tmdb_genre_art', { genres });
  if (raw === null) return null;
  return new Map(Object.entries(v.parse(GenreArtSchema, raw)).map(([id, art]) => [Number(id), art]));
}

/** Awards Discover can browse (src-tauri/src/awards.rs `AWARDS`). */
export const AWARDS = ['oscars', 'golden-globes', 'bafta', 'emmys', 'cannes', 'venice', 'berlinale'] as const;
export type Award = (typeof AWARDS)[number];

/** One page of an award's winners (from Wikidata), newest first, or null without a TMDB token. */
export async function awardPage(award: Award, page: number): Promise<{ titles: Title[]; done: boolean } | null> {
  const raw = await invoke<unknown>('explore_award', { award, page });
  if (raw === null) return null;
  const result = v.parse(ServicePageSchema, raw);
  return { titles: await allowedTitles(toTitles(result.titles) ?? []), done: result.done };
}

/**
 * The title an IMDb id or a TMDB id names (Search's "Top result" for a
 * pasted id or link): undefined when TMDB doesn't know it, null without a
 * TMDB token. Rust does the lookup, so the token never reaches the page.
 */
export async function titleById(ref: { imdbId: string } | { tmdbId: number; kind?: 'movie' | 'tv' | undefined }): Promise<Title | null | undefined> {
  const raw = 'imdbId' in ref ? await invoke<unknown>('tmdb_find_title', { imdbId: ref.imdbId }) : await invoke<unknown>('tmdb_title_by_id', { id: ref.tmdbId, kind: ref.kind === undefined ? null : ref.kind === 'tv' ? 'series' : 'movie' });
  const titles = toTitles(raw);
  return titles === null ? null : (await allowedTitles(titles))[0];
}

/** The titles the profile's content limit allows (see parental.ts). */
const allowedOrNull = async (titles: Title[] | null) => (titles ? allowedTitles(titles) : null);

function toTitles(raw: unknown): Title[] | null {
  if (raw === null) return null;
  return v.parse(v.array(TmdbTitleSchema), raw).map((r) => {
    if (typeof r.rating === 'number') {
      // Re-added at the end, so the titles seen least recently are the ones dropped.
      ratings.delete(r.imdbId);
      ratings.set(r.imdbId, r.rating);
      if (ratings.size > MAX_RATINGS) ratings.delete(ratings.keys().next().value!);
    }
    return {
      id: r.imdbId,
      type: r.kind,
      name: r.name,
      poster: r.poster ?? undefined,
      background: r.background ?? undefined,
      year: r.year ?? undefined,
      description: r.overview ?? undefined,
      released: r.released ?? undefined,
      genres: [],
      origins: [],
    };
  });
}

const CertificationsSchema = v.object({ country: v.pipe(v.string(), v.regex(/^[A-Z]{2}$/)), certifications: v.pipe(v.array(v.pipe(v.string(), v.regex(/^[A-Za-z0-9 +\-/]{1,12}$/))), v.maxLength(30)) });

/** The movie certifications Discover's filters offer in `region` (or the US's), mildest first; null without a TMDB token. */
export async function movieCertifications(region: string): Promise<{ country: string; certifications: string[] } | null> {
  const raw = await invoke<unknown>('tmdb_movie_certifications', { region });
  return raw === null ? null : v.parse(CertificationsSchema, raw);
}
