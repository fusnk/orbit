import type { playerColour as source } from '../en/player-colour';
import type { Catalog } from '../types';

/** Chinese strings for the seek bar's colour shown right in Settings (Appearance and Player). */
export const playerColour: Catalog<typeof source> = {
  'playercolour.label': "播放器颜色",
  'playercolour.seek-label': "进度条颜色",
  'playercolour.hint': "播放器进度条的颜色。“强调色”跟随主题；其余样式可在主题工作室中修改。",
};
