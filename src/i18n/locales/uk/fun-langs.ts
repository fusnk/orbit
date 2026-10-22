import type { funlangs as source } from '../en/fun-langs';
import type { Catalog } from '../types';

export const funlangs: Catalog<typeof source> = {
  'funlangs.setting': 'Жартівливі мови',
  'funlangs.setting-hint': 'Додає до вибору мови жартівливі мови: піратську, UwU, руни Старшого футарка й «догори дриґом». Вони змінюють лише слова; дати й числа залишаються англійською. Якщо вимкнути це, поки така мова ввімкнена, повернеться мова системи.',
  'funlangs.group': 'Жартівливі мови',
  'funlangs.pirate': 'Піратська',
  'funlangs.uwu': 'UwU',
  'funlangs.futhark': 'Старший футарк (руни)',
  'funlangs.upside-down': 'Догори дриґом',
};
