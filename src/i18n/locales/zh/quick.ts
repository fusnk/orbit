import type { quick as source } from '../en/quick';
import type { Catalog } from '../types';

export const quick: Catalog<typeof source> = {
  'quick.button': "快捷设置",
  'quick.heading': "快捷设置",
  'quick.switch-profile': "切换个人资料",
  'quick.pause-history': "暂停观看记录",
  'quick.pause-history-hint': "你播放的内容不会加入观看记录或继续观看，也不会发送到 Stremio、Jellyfin 或 Plex。",
  'quick.look': "风格",
  'quick.look-custom': "自定义",
  'quick.trailers': "自动播放预告片",
  'quick.trailers-partly': "仅在详情页或横幅中开启。打开后两处都会播放预告片。",
  'quick.skip-intros': "自动跳过片头",
  'quick.all-settings': "所有设置",
  'quick.chip': "观看记录已暂停",
  'quick.chip-label': "观看记录已暂停。打开快捷设置",
  'quick.paused': "观看记录已暂停。现在播放的内容不会留下痕迹。",
  'quick.resumed': "观看记录已恢复。",
  'quick.palette.pause': "暂停观看记录",
  'quick.palette.resume': "恢复观看记录",
};
