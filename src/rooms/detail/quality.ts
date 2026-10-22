/**
 * The title page's quality badges (lib/quality-badges.ts), from the sources
 * Orbit would offer for it. The stream lookups are shared with Play and the
 * source picker (see `loadStreams`), so the badges cost no extra requests
 * when the person goes on to play.
 */
import type { Stream } from '../../addons/types';
import { finishedStreams, loadStreams, streamAddons, streamRequest } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import { qualityBadges, qualityTraits, type QualityBadge } from '../../lib/quality-badges';
import { torrentMode } from './ranking-prefs';
import type { EpisodeRef } from './title-actions';

/** Only sources the picker would offer: torrents count only when Settings → Playback allows them. */
const badgesOf = (streams: readonly Stream[]): QualityBadge[] => qualityBadges(streams.filter((s) => !s.torrent || torrentMode() !== 'off').map(qualityTraits));

/** Badges from sources already found for the movie or episode; undefined when none were looked up lately. Never asks the addons. */
export function knownQuality(title: Title, episode?: EpisodeRef): QualityBadge[] | undefined {
  const streams = finishedStreams(streamRequest(title, episode ? { season: episode.season, number: episode.episode.number, id: episode.episode.id } : undefined));
  return streams && badgesOf(streams);
}

/**
 * A movie's badges, passed to `found` as each addon answers (so they show with
 * the first, not the slowest) and resolved once every addon has.
 */
export async function loadQuality(title: Title, signal: AbortSignal, found?: (badges: QualityBadge[]) => void): Promise<QualityBadge[]> {
  const req = streamRequest(title);
  const addons = await streamAddons(req);
  let badges: QualityBadge[] = [];
  for await (const event of loadStreams(addons, req, signal)) {
    // Each partial result holds everything found so far.
    if (event.type !== 'partial') continue;
    const next = badgesOf(event.items.map(({ item }) => item));
    if (next.join() === badges.join()) continue;
    badges = next;
    found?.(badges);
  }
  return badges;
}
