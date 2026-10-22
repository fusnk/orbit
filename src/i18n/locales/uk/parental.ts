import type { parental as source } from '../en/parental';
import type { Catalog } from '../types';

export const parental: Catalog<typeof source> = {
  // The profile editor's "Content limit" section
  'parental.heading': 'Обмеження контенту',
  'parental.level.off': 'Вимк.',
  'parental.level.kids': 'Діти',
  'parental.level.older-kids': 'Старші діти',
  'parental.level.teens': 'Підлітки',
  'parental.level.no-adult': 'Усе, крім 18+',
  'parental.about.off': 'Усе, що пропонують ваші аддони.',
  'parental.about.kids': 'Лише фільми й серіали для будь-якого віку: G, TV-Y, TV-Y7 і TV-G або відповідники у вашій країні (U у Великій Британії, FSK 0 і 6 у Німеччині).',
  'parental.about.older-kids': 'Плюс PG і TV-PG (PG у Великій Британії, приблизно до 11 років в інших країнах).',
  'parental.about.teens': 'Плюс PG-13 і TV-14 (12 і 12A у Великій Британії, FSK 12 у Німеччині).',
  'parental.about.no-adult': 'Плюс R і TV-MA. Приховуються лише рейтинги суто для дорослих (NC-17, X, R18).',
  'parental.addons-note': 'Аддони з позначкою «для дорослих» приховано в будь-якому профілі з обмеженням.',
  'parental.unrated': 'Показувати без рейтингу',
  'parental.unrated-hidden': 'Фільми й серіали, для яких Orbit не знайшов рейтингу, приховано. Це стосується більшості контенту з аддонів, які не використовують IMDb id.',
  'parental.unrated-shown': 'Фільми й серіали, для яких Orbit не знайшов рейтингу, показуються.',
  'parental.live-tv': 'Показувати прямий ефір',
  'parental.live-tv-hint': 'Телеканали не мають рейтингів, тому обмеження не може їх фільтрувати.',
  'parental.region': 'Рейтинги беруться спершу для країни {country}, потім для США.',
  'parental.needs-tmdb': 'Рейтинги беруться з TMDB, а його не підключено (Налаштування → Облікові записи й сервіси). Доки його немає, усе вважається без рейтингу, і в цьому профілі не показується нічого без рейтингу, хоч би що було на перемикачі вище. Тому майже нічого не видно.',
  'parental.no-parent': 'Жоден профіль без обмеження не має PIN-коду, тому змінити це обмеження може будь-хто. Задайте PIN-код своєму профілю.',
  'parental.open-profiles': 'З цього профілю, як і раніше, можна перейти до {names}: без PIN-коду й без обмежень.',
  'parental.who-changes': 'Щоб послабити або зняти обмеження, потрібен PIN-код профілю без обмежень.',
  'parental.badge': 'Обмеження контенту: {level}',
  // Asking for a parent's PIN
  'parental.parent-pin': 'PIN-код батьків',
  'parental.parent-pin-prompt': 'Введіть PIN-код профілю без обмеження контенту.',
  'parental.parent-pin-create': 'Доки профіль має обмеження контенту, для додавання профілю потрібен PIN-код профілю без обмежень.',
  // Where a limit stops something
  'parental.blocked.title': 'Недоступно в цьому профілі',
  'parental.blocked.rated': '«{name}» має рейтинг {rating}, вищий за обмеження цього профілю ({level}).',
  'parental.blocked.adult': '«{name}» позначено як контент для дорослих.',
  'parental.blocked.unrated': 'Orbit не знайшов рейтингу для «{name}», а цей профіль приховує контент без рейтингу.',
  'parental.blocked.toast': '«{name}» недоступний у цьому профілі.',
  'parental.blocked.checking': 'Orbit ще перевіряє рейтинг «{name}». Сторінка відкриється сама, щойно він стане відомий.',
  'parental.blocked.checking-toast': 'Orbit ще перевіряє рейтинг «{name}». Спробуйте ще раз за хвилину.',
  'parental.blocked.unreachable': 'Orbit зараз не зміг перевірити рейтинг «{name}». Спробуйте ще раз за хвилину.',
  'parental.blocked.live': 'Прямий ефір вимкнено для цього профілю.',
};
