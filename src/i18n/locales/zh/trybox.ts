import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "音量增强",
  'trybox.boost.note': "限幅器可防止增强后的音频失真。",
  'trybox.boost.off': "关闭",
  'trybox.boost.passthrough': "请关闭音频直通以增强音量。",
  'trybox.controls.title': "控件大小",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "小",
  'trybox.controls.medium': "中",
  'trybox.controls.large': "大",
  'trybox.info.pin': "在屏幕上显示播放信息",
  'trybox.info.dropped': "丢帧数",
  'trybox.info.fps': "帧率",
  'trybox.hub.shortcuts': "快捷键",
  'trybox.hub.controls': "控件大小",
  'trybox.hub.info': "屏幕信息",
  'trybox.subtitle.sample': "字幕将显示为这样。",
  'trybox.subtitle.font': "字体",
};
