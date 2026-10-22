import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Turkish strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Bu bağlantıyı oynat",
  'pastelink.play-magnet': "Bu magnet bağlantısını oynat",
  'pastelink.magnet': "Magnet bağlantısı",
  'pastelink.source': "Yapıştırılan bağlantı",
  'pastelink.detail': "Oynatıcıda açılır. İzleme geçmişine hiçbir şey kaydedilmez.",
  'pastelink.torrents-off.title': "Magnet bağlantıları için torrentlerin açık olması gerekir",
  'pastelink.torrents-off.detail': "Orbit magnet bağlantılarını kendi torrent oynatıcısıyla oynatır, ancak bu özellik kapalı. Torrentleri Ayarlar’dan açabilirsin.",
  'pastelink.torrents-off.open': "Ayarları aç",
};
