/**
 * Loads titles from the user's addons for the UI. Responses are cached in
 * memory for a few minutes so moving between pages doesn't refetch; failures
 * aren't cached, so Retry really retries.
 */
import { aggregate } from '../addons/aggregate';
import { AddonFailure, toAddonError } from '../addons/errors';
import * as registry from '../addons/registry';
import { buildPath } from '../addons/request';
import { isEligible, isUsable } from '../addons/routing';
import { CatalogResponseSchema, MetaResponseSchema, StreamResponseSchema, SubtitlesResponseSchema, parseWith, streamKey } from '../addons/schema';
import type { AddonOrigin, AggregateEvent, MetaDetail, ResourceRequest, Sourced, Stream, Subtitle, UsableAddon } from '../addons/types';
import { settleWithin } from '../lib/timeout';
import { isJellyfinId, jellyfinMeta } from '../library/jellyfin';
import { isPlexId, plexMeta } from '../library/plex';
import { withoutAdultAddons } from './parental';
import { streamTtl } from './stream-cache';
import { fromDetail, fromPreview, type CatalogRef, type Title } from './titles';

const TTL_MS = 10 * 60 * 1000;
/** Catalog pages and title details kept at most; a long session browses far more than it revisits. */
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;
  // Expired entries go, then the oldest (a Map keeps insertion order).
  for (const [k, entry] of cache) if (now - entry.at >= TTL_MS) cache.delete(k);
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  const value = load();
  const entry = { at: now, value };
  cache.set(key, entry);
  // Only this entry: a newer load under the same key may have replaced it.
  value.catch(() => cache.get(key) === entry && cache.delete(key));
  return value;
}

// A refreshed manifest can change what an addon's catalogs hold or are called.
registry.onAddonsChange(() => cache.clear());

const originOf = (addon: UsableAddon) => ({ key: addon.key, name: addon.manifest.name });

/**
 * Enabled, readable addons in the user's order, with the built-ins installed
 * first. Adult addons are left out on a profile with a content limit.
 */
export async function usableAddons(): Promise<UsableAddon[]> {
  // Offline on first run: carry on with whatever is installed; retried next time.
  const builtins = await registry.ensureBuiltins().then(
    () => null,
    (err: unknown) => {
      console.warn('Could not install built-in addons', err);
      return err;
    },
  );
  const installed = await registry.list();
  // Nothing installed at all (built-ins can't be removed, so they never were): the pages say why, offline or
  // unreachable, with Try again, rather than "no catalogs, enable Cinemeta" for an addon that isn't there.
  if (builtins !== null && !installed.length) throw builtins;
  return withoutAdultAddons(installed.filter(isUsable));
}

/** The cached loads that are catalog pages (the cache also holds title details). */
const catalogPages = new WeakSet<Promise<unknown>>();

export function loadCatalog(ref: CatalogRef, extra: [string, string][] = []): Promise<Title[]> {
  const req: ResourceRequest = { resource: 'catalog', type: ref.catalog.type, id: ref.catalog.id, extra: [...ref.extra, ...extra] };
  const page = cached(`${ref.addon.key}|${buildPath(req)}`, async () => {
    const { metas } = parseWith(CatalogResponseSchema, await registry.request(ref.addon, req));
    return metas.map((meta) => fromPreview(meta, [originOf(ref.addon)]));
  });
  // Search results answer one query; they aren't catalogs to choose from.
  if (!extra.some(([name]) => name === 'search')) catalogPages.add(page);
  return page;
}

/** How long `loadedCatalogTitles` waits for pages still loading. */
const LOADED_WAIT_MS = 1500;

/**
 * Titles from the catalog pages already loaded (and still fresh), in the
 * order they were loaded, without asking any addon: for pickers that choose
 * only among what Orbit already has (Tonight). Pages still loading are
 * waited for briefly; failed ones are skipped.
 */
export async function loadedCatalogTitles(): Promise<Title[]> {
  const now = Date.now();
  const pages = [...cache.values()].filter((entry) => now - entry.at < TTL_MS && catalogPages.has(entry.value)).map((entry) => entry.value as Promise<Title[]>);
  const settled = await Promise.all(pages.map((page) => settleWithin(page, LOADED_WAIT_MS, [] as Title[])));
  return settled.flat();
}

