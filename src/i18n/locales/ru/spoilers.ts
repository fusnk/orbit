import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'Спойлеры',
  'spoilers.intro': 'Что скрывать о сериях: на странице сериала, в списке серий в плеере, на карточке «Далее» и в «Продолжить просмотр».',
  'spoilers.titles': 'Скрывать названия серий',
  'spoilers.titles-hint': 'Вместо названия показывается «Серия 4».',
  'spoilers.descriptions': 'Скрывать описания серий',
  'spoilers.descriptions-hint': 'Краткое содержание серий не показывается.',
  'spoilers.thumbnails': 'Размывать кадры из серий',
  'spoilers.thumbnails-hint': 'Наведите курсор или выделите серию, чтобы подсмотреть.',
  'spoilers.ratings': 'Скрывать рейтинги серий',
  'spoilers.ratings-hint': 'Рейтинг может выдать, какие серии важны.',
  'spoilers.unaired': 'Скрывать даты выхода будущих серий',
  'spoilers.unaired-hint': 'У невышедших серий написано только «Ещё не вышла».',
  'spoilers.scope': 'Применять к',
  'spoilers.scope-hint': 'Для просмотренных и начатых серий показывается всё, если не выбрать «Все серии».',
  'spoilers.scope-unwatched': 'Непросмотренным сериям',
  'spoilers.scope-all': 'Все серии',
};
