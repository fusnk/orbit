import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'Spoiler',
  'spoilers.intro': 'Apa yang disembunyikan tentang episode: di halaman serial, di daftar episode pemutar, di kartu Berikutnya, dan di Lanjutkan Menonton.',
  'spoilers.titles': 'Sembunyikan judul episode',
  'spoilers.titles-hint': 'Menampilkan “Episode 4” sebagai ganti nama episode.',
  'spoilers.descriptions': 'Sembunyikan deskripsi episode',
  'spoilers.descriptions-hint': 'Ringkasan setiap episode tidak ditampilkan.',
  'spoilers.thumbnails': 'Buramkan gambar episode',
  'spoilers.thumbnails-hint': 'Arahkan kursor atau fokus ke episode untuk mengintip.',
  'spoilers.ratings': 'Sembunyikan rating episode',
  'spoilers.ratings-hint': 'Rating bisa membocorkan episode mana yang penting.',
  'spoilers.unaired': 'Sembunyikan tanggal tayang episode mendatang',
  'spoilers.unaired-hint': 'Episode yang belum tayang hanya bertuliskan “Belum tayang”.',
  'spoilers.scope': 'Berlaku untuk',
  'spoilers.scope-hint': 'Episode yang sudah Anda selesaikan atau mulai menampilkan semuanya, kecuali Anda memilih semua episode.',
  'spoilers.scope-unwatched': 'Episode yang belum saya tonton',
  'spoilers.scope-all': 'Semua episode',
};
