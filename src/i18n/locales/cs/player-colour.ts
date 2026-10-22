import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Czech strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Barva přehrávače",
  'playercolour.seek-label': "Barva posuvníku",
  'playercolour.hint': "Barva posuvníku v přehrávači. Zvýraznění se řídí motivem; zbytek jeho vzhledu je ve Studiu motivů.",
};
