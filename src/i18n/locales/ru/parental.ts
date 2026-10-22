import type { parental as source } from '../en/parental';
import type { Catalog } from '../types';

export const parental: Catalog<typeof source> = {
  // The profile editor's "Content limit" section
  'parental.heading': 'Ограничение контента',
  'parental.level.off': 'Выкл.',
  'parental.level.kids': 'Дети',
  'parental.level.older-kids': 'Дети постарше',
  'parental.level.teens': 'Подростки',
  'parental.level.no-adult': 'Всё, кроме 18+',
  'parental.about.off': 'Всё, что предлагают ваши аддоны.',
  'parental.about.kids': 'Только фильмы и сериалы для любого возраста: G, TV-Y, TV-Y7 и TV-G или аналоги в вашей стране (U в Великобритании, FSK 0 и 6 в Германии).',
  'parental.about.older-kids': 'Плюс PG и TV-PG (PG в Великобритании, примерно до 11 лет в других странах).',
  'parental.about.teens': 'Плюс PG-13 и TV-14 (12 и 12A в Великобритании, FSK 12 в Германии).',
  'parental.about.no-adult': 'Плюс R и TV-MA. Скрываются только рейтинги строго для взрослых (NC-17, X, R18).',
  'parental.addons-note': 'Аддоны с пометкой «для взрослых» скрыты в любом профиле с ограничением.',
  'parental.unrated': 'Показывать без рейтинга',
  'parental.unrated-hidden': 'Фильмы и сериалы, для которых Orbit не нашёл рейтинг, скрыты. Это касается большей части контента из аддонов, которые не используют IMDb id.',
  'parental.unrated-shown': 'Фильмы и сериалы, для которых Orbit не нашёл рейтинг, показываются.',
  'parental.live-tv': 'Показывать прямой эфир',
  'parental.live-tv-hint': 'У телеканалов нет рейтингов, поэтому ограничение не может их фильтровать.',
  'parental.region': 'Рейтинги берутся сначала для страны {country}, затем для США.',
  'parental.needs-tmdb': 'Рейтинги берутся из TMDB, а он не подключён (Настройки → Аккаунты и сервисы). Пока его нет, всё считается без рейтинга, и в этом профиле не показывается ничего без рейтинга, что бы ни стояло на переключателе выше. Поэтому почти ничего не видно.',
  'parental.no-parent': 'Ни у одного профиля без ограничения нет PIN-кода, поэтому изменить это ограничение может кто угодно. Задайте PIN-код своему профилю.',
  'parental.open-profiles': 'Из этого профиля по-прежнему можно переключиться на {names}: без PIN-кода и без ограничений.',
  'parental.who-changes': 'Чтобы ослабить или снять ограничение, нужен PIN-код профиля без ограничений.',
  'parental.badge': 'Ограничение контента: {level}',
  // Asking for a parent's PIN
  'parental.parent-pin': 'PIN-код родителя',
  'parental.parent-pin-prompt': 'Введите PIN-код профиля без ограничения контента.',
  'parental.parent-pin-create': 'Пока у профиля есть ограничение контента, для добавления профиля нужен PIN-код профиля без ограничений.',
  // Where a limit stops something
  'parental.blocked.title': 'Недоступно в этом профиле',
  'parental.blocked.rated': 'У «{name}» рейтинг {rating}, выше ограничения этого профиля ({level}).',
  'parental.blocked.adult': '«{name}» помечен как контент для взрослых.',
  'parental.blocked.unrated': 'Orbit не нашёл рейтинг для «{name}», а этот профиль скрывает контент без рейтинга.',
  'parental.blocked.toast': '«{name}» недоступен в этом профиле.',
  'parental.blocked.checking': 'Orbit ещё проверяет рейтинг «{name}». Страница откроется сама, как только он станет известен.',
  'parental.blocked.checking-toast': 'Orbit ещё проверяет рейтинг «{name}». Повторите попытку через минуту.',
  'parental.blocked.unreachable': 'Orbit сейчас не смог проверить рейтинг «{name}». Повторите попытку через минуту.',
  'parental.blocked.live': 'Прямой эфир отключён для этого профиля.',
};
