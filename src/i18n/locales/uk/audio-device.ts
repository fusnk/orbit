import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Ukrainian strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Пристрій виведення",
  'audiodevice.hint': "Де відтворюється звук. «Типовий у системі» слідує вибору комп’ютера, навіть якщо він змінюється під час відео. Якщо вибраний тут пристрій від’єднати, звук перейде на типовий у системі, доки пристрій не повернеться.",
  'audiodevice.default': "Типовий у системі",
  'audiodevice.missing': "Не під’єднано: звук іде на типовий у системі",
  'audiodevice.error': "Не вдалося змінити пристрій виведення",
};
