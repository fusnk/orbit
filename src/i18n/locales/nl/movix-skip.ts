import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Anime-overslaantijden van AniSkip",
  'movix.aniskip-hint': "Vraagt voor anime ook AniSkip, een gratis communitydatabase, waar openings, endings en terugblikken zitten. Stuurt alleen het MyAnimeList-id van de serie en het afleveringsnummer; om de serie te herkennen kan een openbare id-lijst van GitHub worden gedownload. Uit tot je het aanzet.",
  'movix.smooth': "Vloeiend overslaan",
  'movix.smooth-hint': "Bij overslaan vervaagt het beeld even naar zwart en wordt het geluid zachter, daarna komen ze terug. Met Minder beweging aan blijft overslaan direct.",
  'movix.button-delay': "Overslaanknop tonen na",
  'movix.button-delay-hint': "Laat het begin van de intro of aftiteling spelen voordat Overslaan verschijnt, zodat de knop het einde van een scène niet bedekt. Automatisch overslaan wacht hier niet op.",
  'movix.button-delay-none': "Meteen",
  'movix.landing': "Stoppen voor het einde",
  'movix.landing-hint': "Overslaan stopt zoveel voor het einde van de intro of terugblik, zodat het eerste moment erna niet wegvalt. Aftiteling die tot het eind loopt, gaat nog steeds naar het eind.",
  'movix.landing-none': "Aan het eind",
  'movix.color-intro': "Kleur van intro",
  'movix.color-recap': "Kleur van terugblik",
  'movix.color-credits': "Kleur van aftiteling",
  'movix.color-preview': "Kleur van voorproefje",
  'movix.colors-hint': "Hoe elk deel eruitziet op de tijdbalk.",
  'movix.swatch.default': "Standaard",
  'movix.swatch.amber': "Amber",
  'movix.swatch.sky': "Hemelsblauw",
  'movix.swatch.mint': "Mint",
  'movix.swatch.rose': "Roze",
  'movix.swatch.violet': "Violet",
  'movix.swatch.white': "Wit",
};
