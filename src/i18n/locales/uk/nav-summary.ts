import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Ukrainian strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} і ще {count}',
  'navsummary.scale': 'Масштаб {percent}',
  'navsummary.size': 'Розмір {percent}',
  'navsummary.banner': 'Банер: {style}',
  'navsummary.watched-at': 'Переглянуто з {percent}',
  'navsummary.spoilers-hidden': 'Спойлери приховано',
  'navsummary.spoilers-shown': 'Спойлери видно',
  'navsummary.autoplay': 'Автовідтворення: {mode}',
  'navsummary.player-layout': 'Макет: {name}',
  'navsummary.no-addons': 'Немає аддонів',
  'navsummary.not-connected': 'Нічого не підключено',
  'navsummary.downloads.none': 'Завантажень поки немає',
  'navsummary.downloads.done.one': 'Завантажено: {count}',
  'navsummary.downloads.done.few': 'Завантажено: {count}',
  'navsummary.downloads.done.many': 'Завантажено: {count}',
  'navsummary.downloads.done.other': 'Завантажено: {count}',
  'navsummary.downloads.active.one': 'Триває: {count}',
  'navsummary.downloads.active.few': 'Триває: {count}',
  'navsummary.downloads.active.many': 'Триває: {count}',
  'navsummary.downloads.active.other': 'Триває: {count}',
  'navsummary.shortcuts.one': '{count} комбінація клавіш',
  'navsummary.shortcuts.few': '{count} комбінації клавіш',
  'navsummary.shortcuts.many': '{count} комбінацій клавіш',
  'navsummary.shortcuts.other': '{count} комбінації клавіш',
};
