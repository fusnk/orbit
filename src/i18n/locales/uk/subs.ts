import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Найкращий збіг',
  'subs.error.sdh': 'Не вдалося застосувати налаштування тексту для людей з порушеннями слуху',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Прибирати текст для людей з порушеннями слуху',
  'subs.settings.strip-sdh-hint': 'Приховує в субтитрах описи звуків на кшталт [рипнули двері], музичні позначки й імена мовців на кшталт ІВАН:. Порожні рядки пропускаються, таймінг не змінюється.',
  'subs.settings.keep-lyrics': 'Залишати тексти пісень',
  'subs.settings.keep-lyrics-hint': 'Рядки пісень, позначені ♪, залишаються, коли текст для людей з порушеннями слуху прибирається. Рядки з самих нот однаково зникають.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Не вдалося втримати субтитри внизу',
  'subs.player.position': 'Положення субтитрів',
  'subs.player.height': 'Висота',
  'subs.player.raised': 'Вище на {value}%',
  'subs.player.reset': 'Повернути вниз',
  'subs.player.keep-bottom': 'Тримати внизу',
  'subs.player.keep-bottom-hint': 'Прості субтитри (наприклад, SRT) ігнорують розташування з файлу, тож кожен рядок стоїть на цій висоті. Прості субтитри всередині відео до того ж утрачають курсив. Стилізовані субтитри (ASS, часто в аніме) зберігають власну розмітку. Запам’ятовується для всіх відео.',
};
