import type { tonight as source } from '../en/tonight';
import type { Catalog } from '../types';

export const tonight: Catalog<typeof source> = {
  'tonight.title': 'На вечер',
  'tonight.open': 'На вечер',
  'tonight.palette': 'На вечер: что посмотреть',
  'tonight.intro': 'Сколько у вас времени и какое настроение?',
  'tonight.time': 'Время',
  'tonight.time-30': '30 мин',
  'tonight.time-60': '1 час',
  'tonight.time-90': '90 мин',
  'tonight.time-120': '2 часа и больше',
  'tonight.mood': 'Настроение',
  'tonight.mood.light': 'Лёгкое',
  'tonight.mood.intense': 'Напряжённое',
  'tonight.mood.cozy': 'Уютное',
  'tonight.mood.mind-bending': 'Головоломное',
  'tonight.picks': 'Предложения',
  'tonight.from.library': 'В вашей библиотеке',
  'tonight.another-label': 'Предложить другое вместо «{name}»',
  'tonight.no-more': 'Больше ничего не подходит под этот выбор.',
  'tonight.loading': 'Просматриваем, что у вас есть…',
  'tonight.updated': 'Предложения обновлены.',
  'tonight.none': 'Пока ничего не подходит',
  'tonight.none-body': 'Попробуйте больше времени или другое настроение. «На вечер» выбирает только из «Продолжить просмотр», вашей библиотеки и уже открытых каталогов.',
};
