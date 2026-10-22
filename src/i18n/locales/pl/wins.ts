import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** Polish strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'Od',
  'explore.filters.year-to': 'Do',
  'explore.filters.runtime': 'Czas trwania',
  'explore.filters.runtime-min': 'Co najmniej',
  'explore.filters.runtime-max': 'Najwyżej',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Obsada',
  'explore.filters.director': 'Reżyseria lub ekipa',
  'explore.filters.person-search': 'Szukaj osób: {what}',
  'explore.filters.person-placeholder': 'Wpisz imię i nazwisko',
  'explore.filters.person-none': 'Nikogo nie znaleziono',
  'explore.filters.person-clear': 'Usuń: {name}',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Bufor przewijania wstecz',
  'settings.player.rewind-hint': 'Ile filmu zostaje w pamięci, by cofanie było natychmiastowe. Więcej zajmuje podczas odtwarzania do ok. 600 MB RAM, Najwięcej do ok. 1,5 GB. Działa od następnego filmu.',
  'settings.player.rewind-standard': 'Standardowy',
  'settings.player.rewind-more': 'Więcej',
  'settings.player.rewind-most': 'Najwięcej',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Krycie tekstu',
  'subs.style.box-colour': 'Kolor tła',
  'subs.style.box-opacity': 'Krycie tła',
  'subs.style.box-opacity-hint': 'Tło ma proste narożniki: odtwarzacz nie potrafi rysować zaokrąglonych.',
  'subs.style.outline-colour': 'Kolor obrysu',
  'player.subtitle-style.black': 'Czarny',
  'player.subtitle-style.grey': 'Szary',
  'player.subtitle-style.navy': 'Granatowy',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'Brak odpowiedzi',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} zainstalowany',
  'addons.health.installed.other': '{count} zainstalowanych',
  'addons.health.installed.few': '{count} zainstalowane',
  'addons.health.installed.many': '{count} zainstalowanych',
  'addons.health.enabled.one': '{count} włączony',
  'addons.health.enabled.other': '{count} włączonych',
  'addons.health.enabled.few': '{count} włączone',
  'addons.health.enabled.many': '{count} włączonych',
  'addons.health.refresh': 'Odśwież dodatek',
  'addons.health.refreshing': 'Odświeżanie: {name}…',
  'addons.health.refreshed': 'Zaktualizowano: {name}.',
  'addons.health.unchanged': '{name} odpowiada: bez zmian.',
  'addons.health.refresh-failed': '{name} nie odpowiedział. Orbit dalej używa tego, co miał.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Minimalny rozmiar',
  'sources.rules.min-size-hint': 'Dla filmów; odcinki dostają jedną trzecią. Mniejsze pliki, często podróbki lub nagrania z kina, trafiają za wszystkie inne, ale nigdy nie są ukrywane. Nie dotyczy źródeł, które nie podają rozmiaru.',
  'titles.why.under-size': 'Poniżej Twojego minimum {size} GB',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Znajdź kolekcję',
  'collections.search.placeholder': 'Znajdź kolekcję',
  'collections.search.none': 'Żadna kolekcja nie pasuje',
  'collections.search.none-detail': 'Przeszukiwane są nazwy i grupy.',
  'collections.search.titles-label': 'Znajdź tytuł w tej kolekcji',
  'collections.search.titles-placeholder': 'Znajdź tytuł',
  'collections.search.no-titles': 'Żaden tytuł nie pasuje',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Eksportuj do kalendarza (.ics)',
  'radar.export.hint': 'Zapisuje to, co pokazuje Radar, w pliku, który zaimportuje każda aplikacja kalendarza.',
  'radar.export.name': 'Radar premier Orbit',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} za {seconds}',
  'playerplus.settings.skip-delay': 'Czekaj przed automatycznym pominięciem',
  'playerplus.settings.skip-delay-hint': 'Dla fragmentów ustawionych na Automatycznie: przycisk Pomiń najpierw odlicza. Naciśnij dowolny klawisz, by przerwać i oglądać.',
  'playerplus.settings.skip-delay-none': 'Od razu',
};
