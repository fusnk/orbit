import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Upuść, aby odtworzyć',
  'local.drop.video-hint': 'Wideo zostanie odtworzone w Orbit.',
  'local.drop.subtitle-hint': 'Napisy zostaną dodane do tego, co jest odtwarzane.',
  'local.drop.first-only': 'Odtwarzanie {name}. Orbit odtwarza jeden plik naraz, więc pozostałe pominięto.',
  'local.drop.failed': 'Nie udało się otworzyć tego pliku.',
  'local.drop.unsupported': 'Orbit nie może odtworzyć tego rodzaju pliku.',
  'local.drop.subtitle-needs-player': 'Najpierw uruchom wideo, a potem upuść na nie napisy.',
  'local.drop.subtitle-added': 'Dodano napisy: {name}',
  'local.drop.subtitle-first-only': 'Dodano napisy: {name}. Użyto tylko pierwszego pliku.',
  'local.drop.subtitle-failed': 'Nie udało się dodać tych napisów.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'tego komputera',
  'local.source.label': 'Plik lokalny',
  // Settings → Player → External player
  'local.external.heading': 'Zewnętrzny odtwarzacz',
  'local.external.player': 'Otwieraj źródła w',
  'local.external.player-hint': 'Dodaje „Otwórz w zewnętrznym odtwarzaczu” do źródeł internetowych w wyborze źródła. Wznawianie, pomijanie czołówki, zapamiętane ścieżki i postęp działają tylko w odtwarzaczu Orbit.',
  'local.external.none': 'Brak',
  'local.external.custom': 'Własny',
  'local.external.found': 'Znaleziono: {path}',
  'local.external.not-found': 'Nie znaleziono w zwykłym folderze instalacji. Wybierz Własny, aby podać jego położenie.',
  'local.external.custom-path': 'Program',
  'local.external.custom-path-hint': 'Plik programu odtwarzacza, wybrany na tym komputerze.',
  'local.external.choose': 'Wybierz…',
  'local.external.custom-invalid': 'Orbit nie może tego uruchomić. Wybierz plik programu odtwarzacza.',
  'local.external.always': 'Zawsze otwieraj w zewnętrznym odtwarzaczu',
  'local.external.always-hint': 'Odtwórz przekazuje mu od razu najlepsze źródło internetowe. Torrenty i pobrane pliki nadal grają w Orbit.',
  // The source picker
  'local.external.open': 'Zewnętrzny',
  'local.external.open-label': 'Otwórz w zewnętrznym odtwarzaczu',
  'local.external.opened': 'Otwarto w zewnętrznym odtwarzaczu.',
  'local.external.failed': 'Zewnętrzny odtwarzacz się nie uruchomił. Sprawdź Ustawienia → Odtwarzacz.',
};
