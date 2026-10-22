import type { subfonts as source } from '../en/subfonts';
import type { Catalog } from '../types';

export const subfonts: Catalog<typeof source> = {
  'subfonts.preview': '미리 보기',
  'subfonts.preview-hint': '플레이어가 그리는 방식대로 보여 주는 자막 샘플이에요. 크기와 테두리는 플레이어 화면과 비슷하지만 똑같지는 않아요.',
  'subfonts.fullscreen': '전체 화면 미리 보기',
  'subfonts.fullscreen-close': 'Esc를 누르거나 클릭해서 닫기',
  'subfonts.line1': '우리가 여기까지 올 줄은 몰랐어.',
  'subfonts.line2': '나도 그래. 계속 가 보자.',
  'subfonts.font': '글꼴',
  'subfonts.font-label': '자막 글꼴',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend, OpenDyslexic은 읽기 쉽게 만들어진 글꼴로 Orbit에 포함되어 있어요. 스타일이 적용된 자막은 자체 글꼴을 유지해요.',
  'subfonts.default': '기본',
};
