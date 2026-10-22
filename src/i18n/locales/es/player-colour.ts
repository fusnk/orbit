import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Spanish strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Color del reproductor",
  'playercolour.seek-label': "Color de la barra de progreso",
  'playercolour.hint': "El color de la barra de progreso del reproductor. «Acento» sigue al tema; el resto de su estilo está en el Estudio de temas.",
};
