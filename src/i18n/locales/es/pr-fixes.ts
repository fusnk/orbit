import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Spanish strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "¿Actualizar los ajustes de este complemento?",
  'prfixes.addons.update-detail': "{name} ya está instalado. Estos ajustes sustituyen a los anteriores y conserva su lugar en tu lista.",
  'prfixes.addons.update': "Actualizar",
  'prfixes.audio.original': "Primero el idioma original",
  'prfixes.audio.original-hint': "Cada película o serie empieza en el idioma en que se hizo, si el vídeo tiene ese audio: el anime en japonés, un drama coreano en coreano. Si no, el idioma de audio de arriba. Necesita una clave de TMDB.",
  'prfixes.bundle.local': "Esta dirección lleva a este ordenador o a tu red doméstica, así que Orbit no se ha conectado a ella.",
};
