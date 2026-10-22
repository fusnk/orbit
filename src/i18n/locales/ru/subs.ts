import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Лучшее совпадение',
  'subs.error.sdh': 'Не удалось применить настройку текста для слабослышащих',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Убирать текст для слабослышащих',
  'subs.settings.strip-sdh-hint': 'Скрывает в субтитрах описания звуков вроде [скрипит дверь], музыкальные пометки и имена говорящих вроде ИВАН:. Опустевшие строки пропускаются, тайминг не меняется.',
  'subs.settings.keep-lyrics': 'Оставлять тексты песен',
  'subs.settings.keep-lyrics-hint': 'Строки песен, отмеченные ♪, остаются, когда текст для слабослышащих убирается. Строки из одних нот всё равно исчезают.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Не удалось удержать субтитры внизу',
  'subs.player.position': 'Положение субтитров',
  'subs.player.height': 'Высота',
  'subs.player.raised': 'Выше на {value}%',
  'subs.player.reset': 'Вернуть вниз',
  'subs.player.keep-bottom': 'Держать внизу',
  'subs.player.keep-bottom-hint': 'Простые субтитры (например, SRT) игнорируют расположение из файла, поэтому каждая строка стоит на этой высоте. Простые субтитры внутри видео к тому же теряют курсив. Стилизованные субтитры (ASS, часто в аниме) сохраняют свою разметку. Запоминается для всех видео.',
};
