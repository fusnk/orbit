/**
 * Schemas for addon responses. Addon JSON is untrusted: it only becomes typed
 * data by passing through here. Required fields are strict; optional fields
 * and individual list items that fail validation are dropped, so one bad
 * entry can't take down a whole catalog. Unknown keys are stripped.
 */
import * as v from 'valibot';
import { AddonFailure } from './errors';
import { withoutPlaceholders } from './placeholder';
import { requestHeaders } from './proxy-headers';

// C0 controls other than tab/newline, plus DEL. Text is always rendered via
// textContent, so this is about garbled display, not injection. Also the bidi
// embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069), which can
// make a name read as something it isn't; the LRM/RLM marks (U+200E/U+200F)
// stay, since Arabic and Hebrew text needs them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

// Some addons (Cinemeta among them) send names HTML-escaped: "O&apos;Connor".
// Text is rendered via textContent, so it would show escaped; decode the
// entities they use, in one pass so "&amp;lt;" becomes "&lt;", not "<".
// Only text that is shown: values sent back to the addon (catalog extra names
// and options, resource names, id prefixes) keep exactly what it sent, via
// `rawText`; where an option is shown, it's decoded there with `decodeEntities`.
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };
export const decodeEntities = (s: string) =>
  s.replace(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
  });

const text = (max: number) =>
  v.pipe(
    v.string(),
    v.transform((s) => decodeEntities(s).replace(CONTROL_CHARS, '').trim().slice(0, max)),
  );

const requiredText = (max: number) => v.pipe(text(max), v.minLength(1));

/** Like `requiredText` without decoding entities: for values that go back to the addon. */
const rawText = (max: number) =>
  v.pipe(
    v.string(),
    v.transform((s) => s.replace(CONTROL_CHARS, '').trim().slice(0, max)),
    v.minLength(1),
  );

// eslint-disable-next-line no-control-regex
const id = v.pipe(v.string(), v.minLength(1), v.maxLength(512), v.regex(/^[^\u0000-\u001F\u007F]+$/));

/**
 * Whether `hostname` (as the URL parser normalised it, so `2130706433` and
 * `0x7f.1` already read `127.0.0.1`) is this machine or the local network.
 */
export function lanHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name);
  if (v4) return lanV4(v4.slice(1).map(Number));
  if (!name.startsWith('[')) return false;
  const v6 = name.slice(1, -1);
  // Loopback, unspecified, IPv4-mapped (written as hex once parsed), link-local and unique-local.
  if (v6 === '::1' || v6 === '::' || v6.startsWith('::ffff:') || /^fe[89ab]/.test(v6) || /^f[cd]/.test(v6)) return true;
  // Forms that carry an IPv4 address, as Rust checks them (addons/net.rs `is_private_ip`).
  const s = v6Groups(v6);
  if (!s) return false;
  const embedded = (hi: number, lo: number) => lanV4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  return (
    (s.slice(0, 6).every((g) => g === 0) && embedded(s[6]!, s[7]!)) || // IPv4-compatible, ::a.b.c.d
    (s[0] === 0x64 && s[1] === 0xff9b && s.slice(2, 6).every((g) => g === 0) && embedded(s[6]!, s[7]!)) || // NAT64, 64:ff9b::/96
    (s[0] === 0x2002 && embedded(s[1]!, s[2]!)) // 6to4, 2002::/16
  );
}

/** This machine, the LAN, link-local, carrier-grade NAT, benchmarking (198.18.0.0/15) or broadcast. */
function lanV4([a = 0, b = 0, c = 0, d = 0]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 255 && b === 255 && c === 255 && d === 255);
}

