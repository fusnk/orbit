import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Italian strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'L’aspetto del player, il comportamento dei suoi comandi e gli altri player.',
  'settingslayout.intro.playback': 'Premere Riproduci, l’episodio successivo, i salti e i trailer.',
  'settingslayout.intro.appearance': 'Stili, colori, il menu, sfondi, pagine dei titoli e locandine.',
  'settingslayout.keywords.player': 'player layout comandi barra di avanzamento salto volume amplificazione riduci schermo intero anteprime riavvolgi esterno vlc mpv',
  'settingslayout.chapter.library': 'Libreria',
  'settingslayout.chapter.starting': 'Avviare un video',
  'settingslayout.chapter.skip-tuning': 'Rifinire i salti',
  'settingslayout.chapter.player-look': 'Aspetto',
  'settingslayout.chapter.player-controls': 'Comandi',
  'settingslayout.chapter.player-window': 'Finestra ed extra',
  'settingslayout.chapter.subtitle-text': 'Lingua e testo',
  'settingslayout.chapter.choosing-source': 'Scegliere una fonte',
  'settingslayout.chapter.ranking-rules': 'Regole di ordinamento',
  'settingslayout.preview': 'Anteprima',
  'settingslayout.none': 'Nessuna',
};
