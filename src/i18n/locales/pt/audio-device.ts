import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Portuguese strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Dispositivo de saída",
  'audiodevice.hint': "Onde o som é reproduzido. O padrão do sistema segue a escolha do seu computador, mesmo que mude durante um vídeo. Se o dispositivo escolhido aqui for desligado, o som passa para o padrão do sistema até ele voltar.",
  'audiodevice.default': "Padrão do sistema",
  'audiodevice.missing': "Não conectado: reproduzindo no padrão do sistema",
  'audiodevice.error': "Não foi possível mudar o dispositivo de saída",
};
