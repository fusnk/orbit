import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Dutch strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Hoe de speler eruitziet, hoe de bediening werkt, en andere spelers.',
  'settingslayout.intro.playback': 'Op Afspelen drukken, de volgende aflevering, overslaan en trailers.',
  'settingslayout.intro.appearance': 'Looks, kleuren, het menu, achtergronden, titelpagina’s en posters.',
  'settingslayout.keywords.player': 'speler indeling bediening tijdbalk springen volume versterken minimaliseren volledig scherm voorbeelden terugspoelen extern vlc mpv',
  'settingslayout.chapter.library': 'Bibliotheek',
  'settingslayout.chapter.starting': 'Een video starten',
  'settingslayout.chapter.skip-tuning': 'Overslaan bijstellen',
  'settingslayout.chapter.player-look': 'Uiterlijk',
  'settingslayout.chapter.player-controls': 'Bediening',
  'settingslayout.chapter.player-window': 'Venster & extra’s',
  'settingslayout.chapter.subtitle-text': 'Taal & tekst',
  'settingslayout.chapter.choosing-source': 'Een bron kiezen',
  'settingslayout.chapter.ranking-rules': 'Volgorderegels',
  'settingslayout.preview': 'Voorbeeld',
  'settingslayout.none': 'Geen',
};
