import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Russian strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} и ещё {count}',
  'navsummary.scale': 'Масштаб {percent}',
  'navsummary.size': 'Размер {percent}',
  'navsummary.banner': 'Баннер: {style}',
  'navsummary.watched-at': 'Просмотрено с {percent}',
  'navsummary.spoilers-hidden': 'Спойлеры скрыты',
  'navsummary.spoilers-shown': 'Спойлеры видны',
  'navsummary.autoplay': 'Автовоспроизведение: {mode}',
  'navsummary.player-layout': 'Макет: {name}',
  'navsummary.no-addons': 'Нет аддонов',
  'navsummary.not-connected': 'Ничего не подключено',
  'navsummary.downloads.none': 'Загрузок пока нет',
  'navsummary.downloads.done.one': 'Загружен: {count}',
  'navsummary.downloads.done.few': 'Загружено: {count}',
  'navsummary.downloads.done.many': 'Загружено: {count}',
  'navsummary.downloads.done.other': 'Загружено: {count}',
  'navsummary.downloads.active.one': 'В процессе: {count}',
  'navsummary.downloads.active.few': 'В процессе: {count}',
  'navsummary.downloads.active.many': 'В процессе: {count}',
  'navsummary.downloads.active.other': 'В процессе: {count}',
  'navsummary.shortcuts.one': '{count} сочетание клавиш',
  'navsummary.shortcuts.few': '{count} сочетания клавиш',
  'navsummary.shortcuts.many': '{count} сочетаний клавиш',
  'navsummary.shortcuts.other': '{count} сочетания клавиш',
};
