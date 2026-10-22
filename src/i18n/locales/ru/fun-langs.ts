import type { funlangs as source } from '../en/fun-langs';
import type { Catalog } from '../types';

export const funlangs: Catalog<typeof source> = {
  'funlangs.setting': 'Шуточные языки',
  'funlangs.setting-hint': 'Добавляет в выбор языка шуточные языки: пиратский, UwU, руны Старшего футарка и «вверх ногами». Они меняют только слова; даты и числа остаются на английском. Если выключить это, пока такой язык включён, вернётся язык системы.',
  'funlangs.group': 'Шуточные языки',
  'funlangs.pirate': 'Пиратский',
  'funlangs.uwu': 'UwU',
  'funlangs.futhark': 'Старший футарк (руны)',
  'funlangs.upside-down': 'Вверх ногами',
};
