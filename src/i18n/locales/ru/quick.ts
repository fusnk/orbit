import type { quick as source } from '../en/quick';
import type { Catalog } from '../types';

export const quick: Catalog<typeof source> = {
  'quick.button': 'Быстрые настройки',
  'quick.heading': 'Быстрые настройки',
  'quick.switch-profile': 'Сменить профиль',
  'quick.pause-history': 'Приостановить историю',
  'quick.pause-history-hint': 'То, что вы смотрите, не попадает в историю и «Продолжить просмотр» и не отправляется в Stremio, Jellyfin или Plex.',
  'quick.look': 'Стиль',
  'quick.look-custom': 'Свой',
  'quick.trailers': 'Автозапуск трейлеров',
  'quick.trailers-partly': 'Включено только для страниц или баннеров. Если включить, трейлеры будут играть и там, и там.',
  'quick.skip-intros': 'Автоматически пропускать заставки',
  'quick.all-settings': 'Все настройки',
  'quick.chip': 'История на паузе',
  'quick.chip-label': 'История просмотра приостановлена. Открыть быстрые настройки',
  'quick.paused': 'История просмотра приостановлена. То, что вы смотрите сейчас, не оставит следов.',
  'quick.resumed': 'История просмотра снова ведётся.',
  'quick.palette.pause': 'Приостановить историю просмотра',
  'quick.palette.resume': 'Возобновить историю просмотра',
};