/**
 * Full details for a title from the first addon (in the user's order) that
 * has them. Resolves null when every addon answered but none knew the title;
 * throws if every addon failed.
 */
export function loadMeta(type: string, id: string): Promise<Title | null> {
  const req: ResourceRequest = { resource: 'meta', type, id };
  const key = `meta|${type}|${id}`;
  /** Some addon failed: a "nobody knows it" answer isn't sure, so it isn't kept (the next visit asks again). */
  let unsure = false;
  const value = cached(key, async () => {
    // A title only on the person's Jellyfin server: its details come from there.
    if (isJellyfinId(id)) return jellyfinMeta(id);
    // Likewise for one only on their Plex server.
    if (isPlexId(id)) return plexMeta(id);
    const addons = (await usableAddons()).filter((addon) => isEligible(addon, req));
    // All asked at once, read in the user's order: the first that knows the title wins as soon as
    // every addon before it has answered, without waiting on a slow one after it (up to Rust's timeout).
    const ask = async (addon: UsableAddon) => ({ addon, meta: parseWith(MetaResponseSchema, await registry.request(addon, req)).meta });
    // Settled up front, so one failing after the winner isn't an unhandled rejection.
    const asks = addons.map((addon) => Promise.allSettled([ask(addon)]).then(([result]) => result!));
    const results: Awaited<(typeof asks)[number]>[] = [];
    for (const pending of asks) {
      const result = await pending;
      if (result.status === 'fulfilled' && result.value.meta) {
        keepVideoStreams(result.value.meta, result.value.addon);
        return fromDetail(result.value.meta, [originOf(result.value.addon)]);
      }
      results.push(result);
    }
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure && results.every((r) => r.status === 'rejected')) throw new AddonFailure(toAddonError(failure.reason));
    unsure = failure !== undefined;
    return null;
  });
  void value.then(
    (title) => title === null && unsure && cache.get(key)?.value === value && cache.delete(key),
    () => undefined,
  );
  return value;
}

/** An episode as stream and subtitle requests need it: `id` is its video id from the meta, when it has one. */
export interface EpisodeAt {
  season: number;
  number: number;
  id: string | undefined;
}

/**
 * The stream request for a movie, or for one episode of a series. As in
 * stremio-core, an episode is asked for by its own video id from the meta's
 * `videos` (`tt123:1:2` from Cinemeta, `kitsu:1234:5` from an anime addon);
 * `id:season:episode` is only the fallback for an episode without one. A
 * movie is asked for by the meta's `behaviorHints.defaultVideoId` when it has
 * one, as Stremio opens its streams: the TMDB addon's `tmdb:` movies name
 * their IMDb id there, the only kind most stream addons know.
 */
export function streamRequest(title: Title, episode?: EpisodeAt): ResourceRequest {
  return { resource: 'stream', type: title.type, id: episode ? episode.id || `${title.id}:${episode.season}:${episode.number}` : (title.defaultVideoId ?? title.id) };
}

/**
 * Streams a meta lists inside its videos, by `type|video id`, and the addon
 * whose meta listed them. As in Stremio, a video with its own streams is
 * played from those alone: no addon is asked for streams for it. Kept in
 * memory only (stream URLs can carry debrid tokens), never on the Title,
 * which is saved and sent elsewhere.
 */
const videoStreams = new Map<string, { origin: AddonOrigin; items: Sourced<Stream>[] }>();
/** Videos kept at most; one show can list thousands. */
const MAX_VIDEO_STREAMS = 10_000;
registry.onAddonsChange(() => videoStreams.clear());

const videoStreamsKey = (type: string, id: string) => `${type}|${id}`;

