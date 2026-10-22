import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Polish text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'Otwarto z linku instalacyjnego na stronie internetowej. Sprawdź dodatek poniżej, zanim go zainstalujesz.',
  'deeplink.unusable': 'Orbit nie może użyć tego linku. Otwierają się tu tylko linki instalacyjne dodatków (kończące się na manifest.json).',
  'deeplink.after-video': 'Otrzymano link instalacyjny dodatku. Orbit otworzy go, gdy film się skończy.',
  'deeplink.home-network': 'W Twojej sieci domowej',
  'deeplink.home-network-note': 'Ten link wskazuje na ten komputer lub urządzenie w Twojej sieci domowej. Orbit jeszcze się z nim nie łączył. Kontynuuj tylko, jeśli spodziewasz się tam dodatku.',
  'deeplink.continue': 'Dalej',
};
