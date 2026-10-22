import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Vista previa',
  'subfonts.preview-hint': 'Una muestra de tus subtítulos, tal como los dibuja el reproductor. Los tamaños y contornos se aproximan a lo que muestra el reproductor, no son exactos.',
  'subfonts.fullscreen': 'Vista previa a pantalla completa',
  'subfonts.fullscreen-close': 'Pulsa Esc o haz clic para cerrar',
  'subfonts.line1': 'Nunca pensé que llegaríamos tan lejos.',
  'subfonts.line2': 'Yo tampoco. Sigamos adelante.',
  'subfonts.font': 'Fuente',
  'subfonts.font-label': 'Fuente de los subtítulos',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend y OpenDyslexic están hechas para leer con más facilidad; vienen con Orbit. Los subtítulos con estilo conservan su propia fuente.',
  'subfonts.default': 'Predeterminada',
};
