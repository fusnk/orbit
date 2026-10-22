import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Swedish strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} + {count} till',
  'navsummary.scale': 'Skala {percent}',
  'navsummary.size': 'Storlek {percent}',
  'navsummary.banner': 'Banner: {style}',
  'navsummary.watched-at': 'Sedd vid {percent}',
  'navsummary.spoilers-hidden': 'Spoilers dolda',
  'navsummary.spoilers-shown': 'Spoilers visas',
  'navsummary.autoplay': 'Autouppspelning: {mode}',
  'navsummary.player-layout': 'Layout: {name}',
  'navsummary.no-addons': 'Inga tillägg',
  'navsummary.not-connected': 'Inget anslutet än',
  'navsummary.downloads.none': 'Inga nedladdningar än',
  'navsummary.downloads.done.one': '{count} nedladdad',
  'navsummary.downloads.done.other': '{count} nedladdade',
  'navsummary.downloads.active.one': '{count} pågår',
  'navsummary.downloads.active.other': '{count} pågår',
  'navsummary.shortcuts.one': '{count} kortkommando',
  'navsummary.shortcuts.other': '{count} kortkommandon',
};
