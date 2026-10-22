import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': '가장 잘 맞음',
  'subs.error.sdh': '청각 장애인용 텍스트 설정을 적용하지 못했어요',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': '청각 장애인용 텍스트 제거',
  'subs.settings.strip-sdh-hint': '[문 삐걱거림] 같은 소리 설명, 음악 표시, JOHN: 같은 화자 이름을 자막에서 숨겨요. 비게 된 줄은 건너뛰고, 타이밍은 그대로예요.',
  'subs.settings.keep-lyrics': '노래 가사 유지',
  'subs.settings.keep-lyrics-hint': '청각 장애인용 텍스트를 제거해도 ♪로 표시된 노래 가사는 남겨요. 음표만 있는 줄은 그래도 제거돼요.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': '자막을 아래쪽에 고정하지 못했어요',
  'subs.player.position': '자막 위치',
  'subs.player.height': '높이',
  'subs.player.raised': '{value}% 위로',
  'subs.player.reset': '아래쪽으로 초기화',
  'subs.player.keep-bottom': '아래쪽에 고정',
  'subs.player.keep-bottom-hint': '일반 자막(SRT 등)은 파일의 위치 정보를 무시하므로 모든 줄이 이 높이에 표시돼요. 동영상에 포함된 일반 자막은 기울임꼴도 사라져요. 스타일 자막(애니메이션에 흔한 ASS)은 자체 레이아웃을 유지해요. 모든 동영상에 적용되도록 기억돼요.',
};
