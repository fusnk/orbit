import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** Polish strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Wolniej',
  'pstream.keys.speed-up': 'Szybciej',
  'pstream.keys.seek-back-small': 'Do tyłu o 1 sekundę (podczas pauzy: o klatkę)',
  'pstream.keys.seek-forward-small': 'Do przodu o 1 sekundę (podczas pauzy: o klatkę)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Koniec o {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Wróć do {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Części do pominięcia',
  'pstream.chapters.to-end': '{from} – koniec',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Oznacz {episode} jako obejrzany',
  'pstream.episodes.mark-unwatched': 'Oznacz {episode} jako nieobejrzany',
  'pstream.episodes.watched': 'Obejrzany',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Dobre dopasowanie',
  'pstream.subs.match-fair': 'Częściowe dopasowanie',
  'pstream.subs.match-poor': 'Słabe dopasowanie',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, w sekundach',
  'pstream.timing.type': '{name}: {value}. Aktywuj, aby wpisać wartość',
  'pstream.timing.invalid': 'Wpisz sekundy, np. 1,5 lub -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Przesunięcie napisów wyzerowane dla nowych napisów',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Styl napisów',
  'pstream.style.position': 'Położenie',
  'pstream.style.custom': 'Własny…',
  'pstream.style.hex': 'Kod koloru, np. #ffcc00',
  'pstream.style.caps-note': 'Dotyczy napisów dodanych od teraz.',
  'pstream.style.more': 'Krycie tekstu, kolor i krycie tła oraz kolor obrysu znajdziesz w Ustawienia → Napisy.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Spróbuj ponownie',
  'pstream.error.retry-at': 'Spróbuj ponownie od {time}',
  'pstream.error.copy': 'Kopiuj szczegóły',
  'pstream.error.copied': 'Skopiowano szczegóły. Adresy i klucze zostały pominięte.',
  'pstream.error.copy-failed': 'Nie udało się skopiować szczegółów',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Podwójne kliknięcie po bokach przewija',
  'pstream.settings.double-click-hint': 'Podwójne kliknięcie lewej lub prawej części obrazu przewija o jeden skok do tyłu lub do przodu. Środek nadal przełącza pełny ekran.',
};
