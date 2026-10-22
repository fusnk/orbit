import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Portuguese strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Cor do player",
  'playercolour.seek-label': "Cor da barra de progresso",
  'playercolour.hint': "A cor da barra de progresso do player. Destaque segue o tema; o restante do estilo fica no Estúdio de temas.",
};
