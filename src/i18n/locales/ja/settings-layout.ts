import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Japanese strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'プレーヤーの見た目、操作の動き、ほかのプレーヤー。',
  'settingslayout.intro.playback': '再生ボタン、次のエピソード、スキップ、予告編。',
  'settingslayout.intro.appearance': 'ルック、色、メニュー、背景、作品ページ、ポスター。',
  'settingslayout.keywords.player': 'プレーヤー レイアウト 操作 シークバー ジャンプ 音量 ブースト 最小化 全画面 プレビュー 巻き戻し 外部 vlc mpv',
  'settingslayout.chapter.library': 'ライブラリ',
  'settingslayout.chapter.starting': '動画を始める',
  'settingslayout.chapter.skip-tuning': 'スキップの微調整',
  'settingslayout.chapter.player-look': '見た目',
  'settingslayout.chapter.player-controls': '操作',
  'settingslayout.chapter.player-window': 'ウィンドウとその他',
  'settingslayout.chapter.subtitle-text': '言語とテキスト',
  'settingslayout.chapter.choosing-source': 'ソースの選び方',
  'settingslayout.chapter.ranking-rules': '並べ方のルール',
  'settingslayout.preview': 'プレビュー',
  'settingslayout.none': 'なし',
};
