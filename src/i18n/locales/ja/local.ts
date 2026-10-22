import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'ドロップして再生',
  'local.drop.video-hint': '動画はOrbitで再生されます。',
  'local.drop.subtitle-hint': '字幕は再生中の動画に追加されます。',
  'local.drop.first-only': '{name}を再生しています。Orbitは一度に1つのファイルしか再生できないため、残りは除外されました。',
  'local.drop.failed': 'そのファイルを開けませんでした。',
  'local.drop.unsupported': 'Orbitはその種類のファイルを再生できません。',
  'local.drop.subtitle-needs-player': '先に動画を再生してから、字幕をドロップしてください。',
  'local.drop.subtitle-added': '字幕を追加しました：{name}',
  'local.drop.subtitle-first-only': '字幕を追加しました：{name}。最初のファイルのみ使用しました。',
  'local.drop.subtitle-failed': 'その字幕を追加できませんでした。',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'このPC',
  'local.source.label': 'ローカルファイル',
  // Settings → Player → External player
  'local.external.heading': '外部プレーヤー',
  'local.external.player': 'ソースを開くプレーヤー',
  'local.external.player-hint': 'ソース選択画面のWebソースに「外部プレーヤーで開く」を追加します。再開、イントロのスキップ、トラックの記憶、視聴の進捗はOrbitのプレーヤーでのみ機能します。',
  'local.external.none': 'なし',
  'local.external.custom': 'カスタム',
  'local.external.found': '検出：{path}',
  'local.external.not-found': '通常のインストールフォルダーに見つかりません。「カスタム」を選んで場所を指定してください。',
  'local.external.custom-path': 'プログラム',
  'local.external.custom-path-hint': 'このPCで選んだプレーヤーのプログラムファイルです。',
  'local.external.choose': '選択…',
  'local.external.custom-invalid': 'Orbit はそれを起動できません。プレーヤーのプログラムファイルを選んでください。',
  'local.external.always': '常に外部プレーヤーで開く',
  'local.external.always-hint': '再生を押すと最適なWebソースを直接渡します。トレントとダウンロードは引き続きOrbitで再生されます。',
  // The source picker
  'local.external.open': '外部',
  'local.external.open-label': '外部プレーヤーで開く',
  'local.external.opened': '外部プレーヤーで開きました。',
  'local.external.failed': '外部プレーヤーが起動しませんでした。「設定 → プレーヤー」を確認してください。',
};
