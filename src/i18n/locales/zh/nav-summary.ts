import type { navSummary as source } from '../en/nav-summary';
import type { Catalog } from '../types';

/** Chinese strings for the line under each Settings category saying what it's set to. */
export const navSummary: Catalog<typeof source> = {
  'navsummary.more': '{name} 及另外 {count} 个',
  'navsummary.scale': '缩放 {percent}',
  'navsummary.size': '大小 {percent}',
  'navsummary.banner': '横幅：{style}',
  'navsummary.watched-at': '看到 {percent} 算看完',
  'navsummary.spoilers-hidden': '隐藏剧透',
  'navsummary.spoilers-shown': '显示剧透',
  'navsummary.autoplay': '自动播放：{mode}',
  'navsummary.player-layout': '{name} 布局',
  'navsummary.no-addons': '没有插件',
  'navsummary.not-connected': '尚未连接',
  'navsummary.downloads.none': '还没有下载',
  'navsummary.downloads.done.one': '已下载 {count} 个',
  'navsummary.downloads.done.other': '已下载 {count} 个',
  'navsummary.downloads.active.one': '{count} 个进行中',
  'navsummary.downloads.active.other': '{count} 个进行中',
  'navsummary.shortcuts.one': '{count} 个快捷键',
  'navsummary.shortcuts.other': '{count} 个快捷键',
};
