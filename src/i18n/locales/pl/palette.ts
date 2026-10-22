import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Paleta poleceń',
  'palette.placeholder': 'Szukaj tytułów, ustawień, dodatków i akcji',
  // Group headings
  'palette.group.recent': 'Ostatnie',
  'palette.group.suggested': 'Propozycje',
  'palette.group.yours': 'Twoje',
  'palette.group.titles': 'Tytuły',
  'palette.group.settings': 'Ustawienia',
  'palette.group.addons': 'Dodatki',
  'palette.group.actions': 'Akcje',
  // Titles from addons, while typing
  'palette.titles.searching': 'Szukanie w dodatkach…',
  'palette.titles.none': 'Nie znaleziono tytułów',
  'palette.titles.none-can-search': 'Żaden z twoich dodatków nie umie szukać',
  'palette.titles.failed': 'Twoje dodatki nie mogły teraz wyszukać',
  'palette.search-all': 'Wszystkie wyniki dla „{query}”',
  'palette.no-match': 'Nic nie pasuje do „{query}”',
  // Where a title of yours was found
  'palette.from.continue': 'Oglądaj dalej',
  'palette.from.library': 'W twojej bibliotece',
  'palette.from.queue': 'W twojej kolejce',
  'palette.from.downloads': 'Pobrane',
  'palette.from.watched': 'Obejrzane',
  'palette.from.list': 'Lista',
  // What a result is
  'palette.kind.page': 'Strona',
  'palette.kind.shortcut': 'Skrót · {key}',
  'palette.kind.addon': 'Dodatek',
  'palette.kind.category': 'Ustawienia',
  'palette.kind.setting': 'Ustawienia · {category}',
  'palette.setting-hidden': '„{setting}” pojawi się po zmianie „{parent}”.',
  'palette.kind.movie': 'Film',
  'palette.kind.series': 'Serial',
  'palette.kind.title': 'Tytuł',
  // Actions
  'palette.action.profile': 'Zmień profil',
  'palette.action.shortcuts': 'Skróty klawiszowe',
  'palette.action.install-addon': 'Zainstaluj dodatek…',
  'palette.action.addon-updates': 'Sprawdź aktualizacje dodatków',
  // The key hints along the bottom
  'palette.hint.move': 'Przejdź',
  'palette.hint.open': 'Otwórz',
  'palette.hint.groups': 'Następna grupa',
  'palette.hint.close': 'Zamknij',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'język uruchamianie otwieranie zamykanie okno zasobnik skala powiększenie ruch efekty dostępność powiadomienia kopia zapasowa przywracanie diagnostyka dzienniki import trakt letterboxd',
  'palette.keywords.playback': 'autoodtwarzanie następny odcinek wznów pomiń czołówkę zwiastun',
  'palette.keywords.addons': 'instalacja sklep rozszerzenia wtyczki źródła jakość torrenty unikaj preferuj',
  'palette.keywords.downloads': 'offline miejsce folder jakość',
  'palette.keywords.appearance': 'motyw kolory akcent czcionka ciemny jasny tapeta ambient logo style',
  'palette.keywords.shortcuts': 'klawiatura skróty klawisze zmiana przypisania',
  'palette.keywords.home-library': 'anime strona główna rzędy obejrzane oglądaj dalej spoilery wątki fabularne biblioteka metadane',
  'palette.keywords.subtitles': 'napisy język wymuszone synchronizacja niesłyszący teksty piosenek czcionka rozmiar kolor',
  'palette.keywords.picture-sound': 'obraz wideo dekodowanie sprzętowe hdr dźwięk audio język passthrough głośność',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord serwisy streamingowe synchronizacja konto debrid tmdb integracje iptv telewizja na żywo kanały m3u xtream program',
  // Settings → Shortcuts
  'palette.shortcut': 'Paleta poleceń',
};
