import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Ukrainian strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Огляд',
  'remote.phone.browse-loading': 'Завантаження головної…',
  'remote.phone.browse-empty': 'Поки що нічого показати. Додайте в Orbit аддон з каталогом, щоб заповнити головну.',
  'remote.phone.browse-failed': 'Не вдалося завантажити головну. Спробуйте ще раз.',
  'remote.phone.refresh': 'Оновити',
  'remote.phone.moods': 'Який у вас настрій?',
  'remote.phone.mood-loading': 'Шукаємо добірку…',
  'remote.phone.mood-empty': 'Зараз немає добірки для цього настрою.',
  'remote.phone.surprise': 'Здивуй мене',
  'remote.phone.surprise-hint': 'Один випадковий вибір із ваших каталогів.',
  'remote.phone.surprise-movie': 'Фільм',
  'remote.phone.surprise-series': 'Серіал',
  'remote.phone.surprise-none': 'Зараз нічого нового запропонувати. Спробуйте інший тип або змініть параметри «Здивуй мене» в Orbit.',
  'remote.phone.details-loading': 'Завантаження подробиць…',
  'remote.phone.details-failed': 'Не вдалося завантажити цей тайтл. Спробуйте ще раз.',
  'remote.phone.add-library': 'Додати до бібліотеки',
  'remote.phone.in-library': 'У вашій бібліотеці',
  'remote.phone.close': 'Закрити',
  'remote.phone.season': 'Сезон {number}',
  'remote.phone.specials': 'Спецвипуски',
  'remote.phone.episodes': 'Серії',
  'remote.phone.rating': 'Рейтинг IMDb {rating}',
};
