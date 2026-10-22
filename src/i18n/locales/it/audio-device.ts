import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Italian strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Dispositivo di uscita",
  'audiodevice.hint': "Dove viene riprodotto l’audio. Predefinito di sistema segue la scelta del computer, anche se cambia durante un video. Se il dispositivo scelto qui viene scollegato, l’audio passa al predefinito di sistema finché non torna.",
  'audiodevice.default': "Predefinito di sistema",
  'audiodevice.missing': "Non collegato: riproduzione sul predefinito di sistema",
  'audiodevice.error': "Impossibile cambiare il dispositivo di uscita",
};
