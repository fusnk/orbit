import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': '最適な一致',
  'subs.error.sdh': '聴覚障害者向けテキストの設定を適用できませんでした',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': '聴覚障害者向けテキストを削除',
  'subs.settings.strip-sdh-hint': '[ドアがきしむ音]のような音の説明、音楽の表記、JOHN:のような話者名を字幕から隠します。空になった行は飛ばされ、タイミングは変わりません。',
  'subs.settings.keep-lyrics': '歌詞を残す',
  'subs.settings.keep-lyrics-hint': '聴覚障害者向けテキストを削除しても、♪の付いた歌の行は残ります。音符だけの行は削除されます。',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': '字幕を下部に固定できませんでした',
  'subs.player.position': '字幕の位置',
  'subs.player.height': '高さ',
  'subs.player.raised': '{value}%上',
  'subs.player.reset': '下部にリセット',
  'subs.player.keep-bottom': '下部に固定',
  'subs.player.keep-bottom-hint': 'プレーンな字幕（SRTなど）ではファイル内の位置指定を無視し、すべての行をこの高さに表示します。動画に含まれるプレーンな字幕は斜体も失われます。スタイル付き字幕（アニメで一般的なASS）は独自のレイアウトのままです。すべての動画で記憶されます。',
};
