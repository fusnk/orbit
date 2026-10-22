import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** French strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} et {count} de plus',
  'navsummary.scale': 'Échelle {percent}',
  'navsummary.size': 'Taille {percent}',
  'navsummary.banner': 'Bannière {style}',
  'navsummary.watched-at': 'Vu à {percent}',
  'navsummary.spoilers-hidden': 'Spoilers masqués',
  'navsummary.spoilers-shown': 'Spoilers visibles',
  'navsummary.autoplay': 'Lecture auto : {mode}',
  'navsummary.player-layout': 'Disposition {name}',
  'navsummary.no-addons': 'Aucun add-on',
  'navsummary.not-connected': 'Rien de connecté',
  'navsummary.downloads.none': 'Aucun téléchargement',
  'navsummary.downloads.done.one': '{count} téléchargé',
  'navsummary.downloads.done.other': '{count} téléchargés',
  'navsummary.downloads.active.one': '{count} en cours',
  'navsummary.downloads.active.other': '{count} en cours',
  'navsummary.shortcuts.one': '{count} raccourci',
  'navsummary.shortcuts.other': '{count} raccourcis',
};
