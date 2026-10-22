import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Czech strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Jak přehrávač vypadá, jak se chovají jeho ovládací prvky, a jiné přehrávače.',
  'settingslayout.intro.playback': 'Stisknutí Přehrát, další díl, přeskakování a trailery.',
  'settingslayout.intro.appearance': 'Vzhledy, barvy, nabídka, pozadí, stránky titulů a plakáty.',
  'settingslayout.keywords.player': 'přehrávač rozložení ovládání posuvník skok hlasitost zesílení minimalizovat celá obrazovka náhledy přetáčení externí vlc mpv',
  'settingslayout.chapter.library': 'Knihovna',
  'settingslayout.chapter.starting': 'Spuštění videa',
  'settingslayout.chapter.skip-tuning': 'Doladění přeskakování',
  'settingslayout.chapter.player-look': 'Vzhled',
  'settingslayout.chapter.player-controls': 'Ovládání',
  'settingslayout.chapter.player-window': 'Okno a další funkce',
  'settingslayout.chapter.subtitle-text': 'Jazyk a text',
  'settingslayout.chapter.choosing-source': 'Výběr zdroje',
  'settingslayout.chapter.ranking-rules': 'Pravidla pořadí',
  'settingslayout.preview': 'Náhled',
  'settingslayout.none': 'Žádné',
};
