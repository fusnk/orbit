import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Russian strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "Цвет плеера",
  'playercolour.seek-label': "Цвет полосы перемотки",
  'playercolour.hint': "Цвет полосы перемотки в плеере. «Акцент» следует теме; остальной стиль — в Theme Studio.",
};
