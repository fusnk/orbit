import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** German text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Über einen Installationslink auf einer Website geöffnet. Prüfe das Add-on unten, bevor du es installierst.',
  'deeplink.unusable': 'Orbit kann diesen Link nicht verwenden. Hier öffnen sich nur Installationslinks für Add-ons (die auf manifest.json enden).',
  'deeplink.after-video': 'Ein Installationslink für ein Add-on ist eingegangen. Orbit öffnet ihn, sobald das Video endet.',
  'deeplink.home-network': 'In deinem Heimnetz',
  'deeplink.home-network-note': 'Dieser Link zeigt auf diesen Computer oder ein Gerät in deinem Heimnetz. Orbit hat es noch nicht kontaktiert. Fahre nur fort, wenn du dort ein Add-on erwartest.',
  'deeplink.continue': 'Weiter',
};
