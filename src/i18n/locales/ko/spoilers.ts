import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': '스포일러',
  'spoilers.intro': '에피소드에서 숨길 항목이에요. 시리즈 페이지, 플레이어의 에피소드 목록, 다음 재생 카드, 이어서 보기에 적용돼요.',
  'spoilers.titles': '에피소드 제목 숨기기',
  'spoilers.titles-hint': '에피소드 이름 대신 “에피소드 4”처럼 표시해요.',
  'spoilers.descriptions': '에피소드 설명 숨기기',
  'spoilers.descriptions-hint': '각 에피소드의 줄거리를 표시하지 않아요.',
  'spoilers.thumbnails': '에피소드 이미지 흐리게',
  'spoilers.thumbnails-hint': '에피소드에 마우스를 올리거나 포커스하면 살짝 볼 수 있어요.',
  'spoilers.ratings': '에피소드 평점 숨기기',
  'spoilers.ratings-hint': '평점을 보면 어떤 에피소드가 중요한지 드러날 수 있어요.',
  'spoilers.unaired': '방영 예정 에피소드의 방영일 숨기기',
  'spoilers.unaired-hint': '아직 공개되지 않은 에피소드에는 “아직 방영 전”만 표시돼요.',
  'spoilers.scope': '적용 대상',
  'spoilers.scope-hint': '모든 에피소드를 선택하지 않으면, 다 봤거나 보기 시작한 에피소드는 모든 정보가 표시돼요.',
  'spoilers.scope-unwatched': '보지 않은 에피소드',
  'spoilers.scope-all': '모든 에피소드',
};
