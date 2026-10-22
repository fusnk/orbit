import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Korean strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': '플레이어의 모양, 컨트롤 동작, 다른 플레이어.',
  'settingslayout.intro.playback': '재생 누르기, 다음 에피소드, 건너뛰기, 예고편.',
  'settingslayout.intro.appearance': '룩, 색상, 메뉴, 배경, 작품 페이지, 포스터.',
  'settingslayout.keywords.player': '플레이어 레이아웃 컨트롤 탐색 막대 이동 볼륨 증폭 최소화 전체 화면 미리보기 되감기 외부 vlc mpv',
  'settingslayout.chapter.library': '라이브러리',
  'settingslayout.chapter.starting': '동영상 시작',
  'settingslayout.chapter.skip-tuning': '건너뛰기 세부 조정',
  'settingslayout.chapter.player-look': '모양',
  'settingslayout.chapter.player-controls': '컨트롤',
  'settingslayout.chapter.player-window': '창 및 기타',
  'settingslayout.chapter.subtitle-text': '언어 및 텍스트',
  'settingslayout.chapter.choosing-source': '소스 고르기',
  'settingslayout.chapter.ranking-rules': '정렬 규칙',
  'settingslayout.preview': '미리보기',
  'settingslayout.none': '없음',
};
