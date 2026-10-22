import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': "Özel",
  'playertools.speed.custom-label': "Özel hız",
  'playertools.speed.slower': "Daha yavaş (−0,05×)",
  'playertools.speed.faster': "Daha hızlı (+0,05×)",
  'playertools.subs.try-another': "Başka bir altyazı dene",
  'playertools.subs.try-another-detail': "Sonraki en iyi eşleşme ({language})",
  'playertools.subs.cycled': "Altyazı {position}/{total} · {source}",
  'playertools.subs.no-other': "Denenecek başka altyazı yok",
  'playertools.paste.action': "Altyazı yapıştır…",
  'playertools.paste.detail': "SRT veya WebVTT metni",
  'playertools.paste.title': "Altyazı yapıştır",
  'playertools.paste.hint': "Bir SRT veya WebVTT dosyasının metnini yapıştır. Yalnızca bu videoya eklenir.",
  'playertools.paste.field': "Altyazı metni",
  'playertools.paste.placeholder': "1\n00:00:01,000 --> 00:00:03,000\nMerhaba!",
  'playertools.paste.add': "Altyazı ekle",
  'playertools.paste.cancel': "İptal",
  'playertools.paste.empty': "Önce biraz altyazı metni yapıştır.",
  'playertools.paste.too-big': "Bu, 2 MB’tan fazla metin.",
  'playertools.paste.bad': "Bu, SRT veya WebVTT altyazısına benzemiyor.",
  'playertools.paste.added': "Yapıştırılan altyazılar eklendi",
  'playertools.paste.name': "Yapıştırılan altyazılar",
  'playertools.caps.setting': "TAMAMI BÜYÜK HARF altyazıları düzelt",
  'playertools.caps.hint': "Tamamen büyük harfle yazılmış satırlar normal cümle düzenine çevrilir. Eklentilerden gelen altyazılarda, eklediğin dosyalarda ve yapıştırılan metinde çalışır; video dosyasının içindeki altyazılarda çalışmaz. Adlar da büyük harflerini kaybeder.",
  'playertools.caps.error': "Büyük harf ayarın uygulanamadı",
};
