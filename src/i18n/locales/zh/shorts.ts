import type { shorts as source } from '../en/shorts';
import type { Catalog } from '../types';

export const shorts: Catalog<typeof source> = {
  'shorts.title': "短片",
  'shorts.tile': "一个接一个看预告片",
  'shorts.loading': "正在查找预告片…",
  'shorts.empty-title': "没有可显示的预告片",
  'shorts.empty-body': "目前没有你还没看过的热门作品。请稍后再试。",
  'shorts.failed-title': "无法加载短片",
  'shorts.failed-body': "请检查网络连接后重试。",
  'shorts.end-title': "你已经全部看完了",
  'shorts.end-body': "稍后再来看看更多预告片。",
  'shorts.open': "打开作品页面",
  'shorts.save': "保存到片库",
  'shorts.saved': "已在我的片库中",
  'shorts.play': "播放预告片",
  'shorts.no-trailer': "此作品没有预告片。",
  'shorts.previous': "上一个预告片",
  'shorts.next': "下一个预告片",
};
