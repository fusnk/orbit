import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** German strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Ausgabegerät",
  'audiodevice.hint': "Wo der Ton abgespielt wird. Der Systemstandard folgt der Wahl deines Computers, auch wenn sie sich während eines Videos ändert. Wird das hier gewählte Gerät getrennt, wechselt der Ton zum Systemstandard, bis es wieder da ist.",
  'audiodevice.default': "Systemstandard",
  'audiodevice.missing': "Nicht verbunden: Wiedergabe über den Systemstandard",
  'audiodevice.error': "Das Ausgabegerät konnte nicht geändert werden",
};
