import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Korean strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "플레이어 색상",
  'playercolour.seek-label': "탐색 막대 색상",
  'playercolour.hint': "플레이어 탐색 막대의 색상이에요. 강조색은 테마를 따르며, 나머지 스타일은 테마 스튜디오에서 바꿀 수 있어요.",
};
