import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Swedish strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Spelarfärg",
  'playercolour.seek-label': "Tidslinjens färg",
  'playercolour.hint': "Färgen på spelarens tidslinje. Accent följer ditt tema; resten av stilen finns i Temastudio.",
};
