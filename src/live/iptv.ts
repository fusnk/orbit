/**
 * Live TV data (see src-tauri/src/iptv): the person's IPTV sources, their
 * channels and what's on. Addresses and logins stay in Rust; a channel is
 * played as `orbit-tv://{source}/{key}` (a past programme adds `?start=…`),
 * which only the player resolves.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface TvSource {
  id: string;
  name: string;
  kind: 'm3u' | 'xtream';
  host: string;
  /** Plain http: the login travels unencrypted. */
  insecure: boolean;
  channels: number;
  useVod: boolean;
  channelsAt: number | null;
  epgAt: number | null;
  epgError: string | null;
  /** What an Xtream panel last said about the account. */
  account: TvAccount | null;
}

/** An Xtream account as its panel describes it (no login: Rust keeps that). */
export interface TvAccount {
  /** "active", "expired", "banned"… in lower case, if the panel says. */
  status: string | null;
  /** Unix seconds; null when it doesn't expire. */
  expires: number | null;
  maxConnections: number | null;
  activeConnections: number | null;
  trial: boolean;
  /** Unix ms. */
  checkedAt: number;
}

export type AccountState = { kind: 'expired' } | { kind: 'inactive'; status: string } | { kind: 'unlimited' } | { kind: 'days'; days: number };

/** Whether the account still runs, and for how many days (any part of a day counts as one). */
export function accountState(account: TvAccount, nowMs = Date.now()): AccountState {
  if (account.status === 'expired') return { kind: 'expired' };
  if (account.status && account.status !== 'active') return { kind: 'inactive', status: account.status };
  if (account.expires === null) return { kind: 'unlimited' };
  const left = account.expires * 1000 - nowMs;
  return left <= 0 ? { kind: 'expired' } : { kind: 'days', days: Math.ceil(left / 86_400_000) };
}

export type NewTvSource =
  | { kind: 'm3u'; name: string; playlist: string; epg?: string }
  | { kind: 'xtream'; name: string; server: string; username: string; password: string; epg?: string };

export interface TvChannel {
  source: string;
  key: string;
  name: string;
  logo: string | null;
  group: string | null;
  favourite: boolean;
  /** Where it comes among the favourites (lower first; null if not one). */
  rank: number | null;
  /** Whether the guide has programmes for it. */
  listed: boolean;
  /** Days back that past programmes can be replayed (0: no catch-up). */
  archive: number;
}

export interface Showing {
  title: string;
  /** Unix seconds. */
  start: number;
  stop: number;
  description: string | null;
}

export interface TvGuide {
  source: string;
  key: string;
  now: Showing | null;
  next: Showing | null;
}

/** Dispatched on `document` when sources are added or removed (the Live TV tab shows or hides). */
export const TV_SOURCES_CHANGED = 'orbit:tv-sources';

export const tvSources = () => invoke<TvSource[]>('iptv_sources');

export async function addTvSource(source: NewTvSource): Promise<TvSource> {
  const added = await invoke<TvSource>('iptv_add', { source });
  document.dispatchEvent(new Event(TV_SOURCES_CHANGED));
  return added;
}

export async function removeTvSource(id: string): Promise<void> {
  await invoke('iptv_remove', { id });
  document.dispatchEvent(new Event(TV_SOURCES_CHANGED));
}

/** A source's own guides as Settings shows them (hosts only), and what's used when there are none. */
export interface TvGuides {
  own: { host: string; insecure: boolean }[];
  fallback: 'provider' | 'playlist' | 'none';
}
export type TvGuideChange = { kind: 'add'; url: string } | { kind: 'remove'; index: number } | { kind: 'up'; index: number };
export const tvGuides = (id: string) => invoke<TvGuides>('iptv_guides', { id });
/** Changes a source's guides; Rust then downloads them again in the background. */
export const changeTvGuides = (id: string, change: TvGuideChange) => invoke<TvGuides>('iptv_guides_change', { id, change });

export const refreshTvSource = (id: string) => invoke('iptv_refresh', { id });
/** Asks an Xtream panel about the account (Rust answers from what it knows if it asked recently). */
export const tvAccount = (id: string) => invoke<TvAccount | null>('iptv_account', { id });
export const refreshStaleTvSources = () => invoke('iptv_refresh_stale');
export const tvChannels = () => invoke<TvChannel[]>('iptv_channels');
export const tvGuide = (channels: readonly TvChannel[]) => invoke<TvGuide[]>('iptv_guide', { channels: channels.map((c) => [c.source, c.key]) });
export interface TvSchedule {
  source: string;
  key: string;
  programmes: Showing[];
}

