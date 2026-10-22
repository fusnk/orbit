/** IPC wrappers for installed addons. All failures are thrown as AddonFailure. */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { AddonFailure, toAddonError } from './errors';
import { noteAnswer } from './health';
import { settings } from '../lib/ipc';
import { TimeoutError, withTimeout } from '../lib/timeout';
import { buildPath } from './request';
import { sourceOf } from './review';
import { ManifestSchema, parseWith } from './schema';
import type { InstalledAddon, Manifest, ResourceRequest, UsableAddon } from './types';

type StoredAddon = Omit<InstalledAddon, 'manifest'> & { manifest: unknown };

/**
 * Rust bounds each addon request (15 s at most); this is the page's safety
 * net above that, so a command that never answers ends as a timeout error
 * (with Retry) instead of a skeleton that never goes away.
 */
const CALL_LIMIT_MS = 45_000;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await withTimeout(invoke<T>(command, args), CALL_LIMIT_MS, command);
  } catch (err) {
    throw new AddonFailure(err instanceof TimeoutError ? { kind: 'timeout' } : toAddonError(err));
  }
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new AddonFailure({ kind: 'invalid-response', issues: ['not valid JSON'] });
  }
}

/** Stored manifests are re-validated: the schema may be stricter than when they were saved. */
function fromStored(stored: StoredAddon): InstalledAddon {
  const result = v.safeParse(ManifestSchema, stored.manifest);
  return { ...stored, manifest: result.success ? result.output : null };
}

export async function fetchManifest(url: string): Promise<Manifest> {
  return parseWith(ManifestSchema, parseJson(await call<string>('addon_fetch_manifest', { url })));
}

/**
 * An install link's manifest, for its review before the person has confirmed anything: fetched
 * only from the internet. Null when the address leads to this machine or the home network, which
 * Rust refuses to contact for an unconfirmed link (any website can make one); the review asks
 * first, then fetches it with `fetchManifest`.
 */
export async function fetchLinkedManifest(url: string): Promise<Manifest | null> {
  try {
    return parseWith(ManifestSchema, parseJson(await call<string>('addon_fetch_manifest', { url, fromLink: true })));
  } catch (err) {
    const error = toAddonError(err);
    if (error.kind === 'blocked' && error.reason === 'local') return null;
    throw err;
  }
}

/** `replace`: the key of the installed copy whose settings this URL replaces (see `reconfigures`). */
export async function install(url: string, manifest: Manifest, replace?: string): Promise<InstalledAddon> {
  return fromStored(await announcing(call<StoredAddon>('addon_install', { url, manifest, ...(replace ? { replace } : {}) })));
}

/**
 * The installed addon a new install of `manifest` would update rather than add:
 * configured addons keep their settings in the URL, so setting one up again gives
 * a new URL for the same addon (manifest id). Only this profile's own copies (Rust
 * checks the same); built-ins and addons shared by another profile get a copy as before.
 * Only at the same host (and port): any site can claim any id, and one that isn't
 * the addon's own must not take over its settings, so it's installed as its own addon.
 */
export function reconfigures(installed: readonly InstalledAddon[], manifest: Manifest, url: string): InstalledAddon | undefined {
  const host = sourceOf(url)?.host;
  if (!host) return undefined;
  return installed.find((addon) => addon.owned && !addon.builtIn && addon.manifest?.id === manifest.id && addon.displayHost === host);
}

/**
 * The installed list, asked of Rust once and kept until an addon changes
 * (see `forgetList`): at startup nearly every Home row asks for it. A list
 * with an addon whose URL couldn't be read (keychain unavailable) isn't kept,
 * so the next call tries again.
 */
let listing: Promise<InstalledAddon[]> | null = null;

export function list(): Promise<InstalledAddon[]> {
  if (!listing) {
    const current = call<StoredAddon[]>('addon_list').then((stored) => stored.map(fromStored));
    const forget = () => {
      if (listing === current) listing = null;
    };
    current.then((addons) => addons.some((addon) => !addon.urlReadable) && forget(), forget);
    listing = current;
  }
  // Each caller gets its own array.
  return listing.then((addons) => addons.slice());
}

/**
 * Forgets the kept list, so the next call asks Rust again. Called around
 * every change to the installed addons, here and elsewhere (Stremio import,
 * a profile's linked list, switching or deleting profiles).
 */
export function forgetList(): void {
  listing = null;
}

/** Runs an addon change, forgetting any shared list from before it and from while it ran. */
function changing<T>(change: Promise<T>): Promise<T> {
  forgetList();
  return change.finally(forgetList);
}

/**
 * A change to which addons are in use (installed, removed, enabled, reordered):
 * like `changing`, then tells the `onAddonsChange` listeners once it's done.
 * Sharing isn't one, so it doesn't announce.
 */
function announcing<T>(change: Promise<T>): Promise<T> {
  return changing(change).then((result) => {
    announce();
    return result;
  });
}

/** Cinemeta, Orbit's built-in metadata and catalog addon (see src-tauri addons::BUILTIN_URLS). */
export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
/** OpenSubtitles v3, Orbit's built-in subtitles addon. */
export const OPENSUBTITLES_URL = 'https://opensubtitles-v3.strem.io/manifest.json';
/** The built-ins, by the manifest id each one serves. */
const BUILTINS: readonly (readonly [id: string, url: string])[] = [
  ['com.linvo.cinemeta', CINEMETA_URL],
  ['org.stremio.opensubtitlesv3', OPENSUBTITLES_URL],
];

let builtinsReady: Promise<void> | null = null;

