import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Dutch strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "De instellingen van deze add-on bijwerken?",
  'prfixes.addons.update-detail': "{name} is al geïnstalleerd. Deze instellingen vervangen de oude, en de add-on houdt zijn plek in je lijst.",
  'prfixes.addons.update': "Bijwerken",
  'prfixes.audio.original': "Originele taal eerst",
  'prfixes.audio.original-hint': "Elke film of serie start in de taal waarin hij gemaakt is, als de video die audio heeft: anime in het Japans, een Koreaans drama in het Koreaans. Anders de audiotaal hierboven. Vereist een TMDB-sleutel.",
  'prfixes.bundle.local': "Dit adres leidt naar deze computer of je thuisnetwerk, dus Orbit heeft er geen contact mee gemaakt.",
};
