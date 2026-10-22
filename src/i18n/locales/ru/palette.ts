import type { palette as source } from '../en/palette';
import type { Catalog } from '../types';

export const palette: Catalog<typeof source> = {
  'palette.label': 'Палитра команд',
  'palette.placeholder': 'Поиск фильмов, настроек, аддонов и действий',
  // Group headings
  'palette.group.recent': 'Недавние',
  'palette.group.suggested': 'Рекомендуемые',
  'palette.group.yours': 'Ваше',
  'palette.group.titles': 'Фильмы и сериалы',
  'palette.group.settings': 'Настройки',
  'palette.group.addons': 'Аддоны',
  'palette.group.actions': 'Действия',
  // Titles from addons, while typing
  'palette.titles.searching': 'Поиск в аддонах…',
  'palette.titles.none': 'Ничего не найдено',
  'palette.titles.none-can-search': 'Ни один из ваших аддонов не поддерживает поиск',
  'palette.titles.failed': 'Ваши аддоны сейчас не могут выполнить поиск',
  'palette.search-all': 'Все результаты по запросу «{query}»',
  'palette.no-match': 'Ничего не найдено по запросу «{query}»',
  // Where a title of yours was found
  'palette.from.continue': 'Продолжить просмотр',
  'palette.from.library': 'В вашей библиотеке',
  'palette.from.queue': 'В вашей очереди',
  'palette.from.downloads': 'Скачано',
  'palette.from.watched': 'Просмотрено',
  'palette.from.list': 'Список',
  // What a result is
  'palette.kind.page': 'Страница',
  'palette.kind.shortcut': 'Сочетание клавиш · {key}',
  'palette.kind.addon': 'Аддон',
  'palette.kind.category': 'Настройки',
  'palette.kind.setting': 'Настройки · {category}',
  'palette.setting-hidden': '«{setting}» появится, когда вы измените «{parent}».',
  'palette.kind.movie': 'Фильм',
  'palette.kind.series': 'Сериал',
  'palette.kind.title': 'Фильм или сериал',
  // Actions
  'palette.action.profile': 'Сменить профиль',
  'palette.action.shortcuts': 'Сочетания клавиш',
  'palette.action.install-addon': 'Установить аддон…',
  'palette.action.addon-updates': 'Проверить обновления аддонов',
  // The key hints along the bottom
  'palette.hint.move': 'Перейти',
  'palette.hint.open': 'Открыть',
  'palette.hint.groups': 'Следующая группа',
  'palette.hint.close': 'Закрыть',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'язык запуск открытие закрытие окно трей масштаб увеличение движение эффекты доступность оповещения уведомления резервная копия восстановление диагностика журналы импорт trakt letterboxd',
  'palette.keywords.playback': 'автовоспроизведение следующая серия продолжить пропуск заставка трейлер',
  'palette.keywords.addons': 'установка каталог расширения плагины дополнения источники качество торренты избегать предпочитать',
  'palette.keywords.downloads': 'офлайн хранилище папка качество загрузки',
  'palette.keywords.appearance': 'тема цвета акцент шрифт тёмная светлая обои фоновый режим логотип стили',
  'palette.keywords.shortcuts': 'клавиатура горячие клавиши сочетания переназначить',
  'palette.keywords.home-library': 'аниме главная строки просмотрено продолжить спойлеры сюжетные арки библиотека метаданные',
  'palette.keywords.subtitles': 'субтитры язык форсированные синхронизация слабослышащие тексты песен шрифт размер цвет',
  'palette.keywords.picture-sound': 'изображение видео аппаратное декодирование hdr звук аудио язык passthrough громкость',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord стриминговые сервисы синхронизация аккаунт debrid tmdb интеграции iptv прямой эфир тв каналы m3u xtream телепрограмма',
  // Settings → Shortcuts
  'palette.shortcut': 'Палитра команд',
};
