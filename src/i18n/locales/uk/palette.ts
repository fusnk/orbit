import type { palette as source } from '../en/palette';
import type { Catalog } from '../types';

export const palette: Catalog<typeof source> = {
  'palette.label': 'Палітра команд',
  'palette.placeholder': 'Пошук фільмів, налаштувань, аддонів і дій',
  // Group headings
  'palette.group.recent': 'Нещодавні',
  'palette.group.suggested': 'Рекомендовані',
  'palette.group.yours': 'Ваше',
  'palette.group.titles': 'Фільми й серіали',
  'palette.group.settings': 'Налаштування',
  'palette.group.addons': 'Аддони',
  'palette.group.actions': 'Дії',
  // Titles from addons, while typing
  'palette.titles.searching': 'Пошук в аддонах…',
  'palette.titles.none': 'Нічого не знайдено',
  'palette.titles.none-can-search': 'Жоден з ваших аддонів не підтримує пошук',
  'palette.titles.failed': 'Ваші аддони зараз не можуть виконати пошук',
  'palette.search-all': 'Усі результати за запитом «{query}»',
  'palette.no-match': 'Нічого не знайдено за запитом «{query}»',
  // Where a title of yours was found
  'palette.from.continue': 'Продовжити перегляд',
  'palette.from.library': 'У вашій бібліотеці',
  'palette.from.queue': 'У вашій черзі',
  'palette.from.downloads': 'Завантажено',
  'palette.from.watched': 'Переглянуто',
  'palette.from.list': 'Список',
  // What a result is
  'palette.kind.page': 'Сторінка',
  'palette.kind.shortcut': 'Комбінація клавіш · {key}',
  'palette.kind.addon': 'Аддон',
  'palette.kind.category': 'Налаштування',
  'palette.kind.setting': 'Налаштування · {category}',
  'palette.setting-hidden': '«{setting}» з’явиться, коли ви зміните «{parent}».',
  'palette.kind.movie': 'Фільм',
  'palette.kind.series': 'Серіал',
  'palette.kind.title': 'Фільм чи серіал',
  // Actions
  'palette.action.profile': 'Змінити профіль',
  'palette.action.shortcuts': 'Комбінації клавіш',
  'palette.action.install-addon': 'Установити аддон…',
  'palette.action.addon-updates': 'Перевірити оновлення аддонів',
  // The key hints along the bottom
  'palette.hint.move': 'Перейти',
  'palette.hint.open': 'Відкрити',
  'palette.hint.groups': 'Наступна група',
  'palette.hint.close': 'Закрити',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'мова запуск відкриття закриття вікно трей масштаб збільшення рух ефекти доступність сповіщення резервна копія відновлення діагностика журнали імпорт trakt letterboxd',
  'palette.keywords.playback': 'автовідтворення наступна серія продовжити пропуск заставка трейлер',
  'palette.keywords.addons': 'встановлення каталог розширення плагіни доповнення джерела якість торенти уникати перевага',
  'palette.keywords.downloads': 'офлайн сховище тека якість завантаження',
  'palette.keywords.appearance': 'тема кольори акцент шрифт темна світла шпалери фоновий режим логотип стилі',
  'palette.keywords.shortcuts': 'клавіатура гарячі клавіші комбінації перепризначити',
  'palette.keywords.home-library': 'аніме головна рядки переглянуто продовжити спойлери сюжетні арки бібліотека метадані',
  'palette.keywords.subtitles': 'субтитри мова примусові синхронізація порушення слуху тексти пісень шрифт розмір колір',
  'palette.keywords.picture-sound': 'зображення відео апаратне декодування hdr звук аудіо мова passthrough гучність',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord стримінгові сервіси синхронізація обліковий запис акаунт debrid tmdb інтеграції iptv прямий ефір тб канали m3u xtream телепрограма',
  // Settings → Shortcuts
  'palette.shortcut': 'Палітра команд',
};
