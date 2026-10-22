import type { quick as source } from '../en/quick';
import type { Catalog } from '../types';

export const quick: Catalog<typeof source> = {
  'quick.button': '빠른 설정',
  'quick.heading': '빠른 설정',
  'quick.switch-profile': '프로필 전환',
  'quick.pause-history': '시청 기록 일시정지',
  'quick.pause-history-hint': '재생하는 작품이 시청 기록이나 이어서 보기에 추가되지 않고, Stremio, Jellyfin, Plex에도 전송되지 않아요.',
  'quick.look': '룩',
  'quick.look-custom': '사용자 지정',
  'quick.trailers': '예고편 자동 재생',
  'quick.trailers-partly': '작품 페이지나 배너 중 한 곳에서만 켜져 있어요. 켜면 두 곳 모두에서 예고편이 재생돼요.',
  'quick.skip-intros': '인트로 자동 건너뛰기',
  'quick.all-settings': '모든 설정',
  'quick.chip': '기록 일시정지됨',
  'quick.chip-label': '시청 기록이 일시정지됐어요. 빠른 설정 열기',
  'quick.paused': '시청 기록을 일시정지했어요. 지금부터 재생하는 작품은 기록이 남지 않아요.',
  'quick.resumed': '시청 기록이 다시 켜졌어요.',
  'quick.palette.pause': '시청 기록 일시정지',
  'quick.palette.resume': '시청 기록 다시 시작',
};
