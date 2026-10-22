import type { pstreamPlayer as source } from '../en/pstream-player';
import type { Catalog } from '../types';

/** Portuguese strings for the player additions inspired by P-Stream. */
export const pstreamPlayer: Catalog<typeof source> = {
  // Speed and fine-seek shortcuts (lib/keymap.ts, settings/shortcuts.ts, player/cheat-sheet.ts)
  'pstream.keys.speed-down': 'Mais lento',
  'pstream.keys.speed-up': 'Mais rápido',
  'pstream.keys.seek-back-small': 'Voltar 1 segundo (pausado: um quadro)',
  'pstream.keys.seek-forward-small': 'Avançar 1 segundo (pausado: um quadro)',
  // Pause screen (player/pause-info.ts)
  'pstream.pause.ends': 'Termina às {time}',
  // Undo after a skip (player/skip-controller.ts)
  'pstream.skip.back': 'Voltar para {time}',
  // Skip segments in the Chapters view (player/panels.ts)
  'pstream.chapters.segments': 'Partes que você pode pular',
  'pstream.chapters.to-end': '{from} – fim',
  // Episodes panel and docked list (player/panels.ts, player/episode-dock.ts)
  'pstream.episodes.mark-watched': 'Marcar {episode} como assistido',
  'pstream.episodes.mark-unwatched': 'Marcar {episode} como não assistido',
  'pstream.episodes.watched': 'Assistido',
  // Addon subtitle rows (player/tracks.ts)
  'pstream.subs.sdh': 'SDH',
  'pstream.subs.match-good': 'Boa correspondência',
  'pstream.subs.match-fair': 'Correspondência razoável',
  'pstream.subs.match-poor': 'Correspondência fraca',
  // Typing a timing (player/panels.ts)
  'pstream.timing.field': '{name}, em segundos',
  'pstream.timing.type': '{name}: {value}. Ative para digitar um valor',
  'pstream.timing.invalid': 'Digite segundos, como 1,5 ou -2',
  // Subtitle timing kept per subtitle file (player/panel-controller.ts)
  'pstream.timing.reset': 'Sincronização redefinida para as novas legendas',
  // Subtitle style in the player (player/panels.ts)
  'pstream.style.title': 'Estilo das legendas',
  'pstream.style.position': 'Posição',
  'pstream.style.custom': 'Personalizada…',
  'pstream.style.hex': 'Código da cor, como #ffcc00',
  'pstream.style.caps-note': 'Vale para as legendas adicionadas a partir de agora.',
  'pstream.style.more': 'Opacidade do texto, cor e opacidade da caixa e cor do contorno ficam em Configurações → Legendas.',
  // Playback error screen (player/index.ts)
  'pstream.error.retry': 'Tentar novamente',
  'pstream.error.retry-at': 'Tentar novamente a partir de {time}',
  'pstream.error.copy': 'Copiar detalhes',
  'pstream.error.copied': 'Detalhes copiados. Endereços e chaves foram omitidos.',
  'pstream.error.copy-failed': 'Não foi possível copiar os detalhes',
  // Settings → Player (settings/player.ts)
  'pstream.settings.double-click': 'Clique duplo nas laterais para pular',
  'pstream.settings.double-click-hint': 'Clique duas vezes no terço esquerdo ou direito da imagem para voltar ou avançar um salto. O centro continua alternando a tela cheia.',
};
