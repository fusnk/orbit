import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** French strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Lire ce lien",
  'pastelink.play-magnet': "Lire ce lien magnet",
  'pastelink.magnet': "Lien magnet",
  'pastelink.source': "Lien collé",
  'pastelink.detail': "S’ouvre dans le lecteur. Rien n’est enregistré dans votre historique.",
  'pastelink.torrents-off.title': "Les liens magnet nécessitent d’activer les torrents",
  'pastelink.torrents-off.detail': "Orbit lit les liens magnet avec son propre lecteur torrent, qui est désactivé. Vous pouvez activer les torrents dans les Réglages.",
  'pastelink.torrents-off.open': "Ouvrir les Réglages",
};
