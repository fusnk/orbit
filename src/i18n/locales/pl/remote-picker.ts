import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Polish strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Przeglądaj',
  'remote.phone.browse-loading': 'Wczytywanie strony głównej…',
  'remote.phone.browse-empty': 'Na razie nic tu nie ma. Dodaj w Orbit dodatek z katalogiem, aby wypełnić stronę główną.',
  'remote.phone.browse-failed': 'Nie udało się wczytać strony głównej. Spróbuj ponownie.',
  'remote.phone.refresh': 'Odśwież',
  'remote.phone.moods': 'Na co masz ochotę?',
  'remote.phone.mood-loading': 'Szukanie propozycji…',
  'remote.phone.mood-empty': 'Na razie brak propozycji dla tego nastroju.',
  'remote.phone.surprise': 'Zaskocz mnie',
  'remote.phone.surprise-hint': 'Jedna losowa propozycja z Twoich katalogów.',
  'remote.phone.surprise-movie': 'Film',
  'remote.phone.surprise-series': 'Serial',
  'remote.phone.surprise-none': 'Na razie nie ma nic nowego do zaproponowania. Spróbuj drugiego rodzaju albo zmień wybory „Zaskocz mnie” w Orbit.',
  'remote.phone.details-loading': 'Wczytywanie szczegółów…',
  'remote.phone.details-failed': 'Nie udało się wczytać tego tytułu. Spróbuj ponownie.',
  'remote.phone.add-library': 'Dodaj do biblioteki',
  'remote.phone.in-library': 'W Twojej bibliotece',
  'remote.phone.close': 'Zamknij',
  'remote.phone.season': 'Sezon {number}',
  'remote.phone.specials': 'Odcinki specjalne',
  'remote.phone.episodes': 'Odcinki',
  'remote.phone.rating': 'Ocena IMDb {rating}',
};
