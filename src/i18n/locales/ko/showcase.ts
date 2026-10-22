import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // Settings → Appearance → Title page.
  'showcase.setting.label': '작품 페이지',
  'showcase.setting.hint': '클래식은 이미지를 카드 안에 보여 줘요. 쇼케이스는 이미지를 창 전체에 펼치고 상세 정보는 아래 섹션에 보여 줘요.',
  'showcase.setting.classic': '클래식',
  'showcase.setting.showcase': '쇼케이스',
  // The hero.
  'showcase.start-episode': 'S{season} · E{episode} 시작',
  'showcase.ends-at': '{time} 종료',
  'showcase.ends-at-hint': '지금 시작하면 끝나는 시각',
  'showcase.age-rating': '{rating} 등급',
  'showcase.streaming-on': '{provider}에서 스트리밍 중',
  // Episodes.
  'showcase.choose-season': '시즌',
  'showcase.choose-arc': '스토리 아크',
  'showcase.episode-count.one': '에피소드 {count}개',
  'showcase.episode-count.other': '에피소드 {count}개',
  'showcase.episode-length': '{number} · {minutes}분',
  'showcase.season-actions': '시즌 작업',
  'showcase.download-season.one': '시즌 다운로드 (에피소드 {count}개)',
  'showcase.download-season.other': '시즌 다운로드 (에피소드 {count}개)',
  // Sections.
  'showcase.extras': '예고편 및 부가 영상',
  'showcase.cast-crew': '출연진 및 제작진',
  'showcase.photos': '사진',
  'showcase.stills': '스틸컷',
  'showcase.topics': '주제',
  'showcase.topic-intro': 'TMDB에서 “{topic}” 태그가 달린 영화와 시리즈예요.',
  'showcase.where-to-watch': '시청 가능한 곳',
  'showcase.stream': '스트리밍',
  'showcase.rent': '대여',
  'showcase.buy': '구매',
  'showcase.justwatch': '데이터 제공: JustWatch',
  'showcase.releases': '공개일',
  'showcase.cinemas-only': '아직 극장에서만 상영 중이에요. 초기 영상은 대개 극장에서 촬영한 버전이에요.',
};
