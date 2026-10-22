import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Swedish strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Spela upp den här länken",
  'pastelink.play-magnet': "Spela upp den här magnetlänken",
  'pastelink.magnet': "Magnetlänk",
  'pastelink.source': "Inklistrad länk",
  'pastelink.detail': "Öppnas i spelaren. Inget sparas i din tittarhistorik.",
  'pastelink.torrents-off.title': "Magnetlänkar kräver att torrenter är påslagna",
  'pastelink.torrents-off.detail': "Orbit spelar upp magnetlänkar med sin egen torrentspelare, som är avstängd. Du kan slå på Torrents i Inställningar.",
  'pastelink.torrents-off.open': "Öppna Inställningar",
};
