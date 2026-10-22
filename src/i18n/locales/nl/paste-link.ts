import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Dutch strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Deze link afspelen",
  'pastelink.play-magnet': "Deze magnetlink afspelen",
  'pastelink.magnet': "Magnetlink",
  'pastelink.source': "Geplakte link",
  'pastelink.detail': "Opent in de speler. Er wordt niets in je kijkgeschiedenis bewaard.",
  'pastelink.torrents-off.title': "Voor magnetlinks moeten torrents aan staan",
  'pastelink.torrents-off.detail': "Orbit speelt magnetlinks af met een eigen torrentspeler, en die staat uit. Je kunt torrents aanzetten in Instellingen.",
  'pastelink.torrents-off.open': "Instellingen openen",
};
