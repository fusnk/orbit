import type { showcase as source } from '../en/showcase';
import type { Catalog } from '../types';

export const showcase: Catalog<typeof source> = {
  // Settings → Appearance → Title page.
  'showcase.setting.label': '作品ページ',
  'showcase.setting.hint': 'クラシックはアートワークをカード内に表示します。ショーケースはアートワークをウィンドウ全体に広げ、詳細を下のセクションに表示します。',
  'showcase.setting.classic': 'クラシック',
  'showcase.setting.showcase': 'ショーケース',
  // The hero.
  'showcase.start-episode': 'S{season} · E{episode}を再生',
  'showcase.ends-at': '{time}に終了',
  'showcase.ends-at-hint': '今から見始めた場合の終了時刻',
  'showcase.age-rating': '年齢制限：{rating}',
  'showcase.streaming-on': '{provider}で配信中',
  // Episodes.
  'showcase.choose-season': 'シーズン',
  'showcase.choose-arc': 'ストーリーアーク',
  'showcase.episode-count.one': '{count}エピソード',
  'showcase.episode-count.other': '{count}エピソード',
  'showcase.episode-length': '{number} · {minutes}分',
  'showcase.season-actions': 'シーズンの操作',
  'showcase.download-season.one': 'シーズンをダウンロード（{count}エピソード）',
  'showcase.download-season.other': 'シーズンをダウンロード（{count}エピソード）',
  // Sections.
  'showcase.extras': '予告編と特典映像',
  'showcase.cast-crew': 'キャストとスタッフ',
  'showcase.photos': '写真',
  'showcase.stills': 'スチール写真',
  'showcase.topics': 'トピック',
  'showcase.topic-intro': 'TMDBで「{topic}」のタグが付いた映画と番組。',
  'showcase.where-to-watch': '視聴方法',
  'showcase.stream': '配信',
  'showcase.rent': 'レンタル',
  'showcase.buy': '購入',
  'showcase.justwatch': 'データ提供：JustWatch',
  'showcase.releases': '公開日',
  'showcase.cinemas-only': '現在は劇場公開のみです。早期に出回るコピーは通常、映画館で撮影されたものです。',
};
