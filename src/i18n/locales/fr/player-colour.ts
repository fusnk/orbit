import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** French strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Couleur du lecteur",
  'playercolour.seek-label': "Couleur de la barre de lecture",
  'playercolour.hint': "La couleur de la barre de lecture du lecteur. « Accent » suit le thème ; le reste de son style est dans le Studio de thèmes.",
};
