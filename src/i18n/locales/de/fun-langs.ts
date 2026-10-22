import type { funlangs as source } from '../en/fun-langs';
import type { Catalog } from '../types';

export const funlangs: Catalog<typeof source> = {
  'funlangs.setting': 'Spaßsprachen',
  'funlangs.setting-hint': 'Fügt der Sprachauswahl Spaßsprachen hinzu: Pirat, UwU, Runen (älteres Futhark) und Kopfüber. Sie ändern nur die Texte; Datum und Zahlen bleiben englisch. Schaltest du das aus, während eine aktiv ist, gilt wieder die Systemsprache.',
  'funlangs.group': 'Spaßsprachen',
  'funlangs.pirate': 'Pirat',
  'funlangs.uwu': 'UwU',
  'funlangs.futhark': 'Runen (älteres Futhark)',
  'funlangs.upside-down': 'Kopfüber',
};
