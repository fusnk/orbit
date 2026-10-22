import type { pasteLink as source } from '../en/paste-link';
import type { Catalog } from '../types';

/** Korean strings for playing a pasted stream or magnet link from Search or the command palette. */
export const pasteLink: Catalog<typeof source> = {
  'pastelink.play': "이 링크 재생",
  'pastelink.play-magnet': "이 마그넷 링크 재생",
  'pastelink.magnet': "마그넷 링크",
  'pastelink.source': "붙여 넣은 링크",
  'pastelink.detail': "플레이어에서 열려요. 시청 기록에는 아무것도 저장되지 않아요.",
  'pastelink.torrents-off.title': "마그넷 링크를 재생하려면 토렌트를 켜야 해요",
  'pastelink.torrents-off.detail': "Orbit은 자체 토렌트 플레이어로 마그넷 링크를 재생하는데, 지금은 꺼져 있어요. 설정에서 토렌트를 켤 수 있어요.",
  'pastelink.torrents-off.open': "설정 열기",
};
