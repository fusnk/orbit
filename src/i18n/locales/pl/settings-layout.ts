import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Polish strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Jak wygląda odtwarzacz, jak działają jego przyciski oraz inne odtwarzacze.',
  'settingslayout.intro.playback': 'Naciśnięcie Odtwórz, następny odcinek, pomijanie i zwiastuny.',
  'settingslayout.intro.appearance': 'Style, kolory, menu, tła, strony tytułów i plakaty.',
  'settingslayout.keywords.player': 'odtwarzacz układ sterowanie pasek przewijania skok głośność wzmocnienie minimalizuj pełny ekran podglądy przewijanie zewnętrzny vlc mpv',
  'settingslayout.chapter.library': 'Biblioteka',
  'settingslayout.chapter.starting': 'Rozpoczynanie filmu',
  'settingslayout.chapter.skip-tuning': 'Dostrajanie pomijania',
  'settingslayout.chapter.player-look': 'Wygląd',
  'settingslayout.chapter.player-controls': 'Sterowanie',
  'settingslayout.chapter.player-window': 'Okno i dodatki',
  'settingslayout.chapter.subtitle-text': 'Język i tekst',
  'settingslayout.chapter.choosing-source': 'Wybór źródła',
  'settingslayout.chapter.ranking-rules': 'Zasady kolejności',
  'settingslayout.preview': 'Podgląd',
  'settingslayout.none': 'Brak',
};
