import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // Settings → Playback → Autoplay limits (per profile)
  'sources.limits.heading': 'Обмеження автозапуску',
  'sources.limits.any': 'Будь-яке',
  'sources.limits.min-quality': 'Не запускати автоматично нижче',
  'sources.limits.min-quality-hint': 'Кнопка «Дивитися» й наступна серія запускають лише джерела, не гірші за це (джерела без зазначеної якості не підходять). Якщо підхожих немає, грає найкраще, і Orbit про це повідомить. У списку джерел, як і раніше, видно все. Для цього профілю.',
  'sources.limits.max-quality': 'Не запускати автоматично вище',
  'sources.limits.max-quality-hint': 'Кнопка «Дивитися» й наступна серія не запускають джерела, вищі за це, якщо не знайшлося інших. На відміну від «Бажана якість не вище», порядок списку джерел не змінюється. Для цього профілю.',
  'sources.limits.max-size': 'Не запускати автоматично файли, більші за',
  'sources.limits.max-size-hint': 'Для повільного інтернету чи обмеженого трафіку: «Дивитися» й наступна серія пропускають більші файли. Джерел без зазначеного розміру це не стосується. Для цього профілю.',
  // Toasts when a source is picked automatically
  'sources.autoplay.outside-limits': 'Ніщо не відповідає обмеженням автозапуску, тому увімкнено найкраще джерело.',
  'sources.autoplay.only-uncached': 'Усі знайдені джерела ще завантажуються у ваш debrid-сервіс. Виберіть одне, щоб запустити його.',
  // Quiet tags in the source list
  'sources.note.uncached': 'Не в кеші',
  'sources.note.uncached-hint': 'Ще завантажується у ваш debrid-сервіс: автоматично не запускається',
  'sources.note.outside-limits': 'Поза обмеженнями автозапуску',
  'sources.note.outside-limits-hint': '«Дивитися» й наступна серія його пропускають (Налаштування → Аддони та джерела → Вибір джерел → Обмеження автозапуску)',
  // The Next Up card, for an episode whose air date isn't confirmed
  'sources.next-up.unaired': 'Далі · дату виходу не підтверджено',
};
