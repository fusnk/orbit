import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Indonesian strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Tampilan pemutar, cara kontrolnya bekerja, dan pemutar lain.',
  'settingslayout.intro.playback': 'Menekan Putar, episode berikutnya, melewati, dan trailer.',
  'settingslayout.intro.appearance': 'Gaya, warna, menu, latar, halaman judul, dan poster.',
  'settingslayout.keywords.player': 'pemutar tata letak kontrol bilah progres lompat volume penguat perkecil layar penuh pratinjau mundur eksternal vlc mpv',
  'settingslayout.chapter.library': 'Pustaka',
  'settingslayout.chapter.starting': 'Memulai video',
  'settingslayout.chapter.skip-tuning': 'Penyesuaian melewati',
  'settingslayout.chapter.player-look': 'Tampilan',
  'settingslayout.chapter.player-controls': 'Kontrol',
  'settingslayout.chapter.player-window': 'Jendela & ekstra',
  'settingslayout.chapter.subtitle-text': 'Bahasa & teks',
  'settingslayout.chapter.choosing-source': 'Memilih sumber',
  'settingslayout.chapter.ranking-rules': 'Aturan urutan',
  'settingslayout.preview': 'Pratinjau',
  'settingslayout.none': 'Tidak ada',
};
