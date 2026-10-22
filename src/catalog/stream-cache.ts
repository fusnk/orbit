/**
 * How long a finished round of stream results is reused (see service.ts):
 * long enough that coming back to a title is instant, short when what came
 * back can go stale sooner.
 *
 * - Usually 3 hours. Addons' answers rarely change faster, and a debrid
 *   addon's links point at the addon, which resolves them when played.
 * - Signed links (token=, expires=, sig=, …) stop working after a while: at
 *   most 15 minutes, or until a few minutes before the expiry they state.
 * - Nothing found: a minute, as an addon may just have been slow to index.
 *
 * Kept in memory only: stream URLs can carry debrid keys, so they're never
 * written to disk.
 */

export const STREAM_TTL_MS = 3 * 60 * 60_000;
export const SIGNED_TTL_MS = 15 * 60_000;
export const EMPTY_TTL_MS = 60_000;
/** A signed link is dropped this long before the expiry it states. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** Query parameters that mark a link as signed or expiring (lowercased). */
const SIGNED_PARAMS = new Set(['token', 'expires', 'expire', 'exp', 'sig', 'signature', 'policy', 'key-pair-id', 'hdnts', 'x-amz-signature', 'x-amz-expires', 'x-goog-signature', 'x-goog-expires']);
/** Of those, the ones that can state when it expires (Unix seconds). */
const EXPIRY_PARAMS = new Set(['expires', 'expire', 'exp']);

/** How long one link may be reused, from its query parameters. */
export function linkTtl(url: string, now: number): number {
  const query = url.indexOf('?');
  if (query < 0 || !/^https?:/i.test(url)) return STREAM_TTL_MS;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(url.slice(query + 1).split('#')[0]);
  } catch {
    return SIGNED_TTL_MS;
  }
  let ttl = STREAM_TTL_MS;
  for (const [name, value] of params) {
    const key = name.toLowerCase();
    if (!SIGNED_PARAMS.has(key)) continue;
    ttl = Math.min(ttl, SIGNED_TTL_MS);
    // A stated expiry (Unix seconds, 2001–2286) can shorten it further.
    if (EXPIRY_PARAMS.has(key) && /^\d{10}$/.test(value)) ttl = Math.min(ttl, Math.max(0, Number(value) * 1000 - now - EXPIRY_MARGIN_MS));
  }
  return ttl;
}

/** How long a round's results may be reused: its shortest-lived link decides; nothing found is reused briefly. */
export function streamTtl(urls: readonly string[], now: number): number {
  if (!urls.length) return EMPTY_TTL_MS;
  let ttl = STREAM_TTL_MS;
  for (const url of urls) {
    ttl = Math.min(ttl, linkTtl(url, now));
    if (ttl === 0) break;
  }
  return ttl;
}
