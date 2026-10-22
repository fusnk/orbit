import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': "剧透",
  'spoilers.intro': "要隐藏哪些单集信息：剧集详情页、播放器的分集列表、即将播放卡片以及继续观看中都会生效。",
  'spoilers.titles': "隐藏单集标题",
  'spoilers.titles-hint': "显示“第 4 集”，而不是单集名称。",
  'spoilers.descriptions': "隐藏单集简介",
  'spoilers.descriptions-hint': "不显示每一集的剧情简介。",
  'spoilers.thumbnails': "模糊单集图片",
  'spoilers.thumbnails-hint': "将鼠标悬停或聚焦在某一集上即可查看。",
  'spoilers.ratings': "隐藏单集评分",
  'spoilers.ratings-hint': "评分可能会暴露哪几集是关键剧情。",
  'spoilers.unaired': "隐藏未播出单集的播出日期",
  'spoilers.unaired-hint': "尚未播出的单集只显示“尚未播出”。",
  'spoilers.scope': "适用于",
  'spoilers.scope-hint': "已看完或已开始看的单集会显示全部信息，除非你选择“所有单集”。",
  'spoilers.scope-unwatched': "我没看过的单集",
  'spoilers.scope-all': "所有单集",
};
