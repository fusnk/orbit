import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Italian strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} e altri {count}',
  'navsummary.scale': 'Scala {percent}',
  'navsummary.size': 'Dimensione {percent}',
  'navsummary.banner': 'Banner {style}',
  'navsummary.watched-at': 'Visto al {percent}',
  'navsummary.spoilers-hidden': 'Spoiler nascosti',
  'navsummary.spoilers-shown': 'Spoiler visibili',
  'navsummary.autoplay': 'Riproduzione automatica: {mode}',
  'navsummary.player-layout': 'Layout {name}',
  'navsummary.no-addons': 'Nessun componente aggiuntivo',
  'navsummary.not-connected': 'Nessun collegamento',
  'navsummary.downloads.none': 'Nessun download',
  'navsummary.downloads.done.one': '{count} scaricato',
  'navsummary.downloads.done.other': '{count} scaricati',
  'navsummary.downloads.active.one': '{count} in corso',
  'navsummary.downloads.active.other': '{count} in corso',
  'navsummary.shortcuts.one': '{count} scorciatoia',
  'navsummary.shortcuts.other': '{count} scorciatoie',
};
