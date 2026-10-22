import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': '새 에피소드',
  'alerts.bell.unread.one': '새 에피소드: 읽지 않음 {count}개',
  'alerts.bell.unread.other': '새 에피소드: 읽지 않음 {count}개',
  'alerts.panel.heading': '새 에피소드',
  'alerts.panel.mark-read': '모두 읽음으로 표시',
  'alerts.panel.empty': '아직 새로운 소식이 없어요. 팔로우하는 시리즈의 새 에피소드가 여기에 표시돼요.',
  'alerts.panel.play': '재생',
  'alerts.panel.play-label': '{show} S{season}E{episode} 재생',
  'alerts.panel.aired': '{date} 방영',
  'alerts.toast.episode': 'S{season}E{episode} ‘{title}’ 공개',
  'alerts.toast.grouped-title': '새 에피소드',
  'alerts.toast.grouped.one': '팔로우하는 시리즈의 새 에피소드 {count}개: {shows}',
  'alerts.toast.grouped.other': '팔로우하는 시리즈의 새 에피소드 {count}개: {shows}',
  'alerts.settings.enabled': '새 에피소드 알림',
  'alerts.settings.enabled-hint': '제목 표시줄의 종 아이콘에 마지막으로 확인한 이후 방영된 에피소드가 표시돼요. 시작할 때와 몇 시간마다 확인해요.',
  'alerts.settings.toasts': '데스크톱 알림 표시',
  'alerts.settings.toasts-hint': 'Orbit이 백그라운드에 있을 때도 새 에피소드마다 시스템 알림을 보내요(여러 개가 한꺼번에 나오면 하나로 묶어요).',
  'alerts.settings.scope': '알림 대상',
  'alerts.settings.scope-hint': '시청 중인 시리즈는 시청 기록에 있는 시리즈이고, 라이브러리를 선택하면 저장한 모든 시리즈가 포함돼요.',
  'alerts.settings.scope-watching': '시청 중인 시리즈',
  'alerts.settings.scope-library': '내 라이브러리의 모든 작품',
};
