import type { palette as source } from '../en/palette';
import type { Catalog } from '../types';

export const palette: Catalog<typeof source> = {
  'palette.label': 'コマンドパレット',
  'palette.placeholder': '作品、設定、アドオン、操作を検索',
  // Group headings
  'palette.group.recent': '最近',
  'palette.group.suggested': 'おすすめ',
  'palette.group.yours': 'マイコンテンツ',
  'palette.group.titles': '作品',
  'palette.group.settings': '設定',
  'palette.group.addons': 'アドオン',
  'palette.group.actions': '操作',
  // Titles from addons, while typing
  'palette.titles.searching': 'アドオンで検索中…',
  'palette.titles.none': '作品が見つかりません',
  'palette.titles.none-can-search': '検索できるアドオンがありません',
  'palette.titles.failed': 'アドオンで検索できませんでした',
  'palette.search-all': '「{query}」のすべての結果を検索',
  'palette.no-match': '「{query}」に一致する項目はありません',
  // Where a title of yours was found
  'palette.from.continue': '続きを見る',
  'palette.from.library': 'ライブラリ内',
  'palette.from.queue': 'キュー内',
  'palette.from.downloads': 'ダウンロード済み',
  'palette.from.watched': '視聴済み',
  'palette.from.list': 'リスト',
  // What a result is
  'palette.kind.page': 'ページ',
  'palette.kind.shortcut': 'ショートカット · {key}',
  'palette.kind.addon': 'アドオン',
  'palette.kind.category': '設定',
  'palette.kind.setting': '設定 · {category}',
  'palette.setting-hidden': '「{setting}」は「{parent}」を変更すると表示されます。',
  'palette.kind.movie': '映画',
  'palette.kind.series': 'シリーズ',
  'palette.kind.title': '作品',
  // Actions
  'palette.action.profile': 'プロフィールを切り替え',
  'palette.action.shortcuts': 'キーボードショートカット',
  'palette.action.install-addon': 'アドオンをインストール…',
  'palette.action.addon-updates': 'アドオンのアップデートを確認',
  // The key hints along the bottom
  'palette.hint.move': '移動',
  'palette.hint.open': '開く',
  'palette.hint.groups': '次のグループ',
  'palette.hint.close': '閉じる',
  // Other words people may type for each Settings category
  'palette.keywords.general': '言語 起動 開く 閉じる 終了 ウィンドウ トレイ 拡大 縮小 ズーム 動き 視覚効果 アクセシビリティ 通知 アラート バックアップ 復元 診断 ログ インポート trakt letterboxd',
  'palette.keywords.playback': '自動再生 次のエピソード 再開 続き スキップ イントロ オープニング 予告編',
  'palette.keywords.addons': 'インストール ストア 拡張機能 プラグイン ソース 画質 トレント 除外 優先',
  'palette.keywords.downloads': 'オフライン 保存 ストレージ フォルダ 画質',
  'palette.keywords.appearance': 'テーマ 色 カラー アクセント フォント ダーク ライト 壁紙 背景 アンビエント ロゴ ルック',
  'palette.keywords.shortcuts': 'キーボード ホットキー キー 割り当て',
  'palette.keywords.home-library': 'アニメ ホーム 行 視聴済み 続きを見る ネタバレ ストーリー アーク ライブラリ メタデータ',
  'palette.keywords.subtitles': '字幕 キャプション 言語 強制字幕 同期 タイミング 聴覚障害者向け 歌詞 フォント サイズ 色 カラー',
  'palette.keywords.picture-sound': '映像 画面 ビデオ ハードウェア デコード hdr 音声 オーディオ サウンド 言語 パススルー 音量',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord ストリーミングサービス 同期 アカウント debrid tmdb 連携 iptv ライブtv チャンネル m3u xtream 番組表',
  // Settings → Shortcuts
  'palette.shortcut': 'コマンドパレット',
};
