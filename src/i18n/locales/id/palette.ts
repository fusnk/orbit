import type { palette as source } from '../en/palette';
import type { Catalog } from '../types';

export const palette: Catalog<typeof source> = {
  'palette.label': 'Palet perintah',
  'palette.placeholder': 'Cari judul, pengaturan, add-on, dan tindakan',
  // Group headings
  'palette.group.recent': 'Terbaru',
  'palette.group.suggested': 'Disarankan',
  'palette.group.yours': 'Milik Anda',
  'palette.group.titles': 'Judul',
  'palette.group.settings': 'Pengaturan',
  'palette.group.addons': 'Add-on',
  'palette.group.actions': 'Tindakan',
  // Titles from addons, while typing
  'palette.titles.searching': 'Mencari di add-on Anda…',
  'palette.titles.none': 'Tidak ada judul ditemukan',
  'palette.titles.none-can-search': 'Tidak ada add-on Anda yang bisa mencari',
  'palette.titles.failed': 'Add-on Anda tidak bisa mencari saat ini',
  'palette.search-all': 'Cari semua hasil untuk “{query}”',
  'palette.no-match': 'Tidak ada yang cocok dengan “{query}”',
  // Where a title of yours was found
  'palette.from.continue': 'Lanjutkan Menonton',
  'palette.from.library': 'Di pustaka Anda',
  'palette.from.queue': 'Di antrean Anda',
  'palette.from.downloads': 'Diunduh',
  'palette.from.watched': 'Sudah ditonton',
  'palette.from.list': 'Daftar',
  // What a result is
  'palette.kind.page': 'Halaman',
  'palette.kind.shortcut': 'Pintasan · {key}',
  'palette.kind.addon': 'Add-on',
  'palette.kind.category': 'Pengaturan',
  'palette.kind.setting': 'Pengaturan · {category}',
  'palette.setting-hidden': '“{setting}” muncul setelah Anda mengubah “{parent}”.',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Serial',
  'palette.kind.title': 'Judul',
  // Actions
  'palette.action.profile': 'Ganti profil',
  'palette.action.shortcuts': 'Pintasan keyboard',
  'palette.action.install-addon': 'Pasang add-on…',
  'palette.action.addon-updates': 'Periksa pembaruan add-on',
  // The key hints along the bottom
  'palette.hint.move': 'Pindah',
  'palette.hint.open': 'Buka',
  'palette.hint.groups': 'Grup berikutnya',
  'palette.hint.close': 'Tutup',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'bahasa mulai buka tutup jendela tray skala zoom gerakan efek aksesibilitas peringatan notifikasi cadangan pulihkan diagnostik log impor trakt letterboxd',
  'palette.keywords.playback': 'putar otomatis episode berikutnya lanjutkan lewati intro trailer',
  'palette.keywords.addons': 'pasang toko ekstensi plugin sumber kualitas torrent hindari utamakan',
  'palette.keywords.downloads': 'offline penyimpanan folder kualitas unduhan',
  'palette.keywords.appearance': 'tema warna aksen font gelap terang wallpaper ambient logo tampilan',
  'palette.keywords.shortcuts': 'keyboard hotkey tombol pintasan atur ulang',
  'palette.keywords.home-library': 'anime beranda baris sudah ditonton lanjutkan spoiler alur cerita pustaka metadata',
  'palette.keywords.subtitles': 'teks takarir bahasa paksa sinkron tunarungu lirik font ukuran warna',
  'palette.keywords.picture-sound': 'gambar video dekode perangkat keras hdr audio suara bahasa passthrough volume',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord layanan streaming sinkron akun debrid tmdb integrasi iptv tv live saluran m3u xtream panduan',
  // Settings → Shortcuts
  'palette.shortcut': 'Palet perintah',
};
