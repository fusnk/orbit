import type { funlangs as source } from '../en/fun-langs';
import type { Catalog } from '../types';

export const funlangs: Catalog<typeof source> = {
  'funlangs.setting': 'Idiomas de broma',
  'funlangs.setting-hint': 'Añade idiomas de broma al selector de idioma: Pirata, UwU, runas del futhark antiguo y Al revés. Solo cambian los textos; las fechas y los números siguen en inglés. Si lo desactivas mientras usas uno, se vuelve al idioma del sistema.',
  'funlangs.group': 'Idiomas de broma',
  'funlangs.pirate': 'Pirata',
  'funlangs.uwu': 'UwU',
  'funlangs.futhark': 'Futhark antiguo (runas)',
  'funlangs.upside-down': 'Al revés',
};
