import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Grenzen voor automatisch afspelen',
  'sources.limits.any': 'Alle',
  'sources.limits.min-quality': 'Automatisch afspelen start niet onder',
  'sources.limits.min-quality-hint': 'Afspelen en de volgende aflevering starten alleen bronnen van minstens deze kwaliteit (bronnen die het niet vermelden niet). Past er geen, dan speelt de beste en meldt Orbit dat. De bronnenlijst toont nog steeds alles. Voor dit profiel.',
  'sources.limits.max-quality': 'Automatisch afspelen start niet boven',
  'sources.limits.max-quality-hint': 'Afspelen en de volgende aflevering starten geen bronnen daarboven, tenzij er niets anders is. Anders dan ‘Hoogste voorkeurskwaliteit’ verandert het de volgorde van de bronnenlijst niet. Voor dit profiel.',
  'sources.limits.max-size': 'Automatisch afspelen start geen bestanden groter dan',
  'sources.limits.max-size-hint': 'Voor trage verbindingen of een databundel: Afspelen en de volgende aflevering slaan grotere bestanden over. Bronnen zonder grootte worden niet beïnvloed. Voor dit profiel.',
  'sources.autoplay.outside-limits': 'Niets past binnen je grenzen voor automatisch afspelen, dus de beste bron speelt.',
  'sources.autoplay.only-uncached': 'Alle gevonden bronnen worden nog naar je debrid-dienst gedownload. Kies er een om hem te starten.',
  'sources.note.uncached': 'Niet in cache',
  'sources.note.uncached-hint': 'Wordt nog naar je debrid-dienst gedownload: start nooit automatisch',
  'sources.note.outside-limits': 'Buiten de grenzen',
  'sources.note.outside-limits-hint': 'Afspelen en de volgende aflevering slaan hem over (Instellingen → Add-ons & bronnen → Bronvoorkeuren → Grenzen voor automatisch afspelen)',
  'sources.next-up.unaired': 'Hierna · uitzenddatum niet bevestigd',
};
