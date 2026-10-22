import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Chinese strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "要更新此插件的设置吗？",
  'prfixes.addons.update-detail': "{name} 已经安装。这些设置会替换旧设置，它在列表中的位置保持不变。",
  'prfixes.addons.update': "更新",
  'prfixes.audio.original': "优先原始语言",
  'prfixes.audio.original-hint': "如果视频有对应音轨，每部电影或剧集都以其原始语言开始播放：动画用日语，韩剧用韩语。否则使用上面的音频语言。需要 TMDB 密钥。",
  'prfixes.bundle.local': "此地址指向这台电脑或你的家庭网络，因此 Orbit 没有连接它。",
};
