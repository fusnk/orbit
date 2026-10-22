import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoilers',
  'spoilers.intro': 'Wat van afleveringen verborgen blijft: op de pagina van een serie, in de afleveringenlijst van de speler, op de kaart Hierna en bij Verder kijken.',
  'spoilers.titles': 'Titels van afleveringen verbergen',
  'spoilers.titles-hint': 'Toont “Aflevering 4” in plaats van de naam van de aflevering.',
  'spoilers.descriptions': 'Beschrijvingen van afleveringen verbergen',
  'spoilers.descriptions-hint': 'Laat de samenvatting van elke aflevering weg.',
  'spoilers.thumbnails': 'Afbeeldingen van afleveringen vervagen',
  'spoilers.thumbnails-hint': 'Beweeg over een aflevering of selecteer die om even te kijken.',
  'spoilers.ratings': 'Beoordelingen van afleveringen verbergen',
  'spoilers.ratings-hint': 'Een beoordeling kan verraden welke afleveringen ertoe doen.',
  'spoilers.unaired': 'Uitzenddata van komende afleveringen verbergen',
  'spoilers.unaired-hint': 'Afleveringen die nog niet uit zijn, zeggen alleen “Nog niet uitgezonden”.',
  'spoilers.scope': 'Geldt voor',
  'spoilers.scope-hint': 'Afleveringen die je hebt afgekeken of begonnen tonen alles, tenzij je alle afleveringen kiest.',
  'spoilers.scope-unwatched': 'Afleveringen die ik niet heb gezien',
  'spoilers.scope-all': 'Alle afleveringen',
};
