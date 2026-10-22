import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': "Spoiler",
  'spoilers.intro': "Bölümlerle ilgili neler gizlensin: dizi sayfasında, oynatıcının bölüm listesinde, Sıradaki kartında ve İzlemeye Devam Et’te.",
  'spoilers.titles': "Bölüm adlarını gizle",
  'spoilers.titles-hint': "Bölümün adı yerine “4. Bölüm” gösterir.",
  'spoilers.descriptions': "Bölüm açıklamalarını gizle",
  'spoilers.descriptions-hint': "Her bölümün özetini göstermez.",
  'spoilers.thumbnails': "Bölüm görsellerini bulanıklaştır",
  'spoilers.thumbnails-hint': "Göz atmak için bir bölümün üzerine gel veya ona odaklan.",
  'spoilers.ratings': "Bölüm puanlarını gizle",
  'spoilers.ratings-hint': "Bir puan hangi bölümlerin önemli olduğunu ele verebilir.",
  'spoilers.unaired': "Gelecek bölümlerin yayın tarihlerini gizle",
  'spoilers.unaired-hint': "Henüz çıkmamış bölümlerde yalnızca “Henüz yayınlanmadı” yazar.",
  'spoilers.scope': "Şunlara uygulanır",
  'spoilers.scope-hint': "Bitirdiğin veya başladığın bölümlerde her şey görünür; tüm bölümleri seçmediğin sürece.",
  'spoilers.scope-unwatched': "İzlemediğim bölümler",
  'spoilers.scope-all': "Tüm bölümler",
};
