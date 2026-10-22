import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Polish strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Kolor odtwarzacza",
  'playercolour.seek-label': "Kolor paska postępu",
  'playercolour.hint': "Kolor paska postępu w odtwarzaczu. Akcent podąża za motywem; resztę jego stylu zmienisz w Studio motywów.",
};
