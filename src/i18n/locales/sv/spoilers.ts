import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'Spoilers',
  'spoilers.intro': 'Vad som ska döljas om avsnitt: på en series sida, i spelarens avsnittslista, på kortet Härnäst och i Fortsätt titta.',
  'spoilers.titles': 'Dölj avsnittstitlar',
  'spoilers.titles-hint': 'Visar ”Avsnitt 4” i stället för avsnittets namn.',
  'spoilers.descriptions': 'Dölj avsnittsbeskrivningar',
  'spoilers.descriptions-hint': 'Utelämnar varje avsnitts sammanfattning.',
  'spoilers.thumbnails': 'Gör avsnittsbilder suddiga',
  'spoilers.thumbnails-hint': 'Håll muspekaren över eller fokusera ett avsnitt för att kika.',
  'spoilers.ratings': 'Dölj avsnittsbetyg',
  'spoilers.ratings-hint': 'Ett betyg kan avslöja vilka avsnitt som är viktiga.',
  'spoilers.unaired': 'Dölj sändningsdatum för kommande avsnitt',
  'spoilers.unaired-hint': 'Avsnitt som inte har kommit ut än visar bara ”Inte sänd än”.',
  'spoilers.scope': 'Gäller',
  'spoilers.scope-hint': 'Avsnitt du har sett klart eller börjat på visar allt, om du inte väljer alla avsnitt.',
  'spoilers.scope-unwatched': 'Avsnitt jag inte har sett',
  'spoilers.scope-all': 'Alla avsnitt',
};
