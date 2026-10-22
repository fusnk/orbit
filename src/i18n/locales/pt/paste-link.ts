import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Portuguese strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Reproduzir este link",
  'pastelink.play-magnet': "Reproduzir este link magnet",
  'pastelink.magnet': "Link magnet",
  'pastelink.source': "Link colado",
  'pastelink.detail': "Abre no player. Nada é salvo no seu histórico.",
  'pastelink.torrents-off.title': "Links magnet precisam dos torrents ativados",
  'pastelink.torrents-off.detail': "O Orbit reproduz links magnet com o próprio player de torrents, que está desativado. Você pode ativar os torrents nas Configurações.",
  'pastelink.torrents-off.open': "Abrir Configurações",
};
