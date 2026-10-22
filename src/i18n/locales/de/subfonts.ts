import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Vorschau',
  'subfonts.preview-hint': 'Ein Beispiel deiner Untertitel, so wie der Player sie zeichnet. Größen und Umrandungen kommen dem Player nahe, sind aber nicht exakt.',
  'subfonts.fullscreen': 'Vollbild-Vorschau',
  'subfonts.fullscreen-close': 'Esc drücken oder klicken zum Schließen',
  'subfonts.line1': 'Ich hätte nie gedacht, dass wir so weit kommen.',
  'subfonts.line2': 'Ich auch nicht. Machen wir weiter.',
  'subfonts.font': 'Schriftart',
  'subfonts.font-label': 'Schriftart der Untertitel',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend und OpenDyslexic sind für leichteres Lesen gemacht; sie kommen mit Orbit. Gestaltete Untertitel behalten ihre eigene Schrift.',
  'subfonts.default': 'Standard',
};
