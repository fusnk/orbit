import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': "Yeni bölümler",
  'alerts.bell.unread.one': "Yeni bölümler: {count} okunmamış",
  'alerts.bell.unread.other': "Yeni bölümler: {count} okunmamış",
  'alerts.panel.heading': "Yeni bölümler",
  'alerts.panel.mark-read': "Tümünü okundu say",
  'alerts.panel.empty': "Henüz yeni bir şey yok. Takip ettiğin dizilerin yeni bölümleri burada görünür.",
  'alerts.panel.play': "Oynat",
  'alerts.panel.play-label': "Oynat: {show} S{season}B{episode}",
  'alerts.panel.aired': "Yayın tarihi: {date}",
  'alerts.toast.episode': "S{season}B{episode} ‘{title}’ yayında",
  'alerts.toast.grouped-title': "Yeni bölümler",
  'alerts.toast.grouped.one': "Takip ettiğin dizilerden {count} yeni bölüm: {shows}",
  'alerts.toast.grouped.other': "Takip ettiğin dizilerden {count} yeni bölüm: {shows}",
  'alerts.settings.enabled': "Yeni bölüm bildirimleri",
  'alerts.settings.enabled-hint': "Başlık çubuğundaki zil, son baktığından beri yayınlanan bölümleri listeler. Açılışta ve birkaç saatte bir kontrol edilir.",
  'alerts.settings.toasts': "Masaüstü bildirimleri göster",
  'alerts.settings.toasts-hint': "Her yeni bölüm için bir sistem bildirimi (aynı anda birkaç tane gelirse hepsi için tek bir bildirim), Orbit arka plandayken bile.",
  'alerts.settings.scope': "Bildirim kapsamı",
  'alerts.settings.scope-hint': "İzlediğin diziler geçmişindeki dizilerdir; kitaplığın kaydettiğin tüm dizileri ekler.",
  'alerts.settings.scope-watching': "İzlediğim diziler",
  'alerts.settings.scope-library': "Kitaplığımdaki her şey",
};
