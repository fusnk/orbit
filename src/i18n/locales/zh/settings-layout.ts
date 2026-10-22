import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Chinese strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': '播放器的外观、控件的行为，以及其他播放器。',
  'settingslayout.intro.playback': '按下播放、下一集、跳过和预告片。',
  'settingslayout.intro.appearance': '风格、颜色、菜单、背景、作品页和海报。',
  'settingslayout.keywords.player': '播放器 布局 控件 进度条 跳转 音量 增强 最小化 全屏 预览 回退 外部 vlc mpv',
  'settingslayout.chapter.library': '片库',
  'settingslayout.chapter.starting': '开始播放视频',
  'settingslayout.chapter.skip-tuning': '跳过的细调',
  'settingslayout.chapter.player-look': '外观',
  'settingslayout.chapter.player-controls': '控件',
  'settingslayout.chapter.player-window': '窗口与其他',
  'settingslayout.chapter.subtitle-text': '语言与文字',
  'settingslayout.chapter.choosing-source': '选择片源',
  'settingslayout.chapter.ranking-rules': '排序规则',
  'settingslayout.preview': '预览',
  'settingslayout.none': '无',
};
