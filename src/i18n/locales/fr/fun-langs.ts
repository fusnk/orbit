import type { funlangs as source } from '../en/fun-langs';
import type { Catalog } from '../types';

export const funlangs: Catalog<typeof source> = {
  'funlangs.setting': 'Langues pour rire',
  'funlangs.setting-hint': 'Ajoute des langues pour rire au choix de la langue : Pirate, UwU, runes du futhark ancien et À l’envers. Seuls les textes changent ; les dates et les nombres restent en anglais. Le désactiver pendant que l’une d’elles est utilisée rétablit la langue du système.',
  'funlangs.group': 'Langues pour rire',
  'funlangs.pirate': 'Pirate',
  'funlangs.uwu': 'UwU',
  'funlangs.futhark': 'Futhark ancien (runes)',
  'funlangs.upside-down': 'À l’envers',
};
