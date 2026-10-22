/**
 * What went wrong, in terms a person can act on. Errors reach the page from
 * addons (structured `AddonError`s), from Rust commands (short English
 * sentences or codes like "signed-out") and from the browser; none of that
 * text is shown as-is, because it can be English in a translated interface,
 * technical ("error sending request"), or quote an address or a key.
 *
 * `classifyError` sorts an error into a cause the interface has words for,
 * and the service whose sign-in it concerns, if any; `safeSentence` says
 * whether a Rust message is a plain sentence fit to show (in English only).
 * Rust commands can instead answer with a code the interface has words for
 * in every language (`errorCode`, see src-tauri/src/user_error.rs).
 */

/** Why something failed, as far as the person is concerned. */
export type ErrorCause =
  | 'offline'
  | 'timeout'
  | 'unreachable'
  | 'server'
  | 'busy'
  | 'invalid-data'
  | 'not-found'
  | 'signed-out'
  | 'rejected'
  | 'unknown';

/** A service whose sign-in or key can stop working, and which Settings can fix. */
export type ErrorService = 'debrid' | 'stremio' | 'tmdb' | 'jellyfin' | 'plex' | 'iptv' | 'anilist' | 'addon';

export interface ClassifiedError {
  cause: ErrorCause;
  /** For 'signed-out': whose sign-in to renew. */
  service?: ErrorService;
}

export interface ClassifyOptions {
  /** `navigator.onLine` at the time: a network failure while offline is just "offline". */
  online: boolean;
  /** The service the failed call was talking to, when the caller knows it. */
  service?: ErrorService;
}

/** Causes that are really "the connection is down" when the device is offline. */
const NETWORK_CAUSES: ReadonlySet<ErrorCause> = new Set(['timeout', 'unreachable', 'server', 'unknown']);

/**
 * Rust codes that mean a saved sign-in or key stopped working, and whose. They
 * have no words of their own: every page says it the same way (`states.auth.*`)
 * and offers Fix in Settings.
 */
export const SIGN_IN_CODES: Readonly<Record<string, ErrorService>> = {
  'stremio.session-ended': 'stremio',
  'stremio.sign-in-first': 'stremio',
  'tmdb.signed-out': 'tmdb',
  'iptv.refused': 'iptv',
  'jellyfin.signed-out': 'jellyfin',
  'plex.signed-out': 'plex',
  'debrid.signed-out': 'debrid',
  'debrid.key-unreadable': 'debrid',
};

/** A coded network failure (`err.tmdb.unreachable`, `err.iptv.timeout`…): while offline it's just "offline". */
const CODE_CAUSE: readonly [RegExp, ErrorCause][] = [
  [/[.-]unreachable$/, 'unreachable'],
  [/[.-]timeout$/, 'timeout'],
  [/[.-]busy$/, 'busy'],
];

/** What the person just typed (a key, a password, a PIN) wasn't accepted. */
const REJECTED = /didn.t accept that|wrong (?:password|pin)|incorrect (?:password|pin)/;
const TIMEOUT = /timed? ?out|took too long/;
const UNREACHABLE = /couldn.t reach|error sending request|dns error|connection (?:refused|reset|closed)|connect error|network|failed to fetch|unreachable/;
const BUSY = /slow down|too many requests|rate.?limit/;

function fromAddonError(error: { kind: string; status?: unknown }, service: ErrorService | undefined): ClassifiedError {
  switch (error.kind) {
    case 'timeout':
      return { cause: 'timeout' };
    case 'network':
      return { cause: 'unreachable' };
    case 'invalid-response':
    case 'too-large':
      return { cause: 'invalid-data' };
    case 'not-found':
      return { cause: 'not-found' };
    case 'http': {
      const status = typeof error.status === 'number' ? error.status : 0;
      if (status === 401 || status === 403) return { cause: 'signed-out', service: service ?? 'addon' };
      if (status === 404 || status === 410) return { cause: 'not-found' };
      if (status === 429) return { cause: 'busy' };
      return { cause: 'server' };
    }
    case 'rate-limited':
      return { cause: 'busy' };
    default:
      return { cause: 'unknown' };
  }
}