/** The eight 16-bit groups of an IPv6 address as the URL parser writes it (hex, `::` compressed), or null. */
function v6Groups(v6: string): number[] | null {
  const [head = '', tail, extra] = v6.split('::');
  if (extra !== undefined) return null;
  const part = (s: string) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const [h, t] = [part(head), part(tail ?? '')];
  const groups = tail === undefined ? h : [...h, ...Array<number>(Math.max(0, 8 - h.length - t.length)).fill(0), ...t];
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Only https images: anything else would be blocked by CSP or is a downgrade.
 * Never on this machine or the LAN either: the page would request them
 * itself, so an addon could make it poke at the router or a local service.
 */
export const httpsUrl = v.pipe(
  v.string(),
  v.maxLength(2048),
  v.url(),
  v.startsWith('https://'),
  v.check((s) => !lanHostname(new URL(s).hostname)),
);

const optional = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(schema), undefined);

const flag = v.fallback(v.optional(v.boolean(), false), false);

/** Keeps the items that validate (up to `max`) and drops the rest. */
function lenientArray<T extends v.GenericSchema>(item: T, max: number) {
  return v.pipe(
    v.array(v.unknown()),
    v.transform((items) =>
      items.slice(0, max).flatMap((raw) => {
        const result = v.safeParse(item, raw);
        return result.success ? [result.output as v.InferOutput<T>] : [];
      }),
    ),
  );
}

// ── Manifest ────────────────────────────────────────────────────────────────

const ExtraPropSchema = v.object({
  name: rawText(64),
  isRequired: flag,
  options: optional(lenientArray(rawText(200), 500)),
  optionsLimit: v.fallback(v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1), 1),
});

const CatalogSchema = v.pipe(
  v.object({
    type: id,
    id,
    name: optional(text(200)),
    extra: optional(lenientArray(ExtraPropSchema, 50)),
    // Legacy form, still served by older addons.
    extraSupported: optional(lenientArray(rawText(64), 50)),
    extraRequired: optional(lenientArray(rawText(64), 50)),
  }),
  v.transform(({ type, id, name, extra, extraSupported, extraRequired }) => ({
    type,
    id,
    name,
    extra:
      extra ??
      (extraSupported ?? []).map((extraName) => ({
        name: extraName,
        isRequired: extraRequired?.includes(extraName) ?? false,
        options: undefined as string[] | undefined,
        optionsLimit: 1,
      })),
  })),
);

/**
 * A manifest's catalogs, the first of any that repeat a type and id kept: both
 * would be asked at the same address, and repeats would make duplicate rows
 * under the same keys (Home, Discover).
 */
const catalogList = v.pipe(
  lenientArray(CatalogSchema, 200),
  v.transform((catalogs) => {
    const seen = new Set<string>();
    return catalogs.filter((c) => {
      const key = `${c.type}\u0000${c.id}`;
      return !seen.has(key) && !!seen.add(key);
    });
  }),
);

const ResourceSchema = v.union([
  v.pipe(
    rawText(64),
    v.transform((name) => ({ name, short: true, types: undefined, idPrefixes: undefined })),
  ),
  v.pipe(
    v.object({
      name: rawText(64),
      types: optional(lenientArray(id, 50)),
      idPrefixes: optional(lenientArray(rawText(128), 100)),
    }),
    v.transform((r) => ({ ...r, short: false })),
  ),
]);

const DEFAULT_HINTS = { adult: false, p2p: false, configurable: false, configurationRequired: false };

export const ManifestSchema = v.pipe(
  v.object({
    id,
    version: v.pipe(v.string(), v.maxLength(64), v.regex(/^\d+\.\d+\.\d+/)),
    name: requiredText(100),
    description: optional(text(2000)),
    logo: optional(httpsUrl),
    background: optional(httpsUrl),
    types: lenientArray(id, 50),
    resources: lenientArray(ResourceSchema, 20),
    idPrefixes: optional(lenientArray(rawText(128), 100)),
    catalogs: v.fallback(v.optional(catalogList, []), []),
    addonCatalogs: v.fallback(v.optional(catalogList, []), []),
    behaviorHints: v.fallback(
      v.optional(
        v.object({ adult: flag, p2p: flag, configurable: flag, configurationRequired: flag }),
        DEFAULT_HINTS,
      ),
      DEFAULT_HINTS,
    ),
  }),
  // Resolve resource scoping the way stremio-core does: the short (string)
  // form inherits the manifest's types and idPrefixes; the full form uses its
  // own, with a missing `types` falling back to the manifest's. An empty
  // `idPrefixes` list means any id, as in stremio-core, not none.
  v.transform(({ resources, ...manifest }) => {
    const anyId = (prefixes: string[] | undefined) => (prefixes?.length ? prefixes : undefined);
    return {
      ...manifest,
      resources: resources.map((r) => ({
        name: r.name,
        types: r.types ?? manifest.types,
        idPrefixes: anyId(r.short ? manifest.idPrefixes : r.idPrefixes),
      })),
    };
  }),
);

