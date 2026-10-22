/**
 * `behaviorHints.proxyHeaders.request` of an addon's http(s) stream: headers
 * the stream's server wants (a `Referer`, a `User-Agent`, an `Origin`), sent
 * by mpv with the requests for that one file. Rust checks them again with the
 * same rules (src-tauri/src/player/proxy_headers.rs); keep the two alike.
 *
 * The addon is untrusted, so only plain headers pass:
 * - names are HTTP tokens and values visible ASCII, so nothing can end a
 *   header line early and add another, or start a second request;
 * - headers that steer the connection or the request itself (Host, lengths,
 *   encodings, Range, Connection, Upgrade, Proxy-*) are refused: they belong
 *   to mpv and could break playback or smuggle a request;
 * - Cookie and Authorization are refused too. mpv/ffmpeg resend a file's
 *   headers when its server redirects elsewhere (an accepted limit, see
 *   docs/DEVELOPMENT.md), so a credential here would reach whatever host the redirect
 *   names. Addons that need a sign-in already put it in the stream's address.
 *
 * `proxyHeaders.response` is ignored: it tells Stremio's local streaming
 * server which headers to add when it hands the stream to a browser player.
 * Orbit plays in mpv, with no browser between, so there is nothing to apply it to.
 */

export const MAX_PROXY_HEADERS = 16;
export const MAX_HEADER_NAME = 64;
export const MAX_HEADER_VALUE = 1024;
/** All names and values together. */
export const MAX_HEADER_BYTES = 4096;

/** RFC 9110 token. */
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Visible ASCII and spaces inside: no control characters (CR, LF, NUL, tab) and no bytes mpv or a server might read differently. */
const VALUE = /^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/;

const REFUSED = new Set([
  'host',
  'content-length',
  'content-encoding',
  'content-type',
  'transfer-encoding',
  'te',
  'trailer',
  'connection',
  'keep-alive',
  'upgrade',
  'expect',
  'range',
  'if-range',
  'accept-encoding',
  'http2-settings',
  'cookie',
  'cookie2',
  'authorization',
]);

/** Whether `name: value` may be sent with an addon's stream. */
export function allowedHeader(name: string, value: string): boolean {
  if (name.length > MAX_HEADER_NAME || value.length > MAX_HEADER_VALUE) return false;
  if (!NAME.test(name) || !VALUE.test(value)) return false;
  const lower = name.toLowerCase();
  return !REFUSED.has(lower) && !lower.startsWith('proxy-');
}

/**
 * The headers to send from `raw` (an addon's `proxyHeaders.request`):
 * refused ones and repeats (names compare case-insensitively) are left out,
 * as is anything past the caps. Undefined when none are left.
 */
export function requestHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const kept: [string, string][] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const [name, value] of Object.entries(raw)) {
    if (kept.length >= MAX_PROXY_HEADERS) break;
    if (typeof value !== 'string' || !allowedHeader(name, value)) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower) || bytes + name.length + value.length > MAX_HEADER_BYTES) continue;
    seen.add(lower);
    bytes += name.length + value.length;
    kept.push([name, value]);
  }
  // fromEntries defines own properties, so a "__proto__" name stays a plain key.
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}
