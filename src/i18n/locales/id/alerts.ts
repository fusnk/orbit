import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'Episode baru',
  'alerts.bell.unread.one': 'Episode baru: {count} belum dibaca',
  'alerts.bell.unread.other': 'Episode baru: {count} belum dibaca',
  'alerts.panel.heading': 'Episode baru',
  'alerts.panel.mark-read': 'Tandai semua sudah dibaca',
  'alerts.panel.empty': 'Belum ada yang baru. Episode baru dari serial yang Anda ikuti muncul di sini.',
  'alerts.panel.play': 'Putar',
  'alerts.panel.play-label': 'Putar {show} S{season}E{episode}',
  'alerts.panel.aired': 'Tayang {date}',
  'alerts.toast.episode': 'S{season}E{episode} “{title}” sudah tayang',
  'alerts.toast.grouped-title': 'Episode baru',
  'alerts.toast.grouped.one': '{count} episode baru dari serial yang Anda ikuti: {shows}',
  'alerts.toast.grouped.other': '{count} episode baru dari serial yang Anda ikuti: {shows}',
  'alerts.settings.enabled': 'Peringatan episode baru',
  'alerts.settings.enabled-hint': 'Lonceng di bilah judul menampilkan episode yang tayang sejak terakhir Anda melihat. Diperiksa saat aplikasi dimulai dan setiap beberapa jam.',
  'alerts.settings.toasts': 'Tampilkan notifikasi desktop',
  'alerts.settings.toasts-hint': 'Notifikasi sistem untuk setiap episode baru (satu untuk semuanya jika beberapa datang sekaligus), bahkan saat Orbit berjalan di latar belakang.',
  'alerts.settings.scope': 'Peringatan untuk',
  'alerts.settings.scope-hint': 'Serial yang sedang Anda tonton adalah serial di riwayat Anda; pustaka menambahkan semua serial yang disimpan.',
  'alerts.settings.scope-watching': 'Serial yang sedang saya tonton',
  'alerts.settings.scope-library': 'Semua di pustaka saya',
};
