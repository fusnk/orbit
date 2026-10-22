import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Korean strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "이 애드온의 설정을 업데이트할까요?",
  'prfixes.addons.update-detail': "{name}은(는) 이미 설치되어 있어요. 이 설정이 이전 설정을 대체하고, 목록에서의 위치는 그대로예요.",
  'prfixes.addons.update': "업데이트",
  'prfixes.audio.original': "원어 우선",
  'prfixes.audio.original-hint': "영상에 해당 오디오가 있으면 영화나 시리즈를 제작된 언어로 시작해요. 애니메이션은 일본어, 한국 드라마는 한국어로요. 없으면 위의 오디오 언어를 써요. TMDB 키가 필요해요.",
  'prfixes.bundle.local': "이 주소는 이 컴퓨터나 홈 네트워크로 연결되므로 Orbit이 접속하지 않았어요.",
};
