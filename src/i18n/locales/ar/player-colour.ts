import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Arabic strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "لون المشغّل",
  'playercolour.seek-label': "لون شريط التقدّم",
  'playercolour.hint': "لون شريط التقدّم في المشغّل. «لون التمييز» يتبع السمة؛ باقي مظهره في استوديو السمات.",
};
