import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Turkish strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Bu eklentinin ayarları güncellensin mi?",
  'prfixes.addons.update-detail': "{name} zaten yüklü. Bu ayarlar eskilerinin yerini alır ve eklenti listendeki yerini korur.",
  'prfixes.addons.update': "Güncelle",
  'prfixes.audio.original': "Önce orijinal dil",
  'prfixes.audio.original-hint': "Videoda o ses varsa her film ve dizi yapıldığı dilde başlar: anime Japonca, Kore dizisi Korece. Yoksa yukarıdaki ses dili. TMDB anahtarı gerekir.",
  'prfixes.bundle.local': "Bu adres bu bilgisayara ya da ev ağına çıkıyor, bu yüzden Orbit ona bağlanmadı.",
};
