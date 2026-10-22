import type { sources as source } from '../en/sources';
import type { Catalog } from '../types';

export const sources: Catalog<typeof source> = {
  'sources.limits.heading': "自动播放限制",
  'sources.limits.any': "不限",
  'sources.limits.min-quality': "自动播放的最低画质",
  'sources.limits.min-quality-hint': "“播放”和下一集只会自动启动至少达到此画质的片源（未标明画质的不算）。如果都不符合，会播放最好的一个并告诉你。片源列表仍显示全部。仅对此个人资料生效。",
  'sources.limits.max-quality': "自动播放的最高画质",
  'sources.limits.max-quality-hint': "“播放”和下一集不会自动启动高于此画质的片源，除非找不到其他片源。与“首选最高画质”不同，它不会调整片源列表的顺序。仅对此个人资料生效。",
  'sources.limits.max-size': "自动播放的文件大小上限",
  'sources.limits.max-size-hint': "适用于网速慢或流量有限的情况：“播放”和下一集会跳过更大的文件。未标明大小的片源不受影响。仅对此个人资料生效。",
  'sources.autoplay.outside-limits': "没有片源符合你的自动播放限制，正在播放最好的片源。",
  'sources.autoplay.only-uncached': "找到的所有片源都还在下载到你的 Debrid 服务。选择一个即可开始。",
  'sources.note.uncached': "未缓存",
  'sources.note.uncached-hint': "仍在下载到你的 Debrid 服务：不会自动启动",
  'sources.note.outside-limits': "超出自动播放限制",
  'sources.note.outside-limits-hint': "“播放”和下一集会跳过它（设置 → 插件与来源 → 片源偏好 → 自动播放限制）",
  'sources.next-up.unaired': "即将播放 · 播出日期未确认",
};
