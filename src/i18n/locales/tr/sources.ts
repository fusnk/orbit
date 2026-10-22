import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  'sources.limits.heading': "Otomatik oynatma sınırları",
  'sources.limits.any': "Fark etmez",
  'sources.limits.min-quality': "Otomatik oynatmanın en düşük kalitesi",
  'sources.limits.min-quality-hint': "Oynat ve sonraki bölüm yalnızca en az bu kalitedeki kaynakları başlatır (kalitesini belirtmeyenler sayılmaz). Hiçbiri uymazsa en iyisi oynatılır ve Orbit sana söyler. Kaynak listesi yine her şeyi gösterir. Bu profil için.",
  'sources.limits.max-quality': "Otomatik oynatmanın en yüksek kalitesi",
  'sources.limits.max-quality-hint': "Oynat ve sonraki bölüm, başka bir şey bulunmadıkça bunun üstündeki kaynakları başlatmaz. “Tercih edilen en yüksek kalite”den farklı olarak kaynak listesinin sırasını değiştirmez. Bu profil için.",
  'sources.limits.max-size': "Otomatik oynatmanın en büyük dosya boyutu",
  'sources.limits.max-size-hint': "Yavaş bağlantılar veya kotalı internet için: Oynat ve sonraki bölüm daha büyük dosyaları atlar. Boyutunu belirtmeyen kaynaklar etkilenmez. Bu profil için.",
  'sources.autoplay.outside-limits': "Otomatik oynatma sınırlarına uyan bir şey yok, bu yüzden en iyi kaynak oynatılıyor.",
  'sources.autoplay.only-uncached': "Bulunan tüm kaynaklar hâlâ debrid hizmetine indiriliyor. Başlatmak için birini seç.",
  'sources.note.uncached': "Önbellekte değil",
  'sources.note.uncached-hint': "Hâlâ debrid hizmetine indiriliyor: asla otomatik başlatılmaz",
  'sources.note.outside-limits': "Otomatik oynatma sınırları dışında",
  'sources.note.outside-limits-hint': "Oynat ve sonraki bölüm bunu atlar (Ayarlar → Eklentiler ve Kaynaklar → Kaynak tercihleri → Otomatik oynatma sınırları)",
  'sources.next-up.unaired': "Sıradaki · yayın tarihi kesin değil",
};
