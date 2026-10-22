import type { playertools as source } from '../en/playertools';
import type { Catalog } from '../types';

export const playertools: Catalog<typeof source> = {
  'playertools.speed.custom': "自定义",
  'playertools.speed.custom-label': "自定义速度",
  'playertools.speed.slower': "更慢（−0.05×）",
  'playertools.speed.faster': "更快（+0.05×）",
  'playertools.subs.try-another': "换一个字幕",
  'playertools.subs.try-another-detail': "{language}中的下一个最佳匹配",
  'playertools.subs.cycled': "字幕 {position}/{total} · {source}",
  'playertools.subs.no-other': "没有其他字幕可换",
  'playertools.paste.action': "粘贴字幕…",
  'playertools.paste.detail': "SRT 或 WebVTT 文本",
  'playertools.paste.title': "粘贴字幕",
  'playertools.paste.hint': "粘贴 SRT 或 WebVTT 文件的文本。它只会添加到这个视频。",
  'playertools.paste.field': "字幕文本",
  'playertools.paste.placeholder': "1\n00:00:01,000 --> 00:00:03,000\n你好！",
  'playertools.paste.add': "添加字幕",
  'playertools.paste.cancel': "取消",
  'playertools.paste.empty': "请先粘贴一些字幕文本。",
  'playertools.paste.too-big': "文本超过 2 MB。",
  'playertools.paste.bad': "这看起来不像 SRT 或 WebVTT 字幕。",
  'playertools.paste.added': "已添加粘贴的字幕",
  'playertools.paste.name': "粘贴的字幕",
  'playertools.caps.setting': "修正全大写字幕",
  'playertools.caps.hint': "全部用大写字母书写的行会改为句首大写。适用于来自插件的字幕、你添加的文件和粘贴的文本，不适用于视频文件内嵌的字幕。人名的大写也会被去掉。",
  'playertools.caps.error': "无法应用全大写修正设置",
};
