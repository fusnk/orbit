import type { subs as source } from '../en/subs';
import type { Catalog } from '../types';

export const subs: Catalog<typeof source> = {
  'subs.best-match': "最佳匹配",
  'subs.error.sdh': "无法应用听障字幕设置",
  'subs.settings.strip-sdh': "移除听障辅助文字",
  'subs.settings.strip-sdh-hint': "从字幕中隐藏 [门吱呀作响] 这类声音描述、音乐提示以及 JOHN: 这类说话人名字。变空的行会被跳过，时间轴不变。",
  'subs.settings.keep-lyrics': "保留歌词",
  'subs.settings.keep-lyrics-hint': "移除听障辅助文字时，标有 ♪ 的演唱行会保留。只有音符的行仍会移除。",
  'subs.error.override': "无法将字幕固定在底部",
  'subs.player.position': "字幕位置",
  'subs.player.height': "高度",
  'subs.player.raised': "上移 {value}%",
  'subs.player.reset': "重置到底部",
  'subs.player.keep-bottom': "固定在底部",
  'subs.player.keep-bottom-hint': "普通字幕（如 SRT）会忽略文件中的位置设置，每一行都显示在这个高度。视频内嵌的普通字幕也会失去斜体。带样式的字幕（ASS，动画中常见）保留自己的排版。对所有视频生效。",
};
