import type { local as source } from '../en/local';
import type { Catalog } from '../types';

export const local: Catalog<typeof source> = {
  // השכבה שמוצגת בזמן גרירת קבצים מעל החלון
  'local.drop.title': 'שחרור להפעלה',
  'local.drop.video-hint': 'הסרטון יופעל ב-Orbit.',
  'local.drop.subtitle-hint': 'הכתוביות יתווספו למה שמתנגן.',
  'local.drop.first-only': 'מפעיל את {name}. Orbit מפעיל קובץ אחד בכל פעם, לכן השאר הושמטו.',
  'local.drop.failed': 'לא הצלחנו לפתוח את הקובץ.',
  'local.drop.unsupported': 'Orbit לא יכול להפעיל סוג קובץ כזה.',
  'local.drop.subtitle-needs-player': 'קודם מפעילים סרטון, ואז משחררים עליו כתוביות.',
  'local.drop.subtitle-added': 'נוספו כתוביות: {name}',
  'local.drop.subtitle-first-only': 'נוספו כתוביות: {name}. נעשה שימוש רק בקובץ הראשון.',
  'local.drop.subtitle-failed': 'לא הצלחנו להוסיף את הכתוביות.',
  // קובץ ששוחרר בנגן (“טוען מ-{addon}…”)
  'local.source.addon': 'המחשב הזה',
  'local.source.label': 'קובץ מקומי',
  // הגדרות → נגן → נגן חיצוני
  'local.external.heading': 'נגן חיצוני',
  'local.external.player': 'פתיחת מקורות ב',
  'local.external.player-hint': 'מוסיף “פתיחה בנגן חיצוני” למקורות אינטרנט בבחירת המקור. המשך מנקודת העצירה, דילוג על הפתיח, רצועות שנשמרו והתקדמות הצפייה עובדים רק בנגן של Orbit.',
  'local.external.none': 'ללא',
  'local.external.custom': 'מותאם אישית',
  'local.external.found': 'נמצא: {path}',
  'local.external.not-found': 'לא נמצא בתיקיית ההתקנה הרגילה שלו. אפשר לבחור מותאם אישית ולציין את המיקום שלו.',
  'local.external.custom-path': 'תוכנה',
  'local.external.custom-path-hint': 'קובץ התוכנה של הנגן, שנבחר במחשב הזה.',
  'local.external.choose': 'בחירה…',
  'local.external.custom-invalid': 'Orbit לא יכול להפעיל את זה. יש לבחור את קובץ התוכנה של הנגן.',
  'local.external.always': 'תמיד לפתוח בנגן החיצוני',
  'local.external.always-hint': 'הפעלה מעבירה אליו ישירות את מקור האינטרנט הטוב ביותר. טורנטים והורדות עדיין מופעלים ב-Orbit.',
  // בחירת המקור
  'local.external.open': 'חיצוני',
  'local.external.open-label': 'פתיחה בנגן חיצוני',
  'local.external.opened': 'נפתח בנגן החיצוני.',
  'local.external.failed': 'הנגן החיצוני לא הופעל. כדאי לבדוק בהגדרות ← נגן.',
};
