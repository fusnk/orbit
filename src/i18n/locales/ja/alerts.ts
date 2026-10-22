import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': '新しいエピソード',
  'alerts.bell.unread.one': '新しいエピソード：未読{count}件',
  'alerts.bell.unread.other': '新しいエピソード：未読{count}件',
  'alerts.panel.heading': '新しいエピソード',
  'alerts.panel.mark-read': 'すべて既読にする',
  'alerts.panel.empty': '新着はまだありません。フォロー中の番組の新しいエピソードがここに表示されます。',
  'alerts.panel.play': '再生',
  'alerts.panel.play-label': '{show} S{season}E{episode}を再生',
  'alerts.panel.aired': '{date}放送',
  'alerts.toast.episode': 'S{season}E{episode}「{title}」が公開されました',
  'alerts.toast.grouped-title': '新しいエピソード',
  'alerts.toast.grouped.one': 'フォロー中の番組に新しいエピソードが{count}件あります：{shows}',
  'alerts.toast.grouped.other': 'フォロー中の番組に新しいエピソードが{count}件あります：{shows}',
  'alerts.settings.enabled': '新しいエピソードの通知',
  'alerts.settings.enabled-hint': 'タイトルバーのベルに、前回確認してから放送されたエピソードが表示されます。起動時と数時間ごとに確認します。',
  'alerts.settings.toasts': 'デスクトップ通知を表示',
  'alerts.settings.toasts-hint': '新しいエピソードごとにシステム通知を表示します（複数同時の場合はまとめて1件）。Orbitがバックグラウンドにあっても表示されます。',
  'alerts.settings.scope': '通知の対象',
  'alerts.settings.scope-hint': '「視聴中の番組」は視聴履歴にあるシリーズです。「ライブラリ内のすべて」では、保存したすべてのシリーズが対象になります。',
  'alerts.settings.scope-watching': '視聴中の番組',
  'alerts.settings.scope-library': 'ライブラリ内のすべて',
};