// ── Resource responses ──────────────────────────────────────────────────────

/** A short value some addons send as a number (a year, a rating); empty becomes absent. */
const shortValue = v.pipe(
  v.union([v.string(), v.number()]),
  v.transform((value) => String(value).replace(CONTROL_CHARS, '').trim().slice(0, 32) || undefined),
);

/** People lists arrive as arrays or as one comma-separated string. */
const people = v.pipe(
  v.union([v.string(), v.array(v.unknown())]),
  v.transform((value) => (typeof value === 'string' ? value.split(',') : value)),
  lenientArray(requiredText(120), 50),
);

const previewEntries = {
  id,
  type: id,
  name: requiredText(300),
  poster: optional(httpsUrl),
  posterShape: v.fallback(v.optional(v.picklist(['poster', 'square', 'landscape']), 'poster'), 'poster'),
  background: optional(httpsUrl),
  logo: optional(httpsUrl),
  description: optional(text(4000)),
  releaseInfo: optional(shortValue),
  imdbRating: optional(shortValue),
  runtime: optional(text(32)),
  genres: optional(lenientArray(requiredText(60), 20)),
  links: optional(lenientArray(v.object({ name: requiredText(120), category: rawText(40) }), 200)),
};

/**
 * The SDK is moving genres and people to `links` (`{ name, category, url }`),
 * and some addons send only those. Link categories as Stremio groups them
 * (any case, singular or plural); only the names are kept, never the URLs.
 */
const LINK_FIELDS: Record<string, 'genres' | 'cast' | 'director' | 'writer'> = {
  genre: 'genres',
  genres: 'genres',
  cast: 'cast',
  actor: 'cast',
  actors: 'cast',
  director: 'director',
  directors: 'director',
  writer: 'writer',
  writers: 'writer',
};

/** The legacy list when it has entries, else the names linked under `field`. */
function orLinked(listed: string[] | undefined, links: { name: string; category: string }[] | undefined, field: (typeof LINK_FIELDS)[string], max: number): string[] | undefined {
  if (listed?.length) return listed;
  const names = [...new Set((links ?? []).filter((link) => LINK_FIELDS[link.category.toLowerCase()] === field).map((link) => link.name))];
  return names.length ? names.slice(0, max) : listed;
}

/** `{ [key]: list }`, or nothing: the key stays optional, as it was before links were read. */
const optionalList = <K extends string>(key: K, list: string[] | undefined): { [P in K]?: string[] } => (list ? ({ [key]: list } as { [P in K]?: string[] }) : {});

export const MetaPreviewSchema = v.pipe(
  v.object(previewEntries),
  v.transform(({ links, genres, ...meta }) => ({ ...meta, ...optionalList('genres', orLinked(genres, links, 'genres', 20)) })),
);

export const CatalogResponseSchema = v.object({
  // Fake "Error" / "No results" items some addons send instead of failing.
  metas: v.pipe(lenientArray(MetaPreviewSchema, 1000), v.transform(withoutPlaceholders)),
});

