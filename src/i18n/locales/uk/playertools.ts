import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': 'Власна',
  'playertools.speed.custom-label': 'Власна швидкість',
  'playertools.speed.slower': 'Повільніше (−0.05×)',
  'playertools.speed.faster': 'Швидше (+0.05×)',
  'playertools.subs.try-another': 'Інші субтитри',
  'playertools.subs.try-another-detail': 'Наступний відповідний варіант: {language}',
  'playertools.subs.cycled': 'Субтитри {position} з {total} · {source}',
  'playertools.subs.no-other': 'Інших субтитрів немає',
  'playertools.paste.action': 'Вставити субтитри…',
  'playertools.paste.detail': 'Текст SRT або WebVTT',
  'playertools.paste.title': 'Вставити субтитри',
  'playertools.paste.hint': 'Вставте текст файлу SRT або WebVTT. Субтитри додадуться лише до цього відео.',
  'playertools.paste.field': 'Текст субтитрів',
  'playertools.paste.placeholder': '1\n00:00:01,000 --> 00:00:03,000\nПривіт!',
  'playertools.paste.add': 'Додати',
  'playertools.paste.cancel': 'Скасувати',
  'playertools.paste.empty': 'Спочатку вставте текст субтитрів.',
  'playertools.paste.too-big': 'Тексту більше ніж 2 МБ.',
  'playertools.paste.bad': 'Це не схоже на субтитри SRT або WebVTT.',
  'playertools.paste.added': 'Вставлені субтитри додано',
  'playertools.paste.name': 'Вставлені субтитри',
  'playertools.caps.setting': 'Виправляти субтитри ВЕЛИКИМИ ЛІТЕРАМИ',
  'playertools.caps.hint': 'Рядки, набрані повністю великими літерами, зводяться до звичайного вигляду. Працює для субтитрів з аддонів, доданих файлів і вставленого тексту, але не для субтитрів усередині відеофайлу. Імена теж втрачають великі літери.',
  'playertools.caps.error': 'Не вдалося застосувати налаштування великих літер',
};
