import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** Spanish strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Más lento',
  'pstream.keys.speed-up': 'Más rápido',
  'pstream.keys.seek-back-small': 'Atrás 1 segundo (en pausa: un fotograma)',
  'pstream.keys.seek-forward-small': 'Adelante 1 segundo (en pausa: un fotograma)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Termina a las {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Volver a {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Partes que puedes saltar',
  'pstream.chapters.to-end': '{from} – final',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Marcar {episode} como visto',
  'pstream.episodes.mark-unwatched': 'Marcar {episode} como no visto',
  'pstream.episodes.watched': 'Visto',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Buena coincidencia',
  'pstream.subs.match-fair': 'Coincidencia aceptable',
  'pstream.subs.match-poor': 'Mala coincidencia',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, en segundos',
  'pstream.timing.type': '{name}: {value}. Actívalo para escribir un valor',
  'pstream.timing.invalid': 'Escribe segundos, como 1,5 o -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Sincronía de los subtítulos restablecida para los nuevos subtítulos',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Estilo de subtítulos',
  'pstream.style.position': 'Posición',
  'pstream.style.custom': 'Personalizado…',
  'pstream.style.hex': 'Código de color, como #ffcc00',
  'pstream.style.caps-note': 'Se aplica a los subtítulos que se añadan a partir de ahora.',
  'pstream.style.more': 'La opacidad del texto, el color y la opacidad del recuadro y el color del contorno están en Ajustes → Subtítulos.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Reintentar',
  'pstream.error.retry-at': 'Reintentar desde {time}',
  'pstream.error.copy': 'Copiar detalles',
  'pstream.error.copied': 'Detalles copiados. Se omitieron direcciones y claves.',
  'pstream.error.copy-failed': 'No se pudieron copiar los detalles',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Doble clic en los lados para saltar',
  'pstream.settings.double-click-hint': 'Haz doble clic en el tercio izquierdo o derecho de la imagen para retroceder o avanzar lo que dura un salto. El centro sigue cambiando a pantalla completa.',
};
