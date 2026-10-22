import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Отпустите, чтобы воспроизвести',
  'local.drop.video-hint': 'Видео откроется в Orbit.',
  'local.drop.subtitle-hint': 'Субтитры добавятся к тому, что сейчас играет.',
  'local.drop.first-only': 'Воспроизводится {name}. Orbit открывает по одному файлу, остальные пропущены.',
  'local.drop.failed': 'Не удалось открыть этот файл.',
  'local.drop.unsupported': 'Orbit не умеет воспроизводить такие файлы.',
  'local.drop.subtitle-needs-player': 'Сначала запустите видео, а потом перетащите на него субтитры.',
  'local.drop.subtitle-added': 'Субтитры добавлены: {name}',
  'local.drop.subtitle-first-only': 'Субтитры добавлены: {name}. Использован только первый файл.',
  'local.drop.subtitle-failed': 'Не удалось добавить эти субтитры.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'этого компьютера',
  'local.source.label': 'Локальный файл',
  // Settings → Player → External player
  'local.external.heading': 'Внешний плеер',
  'local.external.player': 'Открывать источники в',
  'local.external.player-hint': 'Добавляет «Открыть во внешнем плеере» к веб-источникам в списке источников. Продолжение просмотра, пропуск заставки, запоминание дорожек и прогресс работают только во встроенном плеере Orbit.',
  'local.external.none': 'Нет',
  'local.external.custom': 'Другой',
  'local.external.found': 'Найден: {path}',
  'local.external.not-found': 'Не найден в обычной папке установки. Выберите «Другой», чтобы указать его расположение.',
  'local.external.custom-path': 'Программа',
  'local.external.custom-path-hint': 'Исполняемый файл плеера, выбранный на этом компьютере.',
  'local.external.choose': 'Выбрать…',
  'local.external.custom-invalid': 'Orbit не может это запустить. Выберите исполняемый файл плеера.',
  'local.external.always': 'Всегда открывать во внешнем плеере',
  'local.external.always-hint': '«Смотреть» сразу передаёт ему лучший веб-источник. Торренты и загрузки по-прежнему воспроизводятся в Orbit.',
  // The source picker
  'local.external.open': 'Внешний',
  'local.external.open-label': 'Открыть во внешнем плеере',
  'local.external.opened': 'Открыто во внешнем плеере.',
  'local.external.failed': 'Внешний плеер не запустился. Проверьте Настройки → Плеер.',
};
