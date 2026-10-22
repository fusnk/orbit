/**
 * Jellyfin as a source: the person's own media server (Settings →
 * Integrations → Jellyfin), one per profile.
 *
 * Rust holds the sign-in and makes every request (see src-tauri/src/jellyfin);
 * the page gets titles, image keys for the `jellyfin-art` protocol, and
 * `orbit-jellyfin://…` addresses that only the player can resolve. Titles
 * with an IMDb id keep it, so they're the same titles as Cinemeta's (history,
 * My Library and Stremio sync line up); the rest are `jellyfin:{server}:{item}`.
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

export { REPORT_EVERY_MS } from './media-server';
export const JELLYFIN_SCHEME = 'orbit-jellyfin://';
const ART_PROTOCOL = 'jellyfin-art';
/** Dispatched on `document` when the profile connects or disconnects a server. */
export const JELLYFIN_CHANGED = 'orbit:jellyfin-changed';

export type JellyfinStatus = ServerStatus;

/** A movie or show as Rust sends it (already checked there). */
export interface JellyfinItem extends ServerItem {
  jellyfinId: string;
}

export type JellyfinEpisode = ServerEpisode;
export type JellyfinLibrary = ServerLibrary;
export type JellyfinVersion = ServerVersion;
export type JellyfinFeed = ServerFeed;

const LOCAL_ID = /^jellyfin:([0-9a-f]{8}):([0-9a-f]{32})$/;

/** A title or episode that's only on the person's Jellyfin server. */
export const isJellyfinId = (id: string): boolean => LOCAL_ID.test(id);
export const isJellyfinAddress = (url: string): boolean => url.startsWith(JELLYFIN_SCHEME);

/** The page's address for a `jellyfin-art` key. */
export const artUrl = (key: string): string => convertFileSrc(key, ART_PROTOCOL);

/** A Jellyfin-only title's poster, from its id alone (saved titles keep only https artwork). */
export function posterFor(id: string, art: (key: string) => string = artUrl): string | undefined {
  const match = LOCAL_ID.exec(id);
  return match ? art(`${match[1]}_${match[2]}_Primary`) : undefined;
}

export const itemToTitle = (item: JellyfinItem, serverName: string, art: (key: string) => string = artUrl): Title => serverItemTitle(item, { key: 'jellyfin', name: serverName }, art);

/** A Jellyfin-only title's details, its episodes grouped into seasons. */
export const metaToTitle = (meta: { item: JellyfinItem; episodes: JellyfinEpisode[] }, serverName: string, art: (key: string) => string = artUrl, now = new Date()): Title =>
  serverMetaTitle(meta, { key: 'jellyfin', name: serverName }, art, now);

/** A version on the server as a stream, so the picker reads its quality like any other. */
export const versionStream = (version: JellyfinVersion): Stream => serverVersionStream(version, 'Jellyfin');

let status: Promise<JellyfinStatus | null> | null = null;

/** The active profile's server, or null if it has none. */
export function jellyfinStatus(): Promise<JellyfinStatus | null> {
  // A failure (e.g. before a profile is picked) isn't kept: the next call asks again.
  status ??= invoke<JellyfinStatus | null>('jellyfin_status').catch(() => {
    status = null;
    return null;
  });
  return status;
}

function changed(): void {
  status = null;
  document.dispatchEvent(new Event(JELLYFIN_CHANGED));
}

/** Signs in; `first` says the profile had no server before. */
export async function connectJellyfin(server: string, username: string, password: string): Promise<{ status: JellyfinStatus; first: boolean }> {
  const connected = await invoke<{ status: JellyfinStatus; first: boolean }>('jellyfin_connect', { server, username, password });
  changed();
  return connected;
}

export async function disconnectJellyfin(): Promise<void> {
  await invoke('jellyfin_disconnect');
  changed();
}

export const jellyfinLibraries = (): Promise<JellyfinLibrary[]> => invoke<JellyfinLibrary[]>('jellyfin_libraries');

/** A Home row's titles. */
export async function jellyfinRow(feed: JellyfinFeed, library?: string): Promise<Title[]> {
  const server = await jellyfinStatus();
  if (!server) return [];
  const items = await invoke<JellyfinItem[]>('jellyfin_items', { feed, library: library ?? null });
  return items.map((item) => itemToTitle(item, server.serverName));
}

/** Details for a `jellyfin:…` title, or null if the connected server doesn't have it. */
export async function jellyfinMeta(id: string): Promise<Title | null> {
  const server = await jellyfinStatus();
  if (!server) return null;
  const meta = await invoke<{ item: JellyfinItem; episodes: JellyfinEpisode[] } | null>('jellyfin_meta', { id });
  return meta ? metaToTitle(meta, server.serverName) : null;
}

/**
 * The versions of a movie or episode on the connected server (none when
 * there's no server or it doesn't have it).
 */
export async function jellyfinSources(title: Title, episode?: { season: number; number: number; id: string }): Promise<{ serverName: string; versions: JellyfinVersion[] }> {
  if (!(await jellyfinStatus())) return { serverName: '', versions: [] };
  const found = await invoke<{ serverName: string; versions: JellyfinVersion[] } | null>('jellyfin_find', {
    titleId: title.id,
    kind: title.type,
    season: episode?.season ?? null,
    episode: episode?.number ?? null,
    episodeId: episode?.id ?? null,
  });
  return found ?? { serverName: '', versions: [] };
}

export const sendJellyfinReport: ReportSend = inOrder((event, address, position, paused) =>
  invoke('jellyfin_report', { event, address, position, paused }).catch((err: unknown) => console.warn('Could not update Jellyfin', err)),
);

/** Keeps the server up to date on a Jellyfin video (see `createServerReporter`). */
export const createJellyfinReporter = (send: ReportSend = sendJellyfinReport, now: () => number = Date.now) => createServerReporter(isJellyfinAddress, send, now);
