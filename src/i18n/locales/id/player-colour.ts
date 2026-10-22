import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Indonesian strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Warna pemutar",
  'playercolour.seek-label': "Warna bilah progres",
  'playercolour.hint': "Warna bilah progres di pemutar. Aksen mengikuti tema; gaya lainnya ada di Studio Tema.",
};
