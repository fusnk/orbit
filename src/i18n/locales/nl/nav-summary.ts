import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Dutch strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} + nog {count}',
  'navsummary.scale': 'Schaal {percent}',
  'navsummary.size': 'Grootte {percent}',
  'navsummary.banner': 'Banner: {style}',
  'navsummary.watched-at': 'Gezien bij {percent}',
  'navsummary.spoilers-hidden': 'Spoilers verborgen',
  'navsummary.spoilers-shown': 'Spoilers zichtbaar',
  'navsummary.autoplay': 'Automatisch afspelen: {mode}',
  'navsummary.player-layout': 'Indeling: {name}',
  'navsummary.no-addons': 'Geen add-ons',
  'navsummary.not-connected': 'Nog niets gekoppeld',
  'navsummary.downloads.none': 'Nog geen downloads',
  'navsummary.downloads.done.one': '{count} gedownload',
  'navsummary.downloads.done.other': '{count} gedownload',
  'navsummary.downloads.active.one': '{count} bezig',
  'navsummary.downloads.active.other': '{count} bezig',
  'navsummary.shortcuts.one': '{count} sneltoets',
  'navsummary.shortcuts.other': '{count} sneltoetsen',
};
