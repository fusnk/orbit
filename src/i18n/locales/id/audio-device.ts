import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Indonesian strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Perangkat output",
  'audiodevice.hint': "Tempat suara diputar. Default sistem mengikuti pilihan komputer Anda, bahkan jika berubah saat video diputar. Jika perangkat yang dipilih di sini dicabut, suara pindah ke default sistem sampai perangkat itu kembali.",
  'audiodevice.default': "Default sistem",
  'audiodevice.missing': "Tidak tersambung: diputar di default sistem",
  'audiodevice.error': "Tidak dapat mengubah perangkat output",
};
