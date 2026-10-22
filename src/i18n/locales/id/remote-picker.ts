import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Indonesian strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Jelajahi',
  'remote.phone.browse-loading': 'Memuat Beranda Anda…',
  'remote.phone.browse-empty': 'Belum ada yang bisa ditampilkan. Tambahkan add-on katalog di Orbit untuk mengisi Beranda.',
  'remote.phone.browse-failed': 'Beranda tidak dapat dimuat. Coba lagi.',
  'remote.phone.refresh': 'Muat ulang',
  'remote.phone.moods': 'Sedang ingin menonton apa?',
  'remote.phone.mood-loading': 'Mencari rekomendasi…',
  'remote.phone.mood-empty': 'Belum ada rekomendasi untuk suasana hati ini.',
  'remote.phone.surprise': 'Kejutkan saya',
  'remote.phone.surprise-hint': 'Satu pilihan acak dari katalog Anda.',
  'remote.phone.surprise-movie': 'Film',
  'remote.phone.surprise-series': 'Serial',
  'remote.phone.surprise-none': 'Belum ada yang baru untuk disarankan. Coba jenis lainnya, atau ubah pilihan Kejutkan saya di Orbit.',
  'remote.phone.details-loading': 'Memuat detail…',
  'remote.phone.details-failed': 'Judul ini tidak dapat dimuat. Coba lagi.',
  'remote.phone.add-library': 'Tambahkan ke pustaka',
  'remote.phone.in-library': 'Ada di pustaka Anda',
  'remote.phone.close': 'Tutup',
  'remote.phone.season': 'Musim {number}',
  'remote.phone.specials': 'Spesial',
  'remote.phone.episodes': 'Episode',
  'remote.phone.rating': 'Rating IMDb {rating}',
};
