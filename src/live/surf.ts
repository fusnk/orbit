/**
 * Live TV channel surfing and the Live TV preferences: which channel comes
 * next, the favourites' order, the list a channel was opened from, and what
 * Live TV opens on (Settings → Live TV). The player's side is in
 * src/rooms/player/channel-surf.ts.
 */
import { t } from '../i18n';
import { formatClock } from '../lib/clock';
import type { Title } from '../catalog/titles';
import { activeProfileId } from '../library/profiles';
import { h } from '../lib/dom';
import { settings } from '../lib/ipc';
import type { PlayRequest } from '../rooms/player';
import { channelAddress, tvChannels, type Showing, type TvChannel } from './iptv';

export const LIVE_SETTINGS = {
  /** 'all', 'favourites' or 'last' (the group open last time). */
  openOn: 'live.open-on',
  /** Whether opening Live TV plays the last channel again (off unless chosen). */
  resumeLast: 'live.resume-last',
  /** Per profile: the last group and channel, as `live.last.<profile id>` (a LastPlace). */
  last: 'live.last',
} as const;

export type OpenOn = 'all' | 'favourites' | 'last';
export const parseOpenOn = (value: unknown): OpenOn => (value === 'favourites' || value === 'last' ? value : 'all');

/** A group of the channel list, kept by what it is rather than its (translated) label. */
export type GroupRef = 'all' | 'favourites' | { name: string };
export interface LastPlace {
  group?: GroupRef;
  channel?: { source: string; key: string };
}

/** Caps on what's kept: a provider's group names and ids are untrusted, and settings are small. */
const MAX_TEXT = 300;
/** Setting keys allow lowercase letters, digits and ._- (64 at most). */
const PROFILE_ID = /^[a-z0-9._-]{1,40}$/;

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;

function parseGroup(value: unknown): GroupRef | undefined {
  if (value === 'all' || value === 'favourites') return value;
  if (value && typeof value === 'object' && text((value as { name?: unknown }).name)) return { name: (value as { name: string }).name };
  return undefined;
}

function parsePlace(value: unknown): LastPlace {
  if (!value || typeof value !== 'object') return {};
  const { group, channel } = value as { group?: unknown; channel?: unknown };
  const place: LastPlace = {};
  const g = parseGroup(group);
  if (g) place.group = g;
  if (channel && typeof channel === 'object') {
    const { source, key } = channel as { source?: unknown; key?: unknown };
    if (text(source) && text(key)) place.channel = { source, key };
  }
  return place;
}

/** The profile's last group and channel from its saved setting, ignoring anything malformed. */
export const parseLast = (value: unknown): LastPlace => (Array.isArray(value) ? {} : parsePlace(value));

/** The saved place with `change` applied (malformed parts dropped). */
export const withLast = (value: unknown, change: LastPlace): LastPlace => ({ ...parseLast(value), ...parsePlace(change) });

/**
 * The profile's own setting (`live.last.<id>`, see profiles.rs PROFILE_SETTINGS):
 * Rust lets only the active profile read or write it, so one profile can't see
 * which channel another (perhaps PIN-locked) one watched last.
 */
export const lastKey = (profile: string): string | null => (PROFILE_ID.test(profile) ? `${LIVE_SETTINGS.last}.${profile}` : null);

/** Remembers the active profile's last group or channel (best effort). */
export async function rememberLast(change: LastPlace): Promise<void> {
  const key = lastKey((await activeProfileId().catch(() => null)) ?? '');
  if (!key) return;
  const saved = await settings.get(key).catch(() => null);
  await settings.set(key, withLast(saved, change)).catch(() => {});
}

export async function loadLast(): Promise<LastPlace> {
  const key = lastKey((await activeProfileId().catch(() => null)) ?? '');
  return key ? parseLast(await settings.get(key).catch(() => null)) : {};
}

export const sameChannel = (a: { source: string; key: string }, b: { source: string; key: string }) => a.source === b.source && a.key === b.key;

/** The index `step` places on from `index`, wrapping around the ends. */
export function stepIndex(length: number, index: number, step: number): number {
  if (length <= 0) return -1;
  return (((index + step) % length) + length) % length;
}

/**
 * Indexes of the channels around `index`, in list order: up to `radius`
 * either side, wrapping around the ends (the whole list if it's short).
 */
export function nearby(length: number, index: number, radius: number): number[] {
  if (length <= 2 * radius + 1) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: 2 * radius + 1 }, (_, i) => stepIndex(length, index, i - radius));
}

