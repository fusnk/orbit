import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoiler',
  'spoilers.intro': 'Was bei Folgen verborgen bleibt: auf der Seite einer Serie, in der Folgenliste des Players, auf der Karte „Als Nächstes“ und unter „Weiterschauen“.',
  'spoilers.titles': 'Folgentitel ausblenden',
  'spoilers.titles-hint': 'Zeigt „Folge 4“ statt des Namens der Folge.',
  'spoilers.descriptions': 'Folgenbeschreibungen ausblenden',
  'spoilers.descriptions-hint': 'Lässt die Zusammenfassung jeder Folge weg.',
  'spoilers.thumbnails': 'Folgenbilder weichzeichnen',
  'spoilers.thumbnails-hint': 'Fahre über eine Folge oder markiere sie, um kurz hinzusehen.',
  'spoilers.ratings': 'Folgenbewertungen ausblenden',
  'spoilers.ratings-hint': 'Eine Bewertung kann verraten, welche Folgen wichtig sind.',
  'spoilers.unaired': 'Sendetermine kommender Folgen ausblenden',
  'spoilers.unaired-hint': 'Noch nicht erschienene Folgen zeigen nur „Noch nicht ausgestrahlt“.',
  'spoilers.scope': 'Gilt für',
  'spoilers.scope-hint': 'Folgen, die du beendet oder begonnen hast, zeigen alles, außer du wählst alle Folgen.',
  'spoilers.scope-unwatched': 'Folgen, die ich nicht gesehen habe',
  'spoilers.scope-all': 'Alle Folgen',
};
