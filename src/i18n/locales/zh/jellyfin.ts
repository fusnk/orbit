import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  'jellyfin.settings.intro': "从你自己的 Jellyfin 服务器播放。服务器上有的电影和剧集会多出一个 Jellyfin 来源，它的栏目也可以放到首页。Orbit 只保存服务器给的登录令牌，绝不保存你的密码。",
  'jellyfin.settings.server': "服务器地址",
  'jellyfin.settings.server-placeholder': "http://192.168.1.10:8096",
  'jellyfin.settings.username': "用户名",
  'jellyfin.settings.password': "密码",
  'jellyfin.settings.fields-hint': "你在浏览器中打开 Jellyfin 时用的地址。需要 Jellyfin 10.9 或更新版本。",
  'jellyfin.settings.connect': "连接",
  'jellyfin.settings.connecting': "正在连接…",
  'jellyfin.settings.server-label': "服务器",
  'jellyfin.settings.connected-as': "已以 {user} 身份连接到 {server}",
  'jellyfin.settings.connected': "已连接到 {server}。",
  'jellyfin.settings.connected-first': "已连接到 {server}。“最近添加”已加入首页；可在 设置 → 首页与片库 → 首页栏目 中添加更多 Jellyfin 栏目。",
  'jellyfin.settings.disconnect': "断开连接",
  'jellyfin.settings.disconnected': "已断开连接，并已从服务器退出登录。",
  'jellyfin.settings.insecure': "不安全",
  'jellyfin.settings.insecure-title': "此服务器使用普通 http，你的登录信息和视频以未加密方式传输。在家里没问题；通过互联网使用时请用 https。",
  'jellyfin.rows.kind': "Jellyfin",
  'jellyfin.rows.resume': "继续观看",
  'jellyfin.rows.latest': "最近添加",
  'jellyfin.rows.label': "Jellyfin：{row}",
  'jellyfin.rows.not-connected': "请先在 设置 → 账号与服务 中连接 Jellyfin 服务器。",
  'jellyfin.rows.libraries-failed': "无法加载服务器的媒体库。",
  'jellyfin.source.origin': "Jellyfin · {server}",
};
