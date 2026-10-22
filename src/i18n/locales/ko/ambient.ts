import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  // The idle screen itself
  'ambient.label': '앰비언트 모드',
  'ambient.hint.details': 'Enter를 눌러 자세히 보기',
  'ambient.slide.resume': '이어서 재생',
  'ambient.slide.resume-episode': '{episode} 이어서 재생',
  'ambient.slide.library': '내 라이브러리에 있음',
  'ambient.slide.recent': '최근 시청',
  'ambient.slide.trending': '지금 인기',
  // Settings → Appearance → Ambient mode
  'ambient.settings.heading': '앰비언트 모드',
  'ambient.settings.after': '시작까지 대기 시간',
  'ambient.settings.after-hint': '이 시간 동안 아무것도 누르지 않으면 Orbit이 천천히 넘어가는 아트워크 슬라이드쇼로 바뀌어요. 재생 중에는 시작되지 않아요.',
  'ambient.settings.source': '표시할 내용',
  'ambient.settings.source-hint': '시청 중이거나 저장한 작품, 인기 작품, 또는 둘을 번갈아 보여 줘요.',
  'ambient.settings.source-for-you': '맞춤 추천',
  'ambient.settings.source-trending': '인기',
  'ambient.settings.source-both': '모두',
  'ambient.settings.clock': '시계 표시',
  'ambient.settings.clock-hint': '구석에 시간과 날짜를 표시해요.',
  'ambient.settings.paused': '일시정지 중에도',
  'ambient.settings.paused-hint': '이 시간 동안 일시정지되어 있으면 플레이어 위에서 시작해요. 재생 상태는 그대로 유지돼요.',
  'ambient.settings.preview': '미리 보기',
  'ambient.settings.preview-label': '지금 보기',
  'ambient.settings.preview-hint': '앰비언트 모드를 바로 시작해요. 돌아오려면 아무 키나 누르거나 마우스를 움직이세요.',
};
