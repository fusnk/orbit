import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Russian strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "Воспроизвести эту ссылку",
  'pastelink.play-magnet': "Воспроизвести эту magnet-ссылку",
  'pastelink.magnet': "Magnet-ссылка",
  'pastelink.source': "Вставленная ссылка",
  'pastelink.detail': "Откроется в плеере. В историю просмотра ничего не сохраняется.",
  'pastelink.torrents-off.title': "Для magnet-ссылок нужно включить торренты",
  'pastelink.torrents-off.detail': "Orbit воспроизводит magnet-ссылки своим торрент-плеером, а он выключен. Торренты можно включить в настройках.",
  'pastelink.torrents-off.open': "Открыть настройки",
};
