import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Paling cocok',
  'subs.error.sdh': 'Tidak dapat menerapkan pengaturan teks tunarungu Anda',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Hapus teks untuk tunarungu',
  'subs.settings.strip-sdh-hint': 'Menyembunyikan deskripsi suara seperti [pintu berderit], penanda musik, dan nama pembicara seperti JOHN: dari subtitle. Baris yang menjadi kosong dilewati; waktunya tetap sama.',
  'subs.settings.keep-lyrics': 'Pertahankan lirik lagu',
  'subs.settings.keep-lyrics-hint': 'Baris nyanyian yang ditandai ♪ tetap ditampilkan saat teks untuk tunarungu dihapus. Baris yang hanya berisi not musik tetap dihapus.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Tidak dapat mempertahankan subtitle di bawah',
  'subs.player.position': 'Posisi subtitle',
  'subs.player.height': 'Ketinggian',
  'subs.player.raised': 'Naik {value}%',
  'subs.player.reset': 'Kembalikan ke bawah',
  'subs.player.keep-bottom': 'Tetap di bawah',
  'subs.player.keep-bottom-hint': 'Subtitle biasa (seperti SRT) mengabaikan penempatan dari file, sehingga setiap baris berada di ketinggian ini. Subtitle biasa di dalam video juga kehilangan huruf miringnya. Subtitle bergaya (ASS, umum pada anime) mempertahankan tata letaknya sendiri. Diingat untuk setiap video.',
};
