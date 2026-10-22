import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // Settings → Playback → Autoplay limits (per profile)
  'sources.limits.heading': 'Batas putar otomatis',
  'sources.limits.any': 'Apa saja',
  'sources.limits.min-quality': 'Putar otomatis tidak dimulai di bawah',
  'sources.limits.min-quality-hint': 'Putar dan episode berikutnya hanya memulai sumber yang minimal sebagus ini (sumber yang tidak mencantumkannya tidak ikut). Jika tidak ada yang cocok, sumber terbaik diputar dan Orbit memberi tahu Anda. Daftar sumber tetap menampilkan semuanya. Untuk profil ini.',
  'sources.limits.max-quality': 'Putar otomatis tidak dimulai di atas',
  'sources.limits.max-quality-hint': 'Putar dan episode berikutnya tidak memulai sumber di atas ini, kecuali tidak ada yang lain. Berbeda dengan “Kualitas tertinggi yang diutamakan”, ini tidak mengubah urutan daftar sumber. Untuk profil ini.',
  'sources.limits.max-size': 'Putar otomatis tidak memulai file lebih besar dari',
  'sources.limits.max-size-hint': 'Untuk koneksi lambat atau kuota data: Putar dan episode berikutnya melewati file yang lebih besar. Sumber yang tidak mencantumkan ukurannya tidak terpengaruh. Untuk profil ini.',
  // Toasts when a source is picked automatically
  'sources.autoplay.outside-limits': 'Tidak ada yang sesuai batas putar otomatis Anda, jadi sumber terbaik yang diputar.',
  'sources.autoplay.only-uncached': 'Semua sumber yang ditemukan masih diunduh ke layanan debrid Anda. Pilih salah satu untuk memulainya.',
  // Quiet tags in the source list
  'sources.note.uncached': 'Belum di-cache',
  'sources.note.uncached-hint': 'Masih diunduh ke layanan debrid Anda: tidak pernah dimulai otomatis',
  'sources.note.outside-limits': 'Di luar batas putar otomatis',
  'sources.note.outside-limits-hint': 'Putar dan episode berikutnya melewatinya (Pengaturan → Add-on & Sumber → Preferensi sumber → Batas putar otomatis)',
  // The Next Up card, for an episode whose air date isn't confirmed
  'sources.next-up.unaired': 'Berikutnya · tanggal tayang belum pasti',
};
