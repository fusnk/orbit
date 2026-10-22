import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Czech text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Otevřeno z instalačního odkazu na webu. Než doplněk nainstalujete, zkontrolujte ho níže.',
  'deeplink.unusable': 'Orbit tento odkaz nemůže použít. Otevírají se zde jen instalační odkazy doplňků (končící na manifest.json).',
  'deeplink.after-video': 'Přišel instalační odkaz doplňku. Orbit ho otevře, až video skončí.',
  'deeplink.home-network': 'Ve vaší domácí síti',
  'deeplink.home-network-note': 'Tento odkaz vede na tento počítač nebo na zařízení ve vaší domácí síti. Orbit ho zatím nekontaktoval. Pokračujte, jen pokud tam doplněk očekáváte.',
  'deeplink.continue': 'Pokračovat',
};
