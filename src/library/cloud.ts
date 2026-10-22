/**
 * My cloud: what's already in the person's own debrid accounts (Real-Debrid,
 * TorBox), several at once (Settings → Integrations → Debrid accounts).
 *
 * Rust holds the API keys (OS keychain) and makes every request (see
 * src-tauri/src/debrid). The page gets names, sizes, states and
 * `orbit-debrid://…` addresses that only the player and the downloader can
 * turn into a link, so it never sees a key or a signed link.
 *
 * A cloud file plays as the catalog title it confidently is (found with the
 * addons' search), so history and progress land on that title; otherwise as
 * an untitled `cloud:` item, kept like a file from this PC (see local-media.ts).
 */
import { invoke } from '@tauri-apps/api/core';
import type { Stream } from '../addons/types';
import { mergeResults, searchableCatalogs } from '../catalog/search';
import { loadCatalog, loadMeta, usableAddons } from '../catalog/service';
import type { Episode, Title } from '../catalog/titles';
import { isShowName, matchingItems, parseCloudName, pickFiles, pickMatch, type CloudFile, type CloudItem, type CloudName, type CloudProvider, type CloudState } from '../lib/cloud-names';
import { CLOUD_ID_PREFIX } from '../lib/local-media';
import { baseName, episodeHint, episodeOfFile, parseTorrentFiles } from '../lib/torrent-files';
import { withTimeout } from '../lib/timeout';
import { serverVersionStream, type ServerVersion } from './media-server';

export type { CloudFile, CloudItem, CloudProvider, CloudState } from '../lib/cloud-names';

export const CLOUD_SCHEME = 'orbit-debrid://';
/** The downloads' "addon" for cloud files: Rust makes their link again, no addon is asked. */
export const CLOUD_ADDON_KEY = 'cloud';
/** Dispatched on `document` when the profile adds or removes an account. */
export const CLOUD_CHANGED = 'orbit:cloud-changed';
/** How old a kept list may be for a title page's "In your cloud" source (seconds). */
const INDEX_MAX_AGE = 300;
/** Items whose files a title page looks at, per provider (Real-Debrid asks once per item). */
const MAX_LOOKUPS = 3;
const SEARCH_TIMEOUT_MS = 8000;

/** The providers Orbit supports, and where each one's API key is found. */
export const CLOUD_PROVIDERS: readonly { id: CloudProvider; name: string; keyPage: string }[] = [
  { id: 'realdebrid', name: 'Real-Debrid', keyPage: 'https://real-debrid.com/apitoken' },
  { id: 'torbox', name: 'TorBox', keyPage: 'https://torbox.app/settings' },
];

export const providerName = (id: CloudProvider): string => CLOUD_PROVIDERS.find((p) => p.id === id)?.name ?? id;
export const isCloudAddress = (url: string): boolean => url.startsWith(CLOUD_SCHEME);

export interface CloudAccount {
  provider: CloudProvider;
  name: string;
  userName: string;
  /** Premium until (ms since 1970); null on a free account. */
  premiumUntil: number | null;
}

export interface CloudProblem {
  provider: CloudProvider;
  kind: 'denied' | 'rate-limited' | 'unreachable' | 'failed' | 'restricted';
  /** Seconds, when rate-limited. */
  retryIn: number | null;
  /** With 'restricted': the part of the cloud the account's plan leaves out (TorBox's Usenet or web downloads). */
  section?: CloudSection;
}

export type CloudSection = 'usenet' | 'web';

export interface CloudListing {
  items: CloudItem[];
  problems: CloudProblem[];
}

export interface CloudFiles {
  name: string;
  ready: boolean;
  files: CloudFile[];
}

