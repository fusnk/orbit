import type { subfonts as source } from '../en/subfonts';
import type { Catalog } from '../types';

export const subfonts: Catalog<typeof source> = {
  'subfonts.preview': "预览",
  'subfonts.preview-hint': "按播放器的绘制方式显示的字幕样例。大小和描边与播放器中的效果接近，但不完全相同。",
  'subfonts.fullscreen': "全屏预览",
  'subfonts.fullscreen-close': "按 Esc 或点击关闭",
  'subfonts.line1': "我从没想过我们能走到这一步。",
  'subfonts.line2': "我也没想到。我们继续吧。",
  'subfonts.font': "字体",
  'subfonts.font-label': "字幕字体",
  'subfonts.font-hint': "Atkinson Hyperlegible、Lexend 和 OpenDyslexic 专为易读而设计，随 Orbit 附带。带样式的字幕保留自己的字体。",
  'subfonts.default': "默认",
};
