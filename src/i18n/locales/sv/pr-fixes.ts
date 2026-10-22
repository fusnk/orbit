import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Swedish strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Uppdatera inställningarna för det här tillägget?",
  'prfixes.addons.update-detail': "{name} är redan installerat. De här inställningarna ersätter de gamla, och tillägget behåller sin plats i listan.",
  'prfixes.addons.update': "Uppdatera",
  'prfixes.audio.original': "Originalspråk först",
  'prfixes.audio.original-hint': "Varje film eller serie startar på språket den gjordes på, om videon har det ljudet: anime på japanska, ett koreanskt drama på koreanska. Annars ljudspråket ovan. Kräver en TMDB-nyckel.",
  'prfixes.bundle.local': "Den här adressen leder till den här datorn eller ditt hemnätverk, så Orbit kontaktade den inte.",
};
