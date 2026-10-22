import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Polish strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Odtwórz ten link",
  'pastelink.play-magnet': "Odtwórz ten link magnet",
  'pastelink.magnet': "Link magnet",
  'pastelink.source': "Wklejony link",
  'pastelink.detail': "Otworzy się w odtwarzaczu. Nic nie zostanie zapisane w historii oglądania.",
  'pastelink.torrents-off.title': "Linki magnet wymagają włączenia torrentów",
  'pastelink.torrents-off.detail': "Orbit odtwarza linki magnet własnym odtwarzaczem torrentów, który jest wyłączony. Torrenty możesz włączyć w Ustawieniach.",
  'pastelink.torrents-off.open': "Otwórz Ustawienia",
};
