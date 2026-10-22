import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** German strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Wie der Player aussieht, wie sich seine Bedienelemente verhalten, und andere Player.',
  'settingslayout.intro.playback': 'Auf Abspielen drücken, die nächste Folge, Überspringen und Trailer.',
  'settingslayout.intro.appearance': 'Looks, Farben, das Menü, Hintergründe, Titelseiten und Poster.',
  'settingslayout.keywords.player': 'player layout steuerung bedienung zeitleiste springen lautstärke verstärkung minimieren vollbild vorschau zurückspulen extern vlc mpv',
  'settingslayout.chapter.library': 'Bibliothek',
  'settingslayout.chapter.starting': 'Ein Video starten',
  'settingslayout.chapter.skip-tuning': 'Überspringen feinjustieren',
  'settingslayout.chapter.player-look': 'Aussehen',
  'settingslayout.chapter.player-controls': 'Bedienung',
  'settingslayout.chapter.player-window': 'Fenster & Extras',
  'settingslayout.chapter.subtitle-text': 'Sprache & Text',
  'settingslayout.chapter.choosing-source': 'Eine Quelle wählen',
  'settingslayout.chapter.ranking-rules': 'Regeln für die Reihenfolge',
  'settingslayout.preview': 'Vorschau',
  'settingslayout.none': 'Keine',
};
