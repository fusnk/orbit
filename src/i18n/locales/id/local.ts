import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Lepas untuk memutar',
  'local.drop.video-hint': 'Video diputar di Orbit.',
  'local.drop.subtitle-hint': 'Subtitle ditambahkan ke yang sedang diputar.',
  'local.drop.first-only': 'Memutar {name}. Orbit memutar satu file sekaligus, jadi sisanya dilewati.',
  'local.drop.failed': 'File itu tidak dapat dibuka.',
  'local.drop.unsupported': 'Orbit tidak bisa memutar jenis file itu.',
  'local.drop.subtitle-needs-player': 'Putar video dulu, lalu lepas subtitle ke atasnya.',
  'local.drop.subtitle-added': 'Subtitle ditambahkan: {name}',
  'local.drop.subtitle-first-only': 'Subtitle ditambahkan: {name}. Hanya file pertama yang dipakai.',
  'local.drop.subtitle-failed': 'Subtitle itu tidak dapat ditambahkan.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'PC ini',
  'local.source.label': 'File lokal',
  // Settings → Player → External player
  'local.external.heading': 'Pemutar eksternal',
  'local.external.player': 'Buka sumber di',
  'local.external.player-hint': 'Menambahkan “Buka di pemutar eksternal” ke sumber web di pemilih sumber. Lanjutkan, lewati intro, trek yang diingat, dan progres tontonan hanya berfungsi di pemutar Orbit sendiri.',
  'local.external.none': 'Tidak ada',
  'local.external.custom': 'Kustom',
  'local.external.found': 'Ditemukan: {path}',
  'local.external.not-found': 'Tidak ditemukan di folder instalasi biasanya. Pilih Kustom untuk menentukan lokasinya.',
  'local.external.custom-path': 'Program',
  'local.external.custom-path-hint': 'File program pemutar, dipilih di PC ini.',
  'local.external.choose': 'Pilih…',
  'local.external.custom-invalid': 'Orbit tidak dapat menjalankannya. Pilih file program pemutar.',
  'local.external.always': 'Selalu buka di pemutar eksternal',
  'local.external.always-hint': 'Putar langsung menyerahkan sumber web terbaik ke pemutar itu. Torrent dan unduhan tetap diputar di Orbit.',
  // The source picker
  'local.external.open': 'Eksternal',
  'local.external.open-label': 'Buka di pemutar eksternal',
  'local.external.opened': 'Dibuka di pemutar eksternal.',
  'local.external.failed': 'Pemutar eksternal tidak berjalan. Periksa Pengaturan → Pemutar.',
};
