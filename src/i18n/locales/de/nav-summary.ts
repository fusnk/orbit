import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** German strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} + {count} weitere',
  'navsummary.scale': 'Skalierung {percent}',
  'navsummary.size': 'Größe {percent}',
  'navsummary.banner': 'Banner: {style}',
  'navsummary.watched-at': 'Gesehen ab {percent}',
  'navsummary.spoilers-hidden': 'Spoiler verborgen',
  'navsummary.spoilers-shown': 'Spoiler sichtbar',
  'navsummary.autoplay': 'Autoplay: {mode}',
  'navsummary.player-layout': 'Layout: {name}',
  'navsummary.no-addons': 'Keine Add-ons',
  'navsummary.not-connected': 'Noch nichts verbunden',
  'navsummary.downloads.none': 'Noch keine Downloads',
  'navsummary.downloads.done.one': '{count} heruntergeladen',
  'navsummary.downloads.done.other': '{count} heruntergeladen',
  'navsummary.downloads.active.one': '{count} läuft',
  'navsummary.downloads.active.other': '{count} laufen',
  'navsummary.shortcuts.one': '{count} Tastenkürzel',
  'navsummary.shortcuts.other': '{count} Tastenkürzel',
};
