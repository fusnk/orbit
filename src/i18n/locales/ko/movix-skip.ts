import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "AniSkip의 애니메이션 건너뛰기 시간",
  'movix.aniskip-hint': "애니메이션은 무료 커뮤니티 데이터베이스인 AniSkip에도 오프닝, 엔딩, 지난 줄거리 위치를 물어봐요. 작품의 MyAnimeList ID와 회차 번호만 보내요. 작품을 찾기 위해 GitHub에서 공개 ID 목록을 내려받을 수 있어요. 직접 켜기 전에는 꺼져 있어요.",
  'movix.smooth': "부드럽게 건너뛰기",
  'movix.smooth-hint': "건너뛸 때 화면이 잠깐 검게 바뀌고 소리가 작아졌다가 다시 돌아와요. 동작 줄이기가 켜져 있으면 바로 건너뛰어요.",
  'movix.button-delay': "건너뛰기 버튼 표시 시점",
  'movix.button-delay-hint': "인트로나 크레딧이 조금 재생된 뒤에 건너뛰기를 보여 주어 버튼이 장면의 끝을 가리지 않게 해요. 자동 건너뛰기는 기다리지 않아요.",
  'movix.button-delay-none': "바로",
  'movix.landing': "끝나기 전에 멈추기",
  'movix.landing-hint': "인트로나 지난 줄거리가 끝나기 조금 전에 멈춰, 바로 다음 장면이 잘리지 않게 해요. 끝까지 이어지는 크레딧은 여전히 끝으로 이동해요.",
  'movix.landing-none': "끝에서",
  'movix.color-intro': "인트로 색상",
  'movix.color-recap': "지난 줄거리 색상",
  'movix.color-credits': "엔딩 크레딧 색상",
  'movix.color-preview': "예고 색상",
  'movix.colors-hint': "탐색 막대에서 각 부분이 보이는 색이에요.",
  'movix.swatch.default': "기본",
  'movix.swatch.amber': "앰버",
  'movix.swatch.sky': "하늘색",
  'movix.swatch.mint': "민트",
  'movix.swatch.rose': "로즈",
  'movix.swatch.violet': "바이올렛",
  'movix.swatch.white': "흰색",
};
