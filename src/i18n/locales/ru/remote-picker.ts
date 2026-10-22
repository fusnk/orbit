import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Russian strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Обзор',
  'remote.phone.browse-loading': 'Загрузка главной…',
  'remote.phone.browse-empty': 'Пока нечего показать. Добавьте в Orbit аддон с каталогом, чтобы заполнить главную.',
  'remote.phone.browse-failed': 'Не удалось загрузить главную. Попробуйте снова.',
  'remote.phone.refresh': 'Обновить',
  'remote.phone.moods': 'Какое у вас настроение?',
  'remote.phone.mood-loading': 'Ищем подборку…',
  'remote.phone.mood-empty': 'Сейчас нет подборки для этого настроения.',
  'remote.phone.surprise': 'Удиви меня',
  'remote.phone.surprise-hint': 'Один случайный выбор из ваших каталогов.',
  'remote.phone.surprise-movie': 'Фильм',
  'remote.phone.surprise-series': 'Сериал',
  'remote.phone.surprise-none': 'Сейчас нечего нового предложить. Попробуйте другой тип или измените параметры «Удиви меня» в Orbit.',
  'remote.phone.details-loading': 'Загрузка подробностей…',
  'remote.phone.details-failed': 'Не удалось загрузить этот фильм или сериал. Попробуйте снова.',
  'remote.phone.add-library': 'Добавить в библиотеку',
  'remote.phone.in-library': 'В вашей библиотеке',
  'remote.phone.close': 'Закрыть',
  'remote.phone.season': 'Сезон {number}',
  'remote.phone.specials': 'Спецвыпуски',
  'remote.phone.episodes': 'Серии',
  'remote.phone.rating': 'Рейтинг IMDb {rating}',
};
