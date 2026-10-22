import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Polish strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Urządzenie wyjściowe",
  'audiodevice.hint': "Gdzie odtwarzany jest dźwięk. Domyślne systemowe podąża za wyborem komputera, nawet jeśli zmieni się w trakcie filmu. Jeśli wybrane tu urządzenie zostanie odłączone, dźwięk przejdzie na domyślne systemowe, dopóki nie wróci.",
  'audiodevice.default': "Domyślne systemowe",
  'audiodevice.missing': "Niepodłączone: odtwarzanie na domyślnym systemowym",
  'audiodevice.error': "Nie udało się zmienić urządzenia wyjściowego",
};
