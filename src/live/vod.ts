import { invoke } from '@tauri-apps/api/core';
import type { Stream } from '../addons/types';
import type { Title } from '../catalog/titles';
import { t } from '../i18n';
import { settings } from '../lib/ipc';

/** Settings → Accounts & Services → Live TV: whether IPTV films and episodes join a title's sources (on unless turned off). */
export const VOD_SOURCES_KEY = 'live.vod-sources';
export const parseVodSources = (value: unknown): boolean => value !== false;
const vodSourcesOn = () => settings.get(VOD_SOURCES_KEY).then(parseVodSources, () => true);

type MatchTitle = Pick<Title, 'id' | 'type' | 'name' | 'year'>;
export function vodRequest(title: MatchTitle, episode?: { season: number; number: number }) {
  const year = title.year?.match(/^(\d{4})(?:\D|$)/)?.[1];
  return { id: title.id, name: title.name, year: year ? Number(year) : null, season: episode?.season ?? null, episode: episode?.number ?? null };
}

export interface VodSource {
  provider: string;
  account: string;
  address: string;
  label: string;
  insecure: boolean;
  /** The provider's media details as release-name words ("1080p · HEVC · 5.1"), when it gives them. */
  detail?: string | null;
  /** Estimated from the provider's bitrate and running time. */
  size?: number | null;
}
export async function vodSources(title: MatchTitle, episode?: { season: number; number: number }): Promise<VodSource[]> {
  if (title.type !== 'movie' && !episode) return [];
  if (!(await vodSourcesOn())) return [];
  return invoke<VodSource[]>('iptv_vod_sources', { request: vodRequest(title, episode) }).catch(() => []);
}

/**
 * Opening a film's or series' page: Rust builds a missing or old IPTV
 * index and fetches the matching titles' details in the background, so the
 * sources are ready when asked for. Never waited on.
 */
export async function prepareVod(title: MatchTitle): Promise<void> {
  if (title.type !== 'movie' && title.type !== 'series') return;
  if (!(await vodSourcesOn())) return;
  await invoke<void>('iptv_vod_prepare', { request: vodRequest(title), series: title.type === 'series' }).catch(() => undefined);
}

// The details line feeds the ranking's traits (resolution, codec, audio), as an addon's description would.
// The provider's own name stays out of it ("… 4K TV" would make every copy 4K); the picker shows it as the origin.
export const vodStream = (source: VodSource): Stream => ({
  url: source.address,
  name: 'IPTV',
  description: [source.label, source.detail].filter(Boolean).join('\n'),
  torrent: false,
  filename: undefined,
  videoSize: source.size ?? undefined,
  videoHash: undefined,
  bingeGroup: undefined,
  subtitles: [],
});
/** Where the picker says an IPTV copy comes from: "IPTV · My provider", and whether it travels unencrypted. */
export const vodOrigin = (source: Pick<VodSource, 'provider' | 'insecure'>): string => [t('livetv.vod.origin', { provider: source.provider }), source.insecure ? t('integrations.live-tv.insecure') : ''].filter(Boolean).join(' · ');
export const setVodEnabled = (id: string, on: boolean) => invoke<void>('iptv_vod_enable', { id, on });
