import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  'subs.best-match': "En iyi eşleşme",
  'subs.error.sdh': "İşitme engelliler için metin ayarı uygulanamadı",
  'subs.settings.strip-sdh': "İşitme engelliler için metni kaldır",
  'subs.settings.strip-sdh-hint': "Altyazılardan [kapı gıcırdar] gibi ses açıklamalarını, müzik işaretlerini ve JOHN: gibi konuşmacı adlarını gizler. Boş kalan satırlar atlanır; zamanlama aynı kalır.",
  'subs.settings.keep-lyrics': "Şarkı sözlerini koru",
  'subs.settings.keep-lyrics-hint': "İşitme engelliler için metin kaldırılırken ♪ ile işaretli şarkı satırları kalır. Yalnızca nota içeren satırlar yine kaldırılır.",
  'subs.error.override': "Altyazılar altta tutulamadı",
  'subs.player.position': "Altyazı konumu",
  'subs.player.height': "Yükseklik",
  'subs.player.raised': "%{value} yukarıda",
  'subs.player.reset': "En alta sıfırla",
  'subs.player.keep-bottom': "Altta tut",
  'subs.player.keep-bottom-hint': "Düz altyazılar (SRT gibi) dosyadaki konumu yok sayar, böylece her satır bu yükseklikte durur. Videonun içindeki düz altyazılar italiklerini de kaybeder. Biçimli altyazılar (animede yaygın olan ASS) kendi düzenini korur. Her video için hatırlanır.",
};
