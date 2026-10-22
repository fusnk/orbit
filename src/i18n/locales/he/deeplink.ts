import type { deeplink as source } from '../en/deeplink';
import type { Catalog } from '../types';

/** Hebrew text for addon install links opened from a website. */
export const deeplink: Catalog<typeof source> = {
  'deeplink.from-website': 'נפתח מקישור התקנה באתר אינטרנט. כדאי לבדוק את התוסף שלמטה לפני ההתקנה.',
  'deeplink.unusable': 'Orbit לא יכול להשתמש בקישור הזה. רק קישורי התקנה של תוספים (שמסתיימים ב-manifest.json) נפתחים כאן.',
  'deeplink.after-video': 'התקבל קישור להתקנת תוסף. Orbit יפתח אותו כשהסרטון יסתיים.',
  'deeplink.home-network': 'ברשת הביתית שלך',
  'deeplink.home-network-note': 'הקישור הזה מפנה למחשב הזה או למכשיר ברשת הביתית שלך. Orbit עדיין לא פנה אליו. כדאי להמשיך רק אם מצפים למצוא שם תוסף.',
  'deeplink.continue': 'המשך',
};
