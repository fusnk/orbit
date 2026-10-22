/**
 * A title page's TMDB keywords ("topics") and where it streams, rents or
 * sells in the streaming region (TMDB's data, from JustWatch), and a film's
 * release dates there. Rust fetches and caches them; everything is checked
 * again here, as addon and web data always is.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { RELEASE_KINDS, type ReleaseKind } from './release-calendar';
import { streamingRegion } from './streaming';
import type { Title } from './titles';

const Id = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000_000));
const Name = (max: number) => v.pipe(v.string(), v.minLength(1), v.maxLength(max));

const ProviderSchema = v.object({ id: Id, name: Name(80), logo: v.pipe(v.string(), v.maxLength(300), v.startsWith('https://image.tmdb.org/')) });
const Providers = v.pipe(v.array(ProviderSchema), v.maxLength(12));

const TopicsSchema = v.object({
  keywords: v.pipe(v.array(v.object({ id: Id, name: Name(60) })), v.maxLength(24)),
  providers: v.object({ stream: Providers, rent: Providers, buy: Providers }),
});

export type TitleTopics = v.InferOutput<typeof TopicsSchema>;
export type WatchProvider = v.InferOutput<typeof ProviderSchema>;

const ReleasesSchema = v.pipe(
  v.array(v.object({ id: v.pipe(v.string(), v.regex(/^tt\d+$/)), releases: v.pipe(v.array(v.object({ kind: v.picklist(RELEASE_KINDS), date: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)) })), v.maxLength(3)) })),
  v.maxLength(1),
);

export interface Release {
  kind: ReleaseKind;
  /** "YYYY-MM-DD". */
  date: string;
}

const tmdbTitle = (title: Pick<Title, 'id' | 'type'>) => /^tt\d+$/.test(title.id) && (title.type === 'movie' || title.type === 'series');

/** Reads Rust's answer; anything that doesn't fit is dropped. */
export function parseTopics(raw: unknown): TitleTopics | null {
  const parsed = v.safeParse(TopicsSchema, raw);
  return parsed.success ? parsed.output : null;
}

/** One brand per badge: TMDB lists "Apple TV" and "Apple TV+" (or "Netflix" and "Netflix Standard with Ads") separately. */
export function providerBrand(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(standard\s+)?with\s+ads$/, '')
    .replace(/\s+(amazon|roku premium)\s+channel$/, '')
    .replace(/(\+|\s+plus|\s+store|\s+premium)$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Subscription providers come first from Rust; rentals and purchases aren't streaming. */
export function badgeProviders(topics: TitleTopics | null): WatchProvider[] {
  const seen = new Set<string>();
  return (topics?.providers.stream ?? []).filter((provider) => {
    const brand = providerBrand(provider.name) || String(provider.id);
    if (seen.has(brand) || !/^https:\/\/image\.tmdb\.org\/t\/p\/w92\/[a-zA-Z0-9._-]+$/.test(provider.logo)) return false;
    seen.add(brand);
    return true;
  }).slice(0, 2);
}

/** Session cache shared by hero badges and title-page sections, including pending lookups. */
const topicsCache = new Map<string, Promise<TitleTopics | null>>();

/** The title's topics and providers, or null without a TMDB token (or for titles TMDB can't look up). */
export async function titleTopics(title: Pick<Title, 'id' | 'type'>): Promise<TitleTopics | null> {
  if (!tmdbTitle(title)) return null;
  const region = await streamingRegion();
  const key = [region, title.type, title.id].join(':');
  const cached = topicsCache.get(key);
  if (cached) return cached;
  const pending = invoke<unknown>('tmdb_title_topics', { imdbId: title.id, kind: title.type, region }).then(parseTopics);
  topicsCache.set(key, pending);
  if (topicsCache.size > 256) topicsCache.delete(topicsCache.keys().next().value!);
  // An unavailable key or a transient error must not be remembered forever.
  void pending.then(
    (found) => { if (!found && topicsCache.get(key) === pending) topicsCache.delete(key); },
    () => { if (topicsCache.get(key) === pending) topicsCache.delete(key); },
  );
  return pending;
}

/** A film's cinema, digital and physical release days in the streaming region (or the US's), earliest first; null without a TMDB token. */
export async function titleReleases(title: Pick<Title, 'id' | 'type'>): Promise<Release[] | null> {
  if (title.type !== 'movie' || !tmdbTitle(title)) return null;
  const raw = await invoke<unknown>('tmdb_release_dates', { imdbIds: [title.id], region: await streamingRegion() });
  if (raw === null) return null;
  const parsed = v.safeParse(ReleasesSchema, raw);
  return parsed.success ? (parsed.output[0]?.releases ?? []) : null;
}

/**
 * Out in cinemas, but not yet to stream or buy (`today` as "YYYY-MM-DD"):
 * early copies of such a film are almost always recordings made in a cinema.
 */
export function onlyInCinemas(releases: readonly Release[], today: string): boolean {
  const out = releases.filter((r) => r.date <= today);
  return out.some((r) => r.kind === 'cinema') && !out.some((r) => r.kind !== 'cinema');
}
