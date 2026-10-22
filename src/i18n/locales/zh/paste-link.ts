import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Chinese strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "播放此链接",
  'pastelink.play-magnet': "播放此磁力链接",
  'pastelink.magnet': "磁力链接",
  'pastelink.source': "粘贴的链接",
  'pastelink.detail': "在播放器中打开，不会保存到观看记录。",
  'pastelink.torrents-off.title': "磁力链接需要开启种子功能",
  'pastelink.torrents-off.detail': "Orbit 使用内置的种子播放器播放磁力链接，但该功能目前已关闭。你可以在设置中开启种子功能。",
  'pastelink.torrents-off.open': "打开设置",
};
