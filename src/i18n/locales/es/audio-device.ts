import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Spanish strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Dispositivo de salida",
  'audiodevice.hint': "Dónde se reproduce el sonido. El predeterminado del sistema sigue la elección de tu ordenador, aunque cambie durante un vídeo. Si el dispositivo elegido aquí se desconecta, el sonido pasa al predeterminado del sistema hasta que vuelva.",
  'audiodevice.default': "Predeterminado del sistema",
  'audiodevice.missing': "No conectado: se reproduce en el predeterminado del sistema",
  'audiodevice.error': "No se pudo cambiar el dispositivo de salida",
};
