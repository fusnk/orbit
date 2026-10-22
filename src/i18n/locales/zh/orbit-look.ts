import type { orbitLook as source } from '../en/orbit-look';
import type { Catalog } from '../types';

/** Chinese strings for the Orbit Arc Look. */
export const orbitLook: Catalog<typeof source> = {
  'orbitlook.look-hint': "保留 Orbit 原有页面，只换控件：链接紧跟在文字标志之后，当前页面用取自标志圆环的弧线标出；横幅由一个计时圆环显示进度；Arc 播放器的播放按钮会随观看进度逐渐填满。",
  'orbitlook.nav': "弧形栏",
  'orbitlook.nav-hint': "链接紧跟文字标志，当前页面用弧线标出。",
  'orbitlook.player': "弧形",
  'orbitlook.player-hint': "左侧是标题，中间是胶囊控件，播放圆环随观看进度填满，右侧是工具。",
  'orbitlook.hero.previous': "上一部",
  'orbitlook.hero.next': "下一部",
  'orbitlook.hero.position': "第 {index} 部，共 {count} 部",
};
