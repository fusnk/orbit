import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': '自分のJellyfinサーバーから再生します。サーバーにある映画やエピソードにはJellyfinのソースが表示され、その行をホームに追加できます。Orbitが保存するのはサーバーのログイントークンだけで、パスワードは保存しません。',
  'jellyfin.settings.server': 'サーバーのアドレス',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'ユーザー名',
  'jellyfin.settings.password': 'パスワード',
  'jellyfin.settings.fields-hint': 'ブラウザでJellyfinを開くときのアドレスです。Jellyfin 10.9以降が必要です。',
  'jellyfin.settings.connect': '接続',
  'jellyfin.settings.connecting': '接続中…',
  'jellyfin.settings.server-label': 'サーバー',
  'jellyfin.settings.connected-as': '{server}に{user}として接続中',
  'jellyfin.settings.connected': '{server}に接続しました。',
  'jellyfin.settings.connected-first': '{server}に接続しました。ホームに「最近追加された作品」を追加しました。他のJellyfinの行は「設定 → ホームとライブラリ → ホームの行」で追加できます。',
  'jellyfin.settings.disconnect': '切断',
  'jellyfin.settings.disconnected': '切断し、サーバーからログアウトしました。',
  'jellyfin.settings.insecure': '保護されていない通信',
  'jellyfin.settings.insecure-title': 'このサーバーは暗号化されていないhttpを使用しているため、ログイン情報や動画は暗号化されずに送信されます。家庭内では問題ありませんが、インターネット経由ではhttpsを使用してください。',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': '続きを見る',
  'jellyfin.rows.latest': '最近追加された作品',
  'jellyfin.rows.label': 'Jellyfin：{row}',
  'jellyfin.rows.not-connected': '先に「設定 → アカウントとサービス」でJellyfinサーバーに接続してください。',
  'jellyfin.rows.libraries-failed': 'サーバーのライブラリを読み込めませんでした。',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
