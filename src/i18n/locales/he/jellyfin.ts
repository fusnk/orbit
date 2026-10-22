import type { jellyfin as source } from '../en/jellyfin';
import type { Catalog } from '../types';

export const jellyfin: Catalog<typeof source> = {
  // הגדרות → שילובים → Jellyfin
  'jellyfin.settings.intro': 'הפעלה משרת Jellyfin משלך. סרטים ופרקים שיש בו מקבלים מקור Jellyfin, והשורות שלו יכולות להופיע בדף הבית. Orbit שומר טוקן התחברות מהשרת, אף פעם לא את הסיסמה.',
  'jellyfin.settings.server': 'כתובת השרת',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'שם משתמש',
  'jellyfin.settings.password': 'סיסמה',
  'jellyfin.settings.fields-hint': 'הכתובת שבה פותחים את Jellyfin בדפדפן. דורש Jellyfin 10.9 ומעלה.',
  'jellyfin.settings.connect': 'חיבור',
  'jellyfin.settings.connecting': 'מתחבר…',
  'jellyfin.settings.server-label': 'שרת',
  'jellyfin.settings.connected-as': 'מחובר כ-{user} ב-{server}',
  'jellyfin.settings.connected': 'מחובר ל-{server}.',
  'jellyfin.settings.connected-first': 'מחובר ל-{server}. “נוספו לאחרונה” נמצא עכשיו בדף הבית; אפשר להוסיף עוד שורות Jellyfin בהגדרות ← בית וספרייה ← שורות בדף הבית.',
  'jellyfin.settings.disconnect': 'ניתוק',
  'jellyfin.settings.disconnected': 'נותק, וההתחברות לשרת הסתיימה.',
  'jellyfin.settings.insecure': 'לא מאובטח',
  'jellyfin.settings.insecure-title': 'השרת הזה משתמש ב-http רגיל, כך שההתחברות והסרטונים עוברים ללא הצפנה. בבית זה בסדר; דרך האינטרנט כדאי להשתמש ב-https.',
  // שורות בדף הבית
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'המשך צפייה',
  'jellyfin.rows.latest': 'נוספו לאחרונה',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'קודם יש לחבר שרת Jellyfin בהגדרות ← חשבונות ושירותים.',
  'jellyfin.rows.libraries-failed': 'לא הצלחנו לטעון את הספריות של השרת.',
  // בחירת המקור
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
