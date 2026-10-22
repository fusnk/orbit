import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Dutch text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Geopend via een installatielink op een website. Controleer de add-on hieronder voordat je hem installeert.',
  'deeplink.unusable': 'Orbit kan deze link niet gebruiken. Alleen installatielinks van add-ons (eindigend op manifest.json) openen hier.',
  'deeplink.after-video': 'Er is een installatielink voor een add-on binnengekomen. Orbit opent hem zodra de video is afgelopen.',
  'deeplink.home-network': 'Op je thuisnetwerk',
  'deeplink.home-network-note': 'Deze link wijst naar deze computer of naar een apparaat op je thuisnetwerk. Orbit heeft er nog geen contact mee gemaakt. Ga alleen verder als je daar een add-on verwacht.',
  'deeplink.continue': 'Doorgaan',
};