function keepVideoStreams(meta: MetaDetail, addon: UsableAddon): void {
  for (const video of meta.videos ?? []) {
    const key = videoStreamsKey(meta.type, video.id);
    // A newer meta that no longer lists them sends the video back to the stream addons.
    videoStreams.delete(key);
    if (!video.streams) continue;
    while (videoStreams.size >= MAX_VIDEO_STREAMS) videoStreams.delete(videoStreams.keys().next().value!);
    const origin = originOf(addon);
    // Deduped as the addons' answers are (see `aggregate`).
    const unique = new Map<string, Stream>();
    for (const item of video.streams) if (!unique.has(streamKey(item))) unique.set(streamKey(item), item);
    const items = [...unique.values()].map((item) => ({ item, origins: [origin] }));
    videoStreams.set(key, { origin, items });
  }
}

/** The streams the meta listed for the video `req` asks for, if it did. */
const ownStreams = (req: ResourceRequest) => (req.resource === 'stream' && !req.extra?.length ? videoStreams.get(videoStreamsKey(req.type, req.id)) : undefined);

/** Addons that will be asked for streams for `req`: only the one whose meta listed the video's own streams, when it did. */
export async function streamAddons(req: ResourceRequest): Promise<UsableAddon[]> {
  const own = ownStreams(req);
  return (await usableAddons()).filter((addon) => (own ? addon.key === own.origin.key : isEligible(addon, req)));
}

/**
 * One round of stream requests, kept so whoever asks next for the same
 * movie or episode (the title page's quality badges, then Play or the
 * source picker) shares it instead of asking every addon again.
 */
interface StreamRun {
  addons: string;
  events: AggregateEvent<Stream>[];
  done: boolean;
  /** An addon failed: the next asker tries again rather than reuse it. */
  failed: boolean;
  error?: unknown;
  /** Reused until then (see stream-cache.ts); a round still in flight is always shared. */
  expiresAt: number;
  waiting: (() => void)[];
}

/** Rounds kept at most (in memory only; a window reload, as on switching profile, starts afresh). */
const MAX_STREAM_RUNS = 100;
const streamRuns = new Map<string, StreamRun>();
registry.onAddonsChange(() => streamRuns.clear());

/** The streams a run found (each partial result holds everything found so far). */
function foundIn(run: StreamRun): Stream[] {
  const last = run.events.filter((e) => e.type === 'partial').at(-1);
  return last?.type === 'partial' ? last.items.map(({ item }) => item) : [];
}

const fresh = (run: StreamRun, now: number) => !run.done || (!run.failed && now < run.expiresAt);

function startStreamRun(addons: UsableAddon[], req: ResourceRequest): StreamRun {
  const run: StreamRun = { addons: addons.map((a) => a.key).join(','), events: [], done: false, failed: false, expiresAt: Infinity, waiting: [] };
  const wake = () => run.waiting.splice(0).forEach((resume) => resume());
  void (async () => {
    // Its own signal: one asker giving up mustn't cut the round short for another.
    // (Requests already in flight finish either way; Rust times them out.)
    for await (const event of aggregate(addons, req, (json) => parseWith(StreamResponseSchema, json).streams, streamKey, new AbortController().signal)) {
      run.events.push(event);
      if (event.type === 'error') run.failed = true;
      wake();
    }
  })()
    .catch((err: unknown) => {
      run.failed = true;
      run.error = err;
    })
    .finally(() => {
      const now = Date.now();
      run.expiresAt = now + streamTtl(foundIn(run).map((s) => s.url), now);
      run.done = true;
      wake();
    });
  return run;
}

