/**
 * Plex as a source: a Plex Media Server the person's Plex account can use
 * (Settings → Integrations → Plex), one per profile.
 *
 * Signing in is Plex's own page in the person's browser; Rust holds the
 * tokens and makes every request (see src-tauri/src/plex). The page gets
 * titles, image keys for the `plex-art` protocol, and `orbit-plex://…`
 * addresses that only the player can resolve. Titles with an IMDb id keep it,
 * so they're the same titles as Cinemeta's (history, My Library and Stremio
 * sync line up); the rest are `plex:{server}:{rating key}`.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Stream } from '../addons/types';
import type { Title } from '../catalog/titles';
import {
  createServerReporter,
  inOrder,
  serverItemTitle,
  serverMetaTitle,
  serverVersionStream,
  type ReportSend,
  type ServerEpisode,
  type ServerFeed,
  type ServerItem,
  type ServerLibrary,
  type ServerStatus,
  type ServerVersion,
} from './media-server';

export const PLEX_SCHEME = 'orbit-plex://';
const ART_PROTOCOL = 'plex-art';
/** Dispatched on `document` when the profile connects or disconnects a server. */
export const PLEX_CHANGED = 'orbit:plex-changed';

export type PlexStatus = ServerStatus;
export type PlexItem = ServerItem;
export type PlexEpisode = ServerEpisode;
export type PlexLibrary = ServerLibrary;
export type PlexVersion = ServerVersion;
export type PlexFeed = ServerFeed;

/** A server on the account, to choose from when there are several. */
export interface PlexServerChoice {
  id: string;
  name: string;
  /** The person's own, rather than shared with them. */
  owned: boolean;
}

const LOCAL_ID = /^plex:([0-9a-f]{8}):(\d{1,12})$/;

/** A title or episode that's only on the person's Plex server. */
export const isPlexId = (id: string): boolean => LOCAL_ID.test(id);
export const isPlexAddress = (url: string): boolean => url.startsWith(PLEX_SCHEME);

/** The page's address for a `plex-art` key. */
export const plexArtUrl = (key: string): string => convertFileSrc(key, ART_PROTOCOL);

/** A Plex-only title's poster, from its id alone (saved titles keep only https artwork). */
export function plexPosterFor(id: string, art: (key: string) => string = plexArtUrl): string | undefined {
  const match = LOCAL_ID.exec(id);
  return match ? art(`${match[1]}_${match[2]}_thumb`) : undefined;
}

export const plexItemTitle = (item: PlexItem, serverName: string, art: (key: string) => string = plexArtUrl): Title => serverItemTitle(item, { key: 'plex', name: serverName }, art);

export const plexMetaTitle = (meta: { item: PlexItem; episodes: PlexEpisode[] }, serverName: string, art: (key: string) => string = plexArtUrl, now = new Date()): Title =>
  serverMetaTitle(meta, { key: 'plex', name: serverName }, art, now);

export const plexVersionStream = (version: PlexVersion): Stream => serverVersionStream(version, 'Plex');

let status: Promise<PlexStatus | null> | null = null;

/**
 * The active profile's server, or null if it has none. `fresh` asks again rather than reusing the
 * last answer: the address in use (and so "Not secure") can change while Orbit runs.
 */
export function plexStatus(fresh = false): Promise<PlexStatus | null> {
  if (fresh) status = null;
  // A failure (e.g. before a profile is picked) isn't kept: the next call asks again.
  status ??= invoke<PlexStatus | null>('plex_status').catch(() => {
    status = null;
    return null;
  });
  return status;
}

function changed(): void {
  status = null;
  document.dispatchEvent(new Event(PLEX_CHANGED));
}

/** Opens Plex's sign-in page in the browser. */
export const startPlexSignIn = (): Promise<void> => invoke('plex_link_start');
/** Opens the sign-in page again. */
export const reopenPlexSignIn = (): Promise<void> => invoke('plex_link_open');
export const cancelPlexSignIn = (): Promise<void> => invoke('plex_link_cancel');
/** Resolves once the person has allowed Orbit, with the account's servers. */
export const waitForPlexSignIn = (): Promise<PlexServerChoice[]> => invoke<PlexServerChoice[]>('plex_link_wait');

/** Keeps `server` for the profile; `first` says it had none before. */
export async function choosePlexServer(server: string): Promise<{ status: PlexStatus; first: boolean }> {
  const connected = await invoke<{ status: PlexStatus; first: boolean }>('plex_choose', { server });
  changed();
  return connected;
}

export async function disconnectPlex(): Promise<void> {
  await invoke('plex_disconnect');
  changed();
}

export const plexLibraries = (): Promise<PlexLibrary[]> => invoke<PlexLibrary[]>('plex_libraries');

/** A Home row's titles. */
export async function plexRow(feed: PlexFeed, library?: string): Promise<Title[]> {
  const server = await plexStatus();
  if (!server) return [];
  const items = await invoke<PlexItem[]>('plex_items', { feed, library: library ?? null });
  return items.map((item) => plexItemTitle(item, server.serverName));
}

/** Details for a `plex:…` title, or null if the connected server doesn't have it. */
export async function plexMeta(id: string): Promise<Title | null> {
  const server = await plexStatus();
  if (!server) return null;
  const meta = await invoke<{ item: PlexItem; episodes: PlexEpisode[] } | null>('plex_meta', { id });
  return meta ? plexMetaTitle(meta, server.serverName) : null;
}

/** The versions of a movie or episode on the connected server (none when there's no server or it doesn't have it). */
export async function plexSources(title: Title, episode?: { season: number; number: number; id: string }): Promise<{ serverName: string; versions: PlexVersion[] }> {
  if (!(await plexStatus())) return { serverName: '', versions: [] };
  const found = await invoke<{ serverName: string; versions: PlexVersion[] } | null>('plex_find', {
    titleId: title.id,
    kind: title.type,
    season: episode?.season ?? null,
    episode: episode?.number ?? null,
    episodeId: episode?.id ?? null,
  });
  return found ?? { serverName: '', versions: [] };
}

export const sendPlexReport: ReportSend = inOrder((event, address, position, paused, duration) =>
  invoke('plex_report', { event, address, position, paused, duration }).catch((err: unknown) => console.warn('Could not update Plex', err)),
);

/** Keeps the server up to date on a Plex video (see `createServerReporter`). */
export const createPlexReporter = (send: ReportSend = sendPlexReport, now: () => number = Date.now) => createServerReporter(isPlexAddress, send, now);
