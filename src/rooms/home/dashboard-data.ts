/**
 * What Home's dashboard pieces show, worked out from plain data so it can be
 * tested; dashboard.ts and hero.ts draw it.
 */
import type { Title } from '../../catalog/titles';
import type { Showing, TvChannel, TvGuide } from '../../live/iptv';
import type { NextEpisode } from '../../library/watch';
import { streamLabels } from '../../lib/stream-traits';

export type StatusItem =
  | { kind: 'episode'; title: Title; episode: NextEpisode; airedAt: number }
  | { kind: 'downloads'; count: number }
  | { kind: 'library'; count: number };

/** The status tiles, in order; a tile with nothing to say is left out. */
export function statusItems(input: {
  newEpisode: { title: Title; episode: NextEpisode; airedAt: number } | null;
  downloads: readonly { state: string }[];
  library: number;
}): StatusItem[] {
  const ready = input.downloads.filter((d) => d.state === 'done').length;
  const items: StatusItem[] = [];
  if (input.newEpisode) items.push({ kind: 'episode', ...input.newEpisode });
  if (ready) items.push({ kind: 'downloads', count: ready });
  if (input.library) items.push({ kind: 'library', count: input.library });
  return items;
}

/** "today", "yesterday", "3 days ago": calendar days in this computer's time zone. */
export function airedText(airedAt: number, now: number, tag: string): string {
  const day = (ms: number) => {
    const date = new Date(ms);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  };
  return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(Math.min(0, day(airedAt) - day(now)), 'day');
}

export interface OnNow {
  channel: TvChannel;
  now: Showing | null;
}

/**
 * Up to `limit` favourites for "Live TV · On now", in the person's order.
 * Ones the guide has a programme for come before ones it doesn't, so the
 * row shows what's on wherever it can.
 */
export function onNow(favourites: readonly TvChannel[], guides: readonly TvGuide[], limit = 4): OnNow[] {
  const byKey = new Map(guides.map((g) => [`${g.source}/${g.key}`, g.now]));
  const entries = favourites.map((channel) => ({ channel, now: byKey.get(`${channel.source}/${channel.key}`) ?? null }));
  const chosen = new Set([...entries.filter((e) => e.now), ...entries.filter((e) => !e.now)].slice(0, limit));
  return entries.filter((e) => chosen.has(e));
}

/**
 * Picture quality worth a badge, from a downloaded copy's stream label:
 * "4K", and "Dolby Vision" or "HDR". Only what the label says; nothing is guessed.
 */
export function qualityBadges(label: string): string[] {
  const { resolution, hdr } = streamLabels({ name: label }).traits;
  const badges: string[] = [];
  if (resolution === '2160p') badges.push('4K');
  if (hdr) badges.push(hdr === 'Dolby Vision' ? 'Dolby Vision' : 'HDR');
  return badges;
}
