import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Polish strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} i {count} więcej',
  'navsummary.scale': 'Skala {percent}',
  'navsummary.size': 'Rozmiar {percent}',
  'navsummary.banner': 'Baner: {style}',
  'navsummary.watched-at': 'Obejrzane przy {percent}',
  'navsummary.spoilers-hidden': 'Spoilery ukryte',
  'navsummary.spoilers-shown': 'Spoilery widoczne',
  'navsummary.autoplay': 'Autoodtwarzanie: {mode}',
  'navsummary.player-layout': 'Układ: {name}',
  'navsummary.no-addons': 'Brak dodatków',
  'navsummary.not-connected': 'Nic nie połączono',
  'navsummary.downloads.none': 'Brak pobrań',
  'navsummary.downloads.done.one': 'Pobrane: {count}',
  'navsummary.downloads.done.few': 'Pobrane: {count}',
  'navsummary.downloads.done.many': 'Pobrane: {count}',
  'navsummary.downloads.done.other': 'Pobrane: {count}',
  'navsummary.downloads.active.one': 'W toku: {count}',
  'navsummary.downloads.active.few': 'W toku: {count}',
  'navsummary.downloads.active.many': 'W toku: {count}',
  'navsummary.downloads.active.other': 'W toku: {count}',
  'navsummary.shortcuts.one': '{count} skrót',
  'navsummary.shortcuts.few': '{count} skróty',
  'navsummary.shortcuts.many': '{count} skrótów',
  'navsummary.shortcuts.other': '{count} skrótu',
};
