import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  // The idle screen itself
  'ambient.label': 'アンビエントモード',
  'ambient.hint.details': 'Enterで詳細',
  'ambient.slide.resume': '再開',
  'ambient.slide.resume-episode': '{episode}を再開',
  'ambient.slide.library': 'マイライブラリ内',
  'ambient.slide.recent': '最近見た作品',
  'ambient.slide.trending': '今人気',
  // Settings → Appearance → Ambient mode
  'ambient.settings.heading': 'アンビエントモード',
  'ambient.settings.after': '開始までの時間',
  'ambient.settings.after-hint': 'この時間何も操作がないと、Orbitはアートワークのゆっくりしたスライドショーに切り替わります。再生中は切り替わりません。',
  'ambient.settings.source': '表示する内容',
  'ambient.settings.source-hint': '視聴中や保存した作品、人気の作品、またはその両方を交互に表示します。',
  'ambient.settings.source-for-you': 'おすすめ',
  'ambient.settings.source-trending': 'トレンド',
  'ambient.settings.source-both': '両方',
  'ambient.settings.clock': '時計を表示',
  'ambient.settings.clock-hint': '隅に時刻と日付を表示します。',
  'ambient.settings.paused': '一時停止中も表示',
  'ambient.settings.paused-hint': 'この時間一時停止が続くと、プレーヤーの上で開始します。再生状態はそのまま保持されます。',
  'ambient.settings.preview': 'プレビュー',
  'ambient.settings.preview-label': '今すぐ見る',
  'ambient.settings.preview-hint': 'すぐにアンビエントモードを開始します。いずれかのキーを押すかマウスを動かすと戻ります。',
};
