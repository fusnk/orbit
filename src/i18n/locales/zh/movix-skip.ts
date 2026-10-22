import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "来自 AniSkip 的动画跳过时间",
  'movix.aniskip-hint': "对于动画，还会向免费的社区数据库 AniSkip 查询片头曲、片尾曲和前情提要的位置。只发送作品的 MyAnimeList ID 和集数；为识别作品，可能会从 GitHub 下载一份公开的 ID 列表。在你开启前保持关闭。",
  'movix.smooth': "平滑跳过",
  'movix.smooth-hint': "跳过时画面短暂淡出为黑色、声音降低，然后再淡入恢复。开启“减少动态效果”时立即跳过。",
  'movix.button-delay': "跳过按钮出现前等待",
  'movix.button-delay-hint': "让片头或片尾先播放一会儿再显示“跳过”，以免按钮遮住一场戏的结尾。自动跳过不会等待。",
  'movix.button-delay-none': "立即",
  'movix.landing': "在结尾前停下",
  'movix.landing-hint': "跳过会停在片头或前情提要结束前的这段时间处，避免切掉紧随其后的第一个画面。一直放到结尾的片尾仍会跳到结尾。",
  'movix.landing-none': "在结尾",
  'movix.color-intro': "片头颜色",
  'movix.color-recap': "前情提要颜色",
  'movix.color-credits': "片尾颜色",
  'movix.color-preview': "下集预告颜色",
  'movix.colors-hint': "每个部分在进度条上的颜色。",
  'movix.swatch.default': "标准",
  'movix.swatch.amber': "琥珀色",
  'movix.swatch.sky': "天蓝色",
  'movix.swatch.mint': "薄荷绿",
  'movix.swatch.rose': "玫瑰色",
  'movix.swatch.violet': "紫罗兰色",
  'movix.swatch.white': "白色",
};
