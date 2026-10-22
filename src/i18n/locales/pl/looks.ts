import type { looks as source } from '../en/looks';
import type { Catalog } from '../types';

/** Polish strings for Looks (whole-app style presets). */
export const looks: Catalog<typeof source> = {
  'looks.heading': 'Style',
  'looks.hint': 'Jeden wybór, który zmienia wygląd całego Orbita: motyw, baner na stronie głównej, stronę tytułu, miejsce menu i układ odtwarzacza. Wszystko, co ustawia styl, nadal można zmienić poniżej.',
  'looks.presets-label': 'Style',
  'looks.name.orbit': 'Orbit',
  'looks.name.crimson': 'Crimson',
  'looks.name.marquee': 'Marquee',
  'looks.name.premiere': 'Premiere',
  'looks.name.glass': 'Glass',
  'looks.name.aurora': 'Aurora',
  'looks.name.couch': 'Couch',
  'looks.name.afterglow': 'Afterglow',
  'looks.name.arc': 'Orbit Arc',
  'looks.orbit-hint': 'Orbit taki, jaki jest na starcie: domyślny motyw, baner w formie karty, menu u góry i klasyczny odtwarzacz.',
  'looks.crimson-hint': 'Czerń i jedna kinowa czerwień, baner na całą szerokość, poziome karty, strona tytułu Wystawa i odtwarzacz Teatr.',
  'looks.custom': 'Własny',
  'looks.restore': 'Przywróć moje poprzednie ustawienia',
  'looks.applied': 'Zastosowano {name}.',
  'looks.restored': 'Poprzednie ustawienia wróciły.',
};
