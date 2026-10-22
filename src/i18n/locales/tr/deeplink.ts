import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Turkish text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Bir web sitesindeki yükleme bağlantısından açıldı. Yüklemeden önce aşağıdaki eklentiyi kontrol et.',
  'deeplink.unusable': 'Orbit bu bağlantıyı kullanamıyor. Burada yalnızca eklenti yükleme bağlantıları (manifest.json ile biten) açılır.',
  'deeplink.after-video': 'Bir eklenti yükleme bağlantısı geldi. Orbit, video bitince onu açacak.',
  'deeplink.home-network': 'Ev ağında',
  'deeplink.home-network-note': 'Bu bağlantı bu bilgisayarı ya da ev ağındaki bir cihazı gösteriyor. Orbit henüz ona bağlanmadı. Yalnızca orada bir eklenti bekliyorsan devam et.',
  'deeplink.continue': 'Devam',
};
