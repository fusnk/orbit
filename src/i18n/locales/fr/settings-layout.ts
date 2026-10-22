import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** French strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'L’apparence du lecteur, le comportement de ses commandes, et les autres lecteurs.',
  'settingslayout.intro.playback': 'Appuyer sur Lecture, l’épisode suivant, les passages et les bandes-annonces.',
  'settingslayout.intro.appearance': 'Styles, couleurs, le menu, arrière-plans, pages de titres et affiches.',
  'settingslayout.keywords.player': 'lecteur disposition commandes barre de progression avancer volume amplifier réduire plein écran aperçus retour arrière externe vlc mpv',
  'settingslayout.chapter.library': 'Bibliothèque',
  'settingslayout.chapter.starting': 'Lancer une vidéo',
  'settingslayout.chapter.skip-tuning': 'Affiner les passages',
  'settingslayout.chapter.player-look': 'Apparence',
  'settingslayout.chapter.player-controls': 'Commandes',
  'settingslayout.chapter.player-window': 'Fenêtre et extras',
  'settingslayout.chapter.subtitle-text': 'Langue et texte',
  'settingslayout.chapter.choosing-source': 'Choisir une source',
  'settingslayout.chapter.ranking-rules': 'Règles de classement',
  'settingslayout.preview': 'Aperçu',
  'settingslayout.none': 'Aucune',
};
