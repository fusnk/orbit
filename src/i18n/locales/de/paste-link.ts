import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** German strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Diesen Link abspielen",
  'pastelink.play-magnet': "Diesen Magnet-Link abspielen",
  'pastelink.magnet': "Magnet-Link",
  'pastelink.source': "Eingefügter Link",
  'pastelink.detail': "Öffnet sich im Player. Im Wiedergabeverlauf wird nichts gespeichert.",
  'pastelink.torrents-off.title': "Für Magnet-Links müssen Torrents aktiviert sein",
  'pastelink.torrents-off.detail': "Orbit spielt Magnet-Links mit seinem eigenen Torrent-Player ab, der ausgeschaltet ist. Du kannst Torrents in den Einstellungen aktivieren.",
  'pastelink.torrents-off.open': "Einstellungen öffnen",
};
