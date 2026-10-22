import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'Dari',
  'explore.filters.year-to': 'Sampai',
  'explore.filters.runtime': 'Durasi',
  'explore.filters.runtime-min': 'Minimal',
  'explore.filters.runtime-max': 'Maksimal',
  'explore.filters.minutes': '{count} mnt',
  'explore.filters.cast': 'Pemeran',
  'explore.filters.director': 'Sutradara atau kru',
  'explore.filters.person-search': 'Cari orang: {what}',
  'explore.filters.person-placeholder': 'Ketik nama',
  'explore.filters.person-none': 'Tidak ada yang ditemukan',
  'explore.filters.person-clear': 'Hapus {name}',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Cache mundur',
  'settings.player.rewind-hint': 'Seberapa banyak video yang disimpan di memori, agar mundur terasa instan. Lebih banyak memakai hingga sekitar 600 MB RAM saat video diputar, Paling banyak hingga sekitar 1,5 GB. Berlaku mulai video berikutnya.',
  'settings.player.rewind-standard': 'Standar',
  'settings.player.rewind-more': 'Lebih banyak',
  'settings.player.rewind-most': 'Paling banyak',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Opasitas teks',
  'subs.style.box-colour': 'Warna kotak',
  'subs.style.box-opacity': 'Opasitas kotak',
  'subs.style.box-opacity-hint': 'Kotak bersudut siku: pemutar tidak bisa menggambar sudut membulat.',
  'subs.style.outline-colour': 'Warna garis tepi',
  'player.subtitle-style.black': 'Hitam',
  'player.subtitle-style.grey': 'Abu-abu',
  'player.subtitle-style.navy': 'Biru tua',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'Tidak menjawab',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} terpasang',
  'addons.health.installed.other': '{count} terpasang',
  'addons.health.enabled.one': '{count} aktif',
  'addons.health.enabled.other': '{count} aktif',
  'addons.health.refresh': 'Segarkan add-on',
  'addons.health.refreshing': 'Memperbarui {name}…',
  'addons.health.refreshed': '{name} telah diperbarui.',
  'addons.health.unchanged': '{name} menjawab: tidak ada perubahan.',
  'addons.health.refresh-failed': '{name} tidak menjawab. Orbit tetap memakai yang sudah ada.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Ukuran minimum',
  'sources.rules.min-size-hint': 'Untuk film; episode memakai sepertiganya. File yang lebih kecil, sering kali palsu atau rekaman kamera, ditaruh setelah semua yang lain, tetapi tidak pernah disembunyikan. Sumber yang tidak mencantumkan ukurannya tidak terpengaruh.',
  'titles.why.under-size': 'Di bawah minimum {size} GB Anda',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Cari koleksi',
  'collections.search.placeholder': 'Cari koleksi',
  'collections.search.none': 'Tidak ada koleksi yang cocok',
  'collections.search.none-detail': 'Pencarian mencakup nama dan grup.',
  'collections.search.titles-label': 'Cari judul di koleksi ini',
  'collections.search.titles-placeholder': 'Cari judul',
  'collections.search.no-titles': 'Tidak ada judul yang cocok di sini',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Ekspor ke kalender (.ics)',
  'radar.export.hint': 'Menyimpan isi Radar sebagai file yang bisa diimpor aplikasi kalender mana pun.',
  'radar.export.name': 'Radar Rilis Orbit',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} dalam {seconds}',
  'playerplus.settings.skip-delay': 'Tunggu sebelum melewati otomatis',
  'playerplus.settings.skip-delay-hint': 'Untuk segmen yang diatur ke Otomatis: tombol Lewati menghitung mundur dulu. Tekan tombol apa saja untuk menghentikannya dan menonton.',
  'playerplus.settings.skip-delay-none': 'Tanpa menunggu',
};
