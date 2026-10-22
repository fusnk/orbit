import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Italian strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Colore del player",
  'playercolour.seek-label': "Colore della barra di avanzamento",
  'playercolour.hint': "Il colore della barra di avanzamento del player. «Accento» segue il tema; il resto del suo stile è nello Studio dei temi.",
};
