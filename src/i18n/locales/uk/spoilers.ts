import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'Спойлери',
  'spoilers.intro': 'Що приховувати про серії: на сторінці серіалу, у списку серій у плеєрі, на картці «Далі» та в «Продовжити перегляд».',
  'spoilers.titles': 'Приховувати назви серій',
  'spoilers.titles-hint': 'Замість назви показується «Серія 4».',
  'spoilers.descriptions': 'Приховувати описи серій',
  'spoilers.descriptions-hint': 'Стислий зміст серій не показується.',
  'spoilers.thumbnails': 'Розмивати кадри із серій',
  'spoilers.thumbnails-hint': 'Наведіть курсор або виділіть серію, щоб підглянути.',
  'spoilers.ratings': 'Приховувати рейтинги серій',
  'spoilers.ratings-hint': 'Рейтинг може видати, які серії важливі.',
  'spoilers.unaired': 'Приховувати дати виходу майбутніх серій',
  'spoilers.unaired-hint': 'У серій, що ще не вийшли, написано лише «Ще не вийшла».',
  'spoilers.scope': 'Застосовувати до',
  'spoilers.scope-hint': 'Для переглянутих і розпочатих серій показується все, якщо не вибрати «Усі серії».',
  'spoilers.scope-unwatched': 'Непереглянутих серій',
  'spoilers.scope-all': 'Усі серії',
};
