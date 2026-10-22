import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Dutch strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Spelerkleur",
  'playercolour.seek-label': "Kleur van de tijdbalk",
  'playercolour.hint': "De kleur van de tijdbalk in de speler. Accent volgt je thema; de rest van de stijl staat in de Themastudio.",
};
