import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Swedish text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Öppnades från en installationslänk på en webbplats. Kontrollera tillägget nedan innan du installerar det.',
  'deeplink.unusable': 'Orbit kan inte använda den länken. Här öppnas bara installationslänkar för tillägg (som slutar på manifest.json).',
  'deeplink.after-video': 'En installationslänk för ett tillägg kom in. Orbit öppnar den när videon är slut.',
  'deeplink.home-network': 'I ditt hemnätverk',
  'deeplink.home-network-note': 'Den här länken pekar på den här datorn eller en enhet i ditt hemnätverk. Orbit har inte kontaktat den än. Fortsätt bara om du väntar dig ett tillägg där.',
  'deeplink.continue': 'Fortsätt',
};
