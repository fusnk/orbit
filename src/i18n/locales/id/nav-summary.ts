import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Indonesian strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} + {count} lainnya',
  'navsummary.scale': 'Skala {percent}',
  'navsummary.size': 'Ukuran {percent}',
  'navsummary.banner': 'Banner {style}',
  'navsummary.watched-at': 'Ditonton di {percent}',
  'navsummary.spoilers-hidden': 'Spoiler disembunyikan',
  'navsummary.spoilers-shown': 'Spoiler ditampilkan',
  'navsummary.autoplay': 'Putar otomatis: {mode}',
  'navsummary.player-layout': 'Tata letak {name}',
  'navsummary.no-addons': 'Tidak ada add-on',
  'navsummary.not-connected': 'Belum ada yang terhubung',
  'navsummary.downloads.none': 'Belum ada unduhan',
  'navsummary.downloads.done.one': '{count} diunduh',
  'navsummary.downloads.done.other': '{count} diunduh',
  'navsummary.downloads.active.one': '{count} sedang berjalan',
  'navsummary.downloads.active.other': '{count} sedang berjalan',
  'navsummary.shortcuts.one': '{count} pintasan',
  'navsummary.shortcuts.other': '{count} pintasan',
};
