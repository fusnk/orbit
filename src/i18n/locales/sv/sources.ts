import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  'sources.limits.heading': 'Gränser för autouppspelning',
  'sources.limits.any': 'Valfri',
  'sources.limits.min-quality': 'Autouppspelning startar inte under',
  'sources.limits.min-quality-hint': 'Spela upp och nästa avsnitt startar bara källor som är minst så här bra (källor som inte anger det räknas inte). Om ingen passar spelas den bästa och Orbit säger till. Källistan visar fortfarande allt. För den här profilen.',
  'sources.limits.max-quality': 'Autouppspelning startar inte över',
  'sources.limits.max-quality-hint': 'Spela upp och nästa avsnitt startar inte källor över den här nivån, om inget annat hittas. Till skillnad från ”Högsta kvalitet att föredra” ändrar den inte ordningen i källistan. För den här profilen.',
  'sources.limits.max-size': 'Autouppspelning startar inte filer större än',
  'sources.limits.max-size-hint': 'För långsamma anslutningar eller datatak: Spela upp och nästa avsnitt hoppar över större filer. Källor som inte anger sin storlek påverkas inte. För den här profilen.',
  'sources.autoplay.outside-limits': 'Inget passar dina gränser för autouppspelning, så den bästa källan spelas.',
  'sources.autoplay.only-uncached': 'Alla källor som hittades laddas fortfarande ner till din debrid-tjänst. Välj en för att starta den.',
  'sources.note.uncached': 'Inte cachad',
  'sources.note.uncached-hint': 'Laddas fortfarande ner till din debrid-tjänst: startas aldrig automatiskt',
  'sources.note.outside-limits': 'Utanför gränserna för autouppspelning',
  'sources.note.outside-limits-hint': 'Spela upp och nästa avsnitt hoppar över den (Inställningar → Tillägg & källor → Källinställningar → Gränser för autouppspelning)',
  'sources.next-up.unaired': 'Härnäst · sändningsdatum inte bekräftat',
};
