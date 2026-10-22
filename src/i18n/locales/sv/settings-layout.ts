import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Swedish strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Hur spelaren ser ut, hur dess kontroller beter sig, och andra spelare.',
  'settingslayout.intro.playback': 'Att trycka på Spela upp, nästa avsnitt, överhoppning och trailers.',
  'settingslayout.intro.appearance': 'Stilar, färger, menyn, bakgrunder, titelsidor och affischer.',
  'settingslayout.keywords.player': 'spelare layout kontroller tidslinje hoppa volym förstärkning minimera helskärm förhandsvisningar spola tillbaka extern vlc mpv',
  'settingslayout.chapter.library': 'Bibliotek',
  'settingslayout.chapter.starting': 'Starta en video',
  'settingslayout.chapter.skip-tuning': 'Finjustera överhoppning',
  'settingslayout.chapter.player-look': 'Utseende',
  'settingslayout.chapter.player-controls': 'Kontroller',
  'settingslayout.chapter.player-window': 'Fönster och extra',
  'settingslayout.chapter.subtitle-text': 'Språk och text',
  'settingslayout.chapter.choosing-source': 'Välja en källa',
  'settingslayout.chapter.ranking-rules': 'Regler för ordning',
  'settingslayout.preview': 'Förhandsvisning',
  'settingslayout.none': 'Ingen',
};
