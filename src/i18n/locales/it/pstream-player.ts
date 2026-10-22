import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** Italian strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Più lento',
  'pstream.keys.speed-up': 'Più veloce',
  'pstream.keys.seek-back-small': 'Indietro di 1 secondo (in pausa: un fotogramma)',
  'pstream.keys.seek-forward-small': 'Avanti di 1 secondo (in pausa: un fotogramma)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Finisce alle {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Torna a {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Parti da saltare',
  'pstream.chapters.to-end': '{from} – fine',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Segna {episode} come visto',
  'pstream.episodes.mark-unwatched': 'Segna {episode} come non visto',
  'pstream.episodes.watched': 'Visto',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Buona corrispondenza',
  'pstream.subs.match-fair': 'Corrispondenza discreta',
  'pstream.subs.match-poor': 'Corrispondenza scarsa',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, in secondi',
  'pstream.timing.type': '{name}: {value}. Attiva per digitare un valore',
  'pstream.timing.invalid': 'Digita i secondi, ad esempio 1,5 o -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Sincronizzazione azzerata per i nuovi sottotitoli',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Stile dei sottotitoli',
  'pstream.style.position': 'Posizione',
  'pstream.style.custom': 'Personalizzato…',
  'pstream.style.hex': 'Codice colore, ad esempio #ffcc00',
  'pstream.style.caps-note': 'Vale per i sottotitoli aggiunti da ora in poi.',
  'pstream.style.more': 'Opacità del testo, colore e opacità del riquadro e colore del contorno sono in Impostazioni → Sottotitoli.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Riprova',
  'pstream.error.retry-at': 'Riprova da {time}',
  'pstream.error.copy': 'Copia i dettagli',
  'pstream.error.copied': 'Dettagli copiati. Indirizzi e chiavi sono stati omessi.',
  'pstream.error.copy-failed': 'Impossibile copiare i dettagli',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Doppio clic sui lati per saltare',
  'pstream.settings.double-click-hint': 'Fai doppio clic sul terzo sinistro o destro dell’immagine per tornare indietro o andare avanti di un salto. Il centro attiva ancora lo schermo intero.',
};
