import type { subfonts as source } from '../en/subfonts';
import type { Catalog } from '../types';

export const subfonts: Catalog<typeof source> = {
  'subfonts.preview': 'Förhandsvisning',
  'subfonts.preview-hint': 'Ett exempel på dina undertexter, så som spelaren ritar dem. Storlekar och konturer ligger nära, men inte exakt, det spelaren visar.',
  'subfonts.fullscreen': 'Förhandsvisning i helskärm',
  'subfonts.fullscreen-close': 'Tryck på Esc eller klicka för att stänga',
  'subfonts.line1': 'Jag trodde aldrig att vi skulle komma så här långt.',
  'subfonts.line2': 'Inte jag heller. Vi fortsätter.',
  'subfonts.font': 'Typsnitt',
  'subfonts.font-label': 'Undertexttypsnitt',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend och OpenDyslexic är gjorda för enklare läsning; de följer med Orbit. Formaterade undertexter behåller sitt eget typsnitt.',
  'subfonts.default': 'Standard',
};
