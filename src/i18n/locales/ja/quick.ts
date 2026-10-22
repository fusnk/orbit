import type { quick as source } from '../en/quick';
import type { Catalog } from '../types';

export const quick: Catalog<typeof source> = {
  'quick.button': 'クイック設定',
  'quick.heading': 'クイック設定',
  'quick.switch-profile': 'プロフィールを切り替え',
  'quick.pause-history': '視聴履歴を一時停止',
  'quick.pause-history-hint': '再生したものは視聴履歴や「続きを見る」に追加されず、Stremio、Jellyfin、Plexにも送信されません。',
  'quick.look': 'ルック',
  'quick.look-custom': 'カスタム',
  'quick.trailers': '予告編を自動再生',
  'quick.trailers-partly': '作品ページまたはバナーのみオンです。オンにすると両方で予告編を再生します。',
  'quick.skip-intros': 'オープニングを自動でスキップ',
  'quick.all-settings': 'すべての設定',
  'quick.chip': '履歴を一時停止中',
  'quick.chip-label': '視聴履歴は一時停止中です。クイック設定を開く',
  'quick.paused': '視聴履歴を一時停止しました。これから再生するものは記録に残りません。',
  'quick.resumed': '視聴履歴を再開しました。',
  'quick.palette.pause': '視聴履歴を一時停止',
  'quick.palette.resume': '視聴履歴を再開',
};
