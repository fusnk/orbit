import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Swedish strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Bläddra',
  'remote.phone.browse-loading': 'Läser in din startsida…',
  'remote.phone.browse-empty': 'Inget att visa än. Lägg till ett katalogtillägg i Orbit för att fylla startsidan.',
  'remote.phone.browse-failed': 'Det gick inte att läsa in din startsida. Försök igen.',
  'remote.phone.refresh': 'Uppdatera',
  'remote.phone.moods': 'Vad är du sugen på?',
  'remote.phone.mood-loading': 'Letar efter tips…',
  'remote.phone.mood-empty': 'Inga tips för det här humöret just nu.',
  'remote.phone.surprise': 'Överraska mig',
  'remote.phone.surprise-hint': 'Ett slumpat tips från dina kataloger.',
  'remote.phone.surprise-movie': 'En film',
  'remote.phone.surprise-series': 'En serie',
  'remote.phone.surprise-none': 'Inget nytt att föreslå just nu. Prova den andra sorten, eller ändra valen för Överraska mig i Orbit.',
  'remote.phone.details-loading': 'Läser in detaljer…',
  'remote.phone.details-failed': 'Det gick inte att läsa in den här titeln. Försök igen.',
  'remote.phone.add-library': 'Lägg till i biblioteket',
  'remote.phone.in-library': 'I ditt bibliotek',
  'remote.phone.close': 'Stäng',
  'remote.phone.season': 'Säsong {number}',
  'remote.phone.specials': 'Specialavsnitt',
  'remote.phone.episodes': 'Avsnitt',
  'remote.phone.rating': 'IMDb-betyg {rating}',
};
