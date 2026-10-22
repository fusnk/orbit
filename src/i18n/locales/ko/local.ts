import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // The overlay while files are dragged over the window
  'local.drop.title': '놓아서 재생',
  'local.drop.video-hint': 'Orbit에서 영상을 재생해요.',
  'local.drop.subtitle-hint': '재생 중인 영상에 자막을 추가해요.',
  'local.drop.first-only': '{name} 재생 중. Orbit은 한 번에 파일 하나만 재생하므로 나머지는 제외됐어요.',
  'local.drop.failed': '이 파일을 열 수 없어요.',
  'local.drop.unsupported': 'Orbit에서 재생할 수 없는 파일 형식이에요.',
  'local.drop.subtitle-needs-player': '먼저 영상을 재생한 다음 자막을 끌어다 놓으세요.',
  'local.drop.subtitle-added': '자막 추가됨: {name}',
  'local.drop.subtitle-first-only': '자막 추가됨: {name}. 첫 번째 파일만 사용했어요.',
  'local.drop.subtitle-failed': '이 자막을 추가할 수 없어요.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': '이 PC',
  'local.source.label': '로컬 파일',
  // Settings → Player → External player
  'local.external.heading': '외부 플레이어',
  'local.external.player': '소스를 열 플레이어',
  'local.external.player-hint': '소스 선택기의 웹 소스에 “외부 플레이어에서 열기”를 추가해요. 이어서 재생, 인트로 건너뛰기, 트랙 기억, 시청 진행 상황은 Orbit 자체 플레이어에서만 작동해요.',
  'local.external.none': '없음',
  'local.external.custom': '사용자 지정',
  'local.external.found': '찾음: {path}',
  'local.external.not-found': '일반적인 설치 폴더에서 찾지 못했어요. 사용자 지정을 선택해 위치를 지정하세요.',
  'local.external.custom-path': '프로그램',
  'local.external.custom-path-hint': '이 PC에서 고른 플레이어 프로그램 파일이에요.',
  'local.external.choose': '선택…',
  'local.external.custom-invalid': 'Orbit에서 실행할 수 없어요. 플레이어 프로그램 파일을 골라 주세요.',
  'local.external.always': '항상 외부 플레이어에서 열기',
  'local.external.always-hint': '재생을 누르면 최적의 웹 소스를 바로 외부 플레이어로 넘겨요. 토렌트와 다운로드는 계속 Orbit에서 재생돼요.',
  // The source picker
  'local.external.open': '외부',
  'local.external.open-label': '외부 플레이어에서 열기',
  'local.external.opened': '외부 플레이어에서 열었어요.',
  'local.external.failed': '외부 플레이어가 시작되지 않았어요. 설정 → 플레이어를 확인해 주세요.',
};
