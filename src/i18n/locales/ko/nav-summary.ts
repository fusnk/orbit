import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Korean strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} 외 {count}개',
  'navsummary.scale': '배율 {percent}',
  'navsummary.size': '크기 {percent}',
  'navsummary.banner': '배너: {style}',
  'navsummary.watched-at': '{percent}에서 시청 완료',
  'navsummary.spoilers-hidden': '스포일러 숨김',
  'navsummary.spoilers-shown': '스포일러 표시',
  'navsummary.autoplay': '자동 재생: {mode}',
  'navsummary.player-layout': '레이아웃: {name}',
  'navsummary.no-addons': '애드온 없음',
  'navsummary.not-connected': '연결된 서비스 없음',
  'navsummary.downloads.none': '다운로드 없음',
  'navsummary.downloads.done.one': '{count}개 다운로드됨',
  'navsummary.downloads.done.other': '{count}개 다운로드됨',
  'navsummary.downloads.active.one': '{count}개 진행 중',
  'navsummary.downloads.active.other': '{count}개 진행 중',
  'navsummary.shortcuts.one': '단축키 {count}개',
  'navsummary.shortcuts.other': '단축키 {count}개',
};