const streamHints = v.fallback(
  v.optional(
    v.object({
      filename: optional(text(300)),
      // Finite and exact: JSON reads 1e400 as Infinity, and a size past 2^53 would go to subtitle addons as "1e+21".
      videoSize: optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))),
      // The OpenSubtitles hash (64 bits, in hex), passed on to subtitle addons.
      videoHash: optional(v.pipe(v.string(), v.regex(/^[\da-f]{16}$/i))),
      bingeGroup: optional(text(200)),
      // Only `request` is used; see proxy-headers.ts for the rules and for why `response` isn't.
      proxyHeaders: v.fallback(v.optional(v.pipe(v.object({ request: v.optional(v.unknown()) }), v.transform(({ request }) => requestHeaders(request)))), undefined),
    }),
    {},
  ),
  {},
);

/** Subtitle files are fetched by mpv itself, so only web addresses are accepted. */
const SubtitleSchema = v.object({
  id: optional(text(200)),
  url: v.pipe(v.string(), v.maxLength(4096), v.url(), v.regex(/^https?:\/\//i)),
  lang: v.fallback(text(40), ''),
  // Not in the protocol, but sent by OpenSubtitles: they let Orbit pick the subtitle made for the release playing.
  subtitleFileName: optional(text(300)),
  releaseGroup: optional(text(60)),
  fpsMilli: optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(240_000))),
});

/**
 * Subtitles an addon ships with one stream (`Stream.subtitles` in the protocol),
 * checked as a subtitle addon's are. A stream rarely has more than a few, and
 * there can be hundreds of streams, so fewer are kept. Missing or `null` is none.
 */
const streamSubtitles = v.fallback(v.optional(lenientArray(SubtitleSchema, 50), []), []);

/**
 * Playable streams: http(s) URLs, and torrents (`infoHash`, played by the
 * torrent engine when Settings allow). Torrents become a magnet link built
 * here from the parts Orbit understands; Rust checks it again. YouTube and
 * external-link streams are dropped. Stream URLs can carry debrid tokens, so
 * they're never shown or logged.
 */
const HttpStreamSchema = v.object({
  url: v.pipe(v.string(), v.maxLength(4096), v.url(), v.regex(/^https?:\/\//i)),
  name: optional(text(200)),
  title: optional(text(1000)),
  description: optional(text(1000)),
  subtitles: streamSubtitles,
  behaviorHints: streamHints,
});

const TorrentStreamSchema = v.pipe(
  v.object({
    infoHash: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/i)),
    fileIdx: v.fallback(v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000))), undefined),
    /** "tracker:udp://…" and "dht:…" entries; only trackers are used. */
    sources: v.fallback(v.optional(v.array(v.string())), []),
    name: optional(text(200)),
    title: optional(text(1000)),
    description: optional(text(1000)),
    subtitles: streamSubtitles,
    behaviorHints: streamHints,
  }),
  v.transform(({ infoHash, fileIdx, sources, ...rest }) => {
    const trackers = (sources ?? [])
      .slice(0, 50)
      .filter((s) => s.length <= 512 && /^tracker:(udp|https?):\/\//i.test(s))
      .map((s) => `&tr=${encodeURIComponent(s.slice('tracker:'.length))}`);
    return { ...rest, url: `magnet:?xt=urn:btih:${infoHash.toLowerCase()}${fileIdx !== undefined ? `&so=${fileIdx}` : ''}${trackers.join('')}` };
  }),
);

/**
 * What makes two streams the same one: the URL, except that a torrent's
 * trackers don't count (two addons listing one torrent with different
 * trackers is still one torrent, at the same file).
 */
export const streamKey = (stream: { url: string; torrent: boolean }): string => (stream.torrent ? stream.url.replace(/&tr=[^&]*/g, '') : stream.url);