/**
 * Installs any built-in addon that's missing (on first run, and once for a
 * built-in added in a later version). One the person installed themselves
 * counts as present. A failure (e.g. offline) is retried on the next call.
 */
export function ensureBuiltins(): Promise<void> {
  builtinsReady ??= (async () => {
    const have = new Set((await list()).map((addon) => addon.manifest?.id));
    for (const [id, url] of BUILTINS) {
      if (!have.has(id)) await install(url, await fetchManifest(url));
    }
  })().catch((err: unknown) => {
    builtinsReady = null;
    throw err;
  });
  return builtinsReady;
}

export async function setEnabled(key: string, enabled: boolean): Promise<void> {
  await announcing(call<void>('addon_set_enabled', { key, enabled }));
  // The daily refresh leaves out addons that are off, so one turned back on catches up now (quietly: a failure keeps its manifest).
  if (enabled) void refreshManifests(key).catch((err: unknown) => console.warn('Could not check the addon for updates', err));
}
export const move = (key: string, index: number) => announcing(call<void>('addon_move', { key, index }));
export const remove = (key: string) => announcing(call<void>('addon_remove', { key }));
export const setShared = (key: string, shared: boolean) => changing(call<void>('addon_set_shared', { key, shared }));
export const setAllShared = (shared: boolean) => changing(call<void>('addon_set_all_shared', { shared }));
/** Shared addons this profile removed from its list. */
export async function removedList(): Promise<InstalledAddon[]> {
  return (await call<StoredAddon[]>('addon_removed_list')).map(fromStored);
}
export const restore = (key: string) => announcing(call<void>('addon_restore', { key }));

/** Fetches a resource and returns the parsed (not yet validated) JSON. Notes whether the addon answered (health.ts). */
export async function request(addon: UsableAddon, req: ResourceRequest): Promise<unknown> {
  try {
    const json = parseJson(await call<string>('addon_request', { key: addon.key, path: buildPath(req) }));
    noteAnswer(addon.key, null);
    return json;
  } catch (err) {
    noteAnswer(addon.key, toAddonError(err));
    throw err;
  }
}

// ── Manifest refresh ──

const changeListeners = new Set<() => void>();

/**
 * Calls `listener` after refreshed manifests were stored, or an addon was
 * installed, removed, enabled or disabled, moved or restored (catalogs may have
 * come or gone); returns an unsubscribe function.
 */
export function onAddonsChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Batches running (see `inOneChange`), and whether a change waits to be announced at their end. */
let holding = 0;
let held = false;

function announce(): void {
  if (holding) {
    held = true;
    return;
  }
  for (const listener of changeListeners) listener();
}

/**
 * Runs several addon changes (a bundle's installs) as one: the `onAddonsChange`
 * listeners hear once, at the end, rather than rebuilding Home after each.
 * Coalescing by microtask or frame wouldn't do it: each install waits on Rust
 * before the next starts.
 */
export async function inOneChange<T>(run: () => Promise<T>): Promise<T> {
  holding++;
  try {
    return await run();
  } finally {
    holding--;
    if (!holding && held) {
      held = false;
      announce();
    }
  }
}

export interface RefreshSummary {
  /** Addons whose stored manifest changed. */
  updated: number;
  /** Addons that couldn't be fetched, or answered with something that isn't a valid manifest for them. */
  failed: number;
}

type Fetched = { key: string; body: string | null; error?: unknown };
type Applied = { key: string; outcome: 'updated' | 'unchanged' | 'failed' };

/**
 * Fetches every installed addon's manifest again (or only `key`'s) and
 * stores the ones that changed. Rust fetches (the URLs never reach the page)
 * and stores its own copy; the manifests are validated here, by the same
 * schema as at install (and again whenever they're read back). A failure keeps that addon's stored manifest. `background`: the
 * daily refresh, which leaves out the addons that are turned off.
 */
export async function refreshManifests(key?: string, background = false): Promise<RefreshSummary> {
  const fetched = await call<Fetched[]>('addon_refresh_fetch', key !== undefined ? { key } : background ? { enabledOnly: true } : undefined);
  let failed = 0;
  // Only which ones passed: Rust stores its own copy of what it fetched, never one sent from here.
  const updates: { key: string }[] = [];
  for (const { key, body, error } of fetched) {
    const parsed = body === null ? null : v.safeParse(ManifestSchema, safeJson(body));
    noteAnswer(key, body === null ? toAddonError(error) : parsed?.success ? null : { kind: 'invalid-response', issues: ['not a valid manifest'] });
    if (parsed?.success) updates.push({ key });
    else failed++;
  }
  const applied = updates.length ? await changing(call<Applied[]>('addon_refresh_apply', { updates })) : [];
  const updated = applied.filter((a) => a.outcome === 'updated').length;
  failed += applied.filter((a) => a.outcome === 'failed').length;
  if (updated) announce();
  return { updated, failed };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** When manifests were last refreshed automatically (ms), for the whole app. */
const REFRESHED_KEY = 'addons.refreshed-at';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the daily refresh is due, given when it last ran (a clock set back counts as due). */
export function refreshDue(last: unknown, now: number): boolean {
  return typeof last !== 'number' || !Number.isFinite(last) || last > now || now - last >= DAY_MS;
}

/** The startup refresh: at most once a day, in the background, quietly. */
export async function refreshManifestsDaily(now = Date.now()): Promise<void> {
  if (!navigator.onLine || !refreshDue(await settings.get(REFRESHED_KEY).catch(() => null), now)) return;
  try {
    await refreshManifests(undefined, true);
    await settings.set(REFRESHED_KEY, now);
  } catch (err) {
    console.warn('Could not check addons for updates', err);
  }
}
