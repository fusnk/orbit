import type { parental as source } from '../en/parental';
import type { Catalog } from '../types';

export const parental: Catalog<typeof source> = {
  // מקטע “הגבלת תוכן” בעורך הפרופיל
  'parental.heading': 'הגבלת תוכן',
  'parental.level.off': 'כבוי',
  'parental.level.kids': 'ילדים',
  'parental.level.older-kids': 'ילדים גדולים',
  'parental.level.teens': 'נוער',
  'parental.level.no-adult': 'הכול חוץ ממבוגרים',
  'parental.about.off': 'כל מה שהתוספים שלך מציעים.',
  'parental.about.kids': 'רק כותרים שמתאימים לכל הגילים: G, TV-Y, TV-Y7 ו-TV-G, או המקבילה במדינה שלך (U בבריטניה, FSK 0 ו-6 בגרמניה).',
  'parental.about.older-kids': 'בנוסף PG ו-TV-PG (PG בבריטניה, עד גיל 11 בערך במקומות אחרים).',
  'parental.about.teens': 'בנוסף PG-13 ו-TV-14 (12 ו-12A בבריטניה, FSK 12 בגרמניה).',
  'parental.about.no-adult': 'בנוסף R ו-TV-MA. רק סיווגים למבוגרים בלבד (NC-17, X, R18) מוסתרים.',
  'parental.addons-note': 'תוספים שמסומנים כתוכן למבוגרים מוסתרים בכל פרופיל עם הגבלה.',
  'parental.unrated': 'הצגת כותרים ללא סיווג',
  'parental.unrated-hidden': 'כותרים ש-Orbit לא מוצא להם סיווג מוסתרים. זה כולל את רוב הכותרים מתוספים שלא משתמשים במזהי IMDb.',
  'parental.unrated-shown': 'כותרים ש-Orbit לא מוצא להם סיווג מוצגים.',
  'parental.live-tv': 'הצגת שידור חי',
  'parental.live-tv-hint': 'לערוצי טלוויזיה אין סיווג, ולכן ההגבלה לא יכולה לסנן אותם.',
  'parental.region': 'הסיווגים נקראים קודם עבור {country}, ואחר כך עבור ארה״ב.',
  'parental.needs-tmdb': 'הסיווגים מגיעים מ-TMDB, שלא מחובר (הגדרות ← חשבונות ושירותים). עד שיחובר, כל כותר נחשב ללא סיווג, ובפרופיל הזה לא יוצג אף כותר ללא סיווג, לא משנה מה המתג למעלה. לכן לא יוצג כמעט כלום.',
  'parental.no-parent': 'לאף פרופיל ללא הגבלה אין PIN, כך שכל אחד יכול לשנות את ההגבלה הזו. כדאי להגדיר PIN לפרופיל שלך.',
  'parental.open-profiles': 'כל מי שבפרופיל הזה עדיין יכול לעבור אל {names}: בלי PIN ובלי הגבלה.',
  'parental.who-changes': 'הקלה או הסרה של הגבלה דורשות PIN של פרופיל ללא הגבלה.',
  'parental.badge': 'הגבלת תוכן: {level}',
  // בקשת PIN של הורה
  'parental.parent-pin': 'PIN של הורה',
  'parental.parent-pin-prompt': 'יש להזין PIN של פרופיל ללא הגבלת תוכן.',
  'parental.parent-pin-create': 'כל עוד לפרופיל יש הגבלת תוכן, הוספת פרופיל דורשת PIN של פרופיל ללא הגבלה.',
  // איפה הגבלה עוצרת משהו
  'parental.blocked.title': 'לא זמין בפרופיל הזה',
  'parental.blocked.rated': '{name} מסווג {rating}, מעל ההגבלה של הפרופיל הזה ({level}).',
  'parental.blocked.adult': '{name} מסומן כתוכן למבוגרים.',
  'parental.blocked.unrated': 'Orbit לא מצא סיווג עבור {name}, והפרופיל הזה מסתיר כותרים ללא סיווג.',
  'parental.blocked.toast': '{name} לא זמין בפרופיל הזה.',
  'parental.blocked.checking': 'Orbit עדיין בודק את הסיווג של {name}. הדף ייפתח מעצמו כשהוא יהיה ידוע.',
  'parental.blocked.checking-toast': 'Orbit עדיין בודק את הסיווג של {name}. אפשר לנסות שוב בעוד רגע.',
  'parental.blocked.unreachable': 'Orbit לא הצליח לבדוק כרגע את הסיווג של {name}. אפשר לנסות שוב בעוד רגע.',
  'parental.blocked.live': 'השידור החי כבוי בפרופיל הזה.',
};
