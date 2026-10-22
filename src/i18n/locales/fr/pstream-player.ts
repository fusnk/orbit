import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** French strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Plus lent',
  'pstream.keys.speed-up': 'Plus rapide',
  'pstream.keys.seek-back-small': 'Reculer d’1 seconde (en pause : une image)',
  'pstream.keys.seek-forward-small': 'Avancer d’1 seconde (en pause : une image)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Se termine à {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Revenir à {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Parties à passer',
  'pstream.chapters.to-end': '{from} – fin',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Marquer {episode} comme vu',
  'pstream.episodes.mark-unwatched': 'Marquer {episode} comme non vu',
  'pstream.episodes.watched': 'Vu',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Bonne correspondance',
  'pstream.subs.match-fair': 'Correspondance moyenne',
  'pstream.subs.match-poor': 'Mauvaise correspondance',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, en secondes',
  'pstream.timing.type': '{name} : {value}. Activez pour saisir une valeur',
  'pstream.timing.invalid': 'Saisissez des secondes, comme 1,5 ou -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Décalage des sous-titres remis à zéro pour les nouveaux sous-titres',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Style des sous-titres',
  'pstream.style.position': 'Position',
  'pstream.style.custom': 'Personnalisée…',
  'pstream.style.hex': 'Code couleur, comme #ffcc00',
  'pstream.style.caps-note': 'S’applique aux sous-titres ajoutés à partir de maintenant.',
  'pstream.style.more': 'L’opacité du texte, la couleur et l’opacité du fond et la couleur du contour se règlent dans Réglages → Sous-titres.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Réessayer',
  'pstream.error.retry-at': 'Réessayer à partir de {time}',
  'pstream.error.copy': 'Copier les détails',
  'pstream.error.copied': 'Détails copiés. Les adresses et les clés ont été retirées.',
  'pstream.error.copy-failed': 'Impossible de copier les détails',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Double-clic sur les côtés pour sauter',
  'pstream.settings.double-click-hint': 'Double-cliquez sur le tiers gauche ou droit de l’image pour reculer ou avancer de la durée d’un saut. Le centre bascule toujours en plein écran.',
};
