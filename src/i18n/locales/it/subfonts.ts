import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Anteprima',
  'subfonts.preview-hint': 'Un esempio dei tuoi sottotitoli, come li disegna il lettore. Dimensioni e contorni sono vicini a quelli del lettore, non identici.',
  'subfonts.fullscreen': 'Anteprima a schermo intero',
  'subfonts.fullscreen-close': 'Premi Esc o fai clic per chiudere',
  'subfonts.line1': 'Non avrei mai pensato di arrivare fin qui.',
  'subfonts.line2': 'Nemmeno io. Andiamo avanti.',
  'subfonts.font': 'Carattere',
  'subfonts.font-label': 'Carattere dei sottotitoli',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend e OpenDyslexic sono pensati per una lettura più facile; sono inclusi in Orbit. I sottotitoli con stile mantengono il proprio carattere.',
  'subfonts.default': 'Predefinito',
};
