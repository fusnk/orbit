import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  // Settings → Playback → Autoplay limits (per profile)
  'sources.limits.heading': '자동 재생 제한',
  'sources.limits.any': '제한 없음',
  'sources.limits.min-quality': '자동 재생 최소 화질',
  'sources.limits.min-quality-hint': '재생과 다음 에피소드는 이 화질 이상인 소스만 시작해요(화질 정보가 없는 소스는 제외). 맞는 소스가 없으면 가장 좋은 소스를 재생하고 알려 드려요. 소스 목록에는 여전히 모두 표시돼요. 이 프로필에만 적용돼요.',
  'sources.limits.max-quality': '자동 재생 최대 화질',
  'sources.limits.max-quality-hint': '다른 소스를 찾지 못한 경우가 아니면, 재생과 다음 에피소드는 이보다 높은 화질의 소스를 시작하지 않아요. “선호하는 최고 화질”과 달리 소스 목록 순서는 바꾸지 않아요. 이 프로필에만 적용돼요.',
  'sources.limits.max-size': '자동 재생 최대 파일 크기',
  'sources.limits.max-size-hint': '느린 연결이나 데이터 제한이 있을 때 유용해요. 재생과 다음 에피소드는 이보다 큰 파일을 건너뛰어요. 크기 정보가 없는 소스는 영향을 받지 않아요. 이 프로필에만 적용돼요.',
  // Toasts when a source is picked automatically
  'sources.autoplay.outside-limits': '자동 재생 제한에 맞는 소스가 없어서 가장 좋은 소스를 재생하고 있어요.',
  'sources.autoplay.only-uncached': '찾은 소스가 모두 아직 Debrid 서비스로 다운로드 중이에요. 시작하려면 하나를 선택하세요.',
  // Quiet tags in the source list
  'sources.note.uncached': '캐시 안 됨',
  'sources.note.uncached-hint': '아직 Debrid 서비스로 다운로드 중: 자동으로 시작되지 않아요',
  'sources.note.outside-limits': '자동 재생 제한 밖',
  'sources.note.outside-limits-hint': '재생과 다음 에피소드에서 건너뛰어요(설정 → 애드온 및 소스 → 소스 기본 설정 → 자동 재생 제한)',
  // The Next Up card, for an episode whose air date isn't confirmed
  'sources.next-up.unaired': '다음 재생 · 방영일 미확정',
};
