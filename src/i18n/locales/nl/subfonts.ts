import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Voorbeeld',
  'subfonts.preview-hint': 'Een voorbeeld van je ondertitels, zoals de speler ze tekent. Groottes en randen komen dicht bij wat de speler toont, maar niet precies.',
  'subfonts.fullscreen': 'Voorbeeld op volledig scherm',
  'subfonts.fullscreen-close': 'Druk op Esc of klik om te sluiten',
  'subfonts.line1': 'Ik had nooit gedacht dat we zo ver zouden komen.',
  'subfonts.line2': 'Ik ook niet. Laten we doorgaan.',
  'subfonts.font': 'Lettertype',
  'subfonts.font-label': 'Lettertype van ondertitels',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend en OpenDyslexic zijn gemaakt om makkelijker te lezen; ze worden met Orbit meegeleverd. Opgemaakte ondertitels houden hun eigen lettertype.',
  'subfonts.default': 'Standaard',
};
