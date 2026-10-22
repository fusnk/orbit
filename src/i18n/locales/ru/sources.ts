import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // Settings → Playback → Autoplay limits (per profile)
  'sources.limits.heading': 'Ограничения автозапуска',
  'sources.limits.any': 'Любое',
  'sources.limits.min-quality': 'Не запускать автоматически ниже',
  'sources.limits.min-quality-hint': 'Кнопка «Смотреть» и следующая серия запускают только источники не хуже этого (источники без указания качества не подходят). Если подходящих нет, играет лучший, и Orbit сообщит об этом. В списке источников по-прежнему видно всё. Для этого профиля.',
  'sources.limits.max-quality': 'Не запускать автоматически выше',
  'sources.limits.max-quality-hint': 'Кнопка «Смотреть» и следующая серия не запускают источники выше этого, если не нашлось других. В отличие от «Предпочитать качество не выше», порядок списка источников не меняется. Для этого профиля.',
  'sources.limits.max-size': 'Не запускать автоматически файлы больше',
  'sources.limits.max-size-hint': 'Для медленного интернета или ограниченного трафика: «Смотреть» и следующая серия пропускают файлы крупнее. Источники без указания размера не затрагиваются. Для этого профиля.',
  // Toasts when a source is picked automatically
  'sources.autoplay.outside-limits': 'Ничего не подходит под ограничения автозапуска, поэтому включён лучший источник.',
  'sources.autoplay.only-uncached': 'Все найденные источники ещё загружаются в ваш debrid-сервис. Выберите один, чтобы запустить его.',
  // Quiet tags in the source list
  'sources.note.uncached': 'Не в кэше',
  'sources.note.uncached-hint': 'Ещё загружается в ваш debrid-сервис: автоматически не запускается',
  'sources.note.outside-limits': 'Вне ограничений автозапуска',
  'sources.note.outside-limits-hint': '«Смотреть» и следующая серия его пропускают (Настройки → Аддоны и источники → Выбор источников → Ограничения автозапуска)',
  // The Next Up card, for an episode whose air date isn't confirmed
  'sources.next-up.unaired': 'Далее · дата выхода не подтверждена',
};
