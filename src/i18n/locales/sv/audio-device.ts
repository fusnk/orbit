import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Swedish strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Utenhet",
  'audiodevice.hint': "Var ljudet spelas upp. Systemstandard följer datorns val, även om det ändras under en video. Om enheten som valts här kopplas ur flyttas ljudet till systemstandard tills den är tillbaka.",
  'audiodevice.default': "Systemstandard",
  'audiodevice.missing': "Inte ansluten: spelar upp på systemstandard",
  'audiodevice.error': "Det gick inte att byta utenhet",
};
