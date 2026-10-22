import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Japanese strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "プレーヤーの色",
  'playercolour.seek-label': "シークバーの色",
  'playercolour.hint': "プレーヤーのシークバーの色です。「アクセント」はテーマに合わせます。そのほかのスタイルはテーマスタジオで変更できます。",
};
