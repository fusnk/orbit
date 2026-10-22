import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Czech strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} a {count} další',
  'navsummary.scale': 'Měřítko {percent}',
  'navsummary.size': 'Velikost {percent}',
  'navsummary.banner': 'Banner: {style}',
  'navsummary.watched-at': 'Zhlédnuto při {percent}',
  'navsummary.spoilers-hidden': 'Spoilery skryté',
  'navsummary.spoilers-shown': 'Spoilery viditelné',
  'navsummary.autoplay': 'Automatické přehrávání: {mode}',
  'navsummary.player-layout': 'Rozvržení: {name}',
  'navsummary.no-addons': 'Žádné doplňky',
  'navsummary.not-connected': 'Nic není připojeno',
  'navsummary.downloads.none': 'Zatím žádná stahování',
  'navsummary.downloads.done.one': 'Staženo: {count}',
  'navsummary.downloads.done.few': 'Staženo: {count}',
  'navsummary.downloads.done.other': 'Staženo: {count}',
  'navsummary.downloads.active.one': 'Probíhá: {count}',
  'navsummary.downloads.active.few': 'Probíhá: {count}',
  'navsummary.downloads.active.other': 'Probíhá: {count}',
  'navsummary.shortcuts.one': '{count} zkratka',
  'navsummary.shortcuts.few': '{count} zkratky',
  'navsummary.shortcuts.other': '{count} zkratek',
};
