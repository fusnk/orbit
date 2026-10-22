import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  // The idle screen itself
  'ambient.label': 'Mode ambient',
  'ambient.hint.details': 'Enter untuk detail',
  'ambient.slide.resume': 'Lanjutkan',
  'ambient.slide.resume-episode': 'Lanjutkan {episode}',
  'ambient.slide.library': 'Di Pustaka Saya',
  'ambient.slide.recent': 'Baru ditonton',
  'ambient.slide.trending': 'Populer saat ini',
  // Settings → Appearance → Ambient mode
  'ambient.settings.heading': 'Mode ambient',
  'ambient.settings.after': 'Mulai setelah',
  'ambient.settings.after-hint': 'Jika tidak ada tombol yang ditekan selama ini, Orbit perlahan beralih ke tayangan slide artwork yang lambat. Tidak pernah saat sesuatu sedang diputar.',
  'ambient.settings.source': 'Yang ditampilkan',
  'ambient.settings.source-hint': 'Yang sedang Anda tonton dan simpan, yang populer, atau keduanya bergantian.',
  'ambient.settings.source-for-you': 'Untuk Anda',
  'ambient.settings.source-trending': 'Sedang Tren',
  'ambient.settings.source-both': 'Keduanya',
  'ambient.settings.clock': 'Tampilkan jam',
  'ambient.settings.clock-hint': 'Waktu dan tanggal di sudut layar.',
  'ambient.settings.paused': 'Juga saat dijeda',
  'ambient.settings.paused-hint': 'Muncul di atas pemutar setelah dijeda selama ini. Pemutaran tetap persis seperti semula.',
  'ambient.settings.preview': 'Pratinjau',
  'ambient.settings.preview-label': 'Lihat sekarang',
  'ambient.settings.preview-hint': 'Langsung memulai mode ambient. Tekan tombol apa saja atau gerakkan mouse untuk kembali.',
};
