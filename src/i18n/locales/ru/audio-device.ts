import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Russian strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Устройство вывода",
  'audiodevice.hint': "Где воспроизводится звук. «По умолчанию в системе» следует выбору компьютера, даже если он меняется во время видео. Если выбранное здесь устройство отключить, звук перейдёт на системное по умолчанию, пока оно не вернётся.",
  'audiodevice.default': "По умолчанию в системе",
  'audiodevice.missing': "Не подключено: звук идёт на системное по умолчанию",
  'audiodevice.error': "Не удалось сменить устройство вывода",
};
