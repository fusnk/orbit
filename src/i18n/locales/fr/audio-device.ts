import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** French strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Périphérique de sortie",
  'audiodevice.hint': "Où le son est joué. Le périphérique par défaut du système suit le choix de votre ordinateur, même s’il change pendant une vidéo. Si le périphérique choisi ici est débranché, le son passe sur celui par défaut jusqu’à son retour.",
  'audiodevice.default': "Par défaut du système",
  'audiodevice.missing': "Non connecté : lecture sur le périphérique par défaut",
  'audiodevice.error': "Impossible de changer le périphérique de sortie",
};
