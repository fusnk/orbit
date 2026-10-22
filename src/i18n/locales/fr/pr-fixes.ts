import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** French strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Mettre à jour les réglages de cet add-on ?",
  'prfixes.addons.update-detail': "{name} est déjà installé. Ces réglages remplacent les anciens, et il garde sa place dans votre liste.",
  'prfixes.addons.update': "Mettre à jour",
  'prfixes.audio.original': "Langue originale d’abord",
  'prfixes.audio.original-hint': "Chaque film ou série démarre dans sa langue d’origine quand la vidéo a cette piste audio : l’anime en japonais, un drama coréen en coréen. Sinon, la langue audio ci-dessus. Nécessite une clé TMDB.",
  'prfixes.bundle.local': "Cette adresse mène à cet ordinateur ou à votre réseau domestique, donc Orbit ne l’a pas contactée.",
};
