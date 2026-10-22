import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': "新剧集",
  'alerts.bell.unread.one': "新剧集：{count} 条未读",
  'alerts.bell.unread.other': "新剧集：{count} 条未读",
  'alerts.panel.heading': "新剧集",
  'alerts.panel.mark-read': "全部标为已读",
  'alerts.panel.empty': "暂时没有新内容。你关注的剧集有新的一集时会显示在这里。",
  'alerts.panel.play': "播放",
  'alerts.panel.play-label': "播放 {show} S{season}E{episode}",
  'alerts.panel.aired': "{date} 播出",
  'alerts.toast.episode': "S{season}E{episode}《{title}》已上线",
  'alerts.toast.grouped-title': "新剧集",
  'alerts.toast.grouped.one': "你关注的剧集有 {count} 集更新：{shows}",
  'alerts.toast.grouped.other': "你关注的剧集有 {count} 集更新：{shows}",
  'alerts.settings.enabled': "新剧集提醒",
  'alerts.settings.enabled-hint': "标题栏中的铃铛会列出你上次查看后播出的剧集。启动时以及每隔几小时检查一次。",
  'alerts.settings.toasts': "显示桌面通知",
  'alerts.settings.toasts-hint': "每有新的一集就发出一条系统通知（同时更新多集时合并为一条），即使 Orbit 在后台运行也会提醒。",
  'alerts.settings.scope': "提醒范围",
  'alerts.settings.scope-hint': "“我在看的剧集”是你观看记录中的剧集；片库会加上所有已保存的剧集。",
  'alerts.settings.scope-watching': "我在看的剧集",
  'alerts.settings.scope-library': "我片库中的全部内容",
};
