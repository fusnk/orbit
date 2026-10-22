import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Ukrainian strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Відтворити це посилання",
  'pastelink.play-magnet': "Відтворити це magnet-посилання",
  'pastelink.magnet': "Magnet-посилання",
  'pastelink.source': "Вставлене посилання",
  'pastelink.detail': "Відкриється в плеєрі. В історію перегляду нічого не зберігається.",
  'pastelink.torrents-off.title': "Для magnet-посилань потрібно увімкнути торенти",
  'pastelink.torrents-off.detail': "Orbit відтворює magnet-посилання власним торент-плеєром, але його вимкнено. Торенти можна увімкнути в налаштуваннях.",
  'pastelink.torrents-off.open': "Відкрити налаштування",
};
