import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Czech strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Výstupní zařízení",
  'audiodevice.hint': "Kde se přehrává zvuk. Výchozí nastavení systému sleduje volbu počítače, i když se změní během videa. Když se zde zvolené zařízení odpojí, zvuk přejde na výchozí zařízení systému, dokud se nevrátí.",
  'audiodevice.default': "Výchozí systému",
  'audiodevice.missing': "Nepřipojeno: přehrává se na výchozím zařízení systému",
  'audiodevice.error': "Výstupní zařízení se nepodařilo změnit",
};
