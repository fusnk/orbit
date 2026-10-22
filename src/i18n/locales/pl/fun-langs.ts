import type { funlangs as source } from '../en/fun-langs';
import type { Catalog } from '../types';

export const funlangs: Catalog<typeof source> = {
  'funlangs.setting': 'Języki dla zabawy',
  'funlangs.setting-hint': 'Dodaje do wyboru języka języki dla zabawy: piracki, UwU, runy starszego futharku i do góry nogami. Zmieniają się tylko teksty; daty i liczby zostają po angielsku. Wyłączenie tej opcji, gdy jeden z nich jest używany, przywraca język systemu.',
  'funlangs.group': 'Języki dla zabawy',
  'funlangs.pirate': 'Piracki',
  'funlangs.uwu': 'UwU',
  'funlangs.futhark': 'Starszy futhark (runy)',
  'funlangs.upside-down': 'Do góry nogami',
};
