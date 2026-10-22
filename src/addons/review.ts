/**
 * "What this addon can do": the install review, built only from a manifest
 * that already passed `ManifestSchema`. It reports what the addon declares,
 * nothing more: Orbit can't know which servers its sources will point to, so
 * the review never names any host but the addon's own.
 */
import type { Manifest } from './types';

/** Where an addon is installed from: the host only, never the path or query (they can hold keys). */
export interface AddonSource {
  host: string;
  /** Served from this machine (http://127.0.0.1), rather than over https. */
  local: boolean;
}

export interface AddonReview {
  name: string;
  version: string;
  /** Untrusted text from the addon: render it as text only. */
  description: string | undefined;
  source: AddonSource | null;
  catalogs: { count: number; names: string[]; types: string[] };
  addonCatalogs: number;
  meta: boolean;
  streams: boolean;
  subtitles: boolean;
  /** Resources Orbit doesn't use, as named by the addon. */
  otherResources: string[];
  /** Content types (movie, series, tv, channel, anime…) from the manifest and its resources. */
  types: string[];
  /** The ids it answers for: known schemes by name, the rest as the addon wrote them. */
  ids: { known: string[]; other: string[] };
  needsSetup: boolean;
  configurable: boolean;
  p2p: boolean;
  adult: boolean;
}

/** Catalog names shown before "and N more". */
export const CATALOG_NAMES_SHOWN = 8;

const KNOWN_RESOURCES = new Set(['catalog', 'meta', 'stream', 'subtitles', 'addon_catalog']);

/** Well-known id schemes, by the prefix addons declare. */
const ID_SCHEMES: [prefix: string, name: string][] = [
  ['tt', 'IMDb'],
  ['tmdb:', 'TMDB'],
  ['tvdb:', 'TVDB'],
  ['kitsu:', 'Kitsu'],
  ['mal:', 'MyAnimeList'],
  ['anilist:', 'AniList'],
  ['anidb:', 'AniDB'],
  ['yt_id:', 'YouTube'],
];

const unique = <T>(items: T[]) => [...new Set(items)];

/** The host part of an install URL, or `null` if it isn't one. `stremio://` means https. */
export function sourceOf(url: string): AddonSource | null {
  try {
    const parsed = new URL(url.trim().replace(/^stremio:\/\//i, 'https://'));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { host: parsed.host, local: parsed.protocol === 'http:' };
  } catch {
    return null;
  }
}

/** The source of an installed addon, from the host Rust shows for it (only 127.0.0.1 may use http). */
export const installedSource = (displayHost: string): AddonSource => ({
  host: displayHost,
  local: displayHost === '127.0.0.1' || displayHost.startsWith('127.0.0.1:'),
});

export function reviewManifest(manifest: Manifest, source: AddonSource | null): AddonReview {
  const resources = manifest.resources.map((r) => r.name);
  const has = (name: string) => resources.includes(name);
  const prefixes = unique([...(manifest.idPrefixes ?? []), ...manifest.resources.flatMap((r) => r.idPrefixes ?? [])]);
  const known: string[] = [];
  const other: string[] = [];
  for (const prefix of prefixes) {
    const scheme = ID_SCHEMES.find(([p]) => p === prefix);
    if (scheme) known.push(scheme[1]);
    else other.push(prefix);
  }
  const hints = manifest.behaviorHints;
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || undefined,
    source,
    catalogs: {
      count: manifest.catalogs.length,
      names: unique(manifest.catalogs.map((c) => c.name || c.id)).slice(0, CATALOG_NAMES_SHOWN),
      types: unique(manifest.catalogs.map((c) => c.type)),
    },
    addonCatalogs: manifest.addonCatalogs.length,
    // A catalog addon lists its catalogs even when "catalog" is missing from resources.
    meta: has('meta'),
    streams: has('stream'),
    subtitles: has('subtitles'),
    otherResources: unique(resources.filter((r) => !KNOWN_RESOURCES.has(r))),
    types: unique([...manifest.types, ...manifest.resources.flatMap((r) => r.types ?? [])]),
    ids: { known: unique(known), other },
    needsSetup: hints.configurationRequired,
    configurable: hints.configurable || hints.configurationRequired,
    p2p: hints.p2p,
    adult: hints.adult,
  };
}
