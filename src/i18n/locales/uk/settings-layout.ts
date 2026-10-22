import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Ukrainian strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'Як виглядає плеєр, як працюють його кнопки, та інші плеєри.',
  'settingslayout.intro.playback': 'Натискання «Дивитися», наступна серія, пропуски й трейлери.',
  'settingslayout.intro.appearance': 'Стилі, кольори, меню, фони, сторінки фільмів і постери.',
  'settingslayout.keywords.player': 'плеєр розкладка керування смуга перемотування стрибок гучність підсилення згорнути повний екран превʼю перемотування назад зовнішній vlc mpv',
  'settingslayout.chapter.library': 'Бібліотека',
  'settingslayout.chapter.starting': 'Запуск відео',
  'settingslayout.chapter.skip-tuning': 'Тонке налаштування пропусків',
  'settingslayout.chapter.player-look': 'Зовнішній вигляд',
  'settingslayout.chapter.player-controls': 'Керування',
  'settingslayout.chapter.player-window': 'Вікно й додатково',
  'settingslayout.chapter.subtitle-text': 'Мова й текст',
  'settingslayout.chapter.choosing-source': 'Вибір джерела',
  'settingslayout.chapter.ranking-rules': 'Правила порядку',
  'settingslayout.preview': 'Попередній перегляд',
  'settingslayout.none': 'Немає',
};
