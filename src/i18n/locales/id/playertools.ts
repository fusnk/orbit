import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'Kustom',
  'playertools.speed.custom-label': 'Kecepatan kustom',
  'playertools.speed.slower': 'Lebih lambat (−0.05×)',
  'playertools.speed.faster': 'Lebih cepat (+0.05×)',
  'playertools.subs.try-another': 'Coba subtitle lain',
  'playertools.subs.try-another-detail': 'Kecocokan terbaik berikutnya dalam {language}',
  'playertools.subs.cycled': 'Subtitle {position} dari {total} · {source}',
  'playertools.subs.no-other': 'Tidak ada subtitle lain untuk dicoba',
  'playertools.paste.action': 'Tempel subtitle…',
  'playertools.paste.detail': 'Teks SRT atau WebVTT',
  'playertools.paste.title': 'Tempel subtitle',
  'playertools.paste.hint': 'Tempel teks dari file SRT atau WebVTT. Subtitle hanya ditambahkan ke video ini.',
  'playertools.paste.field': 'Teks subtitle',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nHalo!',
  'playertools.paste.add': 'Tambah subtitle',
  'playertools.paste.cancel': 'Batal',
  'playertools.paste.empty': 'Tempel teks subtitle terlebih dahulu.',
  'playertools.paste.too-big': 'Teks tersebut lebih dari 2 MB.',
  'playertools.paste.bad': 'Itu tidak terlihat seperti subtitle SRT atau WebVTT.',
  'playertools.paste.added': 'Subtitle tempelan ditambahkan',
  'playertools.paste.name': 'Subtitle tempelan',
  'playertools.caps.setting': 'Perbaiki subtitle HURUF KAPITAL',
  'playertools.caps.hint': 'Baris yang ditulis seluruhnya dengan huruf kapital diubah menjadi huruf kalimat. Berlaku untuk subtitle dari add-on, file yang Anda tambahkan, dan teks tempelan, bukan untuk subtitle di dalam file video. Nama juga kehilangan huruf kapitalnya.',
  'playertools.caps.error': 'Tidak dapat menerapkan pengaturan HURUF KAPITAL Anda',
};
