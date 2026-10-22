import type { tonight as source } from '../en/tonight';
import type { Catalog } from '../types';

export const tonight: Catalog<typeof source> = {
  'tonight.title': 'На вечір',
  'tonight.open': 'На вечір',
  'tonight.palette': 'На вечір: що подивитися',
  'tonight.intro': 'Скільки у вас часу і який настрій?',
  'tonight.time': 'Час',
  'tonight.time-30': '30 хв',
  'tonight.time-60': '1 година',
  'tonight.time-90': '90 хв',
  'tonight.time-120': '2 години й більше',
  'tonight.mood': 'Настрій',
  'tonight.mood.light': 'Легкий',
  'tonight.mood.intense': 'Напружений',
  'tonight.mood.cozy': 'Затишний',
  'tonight.mood.mind-bending': 'Головоломний',
  'tonight.picks': 'Пропозиції',
  'tonight.from.library': 'У вашій бібліотеці',
  'tonight.another-label': 'Запропонувати інше замість «{name}»',
  'tonight.no-more': 'Більше нічого не відповідає цьому вибору.',
  'tonight.loading': 'Переглядаємо, що у вас є…',
  'tonight.updated': 'Пропозиції оновлено.',
  'tonight.none': 'Поки нічого не підходить',
  'tonight.none-body': 'Спробуйте більше часу або інший настрій. «На вечір» вибирає лише з «Продовжити перегляд», вашої бібліотеки й уже відкритих каталогів.',
};
