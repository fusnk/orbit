import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Aperçu',
  'subfonts.preview-hint': 'Un échantillon de vos sous-titres, tels que le lecteur les dessine. Les tailles et contours sont proches de ce que le lecteur affiche, sans être exacts.',
  'subfonts.fullscreen': 'Aperçu en plein écran',
  'subfonts.fullscreen-close': 'Appuyez sur Échap ou cliquez pour fermer',
  'subfonts.line1': 'Je n’aurais jamais cru qu’on irait si loin.',
  'subfonts.line2': 'Moi non plus. Continuons.',
  'subfonts.font': 'Police',
  'subfonts.font-label': 'Police des sous-titres',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend et OpenDyslexic sont conçues pour une lecture plus facile ; elles sont fournies avec Orbit. Les sous-titres stylisés gardent leur propre police.',
  'subfonts.default': 'Par défaut',
};
