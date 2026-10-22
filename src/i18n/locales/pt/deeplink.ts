import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Portuguese text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Aberto a partir de um link de instalação em um site. Verifique o complemento abaixo antes de instalá-lo.',
  'deeplink.unusable': 'O Orbit não pode usar esse link. Aqui só abrem links de instalação de complementos (terminados em manifest.json).',
  'deeplink.after-video': 'Chegou um link de instalação de complemento. O Orbit o abrirá quando o vídeo terminar.',
  'deeplink.home-network': 'Na sua rede doméstica',
  'deeplink.home-network-note': 'Este link aponta para este computador ou para um dispositivo da sua rede doméstica. O Orbit ainda não o contatou. Continue apenas se você espera encontrar um complemento lá.',
  'deeplink.continue': 'Continuar',
};
