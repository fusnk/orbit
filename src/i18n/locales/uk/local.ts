import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Відпустіть, щоб відтворити',
  'local.drop.video-hint': 'Відео відкриється в Orbit.',
  'local.drop.subtitle-hint': 'Субтитри додадуться до того, що зараз грає.',
  'local.drop.first-only': 'Відтворюється {name}. Orbit відкриває по одному файлу, решту пропущено.',
  'local.drop.failed': 'Не вдалося відкрити цей файл.',
  'local.drop.unsupported': 'Orbit не вміє відтворювати такі файли.',
  'local.drop.subtitle-needs-player': 'Спершу запустіть відео, а потім перетягніть на нього субтитри.',
  'local.drop.subtitle-added': 'Субтитри додано: {name}',
  'local.drop.subtitle-first-only': 'Субтитри додано: {name}. Використано лише перший файл.',
  'local.drop.subtitle-failed': 'Не вдалося додати ці субтитри.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'цього комп’ютера',
  'local.source.label': 'Локальний файл',
  // Settings → Player → External player
  'local.external.heading': 'Зовнішній плеєр',
  'local.external.player': 'Відкривати джерела в',
  'local.external.player-hint': 'Додає «Відкрити в зовнішньому плеєрі» до вебджерел у списку джерел. Продовження перегляду, пропуск заставки, запам’ятовування доріжок і прогрес працюють лише у вбудованому плеєрі Orbit.',
  'local.external.none': 'Немає',
  'local.external.custom': 'Інший',
  'local.external.found': 'Знайдено: {path}',
  'local.external.not-found': 'Не знайдено у звичайній теці встановлення. Виберіть «Інший», щоб указати його розташування.',
  'local.external.custom-path': 'Програма',
  'local.external.custom-path-hint': 'Виконуваний файл плеєра, вибраний на цьому комп’ютері.',
  'local.external.choose': 'Вибрати…',
  'local.external.custom-invalid': 'Orbit не може це запустити. Виберіть виконуваний файл плеєра.',
  'local.external.always': 'Завжди відкривати в зовнішньому плеєрі',
  'local.external.always-hint': '«Дивитися» одразу передає йому найкраще вебджерело. Торенти й завантаження, як і раніше, відтворюються в Orbit.',
  // The source picker
  'local.external.open': 'Зовнішній',
  'local.external.open-label': 'Відкрити в зовнішньому плеєрі',
  'local.external.opened': 'Відкрито в зовнішньому плеєрі.',
  'local.external.failed': 'Зовнішній плеєр не запустився. Перевірте Налаштування → Плеєр.',
};
