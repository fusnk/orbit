import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Chinese strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': '浏览',
  'remote.phone.browse-loading': '正在加载你的首页…',
  'remote.phone.browse-empty': '暂时没有内容。在 Orbit 中添加目录插件即可填充首页。',
  'remote.phone.browse-failed': '无法加载你的首页。请重试。',
  'remote.phone.refresh': '刷新',
  'remote.phone.moods': '想看点什么？',
  'remote.phone.mood-loading': '正在寻找推荐…',
  'remote.phone.mood-empty': '这种心情暂时没有推荐。',
  'remote.phone.surprise': '给我惊喜',
  'remote.phone.surprise-hint': '从你的目录中随机挑选一部。',
  'remote.phone.surprise-movie': '电影',
  'remote.phone.surprise-series': '剧集',
  'remote.phone.surprise-none': '暂时没有新的推荐。试试另一种类型，或在 Orbit 中更改“给我惊喜”的选项。',
  'remote.phone.details-loading': '正在加载详情…',
  'remote.phone.details-failed': '无法加载此作品。请重试。',
  'remote.phone.add-library': '加入片库',
  'remote.phone.in-library': '已在你的片库中',
  'remote.phone.close': '关闭',
  'remote.phone.season': '第 {number} 季',
  'remote.phone.specials': '特别篇',
  'remote.phone.episodes': '剧集列表',
  'remote.phone.rating': 'IMDb 评分 {rating}',
};
