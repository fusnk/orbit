/**
 * A stream link pasted into Search or the command palette: a web address
 * (http or https, e.g. an .mp4 or an .m3u8 playlist) or a BitTorrent magnet
 * link. The text is untrusted, so only those two shapes are recognised, and
 * Rust checks again before anything plays (player_open's `check_stream_url`,
 * torrent.rs `parse_magnet`).
 *
 * An address can carry a key or token (debrid links often do), so only its
 * host and file name are ever shown; the address itself is never logged,
 * remembered, or sent to addons as a search.
 */
import { dropKind, titleFromFileName } from './local-media';

export type PastedLink = { kind: 'web'; url: string; host: string; name: string } | { kind: 'magnet'; url: string; name: string | null };

/** The player's own limit (src-tauri/src/player/mod.rs `MAX_URL_BYTES`). */
const MAX_URL_BYTES = 8192;
/** A name shown for the link is cut to this many characters. */
const MAX_NAME = 120;

/** `text` as a stream link, or null if it isn't one (a title search, or anything else). */
export function parsePastedLink(text: string): PastedLink | null {
  const raw = text.trim();
  // mpv gets the text as it is: spaces or control characters inside make it something else.
  if (!raw || new TextEncoder().encode(raw).length > MAX_URL_BYTES || /[\s\p{Cc}]/u.test(raw)) return null;
  if (/^magnet:\?/i.test(raw)) return magnet(raw);
  if (!/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
  return { kind: 'web', url: raw, host: url.host, name: webName(url) };
}

/** A video file's name at the end of the path ("The.Matrix.1999.mkv" is "The Matrix (1999)"), else the host. */
function webName(url: URL): string {
  const last = url.pathname.split('/').pop() ?? '';
  let file = last;
  try {
    file = decodeURIComponent(last);
  } catch {
    // Left as it is.
  }
  if (dropKind(file) !== 'video') return url.host;
  const { name, year } = titleFromFileName(file.replace(/\.[^.]+$/, ''));
  return clean(year ? `${name} (${year})` : name) || url.host;
}

/** A magnet link with a BitTorrent info hash (40 hex or 32 base32 characters); its `dn` is the name shown. */
function magnet(raw: string): PastedLink | null {
  const params = new URLSearchParams(raw.slice(raw.indexOf('?') + 1));
  const hash = params
    .getAll('xt')
    .map((xt) => /^urn:btih:(.+)$/i.exec(xt)?.[1] ?? '')
    .find((h) => /^[0-9a-f]{40}$/i.test(h) || /^[a-z2-7]{32}$/i.test(h));
  if (!hash) return null;
  const name = clean(params.get('dn') ?? '');
  // Rust expects the scheme in lower case.
  return { kind: 'magnet', url: `magnet:${raw.slice('magnet:'.length)}`, name: name || null };
}

const clean = (name: string) => name.replace(/\p{Cc}/gu, '').trim().slice(0, MAX_NAME);
