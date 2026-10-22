import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': 'Putar dari server Jellyfin milik Anda sendiri. Film dan episode yang ada di server mendapat sumber Jellyfin, dan barisnya dapat ditampilkan di Beranda. Orbit menyimpan token masuk dari server, bukan kata sandi Anda.',
  'jellyfin.settings.server': 'Alamat server',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'Nama pengguna',
  'jellyfin.settings.password': 'Kata sandi',
  'jellyfin.settings.fields-hint': 'Alamat yang Anda gunakan untuk membuka Jellyfin di browser. Memerlukan Jellyfin 10.9 atau lebih baru.',
  'jellyfin.settings.connect': 'Hubungkan',
  'jellyfin.settings.connecting': 'Menghubungkan…',
  'jellyfin.settings.server-label': 'Server',
  'jellyfin.settings.connected-as': 'Terhubung sebagai {user} di {server}',
  'jellyfin.settings.connected': 'Terhubung ke {server}.',
  'jellyfin.settings.connected-first': 'Terhubung ke {server}. “Baru ditambahkan” kini ada di Beranda; tambahkan baris Jellyfin lainnya di Pengaturan → Beranda & Pustaka → Baris Beranda.',
  'jellyfin.settings.disconnect': 'Putuskan',
  'jellyfin.settings.disconnected': 'Terputus, dan sudah keluar dari server.',
  'jellyfin.settings.insecure': 'Tidak aman',
  'jellyfin.settings.insecure-title': 'Server ini menggunakan http biasa, jadi data masuk dan video Anda dikirim tanpa enkripsi. Tidak masalah di rumah; gunakan https melalui internet.',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'Lanjutkan Menonton',
  'jellyfin.rows.latest': 'Baru ditambahkan',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'Hubungkan server Jellyfin di Pengaturan → Akun & Layanan terlebih dahulu.',
  'jellyfin.rows.libraries-failed': 'Tidak dapat memuat pustaka server.',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
