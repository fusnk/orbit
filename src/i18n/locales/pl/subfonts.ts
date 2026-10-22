import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Podgląd',
  'subfonts.preview-hint': 'Próbka Twoich napisów, tak jak rysuje je odtwarzacz. Rozmiary i obrysy są zbliżone do tego, co pokazuje odtwarzacz, ale nie identyczne.',
  'subfonts.fullscreen': 'Podgląd na pełnym ekranie',
  'subfonts.fullscreen-close': 'Naciśnij Esc lub kliknij, aby zamknąć',
  'subfonts.line1': 'Nigdy nie sądziłem, że zajdziemy tak daleko.',
  'subfonts.line2': 'Ja też nie. Idźmy dalej.',
  'subfonts.font': 'Czcionka',
  'subfonts.font-label': 'Czcionka napisów',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend i OpenDyslexic ułatwiają czytanie; są dołączone do Orbita. Napisy ze stylem zachowują własną czcionkę.',
  'subfonts.default': 'Domyślna',
};
