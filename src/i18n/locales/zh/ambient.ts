import type { ambient as source } from '../en/ambient';
import type { Catalog } from '../types';

export const ambient: Catalog<typeof source> = {
  'ambient.label': "氛围模式",
  'ambient.hint.details': "按 Enter 查看详情",
  'ambient.slide.resume': "继续播放",
  'ambient.slide.resume-episode': "继续播放 {episode}",
  'ambient.slide.library': "在我的片库中",
  'ambient.slide.recent': "最近看过",
  'ambient.slide.trending': "当下热门",
  'ambient.settings.heading': "氛围模式",
  'ambient.settings.after': "启动时间",
  'ambient.settings.after-hint': "在这段时间内没有任何操作时，Orbit 会淡入缓慢播放的海报幻灯片。播放内容时不会启动。",
  'ambient.settings.source': "显示内容",
  'ambient.settings.source-hint': "你在看和已保存的内容、热门内容，或两者交替显示。",
  'ambient.settings.source-for-you': "为你推荐",
  'ambient.settings.source-trending': "热门",
  'ambient.settings.source-both': "两者",
  'ambient.settings.clock': "显示时钟",
  'ambient.settings.clock-hint': "在角落显示时间和日期。",
  'ambient.settings.paused': "暂停时也启动",
  'ambient.settings.paused-hint': "暂停达到这段时间后，在播放器上方启动。播放状态保持不变。",
  'ambient.settings.preview': "预览",
  'ambient.settings.preview-label': "立即查看",
  'ambient.settings.preview-hint': "立即启动氛围模式。按任意键或移动鼠标即可返回。",
};
