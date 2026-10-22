import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** French text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Ouvert depuis un lien d’installation sur un site web. Vérifiez l’add-on ci-dessous avant de l’installer.',
  'deeplink.unusable': 'Orbit ne peut pas utiliser ce lien. Seuls les liens d’installation d’add-ons (se terminant par manifest.json) s’ouvrent ici.',
  'deeplink.after-video': 'Un lien d’installation d’add-on est arrivé. Orbit l’ouvrira à la fin de la vidéo.',
  'deeplink.home-network': 'Sur votre réseau domestique',
  'deeplink.home-network-note': 'Ce lien pointe vers cet ordinateur ou vers un appareil de votre réseau domestique. Orbit ne l’a pas encore contacté. Continuez seulement si vous y attendez un add-on.',
  'deeplink.continue': 'Continuer',
};
