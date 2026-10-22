import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Ukrainian strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Колір плеєра",
  'playercolour.seek-label': "Колір смуги перемотування",
  'playercolour.hint': "Колір смуги перемотування в плеєрі. «Акцент» слідує темі; решта стилю — у Theme Studio.",
};
