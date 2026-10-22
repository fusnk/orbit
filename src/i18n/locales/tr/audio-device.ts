import type { audioDevice as source } from '../en/audio-device';
import type { Catalog } from '../types';

/** Turkish strings for the sound output picker. */
export const audioDevice: Catalog<typeof source> = {
  'audiodevice.title': "Çıkış aygıtı",
  'audiodevice.hint': "Sesin çalındığı yer. Sistem varsayılanı, bir video sırasında değişse bile bilgisayarının seçimini izler. Burada seçilen aygıt çıkarılırsa ses, geri gelene kadar sistem varsayılanına geçer.",
  'audiodevice.default': "Sistem varsayılanı",
  'audiodevice.missing': "Bağlı değil: sistem varsayılanında çalıyor",
  'audiodevice.error': "Çıkış aygıtı değiştirilemedi",
};
