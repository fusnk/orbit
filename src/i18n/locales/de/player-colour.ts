import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** German strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Player-Farbe",
  'playercolour.seek-label': "Farbe der Zeitleiste",
  'playercolour.hint': "Die Farbe der Zeitleiste im Player. „Akzent“ folgt dem Theme; den Rest ihres Stils gibt es im Theme Studio.",
};
