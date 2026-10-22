import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'Spoilery',
  'spoilers.intro': 'Co o dílech skrýt: na stránce seriálu, v seznamu dílů v přehrávači, na kartě Další na řadě a v Pokračovat ve sledování.',
  'spoilers.titles': 'Skrýt názvy dílů',
  'spoilers.titles-hint': 'Ukáže „4. díl“ místo názvu dílu.',
  'spoilers.descriptions': 'Skrýt popisy dílů',
  'spoilers.descriptions-hint': 'Vynechá shrnutí každého dílu.',
  'spoilers.thumbnails': 'Rozmazat obrázky dílů',
  'spoilers.thumbnails-hint': 'Nahlédnete najetím myší nebo výběrem dílu.',
  'spoilers.ratings': 'Skrýt hodnocení dílů',
  'spoilers.ratings-hint': 'Hodnocení může prozradit, na kterých dílech záleží.',
  'spoilers.unaired': 'Skrýt data vysílání nadcházejících dílů',
  'spoilers.unaired-hint': 'U dílů, které ještě nevyšly, stojí jen „Zatím neodvysíláno“.',
  'spoilers.scope': 'Platí pro',
  'spoilers.scope-hint': 'Díly, které jste dokončili nebo začali, ukazují vše, pokud nezvolíte všechny díly.',
  'spoilers.scope-unwatched': 'Díly, které jsem neviděl(a)',
  'spoilers.scope-all': 'Všechny díly',
};