const StreamSchema = v.pipe(
  v.union([HttpStreamSchema, TorrentStreamSchema]),
  v.transform((stream) => ({
    url: stream.url,
    /** Played by the torrent engine rather than streamed from a web address. */
    torrent: stream.url.startsWith('magnet:'),
    name: stream.name,
    // `title` is the legacy name for `description`.
    description: stream.description ?? stream.title,
    filename: stream.behaviorHints.filename,
    videoSize: stream.behaviorHints.videoSize,
    videoHash: stream.behaviorHints.videoHash?.toLowerCase(),
    bingeGroup: stream.behaviorHints.bingeGroup,
    /** Subtitle files made for this stream; offered with the subtitle addons' (see `loadSubtitles`). */
    subtitles: stream.subtitles,
    /** Headers mpv sends for this stream's own address (http(s) streams only; none for a torrent). */
    ...(!stream.url.startsWith('magnet:') && stream.behaviorHints.proxyHeaders ? { headers: stream.behaviorHints.proxyHeaders } : {}),
  })),
);

const episodeNumber = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000));

/** A video's own streams, checked as an addon's stream response is. */
const videoStreams = lenientArray(StreamSchema, 500);

/**
 * Episodes (and other videos) of a title; legacy field names are normalized.
 * A video may list its own `streams` (stremio-core also reads `stream`, one
 * or many); kept only when at least one of them is playable.
 */
const VideoSchema = v.pipe(
  v.object({
    id,
    title: optional(text(300)),
    name: optional(text(300)),
    season: optional(episodeNumber),
    episode: optional(episodeNumber),
    number: optional(episodeNumber),
    released: optional(text(40)),
    thumbnail: optional(httpsUrl),
    overview: optional(text(2000)),
    description: optional(text(2000)),
    streams: optional(videoStreams),
    stream: optional(v.pipe(v.unknown(), v.transform((one) => (Array.isArray(one) ? one : [one])), videoStreams)),
  }),
  v.transform((video) => ({
    id: video.id,
    title: video.title ?? video.name,
    season: video.season,
    episode: video.episode ?? video.number,
    released: video.released,
    thumbnail: video.thumbnail,
    overview: video.overview ?? video.description,
    streams: video.streams?.length ? video.streams : video.stream?.length ? video.stream : undefined,
  })),
);

/** A YouTube video id: the only kind of trailer Orbit plays (see src-tauri/src/trailer.rs). */
const youtubeId = v.pipe(v.string(), v.regex(/^[\w-]{11}$/));

const MetaDetailSchema = v.pipe(
  v.object({
    ...previewEntries,
    released: optional(text(40)),
    status: optional(text(40)),
    director: optional(people),
    writer: optional(people),
    cast: optional(people),
    country: optional(text(200)),
    awards: optional(text(300)),
    videos: optional(lenientArray(VideoSchema, 5000)),
    trailers: optional(lenientArray(v.object({ source: youtubeId, type: optional(text(40)) }), 20)),
    trailerStreams: optional(lenientArray(v.object({ ytId: youtubeId }), 20)),
    // The video whose streams the title plays (the TMDB addon names an IMDb id here for its `tmdb:` movies).
    behaviorHints: optional(v.object({ defaultVideoId: optional(id) })),
  }),
  v.transform(({ links, genres, director, writer, cast, ...meta }) => ({
    ...meta,
    ...optionalList('genres', orLinked(genres, links, 'genres', 20)),
    ...optionalList('director', orLinked(director, links, 'director', 50)),
    ...optionalList('writer', orLinked(writer, links, 'writer', 50)),
    ...optionalList('cast', orLinked(cast, links, 'cast', 50)),
  })),
);

/** `meta: null` is how addons say "no such title". */
export const MetaResponseSchema = v.object({ meta: v.nullable(MetaDetailSchema) });

export const StreamResponseSchema = v.object({
  streams: lenientArray(StreamSchema, 500),
});

export const SubtitlesResponseSchema = v.object({
  subtitles: lenientArray(SubtitleSchema, 500),
});

/** Validates `json`, or throws an `invalid-response` AddonFailure. */
export function parseWith<T extends v.GenericSchema>(schema: T, json: unknown): v.InferOutput<T> {
  const result = v.safeParse(schema, json);
  if (result.success) return result.output;
  throw new AddonFailure({
    kind: 'invalid-response',
    issues: result.issues.slice(0, 5).map((issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`),
  });
}