/** Programmes between `from` and `to` (Unix seconds) for the guide grid. */
export const tvSchedule = (channels: readonly TvChannel[], from: number, to: number) =>
  invoke<TvSchedule[]>('iptv_schedule', { channels: channels.map((c) => [c.source, c.key]), from, to });
export const setTvFavourite = (channel: TvChannel, on: boolean) => invoke('iptv_favourite', { source: channel.source, key: channel.key, on });
/** Saves the favourites' order (the profile's favourites, first to last). */
export const setTvFavouriteOrder = (favourites: readonly TvChannel[]) => invoke('iptv_favourites_order', { order: favourites.map((c) => [c.source, c.key]) });

/** A group as the profile arranges it (see src-tauri/src/iptv/groups.rs). */
export interface TvGroup {
  name: string;
  /** Channels in it, counted whether or not it's shown. */
  count: number;
  hidden: boolean;
  locked: boolean;
}

export interface TvGroups {
  /** Every group in the profile's order, hidden ones included. */
  groups: TvGroup[];
  /** Locked groups are open this session (and their channels listed). */
  unlocked: boolean;
  /** A PIN exists (the profile's or a parent's) that a lock asks for. */
  pinSet: boolean;
}

/** Errors groups.rs answers with: locking needs a PIN to exist; unlocking needs it typed first. */
export const GROUP_ERRORS = { noPin: 'no-pin', pinNeeded: 'pin-needed' } as const;

export const tvGroups = () => invoke<TvGroups>('iptv_groups');
export const setTvGroup = (name: string, change: { hidden?: boolean; locked?: boolean }) =>
  invoke('iptv_group_set', { name, hidden: change.hidden ?? null, locked: change.locked ?? null });
export const setTvGroupOrder = (names: readonly string[]) => invoke('iptv_groups_order', { order: names });
/** Opens locked groups until Orbit closes or the profile changes; rejects with `err.pin.wrong` and the like. */
export const unlockTvGroups = (pin: string) => invoke('iptv_groups_unlock', { pin });
export const lockTvGroups = () => invoke('iptv_groups_lock');

/**
 * What to search the addons for from a guide's programme title: without the
 * decorations guides add (superscript "ᴺᵉʷ" / "ᴸᶦᵛᵉ" marks, "[HD]" tags,
 * "New:" and the episode after "S02E05").
 */
export function programmeQuery(title: string): string {
  return title
    // Of U+02B0-02FF only the superscript letters: the rest are letters and apostrophes too (Hawaiian's okina, Ukrainian's apostrophe).
    .replace(/[\u02B0-\u02B8\u02E0-\u02E4\u1D2C-\u1D7F\u1D9B-\u1DBF\u2070-\u209F]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^\s*(new|live|premiere|repeat)\s*[:\-–]\s*/i, '')
    .replace(/\s*[-–:,(]?\s*\bS\d{1,2}\s*E\d{1,3}\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:|·]+|[\s\-–:|·]+$/g, '')
    .trim();
}

/** The address the player resolves in Rust. */
export const channelAddress = (channel: TvChannel) => `orbit-tv://${channel.source}/${channel.key}`;

/** The longest programme Rust replays (iptv/mod.rs `replay_window`): longer blocks are filler like "Off air". */
const MAX_REPLAY_S = 12 * 3600;

/** Whether `programme` has finished and is still in the channel's archive. */
export const canReplay = (channel: Pick<TvChannel, 'archive'>, programme: Pick<Showing, 'start' | 'stop'>, now = Date.now() / 1000) =>
  channel.archive > 0 && programme.stop <= now && programme.start >= now - channel.archive * 86_400 && programme.stop - programme.start <= MAX_REPLAY_S;

/**
 * A past programme from the channel's archive. `tz` is this computer's offset
 * from UTC (minutes) at the programme's start, for providers whose archive
 * addresses use local time.
 */
export const replayAddress = (channel: TvChannel, programme: Showing) =>
  `${channelAddress(channel)}?start=${programme.start}&end=${programme.stop}&tz=${-new Date(programme.start * 1000).getTimezoneOffset()}`;

/** Calls `onUpdate(sourceId)` when a source's channels or guide finish refreshing. */
export function onTvUpdated(onUpdate: (source: string) => void): Promise<() => void> {
  return listen<string>('iptv://updated', (event) => onUpdate(event.payload));
}
