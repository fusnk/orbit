import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Italian strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Riproduci questo link",
  'pastelink.play-magnet': "Riproduci questo link magnet",
  'pastelink.magnet': "Link magnet",
  'pastelink.source': "Link incollato",
  'pastelink.detail': "Si apre nel lettore. Non viene salvato nulla nella cronologia.",
  'pastelink.torrents-off.title': "I link magnet richiedono i torrent attivi",
  'pastelink.torrents-off.detail': "Orbit riproduce i link magnet con il proprio lettore torrent, che è disattivato. Puoi attivare i torrent nelle Impostazioni.",
  'pastelink.torrents-off.open': "Apri Impostazioni",
};
