/**
 * Details for watch history that lacks them. History brought in from
 * elsewhere (Stremio sync, Trakt, a backup) often keeps titles with only a
 * name and poster, so:
 *  - My Library → Stats would leave them out of its top genres. When Stats
 *    shows, the most recently watched titles without genres are looked up.
 *  - Continue Watching would show them as a poster on a blur with no
 *    "year · runtime" line. When it's drawn, its titles missing artwork or
 *    details are looked up.
 *  - My Library's genre filter would count only the few saved titles whose
 *    full details were ever opened. While the page shows, its saved titles
 *    without genres are looked up a batch at a time in idle moments, and
 *    what's found is saved with each title (see `fillLibraryGenres`).
 * Lookups go through the cached meta lookup, a few at a time, and what's
 * found is saved with the history, so each title is only looked up once for good.
 *
 * Kept cheap: each title is tried at most once a session (per kind), and a
 * session looks up at most `SESSION_LIMIT` titles per kind; the rest follow on later runs.
 */
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { isLocalId } from '../lib/local-media';
import { addLibraryGenres, libraryEntries } from './library';
import { fillTitleFields, watchHistory, withMissingFields, type FillableFields } from './watch';

const SESSION_LIMIT = 60;
const CONCURRENCY = 4;

export interface GenreFillDeps {
  load(type: string, id: string): Promise<Title | null>;
  /** Ids already tried; the ones tried now are added. */
  tried: Set<string>;
  concurrency: number;
}

/** Movies and series an addon can be asked about (not files, not TV channels). */
const lookable = (title: Title) => (title.type === 'movie' || title.type === 'series') && !isLocalId(title.id);

/** Titles without genres, most recently watched first, not yet tried, up to `limit`. */
export function needingGenres(entries: readonly { title: Title; updatedAt: number }[], tried: ReadonlySet<string>, limit: number): Title[] {
  if (limit <= 0) return [];
  return entries
    .filter(({ title }) => !title.genres.length && !tried.has(title.id) && lookable(title))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(({ title }) => title);
}

/** Whether a title lacks something Continue Watching shows: landscape art, its year, runtime or genres, or a logo. */
const lacksDetails = (title: Title) => !title.background || !title.logo || !title.year || !title.runtime || !title.genres.length;

/** Titles (in the order given) missing details, not yet tried, up to `limit`. */
export function needingDetails(titles: readonly Title[], tried: ReadonlySet<string>, limit: number): Title[] {
  if (limit <= 0) return [];
  return titles.filter((title) => lacksDetails(title) && !tried.has(title.id) && lookable(title)).slice(0, limit);
}

/** Looks up `titles`, `concurrency` at a time; failures and unknown titles are skipped. */
async function lookUp(titles: readonly Title[], deps: GenreFillDeps): Promise<Map<string, Title>> {
  const found = new Map<string, Title>();
  const queue = [...titles];
  for (const title of queue) deps.tried.add(title.id);
  const worker = async () => {
    for (let title = queue.shift(); title; title = queue.shift()) {
      const full = await deps.load(title.type, title.id).catch(() => null);
      if (full) found.set(title.id, full);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency, queue.length) }, worker));
  return found;
}

/** Looks up genres for `titles`, `concurrency` at a time; failures are skipped. */
export async function lookUpGenres(titles: readonly Title[], deps: GenreFillDeps): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const [id, full] of await lookUp(titles, deps)) {
    const genres = full.genres.map((g) => g.trim()).filter(Boolean);
    if (genres.length) found.set(id, genres);
  }
  return found;
}

/** Looks up the details `titles` lack; only titles with something new to add are returned. */
export async function lookUpDetails(titles: readonly Title[], deps: GenreFillDeps): Promise<Map<string, FillableFields>> {
  const found = new Map<string, FillableFields>();
  const byId = new Map(titles.map((title) => [title.id, title]));
  for (const [id, full] of await lookUp(titles, deps)) {
    const fields: FillableFields = { poster: full.poster, background: full.background, logo: full.logo, year: full.year, runtime: full.runtime, genres: full.genres.map((g) => g.trim()).filter(Boolean) };
    const title = byId.get(id);
    if (title && withMissingFields(title, fields) !== title) found.set(id, fields);
  }
  return found;
}

