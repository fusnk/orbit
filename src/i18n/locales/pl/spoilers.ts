import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoilery',
  'spoilers.intro': 'Co ukrywać w odcinkach: na stronie serialu, na liście odcinków w odtwarzaczu, na karcie Następny i w Kontynuuj oglądanie.',
  'spoilers.titles': 'Ukryj tytuły odcinków',
  'spoilers.titles-hint': 'Pokazuje „Odcinek 4” zamiast nazwy odcinka.',
  'spoilers.descriptions': 'Ukryj opisy odcinków',
  'spoilers.descriptions-hint': 'Pomija streszczenie każdego odcinka.',
  'spoilers.thumbnails': 'Rozmyj obrazy odcinków',
  'spoilers.thumbnails-hint': 'Najedź na odcinek lub go zaznacz, aby podejrzeć.',
  'spoilers.ratings': 'Ukryj oceny odcinków',
  'spoilers.ratings-hint': 'Ocena może zdradzić, które odcinki są ważne.',
  'spoilers.unaired': 'Ukryj daty emisji nadchodzących odcinków',
  'spoilers.unaired-hint': 'Odcinki, które jeszcze nie wyszły, pokazują tylko „Jeszcze nie wyemitowany”.',
  'spoilers.scope': 'Dotyczy',
  'spoilers.scope-hint': 'Odcinki, które ukończyłeś lub zacząłeś, pokazują wszystko, chyba że wybierzesz wszystkie odcinki.',
  'spoilers.scope-unwatched': 'Odcinków, których nie obejrzałem',
  'spoilers.scope-all': 'Wszystkich odcinków',
};