const PROVIDER_IDS = new Set<string>(CLOUD_PROVIDERS.map((p) => p.id));
const STATES = new Set<string>(['ready', 'downloading', 'queued', 'error']);
const PROBLEMS = new Set<string>(['denied', 'rate-limited', 'unreachable', 'failed', 'restricted']);
const SECTIONS = new Set<string>(['usenet', 'web']);
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Checks `debrid_items`' answer; anything malformed is left out. */
export function parseListing(raw: unknown): CloudListing {
  const data = record(raw);
  const items: CloudItem[] = [];
  for (const entry of Array.isArray(data.items) ? data.items : []) {
    const i = record(entry);
    if (typeof i.provider !== 'string' || !PROVIDER_IDS.has(i.provider) || typeof i.id !== 'string' || typeof i.name !== 'string' || typeof i.state !== 'string' || !STATES.has(i.state)) continue;
    items.push({
      provider: i.provider as CloudProvider,
      id: i.id,
      name: i.name.slice(0, 300),
      size: count(i.size) ?? 0,
      state: i.state as CloudState,
      progress: Math.min(100, count(i.progress) ?? 0),
      added: count(i.added),
      deletable: i.deletable === true,
    });
  }
  const problems: CloudProblem[] = [];
  for (const entry of Array.isArray(data.problems) ? data.problems : []) {
    const p = record(entry);
    if (typeof p.provider !== 'string' || !PROVIDER_IDS.has(p.provider) || typeof p.kind !== 'string' || !PROBLEMS.has(p.kind)) continue;
    const problem: CloudProblem = { provider: p.provider as CloudProvider, kind: p.kind as CloudProblem['kind'], retryIn: count(p.retryIn) };
    if (p.kind === 'restricted') {
      // Only a section the page can name.
      if (typeof p.section !== 'string' || !SECTIONS.has(p.section)) continue;
      problem.section = p.section as CloudSection;
    }
    problems.push(problem);
  }
  return { items, problems };
}

/** Checks `debrid_files`' answer: a torrent's file list, each with its address if it plays. */
export function parseCloudFiles(raw: unknown): CloudFiles {
  const data = record(raw);
  const list = Array.isArray(data.files) ? data.files : [];
  const addresses = new Map<number, string>();
  for (const entry of list) {
    const f = record(entry);
    if (typeof f.index === 'number' && typeof f.address === 'string' && isCloudAddress(f.address)) addresses.set(f.index, f.address);
  }
  const files = parseTorrentFiles({ files: list }).files.map((f) => ({ ...f, address: addresses.get(f.index) }));
  return { name: typeof data.name === 'string' ? data.name.slice(0, 300) : '', ready: data.ready === true, files };
}

// ── Accounts ──

let accounts: Promise<CloudAccount[]> | null = null;

/** The active profile's connected accounts (from Orbit's own records: no network). */
export function cloudAccounts(): Promise<CloudAccount[]> {
  // A failure (e.g. before a profile is picked) isn't kept: the next call asks again.
  accounts ??= invoke<CloudAccount[] | null>('debrid_accounts').then((list) => list ?? [], () => {
    accounts = null;
    return [];
  });
  return accounts;
}

function changed(): void {
  accounts = null;
  document.dispatchEvent(new Event(CLOUD_CHANGED));
}

/** Checks the key with the provider and keeps it (Rust stores it in the OS keychain). */
export async function connectCloud(provider: CloudProvider, key: string): Promise<CloudAccount> {
  const account = await invoke<CloudAccount>('debrid_connect', { provider, key });
  changed();
  return account;
}

export async function disconnectCloud(provider: CloudProvider): Promise<void> {
  await invoke('debrid_disconnect', { provider });
  changed();
}

/** Asks each provider about its account again (today's premium date, a revoked key). */
export async function checkCloudAccounts(): Promise<{ accounts: CloudAccount[]; problems: CloudProblem[] }> {
  const checked = await invoke<{ accounts: CloudAccount[]; problems: unknown[] }>('debrid_check');
  accounts = Promise.resolve(checked.accounts);
  return { accounts: checked.accounts, problems: parseListing({ problems: checked.problems }).problems };
}

// ── The list ──

/** Every account's items, newest first; a provider that couldn't be asked is a problem, not an error. */
export async function cloudItems(options: { refresh?: boolean; maxAge?: number } = {}): Promise<CloudListing> {
  return parseListing(await invoke('debrid_items', { refresh: options.refresh ?? false, maxAge: options.maxAge ?? null }));
}

export async function cloudFiles(provider: CloudProvider, item: string): Promise<CloudFiles> {
  return parseCloudFiles(await invoke('debrid_files', { provider, item }));
}

export const deleteCloudItem = (provider: CloudProvider, item: string): Promise<void> => invoke('debrid_delete', { provider, item });

// ── Playing ──

/** The id an untitled cloud file plays under (kept like a local file's). */
export const cloudId = (item: CloudItem, file: CloudFile): string => `${CLOUD_ID_PREFIX}${item.provider}:${item.id}:${file.index}`;

