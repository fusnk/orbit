import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "AniSkip’ten anime atlama zamanları",
  'movix.aniskip-hint': "Anime için ayrıca ücretsiz bir topluluk veritabanı olan AniSkip’e açılış, kapanış ve özetlerin nerede olduğunu sorar. Yalnızca dizinin MyAnimeList kimliğini ve bölüm numarasını gönderir; diziyi tanımak için GitHub’dan herkese açık bir kimlik listesi indirilebilir. Sen açana kadar kapalıdır.",
  'movix.smooth': "Yumuşak atlama",
  'movix.smooth-hint': "Atlarken görüntü kısa bir süre siyaha kararır ve ses kısılır, sonra ikisi de geri gelir. Hareketi azalt açıkken atlamalar anında olur.",
  'movix.button-delay': "Atla düğmesini şu süreden sonra göster",
  'movix.button-delay-hint': "Atla görünmeden önce girişin ya da jeneriğin başı oynar, böylece düğme bir sahnenin sonunu kapatmaz. Otomatik atlamalar beklemez.",
  'movix.button-delay-none': "Hemen",
  'movix.landing': "Bitişten önce dur",
  'movix.landing-hint': "Atlama, giriş ya da özet bitmeden bu kadar önce durur; böylece ardından gelen ilk an kesilmez. Sona kadar süren jenerik yine sona götürür.",
  'movix.landing-none': "Sonda",
  'movix.color-intro': "Giriş rengi",
  'movix.color-recap': "Özet rengi",
  'movix.color-credits': "Jenerik rengi",
  'movix.color-preview': "Fragman rengi",
  'movix.colors-hint': "Her bölümün zaman çubuğunda nasıl göründüğü.",
  'movix.swatch.default': "Standart",
  'movix.swatch.amber': "Kehribar",
  'movix.swatch.sky': "Gök mavisi",
  'movix.swatch.mint': "Nane",
  'movix.swatch.rose': "Pembe",
  'movix.swatch.violet': "Mor",
  'movix.swatch.white': "Beyaz",
};
