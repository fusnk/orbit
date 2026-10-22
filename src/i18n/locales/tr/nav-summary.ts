import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Turkish strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} + {count} tane daha',
  'navsummary.scale': 'Ölçek {percent}',
  'navsummary.size': 'Boyut {percent}',
  'navsummary.banner': 'Banner: {style}',
  'navsummary.watched-at': 'İzlendi sayılır: {percent}',
  'navsummary.spoilers-hidden': 'Spoiler gizli',
  'navsummary.spoilers-shown': 'Spoiler görünür',
  'navsummary.autoplay': 'Otomatik oynatma: {mode}',
  'navsummary.player-layout': 'Düzen: {name}',
  'navsummary.no-addons': 'Eklenti yok',
  'navsummary.not-connected': 'Henüz bağlı bir şey yok',
  'navsummary.downloads.none': 'Henüz indirme yok',
  'navsummary.downloads.done.one': '{count} indirildi',
  'navsummary.downloads.done.other': '{count} indirildi',
  'navsummary.downloads.active.one': '{count} sürüyor',
  'navsummary.downloads.active.other': '{count} sürüyor',
  'navsummary.shortcuts.one': '{count} kısayol',
  'navsummary.shortcuts.other': '{count} kısayol',
};
