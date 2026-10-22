import type { spoilers as source } from '../en/spoilers';
import type { Catalog } from '../types';

export const spoilers: Catalog<typeof source> = {
  'spoilers.heading': 'ספוילרים',
  'spoilers.intro': 'מה להסתיר על פרקים: בדף של סדרה, ברשימת הפרקים בנגן, בכרטיס הבא בתור ובהמשך צפייה.',
  'spoilers.titles': 'הסתרת שמות הפרקים',
  'spoilers.titles-hint': 'מציג “פרק 4” במקום שם הפרק.',
  'spoilers.descriptions': 'הסתרת תיאורי הפרקים',
  'spoilers.descriptions-hint': 'משמיט את התקציר של כל פרק.',
  'spoilers.thumbnails': 'טשטוש תמונות הפרקים',
  'spoilers.thumbnails-hint': 'ריחוף או מיקוד על פרק מאפשרים להציץ.',
  'spoilers.ratings': 'הסתרת דירוגי הפרקים',
  'spoilers.ratings-hint': 'דירוג יכול לחשוף אילו פרקים חשובים.',
  'spoilers.unaired': 'הסתרת תאריכי שידור של פרקים קרובים',
  'spoilers.unaired-hint': 'בפרקים שעוד לא יצאו כתוב רק “עוד לא שודר”.',
  'spoilers.scope': 'חל על',
  'spoilers.scope-hint': 'פרקים שסיימתם או התחלתם מציגים הכול, אלא אם בוחרים בכל הפרקים.',
  'spoilers.scope-unwatched': 'פרקים שלא צפיתי בהם',
  'spoilers.scope-all': 'כל הפרקים',
};
