import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Hebrew strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "צבע הנגן",
  'playercolour.seek-label': "צבע פס ההתקדמות",
  'playercolour.hint': "הצבע של פס ההתקדמות בנגן. „הדגשה” עוקב אחרי ערכת הנושא; שאר הסגנון שלו נמצא בסטודיו ערכות הנושא.",
};
