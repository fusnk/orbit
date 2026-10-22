import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Turkish strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Oynatıcının görünümü, denetimlerinin davranışı ve diğer oynatıcılar.',
  'settingslayout.intro.playback': 'Oynat’a basmak, sonraki bölüm, atlamalar ve fragmanlar.',
  'settingslayout.intro.appearance': 'Stiller, renkler, menü, arka planlar, yapım sayfaları ve afişler.',
  'settingslayout.keywords.player': 'oynatıcı düzen denetimler ilerleme çubuğu atlama ses yükseltme küçült tam ekran önizlemeler geri sarma harici vlc mpv',
  'settingslayout.chapter.library': 'Kitaplık',
  'settingslayout.chapter.starting': 'Video başlatma',
  'settingslayout.chapter.skip-tuning': 'Atlamaların ince ayarı',
  'settingslayout.chapter.player-look': 'Görünüm',
  'settingslayout.chapter.player-controls': 'Denetimler',
  'settingslayout.chapter.player-window': 'Pencere ve ekstralar',
  'settingslayout.chapter.subtitle-text': 'Dil ve metin',
  'settingslayout.chapter.choosing-source': 'Kaynak seçimi',
  'settingslayout.chapter.ranking-rules': 'Sıralama kuralları',
  'settingslayout.preview': 'Önizleme',
  'settingslayout.none': 'Hiçbiri',
};
