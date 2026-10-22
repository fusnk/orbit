import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': '開始',
  'explore.filters.year-to': '終了',
  'explore.filters.runtime': '上映時間',
  'explore.filters.runtime-min': '最短',
  'explore.filters.runtime-max': '最長',
  'explore.filters.minutes': '{count}分',
  'explore.filters.cast': 'キャスト',
  'explore.filters.director': '監督・スタッフ',
  'explore.filters.person-search': '人物を検索：{what}',
  'explore.filters.person-placeholder': '名前を入力',
  'explore.filters.person-none': '見つかりませんでした',
  'explore.filters.person-clear': '{name}を削除',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': '巻き戻し用キャッシュ',
  'settings.player.rewind-hint': '動画のどれだけをメモリに保持するかを設定します。保持しておくと、すぐに巻き戻せます。「多め」は再生中に最大約600 MB、「最大」は最大約1.5 GBのRAMを使用します。次の動画から適用されます。',
  'settings.player.rewind-standard': '標準',
  'settings.player.rewind-more': '多め',
  'settings.player.rewind-most': '最大',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': '文字の不透明度',
  'subs.style.box-colour': 'ボックスの色',
  'subs.style.box-opacity': 'ボックスの不透明度',
  'subs.style.box-opacity-hint': 'プレーヤーは角丸を描画できないため、ボックスの角は四角になります。',
  'subs.style.outline-colour': '縁取りの色',
  'player.subtitle-style.black': '黒',
  'player.subtitle-style.grey': 'グレー',
  'player.subtitle-style.navy': 'ネイビー',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': '応答なし',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count}個インストール済み',
  'addons.health.installed.other': '{count}個インストール済み',
  'addons.health.enabled.one': '{count}個有効',
  'addons.health.enabled.other': '{count}個有効',
  'addons.health.refresh': 'アドオンを更新',
  'addons.health.refreshing': '{name}を更新中…',
  'addons.health.refreshed': '{name}を更新しました。',
  'addons.health.unchanged': '{name}から応答がありました。変更はありません。',
  'addons.health.refresh-failed': '{name}が応答しませんでした。Orbitはこれまでの内容を使い続けます。',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': '最小サイズ',
  'sources.rules.min-size-hint': '映画に適用され、エピソードはその3分の1が基準になります。これより小さいファイル（偽物や劇場での撮影版であることが多いもの）は他のすべての後に並びますが、非表示にはなりません。サイズを示さないソースには影響しません。',
  'titles.why.under-size': '最小サイズ{size} GB未満',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'コレクションを検索',
  'collections.search.placeholder': 'コレクションを検索',
  'collections.search.none': '一致するコレクションはありません',
  'collections.search.none-detail': '名前とグループが検索対象です。',
  'collections.search.titles-label': 'このコレクション内の作品を検索',
  'collections.search.titles-placeholder': '作品を検索',
  'collections.search.no-titles': '一致する作品はありません',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'カレンダーにエクスポート（.ics）',
  'radar.export.hint': 'リリースレーダーの内容を、どのカレンダーアプリでもインポートできるファイルとして保存します。',
  'radar.export.name': 'Orbit リリースレーダー',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{seconds}秒後に{label}',
  'playerplus.settings.skip-delay': '自動スキップまでの待ち時間',
  'playerplus.settings.skip-delay-hint': '「自動」に設定した区間では、スキップボタンが先にカウントダウンします。いずれかのキーを押すと止めて、そのまま見られます。',
  'playerplus.settings.skip-delay-none': '待たない',
};
