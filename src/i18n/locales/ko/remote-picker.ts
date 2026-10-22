import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Korean strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': '둘러보기',
  'remote.phone.browse-loading': '홈을 불러오는 중…',
  'remote.phone.browse-empty': '아직 보여줄 게 없어요. Orbit에서 카탈로그 애드온을 추가하면 홈이 채워져요.',
  'remote.phone.browse-failed': '홈을 불러오지 못했어요. 다시 시도해 주세요.',
  'remote.phone.refresh': '새로고침',
  'remote.phone.moods': '오늘은 어떤 기분이에요?',
  'remote.phone.mood-loading': '추천을 찾는 중…',
  'remote.phone.mood-empty': '지금은 이 기분에 맞는 추천이 없어요.',
  'remote.phone.surprise': '깜짝 추천',
  'remote.phone.surprise-hint': '카탈로그에서 무작위로 하나 골라 드려요.',
  'remote.phone.surprise-movie': '영화',
  'remote.phone.surprise-series': '시리즈',
  'remote.phone.surprise-none': '지금은 새로 추천할 작품이 없어요. 다른 종류를 시도하거나 Orbit에서 깜짝 추천 조건을 바꿔 보세요.',
  'remote.phone.details-loading': '상세 정보를 불러오는 중…',
  'remote.phone.details-failed': '이 작품을 불러오지 못했어요. 다시 시도해 주세요.',
  'remote.phone.add-library': '라이브러리에 추가',
  'remote.phone.in-library': '라이브러리에 있음',
  'remote.phone.close': '닫기',
  'remote.phone.season': '시즌 {number}',
  'remote.phone.specials': '스페셜',
  'remote.phone.episodes': '에피소드',
  'remote.phone.rating': 'IMDb 평점 {rating}',
};
