/**
 * Sources that failed recently for a movie or episode (wouldn't open, too
 * slow to start, stalled), so the next attempt ranks them last: in the
 * picker, for Play, for the next episode and when switching after a
 * failure. A failure is forgotten after six hours, so a short outage doesn't
 * bury a source for good, or as soon as the source plays.
 *
 * Kept per profile. Sources are remembered by a digest of their addon and
 * address (a torrent's info hash, or the URL), never the URL itself: stream
 * URLs can hold debrid keys.
 */
import * as v from 'valibot';
import { profileStore } from './profile-store';

export const FAILED_SOURCES_PREFIX = 'player.failed-sources';
export const FAILURE_TTL_MS = 6 * 60 * 60_000;
const MAX_FAILURES = 300;
const MAX_WHERE = 100;

/** How a source failed, as the player's failover tells it (see failover.ts). */
export const FAILURE_REASONS = ['failed', 'slow', 'stalled', 'placeholder'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * [movie or episode (see `whereKey`), source digest, when it failed (ms), how].
 * The reason came later: failures saved before it have three items.
 */
export type Failure = [where: string, digest: string, at: number, reason?: FailureReason];

const FailureSchema = v.tuple([v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_WHERE)), v.pipe(v.string(), v.regex(/^[0-9a-f]{1,16}$/)), v.pipe(v.number(), v.finite(), v.minValue(0))]);

/** The movie or episode a failure belongs to (hashed if long, to keep the setting small). */
export function whereKey(titleId: string, episodeId?: string): string {
  const where = `${titleId}/${episodeId ?? ''}`;
  return where.length <= MAX_WHERE ? where : `#${hash(where)}`;
}

/**
 * cyrb53: a fast 53-bit string hash. Sync, so ranking stays sync; it only
 * has to tell sources apart on this machine, and 53 bits of a URL can't give
 * back a key inside it.
 */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * A source's identity: its addon plus a torrent's info hash (its magnet's
 * tracker list can vary) or the URL.
 */
export function sourceDigest(addon: string, url: string): string {
  const infoHash = /^magnet:.*?xt=urn:btih:([a-z0-9]+)/i.exec(url)?.[1]?.toLowerCase();
  return hash(`${addon}\n${infoHash ?? url}`);
}

const isReason = (value: unknown): value is FailureReason => FAILURE_REASONS.includes(value as FailureReason);

/** Saved failures, minus junk and expired ones. An unknown reason is dropped, not the failure. */
export function parseFailures(value: unknown, now: number): Failure[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({ entry: entry as unknown, parsed: v.safeParse(FailureSchema, entry) }))
    .flatMap(({ entry, parsed }) => {
      if (!parsed.success) return [];
      const reason = Array.isArray(entry) ? (entry as unknown[])[3] : undefined;
      return [(isReason(reason) ? [...parsed.output, reason] : parsed.output) as Failure];
    })
    .filter(([, , at]) => at <= now && now - at < FAILURE_TTL_MS)
    .slice(-MAX_FAILURES);
}

/** Adds (or renews) a failure; the oldest go past the cap. */
export function addFailure(list: readonly Failure[], where: string, digest: string, now: number, reason?: FailureReason): Failure[] {
  const entry: Failure = reason ? [where, digest, now, reason] : [where, digest, now];
  return [...list.filter(([w, d]) => w !== where || d !== digest), entry].slice(-MAX_FAILURES);
}

export const removeFailure = (list: readonly Failure[], where: string, digest: string): Failure[] => list.filter(([w, d]) => w !== where || d !== digest);

/** Digests of the sources that failed for `where` in the last six hours. */
export function failedIn(list: readonly Failure[], where: string, now: number): Set<string> {
  return new Set(list.filter(([w, , at]) => w === where && now - at < FAILURE_TTL_MS).map(([, d]) => d));
}

/** The sources that failed for `where` in the last six hours, each with how (when known). */
export function failuresIn(list: readonly Failure[], where: string, now: number): Map<string, FailureReason | undefined> {
  return new Map(list.filter(([w, , at]) => w === where && now - at < FAILURE_TTL_MS).map(([, d, , reason]) => [d, reason]));
}

/** Keeps the order, with failed sources moved to the end. */
export function failedLast<T>(sources: readonly T[], failed: (source: T) => boolean): T[] {
  return [...sources.filter((s) => !failed(s)), ...sources.filter(failed)];
}

const store = profileStore(FAILED_SOURCES_PREFIX, (value) => parseFailures(value, Date.now()));

/** Reads the saved failures (once); the sync helpers below see them after this. */
export const loadFailures = (): Promise<void> => store.load();

/** Whether a source failed for this movie or episode recently. */
export function failedRecently(where: string): (source: { addon: string; url: string }) => boolean {
  const failed = failedIn(store.get(), where, Date.now());
  return (source) => failed.size > 0 && failed.has(sourceDigest(source.addon, source.url));
}

/** Whether a source failed for this movie or episode recently, and how (if known): null if it didn't. */
export function failureOf(where: string): (source: { addon: string; url: string }) => { reason: FailureReason | undefined } | null {
  const failed = failuresIn(store.get(), where, Date.now());
  return (source) => {
    const digest = failed.size > 0 ? sourceDigest(source.addon, source.url) : '';
    return failed.has(digest) ? { reason: failed.get(digest) } : null;
  };
}

export function markFailed(where: string, source: { addon: string; url: string }, reason?: FailureReason): void {
  void store.record((list) => addFailure(list, where, sourceDigest(source.addon, source.url), Date.now(), reason));
}

/** The source played after all: it isn't a failure any more. */
export function markPlayed(where: string, source: { addon: string; url: string }): void {
  const digest = sourceDigest(source.addon, source.url);
  if (!store.get().some(([w, d]) => w === where && d === digest)) return;
  void store.update((list) => removeFailure(list, where, digest));
}
