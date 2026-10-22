/**
 * Playing a torrent source (see src-tauri/src/torrent.rs): Rust starts the
 * download and hands back a local address for mpv. Until the video starts,
 * the loading screen shows how many people are sharing it and how fast.
 */
import { invoke } from '@tauri-apps/api/core';
import { t, tn } from '../../i18n';
import { parseTorrentFiles, type EpisodeHint, type TorrentFiles } from '../../lib/torrent-files';
import { torrentMode } from '../detail/ranking-prefs';
import { formatNumber } from './format';

export const isTorrent = (url: string) => url.startsWith('magnet:');

interface TorrentStatus {
  peers: number;
  /** MB/s. */
  speed: number;
}

/** The loading screen's line about a torrent's progress. */
export function torrentNote(status: TorrentStatus | null): string {
  if (!status || status.peers === 0) return t('player.torrent.looking');
  return tn('player.torrent.downloading', status.peers, { speed: formatNumber(status.speed, 1) });
}

/**
 * Starts `magnet`; `url` resolves to the address to play. `episode` finds the
 * episode in a season pack when the addon didn't say which file it is (left
 * out for a file picked by hand). `onStatus` gets a progress line every
 * second until `stop()` (call it once the video shows).
 */
export function startTorrent(magnet: string, episode: EpisodeHint | undefined, onStatus: (text: string) => void): { url: Promise<string>; stop(): void } {
  onStatus(torrentNote(null));
  const timer = window.setInterval(() => {
    void invoke<TorrentStatus | null>('torrent_status')
      .then((status) => onStatus(torrentNote(status)))
      .catch(() => {});
  }, 1000);
  return {
    url: invoke<string>('torrent_open', { magnet, upload: torrentMode() === 'share', episode: episode ?? null }),
    stop: () => window.clearInterval(timer),
  };
}

/**
 * A torrent's files, to choose one. The torrent playing answers at once;
 * another has to be asked of the people sharing it, which can take a while.
 */
export async function torrentFiles(magnet: string, episode: EpisodeHint | undefined): Promise<TorrentFiles> {
  return parseTorrentFiles(await invoke<unknown>('torrent_files', { magnet, episode: episode ?? null }));
}

/** Leaving a torrent: Rust stops it and deletes what it downloaded. */
export const stopTorrent = () => void invoke('torrent_stop').catch(() => {});