function fromText(text: string, service: ErrorService | undefined): ClassifiedError {
  const lower = text.toLowerCase();
  // Codes Rust commands answer with when a saved sign-in is gone or refused (AniList, media servers).
  if (lower === 'signed-out' || lower === 'denied') return service ? { cause: 'signed-out', service } : { cause: 'unknown' };
  if (REJECTED.test(lower)) return { cause: 'rejected' };
  if (lower === 'invalid-data') return { cause: 'invalid-data' };
  if (BUSY.test(lower)) return { cause: 'busy' };
  if (TIMEOUT.test(lower)) return { cause: 'timeout' };
  if (UNREACHABLE.test(lower)) return { cause: 'unreachable' };
  return { cause: 'unknown' };
}

/** A coded Rust error: `err.<name>`, then `|key=value` parameters for its text. */
export interface ErrorCode {
  name: string;
  params: Record<string, string>;
}

const CODE = /^err\.([a-z0-9]+(?:[.-][a-z0-9]+)*)((?:\|[a-z]+=[^|\r\n]*)*)$/;
const MAX_PARAM_CHARS = 80;

/** The code `err` carries, or null if it's anything else. */
export function errorCode(err: unknown): ErrorCode | null {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const match = CODE.exec(text);
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const part of match[2]!.split('|').slice(1)) {
    const at = part.indexOf('=');
    params[part.slice(0, at)] = part.slice(at + 1).slice(0, MAX_PARAM_CHARS);
  }
  return { name: match[1]!, params };
}

/** Sorts any thrown value into a cause; see the module comment. */
export function classifyError(err: unknown, options: ClassifyOptions): ClassifiedError {
  let found: ClassifiedError;
  if (typeof err === 'object' && err !== null && typeof (err as { kind?: unknown }).kind === 'string') {
    found = fromAddonError(err as { kind: string; status?: unknown }, options.service);
  } else if (typeof err === 'object' && err !== null && typeof (err as { error?: { kind?: unknown } }).error?.kind === 'string') {
    // AddonFailure: an Error wrapping the AddonError.
    found = fromAddonError((err as { error: { kind: string; status?: unknown } }).error, options.service);
  } else {
    const code = errorCode(err);
    if (code) {
      const who = SIGN_IN_CODES[code.name];
      if (who) return { cause: 'signed-out', service: who };
      const network = CODE_CAUSE.find(([pattern]) => pattern.test(code.name));
      // Any other code says exactly what happened, whether or not the device is online.
      if (!network) return { cause: 'unknown' };
      found = { cause: network[1] };
      return !options.online && NETWORK_CAUSES.has(found.cause) ? { cause: 'offline' } : found;
    }
    const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    found = fromText(text, options.service);
  }
  if (!options.online && NETWORK_CAUSES.has(found.cause)) return { cause: 'offline' };
  return found;
}

/**
 * The text of `err` if it's a plain sentence a person could read: short,
 * capitalised, punctuated, one line, and free of addresses, file paths,
 * key-like strings and stack traces. Otherwise null.
 */
export function safeSentence(err: unknown): string | null {
  const text = (err instanceof Error ? err.message : typeof err === 'string' ? err : '').trim();
  if (text.length < 3 || text.length > 240 || /[\r\n]/.test(text)) return null;
  if (!/^\p{Lu}/u.test(text) || !/[.!?…)]$/.test(text)) return null;
  if (/:\/\/|www\.|[a-z]:\\|\/(?:home|users)\/|\bat \S+:\d+/i.test(text)) return null;
  // Tokens, keys and hashes: long runs without spaces.
  if (/[A-Za-z0-9_\-+/=]{28,}/.test(text)) return null;
  if (/^\w*(?:Error|Exception)\b|\bundefined\b|\bnull\b|\[object /.test(text)) return null;
  return text;
}

/** Why a source stopped playing, from mpv's error text (its `mpv_error_string`, English) or a failed open. */
export type PlaybackFailure = 'offline' | 'loading-failed' | 'format' | 'output' | 'failed';

export function playbackFailure(message: unknown, online: boolean): PlaybackFailure {
  const text = (message instanceof Error ? message.message : typeof message === 'string' ? message : '').toLowerCase();
  if (/output initialization failed/.test(text)) return 'output';
  if (/unrecognized file format|no audio or video data played|unsupported/.test(text)) return 'format';
  if (!online) return 'offline';
  if (/loading failed|network|timed? ?out|couldn.t reach/.test(text)) return 'loading-failed';
  return 'failed';
}

/** An error whose message Orbit wrote for the person, already in their language: shown as it is. */
export class ShownError extends Error {
  override name = 'ShownError';
}
