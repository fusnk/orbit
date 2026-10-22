import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Časy přeskakování anime z AniSkip",
  'movix.aniskip-hint': "U anime se zeptá i AniSkip, bezplatné komunitní databáze, kde jsou openingy, endingy a rekapitulace. Posílá jen ID seriálu na MyAnimeList a číslo dílu; k rozpoznání seriálu může stáhnout veřejný seznam ID z GitHubu. Vypnuto, dokud to nezapnete.",
  'movix.smooth': "Plynulé přeskakování",
  'movix.smooth-hint': "Při přeskočení obraz na okamžik ztmavne do černé a zvuk se ztiší, pak se obojí vrátí. Se zapnutým Omezením pohybu se přeskakuje okamžitě.",
  'movix.button-delay': "Zobrazit tlačítko Přeskočit po",
  'movix.button-delay-hint': "Nechá začátek úvodu nebo titulků přehrát, než se objeví Přeskočit, aby tlačítko nezakrylo konec scény. Automatické přeskakování nečeká.",
  'movix.button-delay-none': "Hned",
  'movix.landing': "Skončit před koncem",
  'movix.landing-hint': "Přeskočení skončí o tolik před koncem úvodu nebo rekapitulace, aby se neusekl první okamžik po nich. Závěrečné titulky až do konce stále vedou na konec.",
  'movix.landing-none': "Na konci",
  'movix.color-intro': "Barva úvodu",
  'movix.color-recap': "Barva rekapitulace",
  'movix.color-credits': "Barva závěrečných titulků",
  'movix.color-preview': "Barva upoutávky",
  'movix.colors-hint': "Jak každá část vypadá na časové ose.",
  'movix.swatch.default': "Standardní",
  'movix.swatch.amber': "Jantarová",
  'movix.swatch.sky': "Blankytná",
  'movix.swatch.mint': "Mátová",
  'movix.swatch.rose': "Růžová",
  'movix.swatch.violet': "Fialová",
  'movix.swatch.white': "Bílá",
};