/**
 * What a file is. In a show, the item's name names the show (a file may be
 * just "01 - Pilot.mkv") and the file says the episode; for a movie, the
 * name with a year in it wins (scene file names are often shortened).
 */
export function nameOfFile(item: Pick<CloudItem, 'name'>, file: Pick<CloudFile, 'name' | 'season' | 'episode'>): CloudName {
  const own = parseCloudName(baseName(file.name));
  const outer = parseCloudName(item.name);
  const season = file.season ?? own.season ?? outer.season;
  const episode = file.episode ?? own.episode ?? (outer.pack ? undefined : outer.episode);
  if (season === undefined && episode === undefined && !outer.pack) {
    const best = outer.year || !own.year ? outer : own;
    return { name: best.name, year: best.year, pack: false };
  }
  const name = outer.name || own.name;
  return { name, year: outer.year ?? own.year, season, episode, pack: episode === undefined };
}

/**
 * The catalog title a cloud name confidently is (the addons' search, with
 * Cinemeta built in), with its episodes for a show. Null when no single
 * result fits, or the search fails or takes too long.
 */
export async function findCloudTitle(parsed: CloudName): Promise<Title | null> {
  const type = isShowName(parsed) ? 'series' : 'movie';
  try {
    const refs = (await usableAddons().then(searchableCatalogs)).filter((ref) => ref.catalog.type === type);
    const settled = await withTimeout(Promise.allSettled(refs.map((ref) => loadCatalog(ref, [['search', parsed.name]]))), SEARCH_TIMEOUT_MS);
    const lists = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const found = pickMatch(mergeResults(lists), parsed);
    if (!found) return null;
    return type === 'series' ? ((await loadMeta(found.type, found.id)) ?? null) : found;
  } catch (err) {
    console.warn('Could not look up a cloud title', err);
    return null;
  }
}

/** A cloud file's version, as the source picker and the player show it. */
export function cloudStream(provider: CloudProvider, version: ServerVersion): Stream {
  return { ...serverVersionStream(version, providerName(provider)), filename: version.name ?? undefined };
}

/** "In your cloud" sources for a title page: one per provider that has a matching ready file. */
export interface CloudFound {
  provider: CloudProvider;
  version: ServerVersion;
}

/**
 * The movie's or episode's files in the connected accounts, from a list kept
 * up to five minutes (Rust's), so a title page never waits on a fresh one.
 * Each copy found is its own source, in every connected account; one that fails is left out.
 */
export async function cloudSources(title: Title, episode?: { season: number; number: number }): Promise<CloudFound[]> {
  if (!(await cloudAccounts()).length || (title.type !== 'movie' && title.type !== 'series')) return [];
  const { items } = await cloudItems({ maxAge: INDEX_MAX_AGE });
  const hint = episode ? episodeHint(title, { season: episode.season, episode: { number: episode.number } }) : undefined;
  if (title.type === 'series' && !hint) return [];
  const candidates = matchingItems(items, title, episode?.season);
  const perProvider = new Map<CloudProvider, CloudItem[]>();
  for (const item of candidates) {
    const list = perProvider.get(item.provider) ?? [];
    if (list.length < MAX_LOOKUPS) perProvider.set(item.provider, [...list, item]);
  }
  // Every copy found (a 1080p and a 4K of the same film are both worth offering);
  // the picker ranks them with the addons' sources.
  const found = await Promise.all(
    [...perProvider.entries()].flatMap(([provider, list]) =>
      list.map(async (item): Promise<CloudFound[]> => {
        try {
          const { files } = await cloudFiles(provider, item.id);
          const file = pickFiles(files, item.name, title.type, hint)[0];
          return file?.address ? [{ provider, version: { address: file.address, label: '', name: baseName(file.name), size: file.size } }] : [];
        } catch (err) {
          console.warn(`Could not read a ${providerName(provider)} item`, err);
          return [];
        }
      }),
    ),
  );
  return found.flat();
}

/** The episode of `title` a cloud file is, if the title has it. */
export function cloudEpisode(title: Title, parsed: CloudName): { season: number; episode: Episode } | undefined {
  if (parsed.episode === undefined) return undefined;
  return episodeOfFile<Episode>(title, { season: parsed.season, episode: parsed.episode });
}
