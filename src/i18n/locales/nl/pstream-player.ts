import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** Dutch strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Langzamer',
  'pstream.keys.speed-up': 'Sneller',
  'pstream.keys.seek-back-small': '1 seconde terug (gepauzeerd: één beeld)',
  'pstream.keys.seek-forward-small': '1 seconde vooruit (gepauzeerd: één beeld)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Eindigt om {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Terug naar {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Delen om over te slaan',
  'pstream.chapters.to-end': '{from} – einde',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': '{episode} als bekeken markeren',
  'pstream.episodes.mark-unwatched': '{episode} als niet bekeken markeren',
  'pstream.episodes.watched': 'Bekeken',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Goede match',
  'pstream.subs.match-fair': 'Redelijke match',
  'pstream.subs.match-poor': 'Slechte match',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, in seconden',
  'pstream.timing.type': '{name}: {value}. Activeer om een waarde te typen',
  'pstream.timing.invalid': 'Typ seconden, zoals 1,5 of -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Ondertiteltiming teruggezet voor de nieuwe ondertiteling',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Ondertitelstijl',
  'pstream.style.position': 'Positie',
  'pstream.style.custom': 'Eigen…',
  'pstream.style.hex': 'Kleurcode, zoals #ffcc00',
  'pstream.style.caps-note': 'Geldt voor ondertiteling die je vanaf nu toevoegt.',
  'pstream.style.more': 'Dekking van tekst, kleur en dekking van het vak en kleur van de omlijning stel je in bij Instellingen → Ondertiteling.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Opnieuw proberen',
  'pstream.error.retry-at': 'Opnieuw proberen vanaf {time}',
  'pstream.error.copy': 'Details kopiëren',
  'pstream.error.copied': 'Details gekopieerd. Adressen en sleutels zijn weggelaten.',
  'pstream.error.copy-failed': 'Kan de details niet kopiëren',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Dubbelklik op de zijkanten om te springen',
  'pstream.settings.double-click-hint': 'Dubbelklik op het linker- of rechterderde van het beeld om de ingestelde sprongafstand terug of vooruit te springen. Het midden schakelt nog steeds naar volledig scherm.',
};
