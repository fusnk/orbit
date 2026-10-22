import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Japanese strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} 他{count}件',
  'navsummary.scale': '拡大率 {percent}',
  'navsummary.size': 'サイズ {percent}',
  'navsummary.banner': 'バナー: {style}',
  'navsummary.watched-at': '{percent}で視聴済み',
  'navsummary.spoilers-hidden': 'ネタバレを隠す',
  'navsummary.spoilers-shown': 'ネタバレを表示',
  'navsummary.autoplay': '自動再生: {mode}',
  'navsummary.player-layout': 'レイアウト: {name}',
  'navsummary.no-addons': 'アドオンなし',
  'navsummary.not-connected': '未接続',
  'navsummary.downloads.none': 'ダウンロードなし',
  'navsummary.downloads.done.one': 'ダウンロード済み {count}件',
  'navsummary.downloads.done.other': 'ダウンロード済み {count}件',
  'navsummary.downloads.active.one': '進行中 {count}件',
  'navsummary.downloads.active.other': '進行中 {count}件',
  'navsummary.shortcuts.one': 'ショートカット {count}件',
  'navsummary.shortcuts.other': 'ショートカット {count}件',
};