/** Streams from every eligible addon, yielded as each one answers. Deduped by URL. */
export async function* loadStreams(addons: UsableAddon[], req: ResourceRequest, signal: AbortSignal): AsyncGenerator<AggregateEvent<Stream>> {
  const own = ownStreams(req);
  if (own) {
    // The video's own streams, from the addon that listed them (when it's still among `addons`).
    const listed = addons.some((addon) => addon.key === own.origin.key);
    if (listed && !signal.aborted) yield { type: 'partial', origin: own.origin, items: own.items };
    if (!signal.aborted) yield { type: 'done', succeeded: listed ? 1 : 0, failed: 0 };
    return;
  }
  const key = buildPath(req);
  const now = Date.now();
  for (const [k, r] of streamRuns) if (!fresh(r, now)) streamRuns.delete(k);
  let run = streamRuns.get(key);
  if (!run || run.addons !== addons.map((a) => a.key).join(',')) {
    run = startStreamRun(addons, req);
    streamRuns.delete(key);
    while (streamRuns.size >= MAX_STREAM_RUNS) streamRuns.delete(streamRuns.keys().next().value!);
    streamRuns.set(key, run);
  }
  for (let i = 0; !signal.aborted; ) {
    if (i < run.events.length) {
      yield run.events[i++]!;
      continue;
    }
    if (run.done) {
      if (run.error !== undefined) throw run.error;
      return;
    }
    await new Promise<void>((resume) => {
      run.waiting.push(resume);
      signal.addEventListener('abort', () => resume(), { once: true });
    });
  }
}

/**
 * The streams found for `req` by a finished round that every addon answered,
 * if one is still fresh (see stream-cache.ts); never asks the addons.
 */
export function finishedStreams(req: ResourceRequest): Stream[] | undefined {
  const own = ownStreams(req);
  if (own) return own.items.map(({ item }) => item);
  const run = streamRuns.get(buildPath(req));
  if (!run?.done || !fresh(run, Date.now())) return undefined;
  return foundIn(run);
}

/** Subtitles an addon shipped with the stream playing, and that addon. */
export interface StreamSubtitles {
  subtitles: readonly Subtitle[];
  origin: AddonOrigin;
}

/**
 * The stream's own subtitles ahead of the subtitle addons' (they were made
 * for this very file), deduped by URL as `aggregate` does: the first one
 * found is kept, and every addon that returned it is listed.
 */
export function withStreamSubtitles(found: readonly Sourced<Subtitle>[], fromStream: StreamSubtitles | undefined): Sourced<Subtitle>[] {
  if (!fromStream?.subtitles.length) return [...found];
  const merged = new Map<string, Sourced<Subtitle>>();
  for (const item of fromStream.subtitles) if (!merged.has(item.url)) merged.set(item.url, { item, origins: [fromStream.origin] });
  for (const sub of found) {
    const existing = merged.get(sub.item.url);
    if (!existing) merged.set(sub.item.url, sub);
    else for (const origin of sub.origins) if (!existing.origins.some((o) => o.key === origin.key)) existing.origins.push(origin);
  }
  return [...merged.values()];
}

/**
 * Subtitles for a movie or episode from every subtitle addon, plus those the
 * stream's own addon shipped with it (`fromStream`), deduped by URL.
 * The stream's hash, size and filename help addons like OpenSubtitles match
 * the exact release; they're sent in stremio-core's order, so the addresses
 * match the ones Stremio asks for (and their caches). Addons that fail are
 * skipped; their names are returned.
 */
export async function loadSubtitles(
  title: Title,
  episode: EpisodeAt | undefined,
  hints: { filename?: string | undefined; videoSize?: number | undefined; videoHash?: string | undefined },
  signal: AbortSignal,
  fromStream?: StreamSubtitles,
): Promise<{ subtitles: Sourced<Subtitle>[]; failed: string[] }> {
  const extra: [string, string][] = [];
  if (hints.videoHash) extra.push(['videoHash', hints.videoHash]);
  if (hints.videoSize) extra.push(['videoSize', String(hints.videoSize)]);
  if (hints.filename) extra.push(['filename', hints.filename]);
  const req: ResourceRequest = { ...streamRequest(title, episode), resource: 'subtitles', extra };
  const addons = (await usableAddons()).filter((addon) => isEligible(addon, req));
  let subtitles: Sourced<Subtitle>[] = [];
  const failed: string[] = [];
  const events = aggregate(addons, req, (json) => parseWith(SubtitlesResponseSchema, json).subtitles, (sub) => sub.url, signal);
  for await (const event of events) {
    // Each one is everything found so far, merged.
    if (event.type === 'partial') subtitles = event.items;
    else if (event.type === 'error') failed.push(event.origin.name);
  }
  return { subtitles: withStreamSubtitles(subtitles, fromStream), failed };
}
