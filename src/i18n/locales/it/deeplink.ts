import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Italian text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Aperto da un link di installazione su un sito web. Controlla il componente aggiuntivo qui sotto prima di installarlo.',
  'deeplink.unusable': 'Orbit non può usare questo link. Qui si aprono solo i link di installazione dei componenti aggiuntivi (che terminano con manifest.json).',
  'deeplink.after-video': 'È arrivato un link di installazione di un componente aggiuntivo. Orbit lo aprirà alla fine del video.',
  'deeplink.home-network': 'Sulla tua rete domestica',
  'deeplink.home-network-note': 'Questo link punta a questo computer o a un dispositivo della tua rete domestica. Orbit non l’ha ancora contattato. Continua solo se ti aspetti un componente aggiuntivo lì.',
  'deeplink.continue': 'Continua',
};