const triedGenres = new Set<string>();
let runningGenres: Promise<void> | null = null;

/** Fills in missing genres in watch history in the background (see above); safe to call on every Stats redraw. */
export function fillMissingGenres(): Promise<void> {
  runningGenres ??= (async () => {
    const titles = needingGenres(watchHistory().titles, triedGenres, SESSION_LIMIT - triedGenres.size);
    if (!titles.length) return;
    const found = await lookUpGenres(titles, { load: loadMeta, tried: triedGenres, concurrency: CONCURRENCY });
    fillTitleFields(new Map([...found].map(([id, genres]) => [id, { genres }])));
  })().finally(() => {
    runningGenres = null;
  });
  return runningGenres;
}

const triedDetails = new Set<string>();
let runningDetails: Promise<void> | null = null;

/**
 * Fills in what Continue Watching's `titles` lack, in the background (see
 * above); safe to call on every redraw. The cards redraw once it's saved.
 */
export function fillContinueWatching(titles: readonly Title[]): Promise<void> {
  runningDetails ??= (async () => {
    const wanted = needingDetails(titles, triedDetails, SESSION_LIMIT - triedDetails.size);
    if (!wanted.length) return;
    fillTitleFields(await lookUpDetails(wanted, { load: loadMeta, tried: triedDetails, concurrency: CONCURRENCY }));
  })().finally(() => {
    runningDetails = null;
  });
  return runningDetails;
}

/**
 * How much of a view must have genres before My Library offers a genre
 * filter: below it, the counts ("Action 2" in a library of 143) would mislead.
 */
export const GENRE_SHARE = 0.6;

/** Whether at least `share` of `titles` have genres; files and channels, which never get any, don't count. */
export function genresKnown(titles: readonly Title[], share = GENRE_SHARE): boolean {
  let known = 0;
  let total = 0;
  for (const title of titles) {
    if (title.genres.length) known++;
    else if (!lookable(title)) continue;
    total++;
  }
  return total > 0 && known / total >= share;
}

export interface BatchFillDeps extends GenreFillDeps {
  /** Resolves when there's time to spare for the next batch. */
  idle(): Promise<void>;
  /** Keeps what a batch found; called after each batch that found something. */
  save(found: ReadonlyMap<string, string[]>): void;
  signal: AbortSignal;
}

/**
 * Looks up genres for `titles` a batch of `concurrency` at a time, each batch
 * waiting for idle time and saved as soon as it's back; stops before the next
 * batch once `signal` aborts.
 */
export async function fillGenresInBatches(titles: readonly Title[], deps: BatchFillDeps): Promise<void> {
  for (let i = 0; i < titles.length; i += deps.concurrency) {
    await deps.idle();
    if (deps.signal.aborted) return;
    // A title another run tried meanwhile isn't asked about again.
    const batch = titles.slice(i, i + deps.concurrency).filter((title) => !deps.tried.has(title.id));
    if (!batch.length) continue;
    // Saved even if stopped meanwhile: it's kept for good, so it's never asked for again.
    const found = await lookUpGenres(batch, deps);
    if (found.size) deps.save(found);
  }
}

/** Fewer lookups at once than Stats makes: this runs while the person browses the page. */
const LIBRARY_CONCURRENCY = 3;
const triedLibrary = new Set<string>();

/** The browser's idle callback where there is one (WebKit has none), else a short pause. */
const idleTime = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 200);
  });

/**
 * Fills in genres for My Library's saved titles that have none, newest
 * first, in the background (see above). What's found is saved with each
 * title, so a title is looked up once for good; one no addon knows is tried
 * once a session. `onFound` runs after each batch is saved; `signal` stops it
 * (the page hidden or discarded).
 */
export function fillLibraryGenres(signal: AbortSignal, onFound: () => void): Promise<void> {
  const titles = needingGenres(
    libraryEntries().map((entry) => ({ title: entry.title, updatedAt: entry.addedAt })),
    triedLibrary,
    Infinity,
  );
  return fillGenresInBatches(titles, {
    load: loadMeta,
    tried: triedLibrary,
    concurrency: LIBRARY_CONCURRENCY,
    idle: idleTime,
    signal,
    save: (found) => {
      addLibraryGenres(found);
      onFound();
    },
  });
}
