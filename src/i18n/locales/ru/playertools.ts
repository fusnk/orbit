import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'Своя',
  'playertools.speed.custom-label': 'Своя скорость',
  'playertools.speed.slower': 'Медленнее (−0.05×)',
  'playertools.speed.faster': 'Быстрее (+0.05×)',
  'playertools.subs.try-another': 'Другие субтитры',
  'playertools.subs.try-another-detail': 'Следующий подходящий вариант: {language}',
  'playertools.subs.cycled': 'Субтитры {position} из {total} · {source}',
  'playertools.subs.no-other': 'Других субтитров нет',
  'playertools.paste.action': 'Вставить субтитры…',
  'playertools.paste.detail': 'Текст SRT или WebVTT',
  'playertools.paste.title': 'Вставить субтитры',
  'playertools.paste.hint': 'Вставьте текст файла SRT или WebVTT. Субтитры добавятся только к этому видео.',
  'playertools.paste.field': 'Текст субтитров',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nПривет!',
  'playertools.paste.add': 'Добавить',
  'playertools.paste.cancel': 'Отмена',
  'playertools.paste.empty': 'Сначала вставьте текст субтитров.',
  'playertools.paste.too-big': 'Текста больше 2 МБ.',
  'playertools.paste.bad': 'Это не похоже на субтитры SRT или WebVTT.',
  'playertools.paste.added': 'Вставленные субтитры добавлены',
  'playertools.paste.name': 'Вставленные субтитры',
  'playertools.caps.setting': 'Исправлять субтитры ЗАГЛАВНЫМИ',
  'playertools.caps.hint': 'Строки, набранные целиком заглавными буквами, приводятся к обычному виду. Работает для субтитров из аддонов, добавленных файлов и вставленного текста, но не для субтитров внутри видеофайла. Имена тоже теряют заглавные буквы.',
  'playertools.caps.error': 'Не удалось применить настройку заглавных букв',
};
