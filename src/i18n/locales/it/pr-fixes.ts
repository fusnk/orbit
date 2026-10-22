import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Italian strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Aggiornare le impostazioni di questo componente aggiuntivo?",
  'prfixes.addons.update-detail': "{name} è già installato. Queste impostazioni sostituiscono le precedenti e il componente aggiuntivo mantiene il suo posto nell’elenco.",
  'prfixes.addons.update': "Aggiorna",
  'prfixes.audio.original': "Prima la lingua originale",
  'prfixes.audio.original-hint': "Ogni film o serie parte nella lingua in cui è stato girato, se il video ha quell’audio: gli anime in giapponese, un drama coreano in coreano. Altrimenti la lingua audio qui sopra. Richiede una chiave TMDB.",
  'prfixes.bundle.local': "Questo indirizzo porta a questo computer o alla tua rete di casa, quindi Orbit non l’ha contattato.",
};