/** Favourites in the person's order (ties keep the channel list's order). */
export function favouritesInOrder(channels: readonly TvChannel[]): TvChannel[] {
  return channels.filter((c) => c.favourite).sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

/** `list` with the item at `from` moved to `to` (clamped); the same order if either is out of range. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= list.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.min(Math.max(0, to), next.length), 0, item!);
  return next;
}

/**
 * Where a dragged row lands: its index once moved (as `moveItem` takes it),
 * from the vertical middles of the rows (in order) and the pointer's height.
 */
export function dropIndex(middles: readonly number[], from: number, y: number): number {
  return middles.filter((middle, i) => i !== from && middle < y).length;
}

/**
 * Calls `fn` with the latest arguments once calls stop for `ms`: rapid
 * presses tune only to the channel the person stops on.
 */
export function debounce<A extends unknown[]>(ms: number, fn: (...args: A) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call(...args: A): void {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn(...args);
      }, ms);
    },
    cancel(): void {
      clearTimeout(timer);
      timer = undefined;
    },
    pending: () => timer !== undefined,
  };
}

// ── What's on ──

/** How far through `showing` it is at `now` (Unix seconds), 0 to 1. */
export const progressOf = (showing: Showing, now = Date.now() / 1000) => (showing.stop > showing.start ? Math.min(1, Math.max(0, (now - showing.start) / (showing.stop - showing.start))) : 0);

/** CSSOM rather than a style attribute: the CSP forbids inline styles. */
export function progressBar(fraction: number): HTMLElement {
  const fill = h('span', {});
  fill.style.setProperty('--fraction', String(fraction));
  return h('span', { class: 'live-progress', 'aria-hidden': 'true' }, fill);
}

/**
 * What stands in for a missing logo: the name's first letter or digit, as providers often
 * start names with a flag ("🇬🇧 BBC One", whose first UTF-16 unit alone is a broken glyph) or a tag ("|UK| …").
 */
export const channelInitial = (name: string): string => name.match(/[\p{L}\p{N}]/u)?.[0] ?? Array.from(name)[0] ?? '';

/** The channel's logo, or its initial if it has none (or it doesn't load). */
export function channelLogo(channel: TvChannel, className = 'live-logo'): HTMLElement {
  const initial = () => h('span', { class: `${className} live-initial`, 'aria-hidden': 'true' }, channelInitial(channel.name));
  if (!channel.logo) return initial();
  const img = h('img', { class: className, src: channel.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(initial()));
  return img;
}

export const clock = (seconds: number) => formatClock(seconds * 1000);

// ── Playing a channel ──

/** The player shows a channel as a title of type "tv". */
export function channelTitle(channel: TvChannel): Title {
  return { id: `tv:${channel.source}:${channel.key}`, type: 'tv', name: channel.name, ...(channel.logo ? { poster: channel.logo } : {}), genres: [], origins: [] };
}

export function channelRequest(channel: TvChannel): PlayRequest {
  const source = { id: 'live', url: channelAddress(channel), addon: t('browse.nav.live'), label: t('browse.live.live'), meta: '' };
  return { title: channelTitle(channel), source, sources: [source], live: true };
}

/** What the player surfs through: the list the channel was opened from, and which one plays. */
let surfing: { list: readonly TvChannel[] | null; channel: TvChannel } | null = null;

/** Notes the channel about to play and (if known) the list it was picked from. */
export function setSurfing(channel: TvChannel, list: readonly TvChannel[] | null): void {
  surfing = { list: list && list.some((c) => sameChannel(c, channel)) ? list : null, channel };
  void rememberLast({ channel: { source: channel.source, key: channel.key } });
}

/** The channel playing, if a Live TV channel was the last thing started. */
export const surfingChannel = () => surfing?.channel ?? null;

/**
 * The list to surf through: the one the channel was opened from, or else the
 * favourites (if it's one) or all channels.
 */
export async function surfList(): Promise<readonly TvChannel[]> {
  if (!surfing) return [];
  if (surfing.list) return surfing.list;
  const { channel } = surfing;
  const all = await tvChannels().catch(() => [] as TvChannel[]);
  const favourites = favouritesInOrder(all);
  const list = favourites.some((c) => sameChannel(c, channel)) ? favourites : all;
  if (surfing.channel === channel) surfing = { channel, list };
  return list;
}
