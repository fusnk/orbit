import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Czech strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Přehrát tento odkaz",
  'pastelink.play-magnet': "Přehrát tento magnet odkaz",
  'pastelink.magnet': "Magnet odkaz",
  'pastelink.source': "Vložený odkaz",
  'pastelink.detail': "Otevře se v přehrávači. Do historie sledování se nic neuloží.",
  'pastelink.torrents-off.title': "Magnet odkazy vyžadují zapnuté torrenty",
  'pastelink.torrents-off.detail': "Orbit přehrává magnet odkazy vlastním torrentovým přehrávačem, který je vypnutý. Torrenty můžete zapnout v Nastavení.",
  'pastelink.torrents-off.open': "Otevřít Nastavení",
};
