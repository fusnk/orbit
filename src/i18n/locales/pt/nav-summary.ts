import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Portuguese strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} e mais {count}',
  'navsummary.scale': 'Escala {percent}',
  'navsummary.size': 'Tamanho {percent}',
  'navsummary.banner': 'Banner {style}',
  'navsummary.watched-at': 'Assistido aos {percent}',
  'navsummary.spoilers-hidden': 'Spoilers ocultos',
  'navsummary.spoilers-shown': 'Spoilers visíveis',
  'navsummary.autoplay': 'Reprodução automática: {mode}',
  'navsummary.player-layout': 'Layout {name}',
  'navsummary.no-addons': 'Nenhum complemento',
  'navsummary.not-connected': 'Nada conectado ainda',
  'navsummary.downloads.none': 'Nenhum download ainda',
  'navsummary.downloads.done.one': '{count} baixado',
  'navsummary.downloads.done.other': '{count} baixados',
  'navsummary.downloads.active.one': '{count} em andamento',
  'navsummary.downloads.active.other': '{count} em andamento',
  'navsummary.shortcuts.one': '{count} atalho',
  'navsummary.shortcuts.other': '{count} atalhos',
};
