import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Spanish text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Abierto desde un enlace de instalación de un sitio web. Revisa el complemento antes de instalarlo.',
  'deeplink.unusable': 'Orbit no puede usar ese enlace. Aquí solo se abren enlaces de instalación de complementos (que terminan en manifest.json).',
  'deeplink.after-video': 'Ha llegado un enlace de instalación de complemento. Orbit lo abrirá cuando termine el vídeo.',
  'deeplink.home-network': 'En tu red doméstica',
  'deeplink.home-network-note': 'Este enlace apunta a este ordenador o a un dispositivo de tu red doméstica. Orbit aún no lo ha contactado. Continúa solo si esperas encontrar un complemento ahí.',
  'deeplink.continue': 'Continuar',
};
