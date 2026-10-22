import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Indonesian strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Putar tautan ini",
  'pastelink.play-magnet': "Putar tautan magnet ini",
  'pastelink.magnet': "Tautan magnet",
  'pastelink.source': "Tautan yang ditempel",
  'pastelink.detail': "Dibuka di pemutar. Tidak ada yang disimpan ke riwayat tontonan.",
  'pastelink.torrents-off.title': "Tautan magnet memerlukan torrent diaktifkan",
  'pastelink.torrents-off.detail': "Orbit memutar tautan magnet dengan pemutar torrent bawaannya, yang sedang nonaktif. Anda bisa mengaktifkan Torrent di Pengaturan.",
  'pastelink.torrents-off.open': "Buka Pengaturan",
};
