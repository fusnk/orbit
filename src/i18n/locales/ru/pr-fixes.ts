import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Russian strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Обновить настройки этого аддона?",
  'prfixes.addons.update-detail': "{name} уже установлен. Эти настройки заменят прежние, а аддон сохранит своё место в списке.",
  'prfixes.addons.update': "Обновить",
  'prfixes.audio.original': "Сначала язык оригинала",
  'prfixes.audio.original-hint': "Каждый фильм или сериал начинается на языке оригинала, если в видео есть такая дорожка: аниме на японском, корейская дорама на корейском. Иначе — язык аудио выше. Нужен ключ TMDB.",
  'prfixes.bundle.local': "Этот адрес ведёт на этот компьютер или в вашу домашнюю сеть, поэтому Orbit не стал к нему обращаться.",
};
