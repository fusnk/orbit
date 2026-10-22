import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** German strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Langsamer',
  'pstream.keys.speed-up': 'Schneller',
  'pstream.keys.seek-back-small': '1 Sekunde zurück (pausiert: ein Bild)',
  'pstream.keys.seek-forward-small': '1 Sekunde vor (pausiert: ein Bild)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Endet um {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Zurück zu {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Überspringbare Teile',
  'pstream.chapters.to-end': '{from} – Ende',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': '{episode} als gesehen markieren',
  'pstream.episodes.mark-unwatched': '{episode} als nicht gesehen markieren',
  'pstream.episodes.watched': 'Gesehen',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Passt gut',
  'pstream.subs.match-fair': 'Passt einigermaßen',
  'pstream.subs.match-poor': 'Passt schlecht',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, in Sekunden',
  'pstream.timing.type': '{name}: {value}. Aktivieren, um einen Wert einzugeben',
  'pstream.timing.invalid': 'Gib Sekunden ein, z. B. 1,5 oder -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Untertitel-Timing für die neuen Untertitel zurückgesetzt',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Untertitelstil',
  'pstream.style.position': 'Position',
  'pstream.style.custom': 'Eigene…',
  'pstream.style.hex': 'Farbcode, z. B. #ffcc00',
  'pstream.style.caps-note': 'Gilt für Untertitel, die ab jetzt hinzukommen.',
  'pstream.style.more': 'Textdeckkraft, Kastenfarbe und -deckkraft sowie Konturfarbe findest du unter Einstellungen → Untertitel.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Erneut versuchen',
  'pstream.error.retry-at': 'Ab {time} erneut versuchen',
  'pstream.error.copy': 'Details kopieren',
  'pstream.error.copied': 'Details kopiert. Adressen und Schlüssel wurden weggelassen.',
  'pstream.error.copy-failed': 'Details konnten nicht kopiert werden',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Doppelklick an den Seiten springt',
  'pstream.settings.double-click-hint': 'Ein Doppelklick auf das linke oder rechte Drittel des Bildes springt um die Sprungweite zurück oder vor. Die Mitte schaltet weiterhin den Vollbildmodus um.',
};
