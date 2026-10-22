import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Spanish strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} y {count} más',
  'navsummary.scale': 'Escala {percent}',
  'navsummary.size': 'Tamaño {percent}',
  'navsummary.banner': 'Banner {style}',
  'navsummary.watched-at': 'Visto al {percent}',
  'navsummary.spoilers-hidden': 'Spoilers ocultos',
  'navsummary.spoilers-shown': 'Spoilers visibles',
  'navsummary.autoplay': 'Reproducción automática: {mode}',
  'navsummary.player-layout': 'Diseño {name}',
  'navsummary.no-addons': 'Sin complementos',
  'navsummary.not-connected': 'Nada conectado aún',
  'navsummary.downloads.none': 'Aún no hay descargas',
  'navsummary.downloads.done.one': '{count} descargado',
  'navsummary.downloads.done.other': '{count} descargados',
  'navsummary.downloads.active.one': '{count} en curso',
  'navsummary.downloads.active.other': '{count} en curso',
  'navsummary.shortcuts.one': '{count} atajo',
  'navsummary.shortcuts.other': '{count} atajos',
};
