import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** German strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Die Einstellungen dieses Add-ons aktualisieren?",
  'prfixes.addons.update-detail': "{name} ist bereits installiert. Diese Einstellungen ersetzen die alten, und das Add-on behält seinen Platz in deiner Liste.",
  'prfixes.addons.update': "Aktualisieren",
  'prfixes.audio.original': "Originalsprache zuerst",
  'prfixes.audio.original-hint': "Jeder Film und jede Serie startet in der Sprache, in der sie gedreht wurde, wenn das Video diese Tonspur hat: Anime auf Japanisch, ein koreanisches Drama auf Koreanisch. Sonst die Audiosprache oben. Braucht einen TMDB-Schlüssel.",
  'prfixes.bundle.local': "Diese Adresse führt zu diesem Computer oder in dein Heimnetz, deshalb hat Orbit sie nicht kontaktiert.",
};
