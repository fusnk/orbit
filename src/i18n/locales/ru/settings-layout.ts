import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Russian strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Как выглядит плеер, как работают его кнопки, и другие плееры.',
  'settingslayout.intro.playback': 'Нажатие «Смотреть», следующая серия, пропуски и трейлеры.',
  'settingslayout.intro.appearance': 'Стили, цвета, меню, фоны, страницы фильмов и постеры.',
  'settingslayout.keywords.player': 'плеер раскладка управление полоса перемотки прыжок громкость усиление свернуть полный экран превью перемотка назад внешний vlc mpv',
  'settingslayout.chapter.library': 'Библиотека',
  'settingslayout.chapter.starting': 'Запуск видео',
  'settingslayout.chapter.skip-tuning': 'Тонкая настройка пропусков',
  'settingslayout.chapter.player-look': 'Внешний вид',
  'settingslayout.chapter.player-controls': 'Управление',
  'settingslayout.chapter.player-window': 'Окно и прочее',
  'settingslayout.chapter.subtitle-text': 'Язык и текст',
  'settingslayout.chapter.choosing-source': 'Выбор источника',
  'settingslayout.chapter.ranking-rules': 'Правила ранжирования',
  'settingslayout.preview': 'Предпросмотр',
  'settingslayout.none': 'Нет',
};
