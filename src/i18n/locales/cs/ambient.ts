import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  'ambient.label': 'Ambientní režim',
  'ambient.hint.details': 'Enter pro podrobnosti',
  'ambient.slide.resume': 'Pokračovat',
  'ambient.slide.resume-episode': 'Pokračovat: {episode}',
  'ambient.slide.library': 'V mé knihovně',
  'ambient.slide.recent': 'Nedávno sledované',
  'ambient.slide.trending': 'Právě populární',
  'ambient.settings.heading': 'Ambientní režim',
  'ambient.settings.after': 'Spustit po',
  'ambient.settings.after-hint': 'Když tak dlouho nic nestisknete, Orbit přejde do pomalé prezentace obrázků. Nikdy během přehrávání.',
  'ambient.settings.source': 'Co zobrazuje',
  'ambient.settings.source-hint': 'Co sledujete a máte uložené, co je populární, nebo obojí střídavě.',
  'ambient.settings.source-for-you': 'Pro vás',
  'ambient.settings.source-trending': 'Trendy',
  'ambient.settings.source-both': 'Obojí',
  'ambient.settings.clock': 'Zobrazit čas',
  'ambient.settings.clock-hint': 'Čas a datum v rohu.',
  'ambient.settings.paused': 'Také při pozastavení',
  'ambient.settings.paused-hint': 'Spustí se nad přehrávačem, když je tak dlouho pozastavený. Přehrávání zůstane přesně tak, jak bylo.',
  'ambient.settings.preview': 'Náhled',
  'ambient.settings.preview-label': 'Zobrazit hned',
  'ambient.settings.preview-hint': 'Ambientní režim se spustí okamžitě. Vrátíte se stiskem libovolné klávesy nebo pohybem myši.',
};
