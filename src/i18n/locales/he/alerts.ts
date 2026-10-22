import type { alerts as source } from '../en/alerts';
import type { Catalog } from '../types';

export const alerts: Catalog<typeof source> = {
  'alerts.bell.label': 'פרקים חדשים',
  'alerts.bell.unread.one': 'פרקים חדשים: {count} שלא נקרא',
  'alerts.bell.unread.other': 'פרקים חדשים: {count} שלא נקראו',
  'alerts.panel.heading': 'פרקים חדשים',
  'alerts.panel.mark-read': 'סימון הכול כנקרא',
  'alerts.panel.empty': 'אין עדיין חדש. פרקים חדשים של סדרות שעוקבים אחריהן יופיעו כאן.',
  'alerts.panel.play': 'הפעלה',
  'alerts.panel.play-label': 'הפעלת {show} S{season}E{episode}',
  'alerts.panel.aired': 'שודר ב-{date}',
  'alerts.toast.episode': 'S{season}E{episode} “{title}” כבר כאן',
  'alerts.toast.grouped-title': 'פרקים חדשים',
  'alerts.toast.grouped.one': '{count} פרק חדש מסדרות שעוקבים אחריהן: {shows}',
  'alerts.toast.grouped.other': '{count} פרקים חדשים מסדרות שעוקבים אחריהן: {shows}',
  'alerts.settings.enabled': 'התראות על פרקים חדשים',
  'alerts.settings.enabled-hint': 'הפעמון בשורת הכותרת מציג פרקים ששודרו מאז הביקור האחרון. נבדק בהפעלה ובכל כמה שעות.',
  'alerts.settings.toasts': 'הצגת התראות שולחן עבודה',
  'alerts.settings.toasts-hint': 'התראת מערכת על כל פרק חדש (התראה אחת לכולם כשכמה מגיעים יחד), גם כש-Orbit ברקע.',
  'alerts.settings.scope': 'התראה על',
  'alerts.settings.scope-hint': 'סדרות בצפייה הן הסדרות שבהיסטוריה; הספרייה מוסיפה כל סדרה שנשמרה.',
  'alerts.settings.scope-watching': 'סדרות שאני צופה בהן',
  'alerts.settings.scope-library': 'כל מה שבספרייה שלי',
};
