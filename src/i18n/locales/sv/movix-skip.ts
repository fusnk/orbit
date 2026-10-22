import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Hopptider för anime från AniSkip",
  'movix.aniskip-hint': "För anime frågas även AniSkip, en gratis communitydatabas, var openings, endings och resuméer finns. Skickar bara seriens MyAnimeList-id och avsnittsnumret; för att känna igen serien kan en offentlig id-lista hämtas från GitHub. Av tills du slår på det.",
  'movix.smooth': "Mjuk överhoppning",
  'movix.smooth-hint': "Vid ett hopp tonar bilden kort till svart och ljudet sänks, sedan tonar båda tillbaka. Med Minska rörelse på sker hopp direkt.",
  'movix.button-delay': "Visa Hoppa över-knappen efter",
  'movix.button-delay-hint': "Låter början av introt eller eftertexterna spelas innan Hoppa över visas, så att knappen inte täcker slutet av en scen. Automatiska hopp väntar inte.",
  'movix.button-delay-none': "Direkt",
  'movix.landing': "Landa före slutet",
  'movix.landing-hint': "Ett hopp landar så här långt före slutet av introt eller resumén, så att första ögonblicket efter inte klipps bort. Eftertexter som går till slutet hoppar fortfarande till slutet.",
  'movix.landing-none': "Vid slutet",
  'movix.color-intro': "Färg för intro",
  'movix.color-recap': "Färg för resumé",
  'movix.color-credits': "Färg för eftertexter",
  'movix.color-preview': "Färg för förhandstitt",
  'movix.colors-hint': "Hur varje del ser ut på tidslinjen.",
  'movix.swatch.default': "Standard",
  'movix.swatch.amber': "Bärnsten",
  'movix.swatch.sky': "Himmelsblå",
  'movix.swatch.mint': "Mint",
  'movix.swatch.rose': "Rosa",
  'movix.swatch.violet': "Violett",
  'movix.swatch.white': "Vit",
};
